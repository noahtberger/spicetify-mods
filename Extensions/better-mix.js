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
  // A stub from the very first tick, so anything calling BetterMix before
  // init finishes gets a clear answer. Replaced with the real object at the
  // bottom once everything's ready -- or left standing, with the error, if
  // init throws, so "still starting" can never be a permanent state.
  window.BetterMix ||= {
    ready: false,
    open: () => Spicetify?.showNotification?.(window.__betterMixError
      ? `Better Mix failed to start: ${window.__betterMixError}`
      : "Better Mix is still starting — try again in a moment"),
  };
  if (window.__betterMixError) return;

  const startedAt = (window.__betterMixStart ??= Date.now());
  const waited = Date.now() - startedAt;
  // Truly required: the recommender and a way to talk to you. Everything
  // else is nice-to-have -- wait up to 10s for it, then carry on without.
  const core = !!(Spicetify?.Platform?.PlaylistAPI && Spicetify?.showNotification);
  const nice = {
    Playbar: !!Spicetify?.Playbar, PopupModal: !!Spicetify?.PopupModal,
    ContextMenu: !!Spicetify?.ContextMenu, PlayerAPI: !!Spicetify?.Platform?.PlayerAPI,
  };
  const missing = Object.keys(nice).filter((k) => !nice[k]);
  if (!core || (missing.length && waited < 10000)) {
    if (waited < 400) console.log("[better-mix] loaded, waiting for Spicetify…");
    else if (waited > 8000 && Date.now() - (window.__betterMixWarn || 0) > 8000) {
      window.__betterMixWarn = Date.now();
      console.warn(`[better-mix] still waiting after ${Math.round(waited / 1000)}s — ` +
        `${core ? "" : "no PlaylistAPI yet; "}missing: ${missing.join(", ") || "nothing"}`);
    }
    setTimeout(betterMix, 300);
    return;
  }
  if (missing.length) console.warn(`[better-mix] starting without: ${missing.join(", ")} (those features off)`);
  console.log(`[better-mix] initialised after ${waited}ms`);
  try {

  const P = () => Spicetify.Platform;
  let logLine = () => {};

  const SET_KEY = "better-mix:settings";
  const DEFAULTS = { total: 50, familiarCount: 3, maxPerArtist: 2 };
  const settings = () => { try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SET_KEY)) || {}) }; } catch { return { ...DEFAULTS }; } };
  const saveSettings = (o) => { try { localStorage.setItem(SET_KEY, JSON.stringify(o)); } catch {} };

  // home-mixes.js records the Spotify mix shelves it hides. Reading them from
  // storage means this works anywhere, not just while Home is on screen.
  const isMix = (x) => /^37i9dQZF1E/.test(String(x?.uri).split(":").pop()) && /\bmix\b/i.test(x?.name || "");
  const spotifyMixes = () => {
    try { return (JSON.parse(Spicetify.LocalStorage.get("home-mixes:sources")) || []).filter(isMix); }
    catch { return []; }
  };

  // --- Reading your listening ------------------------------------------------
  async function myPlaylists() {
    const rl = await P().RootlistAPI.getContents({ limit: 200 });
    return (rl?.items || []).filter((i) => String(i?.uri).includes(":playlist:"));
  }

  async function playlistTracks(uri) {
    const c = await P().PlaylistAPI.getContents(uri);
    return c?.items || [];
  }

  // The extender does NOT page -- any offset above 0 comes back 400, which
  // is what was killing every mix. It may hand back a different set on each
  // call though, so ask repeatedly at offset 0 and dedupe, stopping the
  // moment a call adds nothing new.
  async function recommend(uri, want) {
    const out = [];
    const seen = new Set();
    let limit = Math.min(100, Math.max(50, want));
    for (let call = 0; call < 5 && out.length < want; call++) {
      let batch;
      try {
        batch = await P().PlaylistAPI.getRecommendedTracks(uri, 0, limit);
      } catch (e) {
        if (limit > 50) { limit = 50; call--; continue; }   // 100 refused: retry once at 50
        throw new Error(`recommender refused this playlist (HTTP ${e?.status ?? "?"})`);
      }
      let added = 0;
      for (const t of batch || []) {
        if (t?.uri && !seen.has(t.uri)) { seen.add(t.uri); out.push(t); added++; }
      }
      logLine(`  +${added} candidates (${out.length} total)`);
      if (added === 0) break;
    }
    return out;
  }

  // Everything we're going to subtract. Tracks by URI, artists by URI/id.
  // Your recent listening and library don't change between one mix and the
  // next, so fetch them once and reuse for a few minutes. Building ten mixes
  // used to mean ten identical 300-track library reads.
  let base = null, baseAt = 0;
  async function baseKnown() {
    if (base && Date.now() - baseAt < 10 * 60 * 1000) return base;
    const tracks = new Set(), artists = new Set();
    const note = (t) => {
      if (t?.uri) tracks.add(t.uri);
      (t?.artists || []).forEach((a) => a && artists.add(a.uri || a.id));
    };
    try {   // recently played comes back as bare URI strings -- no artist data
      const recent = await P().AssistedCurationAPI.getRecentlyPlayedTracks({ limit: 50 });
      (recent || []).forEach((u) => typeof u === "string" && tracks.add(u));
    } catch (e) { logLine("recently-played unavailable: " + e.message); }
    try {
      const lib = await P().LibraryAPI.getTracks({ limit: 300 });
      (lib?.items || []).forEach(note);
    } catch (e) { logLine("library unavailable: " + e.message); }
    base = { tracks, artists }; baseAt = Date.now();
    return base;
  }

  // Everything we subtract for ONE mix: the shared base plus the source
  // playlist's own tracks and artists -- you asked for songs by OTHER artists
  // that fit, not more of the same ones.
  async function knownStuff(sourceUri) {
    const b = await baseKnown();
    const tracks = new Set(b.tracks), artists = new Set(b.artists);
    try {
      (await playlistTracks(sourceUri)).forEach((t) => {
        if (t?.uri) tracks.add(t.uri);
        (t?.artists || []).forEach((a) => a && artists.add(a.uri || a.id));
      });
    } catch (e) { logLine("source playlist unreadable: " + e.message); }
    logLine(`known: ${tracks.size} tracks / ${artists.size} artists`);
    return { tracks, artists };
  }

  // --- The algorithm ---------------------------------------------------------
  const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((p) => p[1]);

  async function buildMix({ sourceUri, total, familiarCount, maxPerArtist }) {
    logLine("gathering what you already listen to…");
    const known = await knownStuff(sourceUri);

    const source = (await playlistTracks(sourceUri).catch(() => [])).filter((t) => t?.uri).map(normalize);
    logLine(`source: ${source.length} tracks — e.g. ${source.slice(0, 3).map((t) => `${t.name} — ${(t.artists || []).map((a) => a.name).join(", ")}`).join("  ·  ")}`);

    // Script-based theme guard. Some of Spotify's mixes are defined by language
    // as much as genre -- J-Pop, K-Pop, música mexicana. If most of the source
    // is written in one non-Latin script, a candidate with none of that script
    // anywhere in its title, artist or album is almost certainly an outlier
    // that leaked in from your history, and gets dropped.
    const SCRIPTS = {
      Japanese: /[\u3040-\u30ff\u4e00-\u9fff]/, Korean: /[\uac00-\ud7af\u1100-\u11ff]/,
      Cyrillic: /[\u0400-\u04ff]/, Arabic: /[\u0600-\u06ff]/, Thai: /[\u0e00-\u0e7f]/,
      Hebrew: /[\u0590-\u05ff]/, Greek: /[\u0370-\u03ff]/, Devanagari: /[\u0900-\u097f]/,
    };
    const textOf = (t) => [t?.name, t?.album?.name, ...(t?.artists || []).map((a) => a?.name)].filter(Boolean).join(" ");
    let theme = null;
    if (source.length >= 5) {
      for (const [name, re] of Object.entries(SCRIPTS)) {
        const share = source.filter((t) => re.test(textOf(t))).length / source.length;
        if (share >= 0.6) { theme = { name, re, share }; break; }
      }
    }
    if (theme) logLine(`theme: ${theme.name} script in ${Math.round(theme.share * 100)}% of the source — candidates without it are dropped`);
    const offTheme = (t) => !!theme && !theme.re.test(textOf(t));
    const artistKeys = (t) => (t?.artists || []).flatMap((a) => [a?.uri, a?.id, a?.name]).filter(Boolean);
    const sourceArtists = new Set(source.flatMap(artistKeys));

    logLine("asking Spotify what fits this playlist…");
    const candidates = await recommend(sourceUri, Math.max(150, total * 6));
    if (!candidates.length) throw new Error("The recommender returned nothing for this playlist.");

    // The step Spotify won't do: drop anything you already play.
    const perArtist = new Map();
    const fresh = [];
    let cutTrack = 0, cutArtist = 0, cutCap = 0, cutTheme = 0;

    for (const t of candidates.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))) {
      if (known.tracks.has(t.uri)) { cutTrack++; continue; }
      if ((t.artists || []).some((a) => known.artists.has(a.uri || a.id))) { cutArtist++; continue; }
      if (offTheme(t)) { cutTheme++; continue; }

      const key = t.artists?.[0]?.uri ?? "?";
      if ((perArtist.get(key) || 0) >= maxPerArtist) { cutCap++; continue; }
      perArtist.set(key, (perArtist.get(key) || 0) + 1);
      t.why = "new";
      fresh.push(t);
    }

    logLine(`filtered: -${cutTrack} already played, -${cutArtist} your artists, -${cutCap} artist cap` + (theme ? `, -${cutTheme} off-script` : ""));
    logLine(`${fresh.length} genuinely new tracks left`);
    if (!fresh.length) throw new Error("Nothing survived the filter — try a different playlist.");

    // If the strict pass can't fill the mix, loosen in stages rather than
    // hand back a short playlist. Each stage is a little less "new" than the
    // one before, so it's logged: you should know when the tail of a mix was
    // filled by artists you already play. Top up to the full size -- the
    // slice below trims whatever the familiar tracks don't need.
    if (fresh.length < total) {
      const strict = fresh.length;
      const have = new Set(fresh.map((t) => t.uri));
      const pool = candidates.filter((t) => t?.uri && !have.has(t.uri) && !known.tracks.has(t.uri));
      let capUp = 0, knownUp = 0;

      // stage 1: more songs from the new artists we already found
      for (const t of pool) {
        if (fresh.length >= total) break;
        if (offTheme(t) || (t.artists || []).some((a) => known.artists.has(a.uri || a.id))) continue;
        const key = t.artists?.[0]?.uri ?? "?";
        if ((perArtist.get(key) || 0) >= maxPerArtist + 2) continue;
        perArtist.set(key, (perArtist.get(key) || 0) + 1);
        t.why = "top-up:new-artist";
        have.add(t.uri); fresh.push(t); capUp++;
      }
      // stage 2: songs you haven't played, by artists Spotify put in THIS mix.
      // Not "any artist you know" -- that's precisely how rap got into J-Pop.
      for (const t of pool) {
        if (fresh.length >= total) break;
        if (have.has(t.uri) || offTheme(t)) continue;
        if (!artistKeys(t).some((k) => sourceArtists.has(k))) continue;
        t.why = "top-up:mix-artist";
        have.add(t.uri); fresh.push(t); knownUp++;
      }

      if (capUp || knownUp)
        logLine(`strict pass gave ${strict} — topped up: +${capUp} more from the new artists, +${knownUp} unheard songs by this mix's own artists`);
      if (fresh.length < total)
        logLine(`still short at ${fresh.length}: the recommender only offered ${candidates.length} candidates for this one`);
    }

    // A few tracks you know, spread through rather than front-loaded -- but
    // only ones whose artist the recommender ALSO returned for this playlist.
    // Spotify's mixes carry a few outliers from your history (a rap track in
    // the J-Pop Mix), and without genre data the recommender's artist set is
    // the best signal there is for what actually fits.
    const onTheme = new Set(candidates.flatMap(artistKeys));
    const familiarPool = source.filter((t) => !offTheme(t) && artistKeys(t).some((k) => onTheme.has(k)));
    const familiar = shuffle(familiarPool).slice(0, familiarCount);
    familiar.forEach((t) => { t.why = "familiar"; });
    logLine(familiar.length
      ? `familiar (${familiarPool.length} eligible): ${familiar.map((t) => `${t.name} — ${(t.artists || []).map((a) => a.name).join(", ")}`).join("  ·  ")}`
      : "familiar: none of this mix's tracks are on-theme by the recommender's artists — none added");
    const out = fresh.slice(0, Math.max(0, total - familiar.length));
    familiar.forEach((t, i) =>
      out.splice(Math.floor(((i + 1) * out.length) / (familiar.length + 1)), 0, t)
    );
    return out;
  }

  // --- Writing the playlist --------------------------------------------------
  // Reuse one playlist per source rather than creating a new one every run.
  // Otherwise ten runs leaves ten near-identical playlists in your library --
  // and anything linking to the mix (the Home row) points at a stale one.
  async function saveMix(name, tracks) {
    const existing = (await myPlaylists()).find((p) => p.name === name);
    let uri = existing?.uri;

    if (uri) {
      logLine("refreshing the existing playlist…");
      const old = await playlistTracks(uri);
      if (old.length) {
        // remove() wants positions, not URIs -- clear from the end so earlier
        // indices stay valid as we go.
        await P().PlaylistAPI.remove(uri, old.map((t, i) => ({ uri: t.uri, uid: t.uid, index: i })).reverse());
      }
    } else {
      logLine("creating the playlist…");
      const made = await P().RootlistAPI.createPlaylist(name, {});
      uri = typeof made === "string" ? made : made?.uri;
      if (!uri) throw new Error("createPlaylist returned nothing usable: " + JSON.stringify(made));
    }

    await P().PlaylistAPI.add(uri, tracks.map((t) => t.uri), {});
    return uri;
  }

  // --- The virtual store --------------------------------------------------------
  // Built mixes live here, in this client's storage, NOT as Spotify playlists.
  // home-mixes.js draws its row from this and plays straight from it. Nothing
  // reaches your library unless you save one. This file is the only writer.
  const VIRT_KEY = "better-mix:virtual";
  const readVirtual = () => { try { return JSON.parse(localStorage.getItem(VIRT_KEY)) || []; } catch { return []; } };
  const writeVirtual = (list) => {
    try { localStorage.setItem(VIRT_KEY, JSON.stringify(list)); } catch (e) { console.warn("[better-mix] store write failed", e); }
    window.dispatchEvent(new Event("better-mix:updated"));
  };
  // PlaylistAPI.getContents items aren't shaped like recommender tracks:
  // duration is {milliseconds}, art is album.images[]. Flatten to one shape so
  // a familiar track gets a cover and a time like everything else -- without
  // this they showed as a grey square and "NaN:NaN".
  const normalize = (t) => ({
    ...t,
    duration: typeof t?.duration === "object" ? (t.duration?.milliseconds ?? null) : (t?.duration ?? null),
    album: {
      ...(t?.album || {}),
      imageUrl: t?.album?.imageUrl || t?.album?.images?.[0]?.url || t?.album?.image || null,
      largeImageUrl: t?.album?.largeImageUrl || t?.album?.images?.slice(-1)?.[0]?.url || null,
    },
  });

  // Keep only what a card needs. Full track objects x 30 mixes would bloat
  // localStorage for no benefit.
  const slim = (t) => ({
    uri: t.uri, name: t.name,
    duration: t.duration ?? null,                                   // for the page's clock column
    artists: (t.artists || []).map((a) => ({ name: a.name, uri: a.uri || null })),
    album: { name: t.album?.name || "", uri: t.album?.uri || null },
    image: t.album?.imageUrl || t.album?.largeImageUrl || null,
    popularity: t.popularity ?? null,
    why: t.why || null,       // which rule let it in -- so a bad pick is traceable
  });

  // Play a virtual mix: first track directly, the rest queued behind it.
  // No playlist involved -- the queue IS the mechanism. Lives here so the
  // Home row and the app page share one implementation.
  async function play(mix, startAt = 0) {
    const uris = (mix?.tracks || []).map((t) => t.uri).filter(Boolean).slice(startAt);
    if (!uris.length) return;
    const PA = P().PlayerAPI;
    try { await PA.clearQueue?.(); } catch {}
    await Spicetify.Player.playUri(uris[0]);
    const rest = uris.slice(1).map((uri) => ({ uri }));
    if (rest.length) {
      try { await PA.addToQueue(rest); }
      catch (e) {
        try { await Spicetify.addToQueue?.(rest); }
        catch (e2) { console.warn("[better-mix] couldn't queue the rest:", e2); }
      }
    }
    Spicetify.showNotification(`Playing ${mix.name}`);
  }

  // Spotify already sorts these by mood and activity -- Chill Happy, Driving,
  // Melancholy. Reusing their grouping is far better than trying to cluster
  // your library into moods, and the names come out meaningful for free.
  async function rebuildThese(mixes, { total, familiarCount, maxPerArtist }) {
    const store = readVirtual();
    const done = [];
    for (const m of mixes) {
      logLine(`\n=== ${m.name} ===`);
      try {
        const tracks = await buildMix({ sourceUri: m.uri, total, familiarCount, maxPerArtist });
        const name = "Better " + m.name.replace(/^better\s+/i, "");
        const prev = store.find((x) => x.sourceUri === m.uri);
        const entry = {
          id: prev?.id || ("bm-" + String(m.uri).split(":").pop()),
          name, sourceUri: m.uri, sourceName: m.name,
          builtAt: new Date().toISOString(),
          savedUri: prev?.savedUri || null,        // a saved one stays saved
          tracks: tracks.map(slim),
        };
        if (prev) Object.assign(prev, entry); else store.push(entry);
        writeVirtual(store);                       // the row updates after each one
        const byWhy = {};
        tracks.forEach((t) => { byWhy[t.why || "?"] = (byWhy[t.why || "?"] || 0) + 1; });
        logLine(`built "${name}" (${tracks.length} tracks): ` + Object.entries(byWhy).map(([k, v]) => `${v} ${k}`).join(", "));
        done.push(name);
      } catch (e) {
        const where = e?.requestUrl ? ` at ${String(e.requestUrl).split("/").slice(-2).join("/")}` : "";
        logLine(`skipped — ${e?.message || e?.name || e}${e?.status ? ` (HTTP ${e.status})` : ""}${where}`);
      }
    }
    return done;
  }

  async function rebuildAll({ limit, ...opts }) {
    const mixes = spotifyMixes().slice(0, limit);
    if (!mixes.length) throw new Error("No Spotify mixes recorded yet — open Home once so home-mixes can see them.");
    return rebuildThese(mixes, opts);
  }

  // --- Automatic ---------------------------------------------------------------
  // No button. home-mixes.js writes the mixes currently on your Home page to
  // "home-mixes:current" whenever it hides Spotify's row; anything in that
  // list that isn't built yet, or is older than a day, gets built here in the
  // background. Spotify refreshes its mixes daily, so a day is the right
  // staleness -- rebuilding more often just burns requests for the same input.
  const CUR_KEY = "home-mixes:current";
  const STALE_MS = 24 * 60 * 60 * 1000;
  let building = false;
  const readCurrent = () => { try { return JSON.parse(localStorage.getItem(CUR_KEY)) || []; } catch { return []; } };

  async function autoBuild(reason) {
    if (building) return;
    const store = readVirtual();
    const due = readCurrent().filter((m) => {
      const e = store.find((x) => x.sourceUri === m.uri);
      return !e || Date.now() - Date.parse(e.builtAt || 0) > STALE_MS;
    });
    if (!due.length) return;
    building = true;
    console.log(`[better-mix] auto-building ${due.length} mix(es) — ${reason}`);
    Spicetify.showNotification(`Building ${due.length} better mix${due.length > 1 ? "es" : ""}…`);
    const prevLog = logLine;
    logLine = (m) => console.log("[better-mix]", m);
    try { await rebuildThese(due, settings()); }
    catch (e) { console.warn("[better-mix] auto-build failed:", e); }
    finally { logLine = prevLog; building = false; }
  }
  window.addEventListener("home-mixes:current", () => autoBuild("Home changed"));
  setInterval(() => autoBuild("daily refresh"), 60 * 60 * 1000);
  setTimeout(() => autoBuild("startup"), 4000);

  // Promote a virtual mix to a real playlist. Called from the card's "save".
  async function saveVirtual(id) {
    const store = readVirtual();
    const entry = store.find((x) => x.id === id);
    if (!entry) throw new Error("mix not found");
    const uri = await saveMix(entry.name, entry.tracks);
    entry.savedUri = uri;
    writeVirtual(store);
    return uri;
  }

  // --- UI --------------------------------------------------------------------
  async function openMenu(preselect) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<pre class="bmx-log" id="bmx-log">loading your playlists…</pre>`;
    Spicetify.PopupModal.display({ title: "Better Mix", content: wrap, isLarge: true });

    let lists = [];
    try { lists = await myPlaylists(); }
    catch (e) { wrap.querySelector("#bmx-log").textContent = "Couldn't read your playlists: " + e.message; return; }

    const st = settings();
    wrap.innerHTML = `
      <div class="bmx-row">
        <label style="flex:1 1 260px">Base it on
          <select class="bmx-in" id="bmx-src">
            ${lists.map((p) => `<option value="${p.uri}"${p.uri === preselect ? " selected" : ""}>${(p.name || p.uri).replace(/</g, "&lt;")}</option>`).join("")}
          </select>
        </label>
        <label>Size <input class="bmx-in" id="bmx-total" type="number" min="5" max="100" value="${st.total}"></label>
        <label>Ones you know <input class="bmx-in" id="bmx-fam" type="number" min="0" max="20" value="${st.familiarCount}"></label>
        <label>Max per artist <input class="bmx-in" id="bmx-cap" type="number" min="1" max="5" value="${st.maxPerArtist}"></label>
        <label>How many mixes <input class="bmx-in" id="bmx-count" type="number" min="1" max="20" value="5"></label>
      </div>
      <div class="bmx-actions">
        <button class="bmx-btn" id="bmx-preview">Preview</button>
        <button class="bmx-btn" id="bmx-create">Create from this playlist</button>
        <button class="bmx-btn bmx-primary" id="bmx-all">Rebuild all now (${spotifyMixes().length})</button>
      </div>
      <pre class="bmx-log" id="bmx-log"></pre>`;

    const logEl = wrap.querySelector("#bmx-log");
    logLine = (m) => { logEl.textContent += m + "\n"; logEl.scrollTop = logEl.scrollHeight; };
    const val = (id) => wrap.querySelector(id).value;

    const run = async (create) => {
      logEl.textContent = "";
      wrap.querySelectorAll("button").forEach((b) => (b.disabled = true));
      saveSettings({ total: +val("#bmx-total"), familiarCount: +val("#bmx-fam"), maxPerArtist: +val("#bmx-cap") });
      try {
        const tracks = await buildMix({
          sourceUri: val("#bmx-src"),
          total: +val("#bmx-total"),
          familiarCount: +val("#bmx-fam"),
          maxPerArtist: +val("#bmx-cap"),
        });
        logLine("");
        tracks.forEach((t, i) =>
          logLine(`${String(i + 1).padStart(2)}. ${t.name} — ${(t.artists || []).map((a) => a.name).join(", ")}${t.popularity ? `  (${t.popularity})` : ""}${t.why ? `  [${t.why}]` : ""}`)
        );
        if (create) {
          const name = "Better Mix — " + (lists.find((p) => p.uri === val("#bmx-src"))?.name || "mix");
          logLine("\ncreating playlist…");
          await saveMix(name, tracks);
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
    wrap.querySelector("#bmx-all").onclick = async () => {
      logEl.textContent = "";
      wrap.querySelectorAll("button").forEach((b) => (b.disabled = true));
      saveSettings({ total: +val("#bmx-total"), familiarCount: +val("#bmx-fam"), maxPerArtist: +val("#bmx-cap") });
      try {
        const made = await rebuildAll({
          limit: +val("#bmx-count"),
          total: +val("#bmx-total"),
          familiarCount: +val("#bmx-fam"),
          maxPerArtist: +val("#bmx-cap"),
        });
        logLine(`\ndone — ${made.length} mixes built. They're on your Home page; nothing was saved to your library.`);
        Spicetify.showNotification(`Built ${made.length} mixes`);
      } catch (e) {
        logLine("\nFAILED: " + (e?.message || e));
      } finally {
        wrap.querySelectorAll("button").forEach((b) => (b.disabled = false));
      }
    };
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

  if (Spicetify.Playbar) {
    const ICON = `<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons.enhance}</svg>`;
    new Spicetify.Playbar.Button("Better Mix", ICON, openMenu).element.classList.add("bmx-playbar-btn");
  }
  // Right-click a playlist -> build from it directly. The playlist you clicked
  // IS the input, so this skips the picker entirely.
  if (Spicetify.ContextMenu) {
    new Spicetify.ContextMenu.Item(
      "Better Mix from this",
      (uris) => openMenu(uris?.[0]),
      (uris) => uris?.length === 1 && String(uris[0]).includes(":playlist:"),
      "enhance"
    ).register();
  }

  // Shared surface for home-mixes.js (and for poking at from the console).
  window.BetterMix = { ready: true, open: () => openMenu(), rebuildAll, saveVirtual, play, virtual: readVirtual };

  console.log(`[better-mix] loaded — ${readVirtual().length} mixes in store`);
  } catch (e) {
    window.__betterMixError = e?.message || String(e);
    console.error("[better-mix] init FAILED:", e);
  }
})();
