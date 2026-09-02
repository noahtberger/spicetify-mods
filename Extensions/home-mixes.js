// ============================================================================
// home-mixes.js — hide Spotify's mix shelves, show your own instead
// ----------------------------------------------------------------------------
// Spotify's mix rows are server-rendered and read-only: you cannot put your
// own tracks in them. So this hides them and draws a row of YOUR mixes in
// their place.
//
// Your mixes are VIRTUAL. They live in this client's storage, built by
// better-mix.js, and clicking one plays it straight from that list -- no
// playlist is ever saved unless you hit "save" on a card. That keeps your
// library clean; the trade is that a virtual mix can't be seen from your
// phone until you save it.
//
// HOW SPOTIFY'S MIXES ARE FOUND:
// By the playlists themselves, not the shelf heading -- Spotify-generated id
// prefix plus "Mix" in the name. Headings change with the day ("Soundtrack
// your Tuesday evening"), so anything keyed on them would break by Wednesday.
// ============================================================================

(function homeMixes() {
  const SRC_KEY  = "home-mixes:sources";   // Spotify mixes we've seen (written here)
  const VIRT_KEY = "better-mix:virtual";   // your built mixes (written by better-mix.js)

  // Defined BEFORE anything else, reading raw localStorage so it needs no
  // Spicetify at all. A diagnostic that only exists once the thing it
  // diagnoses is working isn't much of a diagnostic.
  window.homeSources ||= () => {
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem(SRC_KEY)) || []; } catch {}
    console.log(`[home-mixes] ${window.__homeMixesReady ? "ready" : "still initialising — give it a few seconds"} · ${rows.length} Spotify mixes recorded`);
    console.table(rows);
    return rows;
  };

  // --- Wait for Spicetify ----------------------------------------------------
  const startedAt = (window.__homeMixesStart ??= Date.now());
  const gate = {
    RootlistAPI: !!Spicetify?.Platform?.RootlistAPI,
    PlayerAPI:   !!Spicetify?.Platform?.PlayerAPI,
    Menu:        !!Spicetify?.Menu,
    LocalStorage: !!Spicetify?.LocalStorage,
  };
  if (!Object.values(gate).every(Boolean)) {
    const waited = Date.now() - startedAt;
    if (waited < 400) console.log("[home-mixes] loaded, waiting for Spicetify…");
    else if (waited > 8000 && Date.now() - (window.__homeMixesWarn || 0) > 8000) {
      window.__homeMixesWarn = Date.now();
      console.warn(`[home-mixes] still waiting after ${Math.round(waited / 1000)}s — missing: ` +
        Object.keys(gate).filter((k) => !gate[k]).join(", "));
    }
    setTimeout(homeMixes, 300);
    return;
  }
  window.__homeMixesReady = true;
  console.log(`[home-mixes] initialised after ${Date.now() - startedAt}ms`);

  const HIDE_KEY = "home-mixes:patterns";
  const SHOW_KEY = "home-mixes:enabled";
  const ROW_ID   = "home-mixes-row";

  // Spotify's algorithmically generated playlists all share this id prefix.
  // With "Mix" in the name that's a precise test for Daily Mix, Driving Mix,
  // Chill Happy Mix -- without catching your own playlists that say "mix".
  const MIX_ID = /^37i9dQZF1E/;
  const isMix = (name, id) => MIX_ID.test(id) && /\bmix\b/i.test(name);

  // Extra shelves to hide by heading, beyond the auto-detected mix rows.
  const DEFAULT_PATTERNS = [];
  const patterns = () => {
    try { return JSON.parse(Spicetify.LocalStorage.get(HIDE_KEY)) || DEFAULT_PATTERNS; }
    catch { return DEFAULT_PATTERNS; }
  };
  let enabled = Spicetify.LocalStorage.get(SHOW_KEY) !== "false";

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // --- Finding Spotify's shelves ------------------------------------------------
  // LEAF sections only. Home wraps every shelf in an outer <section>, and
  // since we detect by descendant links that container "contains" every mix
  // on the page. Hide it and the whole Home page goes blank.
  function shelves() {
    const root = document.querySelector(".main-view-container") || document;
    return [...root.querySelectorAll('section, [data-testid="component-shelf"]')]
      .filter((s) => !s.querySelector("section"));
  }
  const headingOf = (el) => el.querySelector("h1,h2,h3")?.textContent?.trim() || "";

  function mixesIn(shelf) {
    const out = [];
    let links = 0;
    shelf.querySelectorAll('a[href*="/playlist/"]').forEach((a) => {
      const id = a.getAttribute("href")?.split("/playlist/")[1]?.split(/[?#]/)[0];
      if (!id) return;
      links++;
      const name = (a.getAttribute("aria-label") || a.title || a.textContent || "").trim();
      if (name && isMix(name, id)) out.push({ uri: "spotify:playlist:" + id, name });
    });
    out.links = links;
    return out;
  }

  function scan() {
    if (!enabled) return;
    const pats = patterns().map((p) => p.toLowerCase());
    const found = [];
    for (const s of shelves()) {
      if (s.id === ROW_ID || s.dataset.homeMixesChecked === "1") continue;
      const h = headingOf(s);
      if (!h) continue;
      s.dataset.homeMixesChecked = "1";
      const mixes = mixesIn(s);
      found.push(...mixes);
      // A mix shelf is MOSTLY mixes. "Recently played" can hold a couple of
      // Daily Mixes among your own playlists -- that row should stay.
      const mixShelf = mixes.length >= 2 && mixes.length * 2 >= mixes.links;
      if (mixShelf || pats.some((p) => h.toLowerCase().includes(p))) {
        s.style.display = "none";
        s.dataset.homeMixesHidden = "1";
      }
    }
    if (found.length) record(found);
  }

  function record(found) {
    const byUri = new Map(readSources().map((x) => [x.uri, x]));
    found.forEach((x) => byUri.set(x.uri, x));
    try { Spicetify.LocalStorage.set(SRC_KEY, JSON.stringify([...byUri.values()])); } catch {}
  }
  // Filtered through the current rule, so entries recorded by older versions
  // (genre links, your own playlists) can't leak back in.
  function readSources() {
    try {
      return (JSON.parse(Spicetify.LocalStorage.get(SRC_KEY)) || [])
        .filter((x) => isMix(x?.name || "", String(x?.uri).split(":").pop()));
    } catch { return []; }
  }
  function unhideAll() {
    document.querySelectorAll('[data-home-mixes-hidden="1"]').forEach((s) => {
      s.style.display = "";
      delete s.dataset.homeMixesHidden;
      delete s.dataset.homeMixesChecked;
    });
  }

  // --- Your mixes --------------------------------------------------------------
  // Read-only here. better-mix.js owns every write to this store and fires
  // "better-mix:updated" when it changes; we just redraw. One writer means
  // the two extensions can never disagree about what's in it.
  const readVirtual = () => { try { return JSON.parse(localStorage.getItem(VIRT_KEY)) || []; } catch { return []; } };

  // Playback and the page both live in better-mix; this row only points at them.
  const playMix = (mix, startAt = 0) =>
    window.BetterMix?.play ? window.BetterMix.play(mix, startAt)
                           : Spicetify.showNotification("Better Mix isn't loaded", true);
  const openMix = (mix) =>
    Spicetify.Platform.History.push({ pathname: "/better-mix", search: `?id=${mix.id}`, state: { id: mix.id } });

  const openPlaylist = (uri) =>
    Spicetify.Platform.History.push(`/playlist/${String(uri).split(":").pop()}`);

  async function saveMix(mix, cardEl) {
    const BM = window.BetterMix;
    if (!BM?.saveVirtual) return Spicetify.showNotification("Better Mix isn't loaded", true);
    cardEl.classList.add("hmx-busy");
    try {
      await BM.saveVirtual(mix.id);       // writes savedUri + fires the update event
      Spicetify.showNotification(`Saved "${mix.name}" to your library`);
    } catch (e) {
      Spicetify.showNotification("Couldn't save: " + (e?.message || e), true);
    } finally {
      cardEl.classList.remove("hmx-busy");
    }
  }

  const icon = (name) =>
    `<svg viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons[name] || ""}</svg>`;

  function card(mix) {
    const el = document.createElement("div");
    el.className = "hmx-card";
    // The recommender hands back album art with every track, so each card
    // gets a real mosaic like Spotify's own playlist covers.
    const imgs = [...new Set((mix.tracks || []).map((t) => t.image).filter(Boolean))].slice(0, 4);
    const art = imgs.length >= 4
      ? `<div class="hmx-mosaic">${imgs.map((u) => `<img src="${esc(u)}" alt="">`).join("")}</div>`
      : imgs.length
        ? `<img class="hmx-single" src="${esc(imgs[0])}" alt="">`
        : `<div class="hmx-fallback">${esc(mix.name.replace(/^better\s+/i, "").slice(0, 2).toUpperCase())}</div>`;

    const saved = !!mix.savedUri;
    el.innerHTML = `
      <div class="hmx-art">${art}<button class="hmx-play" title="Play">${icon("play")}</button></div>
      <div class="hmx-name" title="${esc(mix.name)}">${esc(mix.name)}</div>
      <div class="hmx-meta">
        <span>${(mix.tracks || []).length} songs${saved ? " · saved" : ""}</span>
        <button class="hmx-save" title="${saved ? "Open the saved playlist" : "Save as a real playlist"}">${saved ? "open" : "save"}</button>
      </div>`;

    el.querySelector(".hmx-art").onclick = () => openMix(mix);
    el.querySelector(".hmx-name").onclick = () => openMix(mix);
    el.querySelector(".hmx-play").onclick = (e) => { e.stopPropagation(); playMix(mix); };
    el.querySelector(".hmx-save").onclick = (e) => {
      e.stopPropagation();
      saved ? openPlaylist(mix.savedUri) : saveMix(mix, el);
    };
    return el;
  }

  const onHome = () => {
    const path = Spicetify.Platform.History?.location?.pathname ?? location.pathname;
    return /^\/?(home)?\/?$/.test(path);
  };

  // Put the row where Spotify's mix row WAS -- directly above the first shelf
  // we hid -- so it sits below the chips and "Jump back in" like theirs did.
  // If no hidden shelf exists yet (Home loads shelves progressively), fall
  // back to after the first shelf and move into the real slot once it appears.
  function placeRow(row) {
    const slot = document.querySelector('[data-home-mixes-hidden="1"]');
    if (slot) { slot.parentNode.insertBefore(row, slot); row.dataset.placed = "slot"; return true; }
    const first = shelves().find((s) => s.id !== ROW_ID && headingOf(s));
    if (first) { first.after(row); row.dataset.placed = "fallback"; return true; }
    return false;
  }

  function injectRow() {
    if (!enabled) return;
    const existing = document.getElementById(ROW_ID);
    if (!onHome()) { existing?.remove(); return; }

    const mixes = readVirtual();
    if (!mixes.length) { existing?.remove(); return; }
    if (existing) {
      if (existing.dataset.placed === "fallback") {
        const slot = document.querySelector('[data-home-mixes-hidden="1"]');
        if (slot && existing.nextElementSibling !== slot) {
          slot.parentNode.insertBefore(existing, slot);
          existing.dataset.placed = "slot";
        }
      }
      return;
    }

    const row = document.createElement("section");
    row.id = ROW_ID;
    row.innerHTML = `
      <div class="hmx-head">
        <h2 class="hmx-heading">Your mixes</h2>
        <span><button class="hmx-rebuild" id="hmx-showall">Show all</button><button class="hmx-rebuild">Rebuild</button></span>
      </div>
      <div class="hmx-strip"></div>`;
    row.querySelector("#hmx-showall").onclick = () => Spicetify.Platform.History.push("/better-mix");
    row.querySelector(".hmx-rebuild:not(#hmx-showall)").onclick = () =>
      window.BetterMix?.open ? window.BetterMix.open() : Spicetify.showNotification("Better Mix isn't loaded", true);
    const strip = row.querySelector(".hmx-strip");
    mixes.forEach((m) => strip.appendChild(card(m)));
    placeRow(row);   // nothing to anchor to yet -> try again on the next pass
  }

  const redraw = () => { document.getElementById(ROW_ID)?.remove(); schedule(); };
  window.addEventListener("better-mix:updated", redraw);

  // --- Keeping up with navigation -------------------------------------------
  let scheduled = false;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 250));
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    idle(() => { scheduled = false; scan(); injectRow(); });
  }

  // Purge stale entries once on startup so storage matches the current rule.
  try { Spicetify.LocalStorage.set(SRC_KEY, JSON.stringify(readSources())); } catch {}

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();

  // --- Styles ------------------------------------------------------------------
  const css = document.createElement("style");
  css.textContent = `
    #${ROW_ID} { padding: 8px 0 24px; }
    .hmx-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
    .hmx-heading { font-size: 24px; font-weight: 700; margin: 0; color: var(--spice-text, #fff); }
    .hmx-rebuild { margin-left: 18px; background: transparent; border: 0; color: var(--spice-subtext, #b3b3b3); font-size: 14px; font-weight: 700; cursor: pointer; }
    .hmx-rebuild:hover { color: var(--spice-text, #fff); text-decoration: underline; }
    .hmx-strip { display: flex; gap: 18px; overflow-x: auto; padding-bottom: 6px; }
    .hmx-card { width: 180px; flex: 0 0 auto; border-radius: 8px; padding: 12px; background: var(--spice-card, #181818); transition: background-color 150ms ease; }
    .hmx-card:hover { background: var(--spice-highlight, #282828); }
    .hmx-card.hmx-busy { opacity: .6; pointer-events: none; }
    .hmx-art { position: relative; width: 100%; aspect-ratio: 1; border-radius: 6px; overflow: hidden; cursor: pointer; background: var(--spice-main, #121212); }
    .hmx-mosaic { display: grid; grid-template-columns: 1fr 1fr; width: 100%; height: 100%; }
    .hmx-mosaic img, .hmx-single { width: 100%; height: 100%; object-fit: cover; display: block; }
    .hmx-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 40px; font-weight: 700;
                    color: var(--spice-main, #121212); background: linear-gradient(135deg, var(--spice-button, #1ed760), var(--spice-button-active, #1db954)); }
    .hmx-play { position: absolute; right: 8px; bottom: 8px; width: 44px; height: 44px; border-radius: 50%; border: 0; cursor: pointer;
                background: var(--spice-button, #1ed760); color: var(--spice-main, #121212); display: flex; align-items: center; justify-content: center;
                opacity: 0; transform: translateY(6px); transition: opacity 150ms ease, transform 150ms ease; box-shadow: 0 8px 16px rgba(0,0,0,.4); }
    .hmx-play svg { width: 20px; height: 20px; margin-left: 2px; }
    .hmx-card:hover .hmx-play { opacity: 1; transform: none; }
    .hmx-name { margin-top: 12px; font-size: 14px; font-weight: 700; color: var(--spice-text, #fff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
    .hmx-name:hover { text-decoration: underline; }

    .hmx-meta { margin-top: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--spice-subtext, #b3b3b3); }
    .hmx-save { background: transparent; border: 1px solid var(--spice-misc, #555); color: var(--spice-subtext, #b3b3b3); border-radius: 12px; padding: 2px 10px; font-size: 11px; font-weight: 700; cursor: pointer; }
    .hmx-save:hover { border-color: var(--spice-button, #1ed760); color: var(--spice-text, #fff); }
  `;
  document.head.appendChild(css);

  // --- Toggle ------------------------------------------------------------------
  new Spicetify.Menu.Item("Replace Spotify's mix rows", enabled, (self) => {
    enabled = !enabled;
    self.setState(enabled);
    Spicetify.LocalStorage.set(SHOW_KEY, String(enabled));
    if (enabled) schedule();
    else { unhideAll(); document.getElementById(ROW_ID)?.remove(); }
    Spicetify.showNotification(enabled ? "Showing your mixes" : "Spotify's rows restored");
  }).register();

  // --- Console helpers ---------------------------------------------------------
  window.homeShelves = () => {
    const rows = shelves()
      .filter((s) => s.id !== ROW_ID && headingOf(s))
      .map((s) => { const m = mixesIn(s); return { heading: headingOf(s), mixes: m.length, cards: m.links, hidden: s.dataset.homeMixesHidden === "1" }; });
    console.table(rows);
    return rows;
  };
  window.homeHide = (...pats) => {
    const next = [...new Set([...patterns(), ...pats])];
    Spicetify.LocalStorage.set(HIDE_KEY, JSON.stringify(next));
    document.querySelectorAll("[data-home-mixes-checked]").forEach((s) => delete s.dataset.homeMixesChecked);
    schedule();
    console.log("hiding:", next);
  };
  window.homeHide.reset = () => {
    Spicetify.LocalStorage.set(HIDE_KEY, JSON.stringify(DEFAULT_PATTERNS));
    unhideAll(); schedule();
    console.log("reset to:", DEFAULT_PATTERNS);
  };
  window.homeSources = () => { console.table(readSources()); return readSources(); };
  window.homeSources.clear = () => { Spicetify.LocalStorage.set(SRC_KEY, "[]"); console.log("captured mixes cleared"); };
  window.homeRescan = () => {
    document.querySelectorAll("[data-home-mixes-checked]").forEach((s) => delete s.dataset.homeMixesChecked);
    redraw();
    console.log("rescanning…");
  };
  window.homeMixes = () => { const v = readVirtual(); console.table(v.map((m) => ({ name: m.name, songs: m.tracks?.length, saved: !!m.savedUri, built: m.builtAt }))); return v; };

  console.log(`[home-mixes] ${readSources().length} Spotify mixes recorded, ${readVirtual().length} of yours built. ` +
    "homeShelves() · homeSources() · homeMixes()");
})();
