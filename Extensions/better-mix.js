// ============================================================================
// better-mix.js — build a mix that's actually mostly new music
// ----------------------------------------------------------------------------
// Spotify's own mixes optimise for "you'll definitely like this", which
// collapses into songs you already play. This does the opposite: it seeds from
// your taste, then SUBTRACTS everything you already listen to, and keeps the
// popular tracks by artists you don't.
//
// The candidate source is deliberately pluggable (see SOURCES). Spotify
// deprecated /v1/recommendations and /v1/artists/{id}/related-artists for
// third-party apps in Nov 2024; whether they still answer the desktop
// client's own token is an empirical question. Swapping strategies is a
// one-line change so that answer can't invalidate the rest of this.
// ============================================================================

(function betterMix() {
  if (!(Spicetify?.CosmosAsync && Spicetify?.Playbar && Spicetify?.PopupModal && Spicetify?.showNotification)) {
    setTimeout(betterMix, 300);
    return;
  }

  const NS = "better-mix:";
  const DAY = 24 * 60 * 60 * 1000;
  const MIN_GAP_MS = 120;        // floor between requests
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let logLine = () => {};        // replaced by the modal while it's open

  // --- HTTP ------------------------------------------------------------------
  let lastCall = 0;

  // CosmosAsync RESOLVES on HTTP errors rather than rejecting -- the failure
  // arrives as an ordinary value carrying a `code`. try/catch never fires, so
  // checking r.code is the ONLY way to see it. Miss this and a 429 sails on
  // as if it were data and breaks somewhere confusing downstream.
  //
  // It also doesn't expose response headers, so we can't read Retry-After.
  // Exponential backoff is the best available substitute.
  async function api(url, { retries = 4 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const gap = MIN_GAP_MS - (Date.now() - lastCall);
      if (gap > 0) await sleep(gap);
      lastCall = Date.now();

      const r = await Spicetify.CosmosAsync.get(url);
      if (!r?.code) return r;

      if (r.code === 429) {
        const wait = 2000 * 2 ** attempt;
        logLine(`rate limited — waiting ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      throw new Error(`API ${r.code} on ${url.split("?")[0]}`);
    }
    throw new Error("Still rate limited. Leave it a few minutes and retry.");
  }

  // --- Cache -----------------------------------------------------------------
  // Your top tracks don't change hour to hour, and every cached read is a
  // request not spent. This is what keeps repeated runs off the rate limit.
  async function cached(key, ttl, fn) {
    const k = NS + key;
    try {
      const hit = JSON.parse(localStorage.getItem(k) || "null");
      if (hit && Date.now() - hit.at < ttl) return hit.data;
    } catch { /* corrupt entry -- fall through and refetch */ }

    const data = await fn();
    try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), data })); } catch {}
    return data;
  }

  const clearCache = () =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith(NS))
      .forEach((k) => localStorage.removeItem(k));

  // --- Your listening --------------------------------------------------------
  const topTracks = (range = "medium_term") =>
    cached(`top-tracks-${range}`, DAY, async () =>
      (await api(`https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=${range}`)).items || []
    );

  const topArtists = (range = "medium_term") =>
    cached(`top-artists-${range}`, DAY, async () =>
      (await api(`https://api.spotify.com/v1/me/top/artists?limit=50&time_range=${range}`)).items || []
    );

  // --- Candidate sources (swappable) ----------------------------------------
  const SOURCES = {
    // One request, but the endpoint may be closed to us.
    recommendations: async (seeds) => {
      const ids = seeds.slice(0, 5).map((t) => t.id).join(",");
      logLine("asking /recommendations…");
      const r = await api(
        `https://api.spotify.com/v1/recommendations?limit=100&seed_tracks=${ids}`
      );
      return r.tracks || [];
    },

    // Many requests, but heavily cached -- and it maps directly onto what you
    // asked for: popular tracks by artists adjacent to the ones you play.
    relatedArtists: async (_seeds, artists) => {
      const out = [];
      for (const a of artists.slice(0, 6)) {
        logLine(`related artists for ${a.name}…`);
        const rel = await cached(`related-${a.id}`, 7 * DAY, async () =>
          (await api(`https://api.spotify.com/v1/artists/${a.id}/related-artists`)).artists || []
        );
        for (const r of rel.slice(0, 4)) {
          const tt = await cached(`toptracks-${r.id}`, 7 * DAY, async () =>
            (await api(`https://api.spotify.com/v1/artists/${r.id}/top-tracks?market=from_token`)).tracks || []
          );
          out.push(...tt);
        }
      }
      return out;
    },
  };

  // --- The algorithm ---------------------------------------------------------
  const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((p) => p[1]);

  async function buildMix({ total, familiarCount, source, maxPerArtist }) {
    logLine("fetching your top tracks…");
    const mine = await topTracks();
    const artists = await topArtists();
    if (!mine.length) throw new Error("No listening history came back.");

    // Everything we're going to subtract.
    const knownTracks = new Set(mine.map((t) => t.id));
    const knownArtists = new Set(artists.map((a) => a.id));

    const candidates = await SOURCES[source](shuffle(mine).slice(0, 5), artists);
    logLine(`${candidates.length} candidates`);

    // The step Spotify won't do for you: drop anything you already listen to.
    const perArtist = new Map();
    const fresh = [];
    const seen = new Set();

    for (const t of candidates.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))) {
      if (!t?.id || seen.has(t.id) || knownTracks.has(t.id)) continue;
      if (t.artists?.some((a) => knownArtists.has(a.id))) continue;

      // Without this one artist's whole catalogue can swamp the mix.
      const key = t.artists?.[0]?.id ?? "?";
      if ((perArtist.get(key) || 0) >= maxPerArtist) continue;

      perArtist.set(key, (perArtist.get(key) || 0) + 1);
      seen.add(t.id);
      fresh.push(t);
    }

    logLine(`${fresh.length} genuinely new after filtering`);
    if (!fresh.length) throw new Error("Nothing survived the filter — try the other source.");

    const familiar = shuffle(mine).slice(0, familiarCount);
    const picked = fresh.slice(0, Math.max(0, total - familiar.length));

    // Spread the familiar ones through rather than front-loading them, so it
    // doesn't open with three songs you know and then feel like a stranger.
    const out = [...picked];
    familiar.forEach((t, i) => out.splice(Math.floor(((i + 1) * out.length) / (familiar.length + 1)), 0, t));
    return out;
  }

  // --- Playlist creation -----------------------------------------------------
  async function createPlaylist(tracks) {
    const me = await api("https://api.spotify.com/v1/me");
    const stamp = new Date().toISOString().slice(0, 10);
    const pl = await Spicetify.CosmosAsync.post(
      `https://api.spotify.com/v1/users/${me.id}/playlists`,
      { name: `Better Mix — ${stamp}`, description: "Mostly artists you don't already play.", public: false }
    );
    if (pl?.code) throw new Error(`Couldn't create playlist (${pl.code})`);

    const uris = tracks.map((t) => t.uri);
    for (let i = 0; i < uris.length; i += 100) {
      await Spicetify.CosmosAsync.post(
        `https://api.spotify.com/v1/playlists/${pl.id}/tracks`,
        { uris: uris.slice(i, i + 100) }
      );
    }
    return pl;
  }

  // --- UI --------------------------------------------------------------------
  function openMenu() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="bmx-row">
        <label>Playlist size <input class="bmx-in" id="bmx-total" type="number" min="5" max="100" value="20"></label>
        <label>Songs you know <input class="bmx-in" id="bmx-fam" type="number" min="0" max="20" value="3"></label>
        <label>Max per artist <input class="bmx-in" id="bmx-cap" type="number" min="1" max="5" value="2"></label>
      </div>
      <div class="bmx-row">
        <label>Source
          <select class="bmx-in" id="bmx-src">
            <option value="recommendations">Recommendations (1 request)</option>
            <option value="relatedArtists">Related artists (slower, cached)</option>
          </select>
        </label>
      </div>
      <div class="bmx-actions">
        <button class="bmx-btn" id="bmx-preview">Preview</button>
        <button class="bmx-btn bmx-primary" id="bmx-create">Create playlist</button>
        <button class="bmx-btn" id="bmx-clear">Clear cache</button>
      </div>
      <pre class="bmx-log" id="bmx-log"></pre>`;

    Spicetify.PopupModal.display({ title: "Better Mix", content: wrap, isLarge: true });

    const logEl = wrap.querySelector("#bmx-log");
    logLine = (m) => { logEl.textContent += m + "\n"; logEl.scrollTop = logEl.scrollHeight; };

    const opts = () => ({
      total: +wrap.querySelector("#bmx-total").value,
      familiarCount: +wrap.querySelector("#bmx-fam").value,
      maxPerArtist: +wrap.querySelector("#bmx-cap").value,
      source: wrap.querySelector("#bmx-src").value,
    });

    const run = async (create) => {
      logEl.textContent = "";
      try {
        const tracks = await buildMix(opts());
        logLine("");
        tracks.forEach((t, i) =>
          logLine(`${String(i + 1).padStart(2)}. ${t.name} — ${t.artists.map((a) => a.name).join(", ")}`)
        );
        if (create) {
          logLine("\ncreating playlist…");
          await createPlaylist(tracks);
          logLine("done — check your library");
          Spicetify.showNotification("Better Mix created");
        }
      } catch (e) {
        logLine("\nFAILED: " + e.message);
      }
    };

    wrap.querySelector("#bmx-preview").onclick = () => run(false);
    wrap.querySelector("#bmx-create").onclick = () => run(true);
    wrap.querySelector("#bmx-clear").onclick = () => { clearCache(); logLine("cache cleared"); };
  }

  const M = '.GenericModal[aria-label="Better Mix"]';
  const css = document.createElement("style");
  css.textContent = `
    ${M} { width: min(680px, 94vw); }
    ${M} .main-trackCreditsModal-header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:20px 24px 10px; }
    ${M} .main-trackCreditsModal-header h1 { margin:0; font-size:20px; font-weight:700; }
    ${M} .main-trackCreditsModal-closeBtn { flex:0 0 32px; width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; margin:0; padding:0; border:0; border-radius:50%; background:transparent; color:var(--spice-subtext,#b3b3b3); cursor:pointer; }
    ${M} .main-trackCreditsModal-closeBtn:hover { background:rgba(255,255,255,.1); color:var(--spice-text,#fff); }
    ${M} .main-trackCreditsModal-closeBtn svg { display:block; width:14px; height:14px; }
    ${M} .main-trackCreditsModal-originalCredits { padding:6px 24px 24px; }
    .bmx-row { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:12px; }
    .bmx-row label { display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--spice-subtext,#b3b3b3); }
    .bmx-in { padding:9px 10px; border-radius:8px; border:1px solid var(--spice-misc,#555); background:transparent; color:var(--spice-text,#fff); font-size:14px; }
    .bmx-in:focus { outline:none; border-color:var(--spice-button,#1ed760); }
    .bmx-actions { display:flex; gap:10px; margin:4px 0 14px; }
    .bmx-btn { padding:10px 16px; border-radius:8px; border:1px solid var(--spice-misc,#555); background:transparent; color:var(--spice-text,#fff); font-size:14px; font-weight:600; cursor:pointer; }
    .bmx-btn:hover { border-color:var(--spice-button,#1ed760); background:rgba(255,255,255,.06); }
    .bmx-primary { border-color:var(--spice-button,#1ed760); color:var(--spice-button,#1ed760); }
    .bmx-log { max-height:320px; overflow:auto; margin:0; padding:12px; border-radius:8px; background:rgba(255,255,255,.04); color:var(--spice-text,#fff); font-size:12px; line-height:1.5; white-space:pre-wrap; }
  `;
  document.head.appendChild(css);

  const ICON = `<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons.shuffle}</svg>`;
  const btn = new Spicetify.Playbar.Button("Better Mix", ICON, openMenu);
  btn.element.classList.add("bmx-playbar-btn");

  const css2 = document.createElement("style");
  css2.textContent = `.bmx-playbar-btn{display:flex;align-items:center;justify-content:center}.bmx-playbar-btn svg{display:block}`;
  document.head.appendChild(css2);

  console.log("[better-mix] loaded");
})();
