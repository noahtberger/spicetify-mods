// ============================================================================
// better-mix.js — a mix that's actually mostly music you don't already play
// ----------------------------------------------------------------------------
// Spotify's own mixes optimise for "you'll definitely like this", which
// collapses into songs you already listen to. This inverts that: it takes a
// playlist you like, asks Spotify what fits it, then SUBTRACTS everything you
// already play -- your library, your recent listening, and the playlist's own
// artists -- and keeps the popular remainder.
//
// WHY NONE OF THIS USES api.spotify.com:
// The public Web API refuses calls from the desktop client (every request,
// including /v1/me, comes back 429 no matter how long you wait). Everything
// here uses Spicetify.Platform instead -- the internal APIs the Spotify UI
// itself runs on. Those can't be closed off without breaking the app.
//
// The recommender is PlaylistAPI.getRecommendedTracks(uri, offset, limit),
// which is what powers "Recommended songs" at the bottom of a playlist.
// Note the POSITIONAL arguments -- passing an options object returns 400.
// ============================================================================

(function betterMix() {
  if (!(Spicetify?.Platform?.PlaylistAPI && Spicetify?.Playbar && Spicetify?.PopupModal)) {
    setTimeout(betterMix, 300);
    return;
  }

  const P = () => Spicetify.Platform;
  let logLine = () => {};

  // --- Reading your listening ------------------------------------------------
  async function myPlaylists() {
    const rl = await P().RootlistAPI.getContents({ limit: 200 });
    return (rl?.items || []).filter((i) => String(i?.uri).includes(":playlist:"));
  }

  async function playlistTracks(uri) {
    const c = await P().PlaylistAPI.getContents(uri);
    return c?.items || [];
  }

  // The extender pages. Ask in chunks until it stops giving us new ones.
  async function recommend(uri, want) {
    const out = [];
    const seen = new Set();
    for (let off = 0; out.length < want && off < 400; off += 50) {
      const batch = await P().PlaylistAPI.getRecommendedTracks(uri, off, 50);
      if (!batch?.length) break;
      let added = 0;
      for (const t of batch) {
        if (t?.uri && !seen.has(t.uri)) { seen.add(t.uri); out.push(t); added++; }
      }
      logLine(`  +${added} candidates (${out.length} total)`);
      if (added === 0) break;          // extender has run dry
    }
    return out;
  }

  // Everything we're going to subtract. Tracks by URI, artists by URI/id.
  async function knownStuff(sourceUri) {
    const tracks = new Set();
    const artists = new Set();
    const note = (t) => {
      if (t?.uri) tracks.add(t.uri);
      (t?.artists || []).forEach((a) => a && artists.add(a.uri || a.id));
    };

    // Recently played comes back as bare URI strings -- no artist data.
    try {
      const recent = await P().AssistedCurationAPI.getRecentlyPlayedTracks({ limit: 50 });
      (recent || []).forEach((u) => typeof u === "string" && tracks.add(u));
      logLine(`known: ${tracks.size} recently played`);
    } catch (e) { logLine("recently-played unavailable: " + e.message); }

    try {
      const lib = await P().LibraryAPI.getTracks({ limit: 300 });
      (lib?.items || []).forEach(note);
      logLine(`known: ${tracks.size} after your library`);
    } catch (e) { logLine("library unavailable: " + e.message); }

    // The source playlist's own artists count as "already yours" -- you asked
    // for songs by OTHER artists that fit, not more of the same ones.
    try {
      (await playlistTracks(sourceUri)).forEach(note);
      logLine(`known: ${tracks.size} tracks / ${artists.size} artists`);
    } catch (e) { logLine("source playlist unreadable: " + e.message); }

    return { tracks, artists };
  }

  // --- The algorithm ---------------------------------------------------------
  const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((p) => p[1]);

  async function buildMix({ sourceUri, total, familiarCount, maxPerArtist }) {
    logLine("gathering what you already listen to…");
    const known = await knownStuff(sourceUri);

    logLine("asking Spotify what fits this playlist…");
    const candidates = await recommend(sourceUri, Math.max(150, total * 6));
    if (!candidates.length) throw new Error("The recommender returned nothing for this playlist.");

    // The step Spotify won't do: drop anything you already play.
    const perArtist = new Map();
    const fresh = [];
    let cutTrack = 0, cutArtist = 0, cutCap = 0;

    for (const t of candidates.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))) {
      if (known.tracks.has(t.uri)) { cutTrack++; continue; }
      if ((t.artists || []).some((a) => known.artists.has(a.uri || a.id))) { cutArtist++; continue; }

      const key = t.artists?.[0]?.uri ?? "?";
      if ((perArtist.get(key) || 0) >= maxPerArtist) { cutCap++; continue; }
      perArtist.set(key, (perArtist.get(key) || 0) + 1);
      fresh.push(t);
    }

    logLine(`filtered: -${cutTrack} already played, -${cutArtist} your artists, -${cutCap} artist cap`);
    logLine(`${fresh.length} genuinely new tracks left`);
    if (!fresh.length) throw new Error("Nothing survived the filter — try a different playlist.");

    // A few tracks you know, spread through rather than front-loaded.
    const source = await playlistTracks(sourceUri).catch(() => []);
    const familiar = shuffle(source.filter((t) => t?.uri)).slice(0, familiarCount);
    const out = fresh.slice(0, Math.max(0, total - familiar.length));
    familiar.forEach((t, i) =>
      out.splice(Math.floor(((i + 1) * out.length) / (familiar.length + 1)), 0, t)
    );
    return out;
  }

  // --- Writing the playlist --------------------------------------------------
  async function createPlaylist(name, tracks) {
    const made = await P().RootlistAPI.createPlaylist(name, {});
    // createPlaylist has returned a bare URI string in testing, but normalise
    // in case it hands back an object instead.
    const uri = typeof made === "string" ? made : made?.uri;
    if (!uri) throw new Error("createPlaylist returned nothing usable: " + JSON.stringify(made));

    await P().PlaylistAPI.add(uri, tracks.map((t) => t.uri), {});
    return uri;
  }

  // --- UI --------------------------------------------------------------------
  async function openMenu() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<pre class="bmx-log" id="bmx-log">loading your playlists…</pre>`;
    Spicetify.PopupModal.display({ title: "Better Mix", content: wrap, isLarge: true });

    let lists = [];
    try { lists = await myPlaylists(); }
    catch (e) { wrap.querySelector("#bmx-log").textContent = "Couldn't read your playlists: " + e.message; return; }

    wrap.innerHTML = `
      <div class="bmx-row">
        <label style="flex:1 1 260px">Base it on
          <select class="bmx-in" id="bmx-src">
            ${lists.map((p) => `<option value="${p.uri}">${(p.name || p.uri).replace(/</g, "&lt;")}</option>`).join("")}
          </select>
        </label>
        <label>Size <input class="bmx-in" id="bmx-total" type="number" min="5" max="100" value="25"></label>
        <label>Ones you know <input class="bmx-in" id="bmx-fam" type="number" min="0" max="20" value="3"></label>
        <label>Max per artist <input class="bmx-in" id="bmx-cap" type="number" min="1" max="5" value="2"></label>
      </div>
      <div class="bmx-actions">
        <button class="bmx-btn" id="bmx-preview">Preview</button>
        <button class="bmx-btn bmx-primary" id="bmx-create">Create playlist</button>
      </div>
      <pre class="bmx-log" id="bmx-log"></pre>`;

    const logEl = wrap.querySelector("#bmx-log");
    logLine = (m) => { logEl.textContent += m + "\n"; logEl.scrollTop = logEl.scrollHeight; };
    const val = (id) => wrap.querySelector(id).value;

    const run = async (create) => {
      logEl.textContent = "";
      wrap.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        const tracks = await buildMix({
          sourceUri: val("#bmx-src"),
          total: +val("#bmx-total"),
          familiarCount: +val("#bmx-fam"),
          maxPerArtist: +val("#bmx-cap"),
        });
        logLine("");
        tracks.forEach((t, i) =>
          logLine(`${String(i + 1).padStart(2)}. ${t.name} — ${(t.artists || []).map((a) => a.name).join(", ")}${t.popularity ? `  (${t.popularity})` : ""}`)
        );
        if (create) {
          const name = "Better Mix — " + (lists.find((p) => p.uri === val("#bmx-src"))?.name || "mix");
          logLine("\ncreating playlist…");
          await createPlaylist(name, tracks);
          logLine("done — check your library");
          Spicetify.showNotification("Better Mix created");
        }
      } catch (e) {
        logLine("\nFAILED: " + (e?.message || e));
      } finally {
        wrap.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    };

    wrap.querySelector("#bmx-preview").onclick = () => run(false);
    wrap.querySelector("#bmx-create").onclick = () => run(true);
  }

  const M = '.GenericModal[aria-label="Better Mix"]';
  const css = document.createElement("style");
  css.textContent = `
    ${M} { width: min(700px, 94vw); }
    ${M} .main-trackCreditsModal-header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:20px 24px 10px; }
    ${M} .main-trackCreditsModal-header h1 { margin:0; font-size:20px; font-weight:700; }
    ${M} .main-trackCreditsModal-closeBtn { flex:0 0 32px; width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; margin:0; padding:0; border:0; border-radius:50%; background:transparent; color:var(--spice-subtext,#b3b3b3); cursor:pointer; }
    ${M} .main-trackCreditsModal-closeBtn:hover { background:rgba(255,255,255,.1); color:var(--spice-text,#fff); }
    ${M} .main-trackCreditsModal-closeBtn svg { display:block; width:14px; height:14px; }
    ${M} .main-trackCreditsModal-originalCredits { padding:6px 24px 24px; }
    .bmx-row { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:12px; align-items:flex-end; }
    .bmx-row label { display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--spice-subtext,#b3b3b3); }
    .bmx-in { padding:9px 10px; border-radius:8px; border:1px solid var(--spice-misc,#555); background:transparent; color:var(--spice-text,#fff); font-size:14px; max-width:100%; }
    .bmx-in:focus { outline:none; border-color:var(--spice-button,#1ed760); }
    .bmx-actions { display:flex; gap:10px; margin:4px 0 14px; }
    .bmx-btn { padding:10px 16px; border-radius:8px; border:1px solid var(--spice-misc,#555); background:transparent; color:var(--spice-text,#fff); font-size:14px; font-weight:600; cursor:pointer; }
    .bmx-btn:hover:not(:disabled) { border-color:var(--spice-button,#1ed760); background:rgba(255,255,255,.06); }
    .bmx-btn:disabled { opacity:.5; cursor:default; }
    .bmx-primary { border-color:var(--spice-button,#1ed760); color:var(--spice-button,#1ed760); }
    .bmx-log { max-height:340px; overflow:auto; margin:0; padding:12px; border-radius:8px; background:rgba(255,255,255,.04); color:var(--spice-text,#fff); font-size:12px; line-height:1.5; white-space:pre-wrap; }
    .bmx-playbar-btn { display:flex; align-items:center; justify-content:center; }
    .bmx-playbar-btn svg { display:block; }
  `;
  document.head.appendChild(css);

  const ICON = `<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons.enhance}</svg>`;
  new Spicetify.Playbar.Button("Better Mix", ICON, openMenu)
    .element.classList.add("bmx-playbar-btn");

  console.log("[better-mix] loaded");
})();
