// ============================================================================
// home-mixes.js — hide Spotify's mix shelves, show your own instead
// ----------------------------------------------------------------------------
// Spotify's Home rows ("Soundtrack your Tuesday evening", the Daily Mixes)
// are server-rendered and read-only -- you cannot put your own tracks in them.
// So this hides the ones you don't want and injects a row of your own
// playlists in their place.
//
// Pairs with better-mix.js: generate playlists there, list them here.
//
// HOW MIXES ARE FOUND:
// By the playlists themselves, not the shelf heading -- Spotify-generated id
// prefix plus "Mix" in the name. Headings change with the day ("Soundtrack
// your Tuesday evening"), so anything keyed on them would break by Wednesday.
// ============================================================================

(function homeMixes() {
  const SRC_KEY = "home-mixes:sources";

  // Defined BEFORE anything else, reading raw localStorage so it needs no
  // Spicetify at all. If you can call this, the file loaded -- and it tells
  // you whether the rest has initialised yet. A diagnostic that only exists
  // once the thing it diagnoses is working isn't much of a diagnostic.
  window.homeSources ||= () => {
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem(SRC_KEY)) || []; } catch {}
    console.log(`[home-mixes] ${window.__homeMixesReady ? "ready" : "still initialising — give it a few seconds"} · ${rows.length} mixes recorded`);
    console.table(rows);
    return rows;
  };

  // --- Wait for Spicetify ----------------------------------------------------
  // Polls until the pieces we need exist. After a reload that can take several
  // seconds, and NOTHING below runs until it passes. Saying so out loud is what
  // stops "is it broken or just not ready yet" from being a guessing game.
  const startedAt = (window.__homeMixesStart ??= Date.now());
  const gate = {
    RootlistAPI: !!Spicetify?.Platform?.RootlistAPI,
    Menu: !!Spicetify?.Menu,
    LocalStorage: !!Spicetify?.LocalStorage,
  };
  if (!(gate.RootlistAPI && gate.Menu && gate.LocalStorage)) {
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
  const ROW_ID = "home-mixes-row";

  // Substring matches against shelf headings, case-insensitive. Edit via the
  // profile menu, or just change these defaults.
  // Spotify's algorithmically generated playlists all share this id prefix.
  // Combined with a "Mix" in the name, that's a precise test for the things
  // you actually want replaced -- Daily Mix, Driving Mix, Chill Happy Mix --
  // without catching your own playlists that happen to say "mix".
  const MIX_ID = /^37i9dQZF1E/;
  const isMix = (name, id) => MIX_ID.test(id) && /\bmix\b/i.test(name);

  // Extra shelves to hide by heading, beyond the auto-detected mix rows.
  const DEFAULT_PATTERNS = [];

  const patterns = () => {
    try { return JSON.parse(Spicetify.LocalStorage.get(HIDE_KEY)) || DEFAULT_PATTERNS; }
    catch { return DEFAULT_PATTERNS; }
  };
  let enabled = Spicetify.LocalStorage.get(SHOW_KEY) !== "false";

  // --- Finding shelves -------------------------------------------------------
  // A shelf is a section element; its heading is the first h1/h2/h3 inside.
  function shelves() {
    return [...document.querySelectorAll('section, [data-testid="component-shelf"]')];
  }

  function headingOf(el) {
    return el.querySelector("h1,h2,h3")?.textContent?.trim() || "";
  }

  // Pull every Spotify-made "* Mix" out of a shelf.
  function mixesIn(shelf) {
    const out = [];
    shelf.querySelectorAll('a[href*="/playlist/"]').forEach((a) => {
      const id = a.getAttribute("href")?.split("/playlist/")[1]?.split(/[?#]/)[0];
      if (!id) return;
      const name = (a.getAttribute("aria-label") || a.title || a.textContent || "").trim();
      if (name && isMix(name, id)) out.push({ uri: "spotify:playlist:" + id, name });
    });
    return out;
  }

  // One pass: find mixes, remember them, and hide the rows that hold them.
  // Detecting the row by its CONTENTS rather than its heading means it keeps
  // working when Spotify renames it -- and those headings change with the day
  // ("Soundtrack your Tuesday evening"), so heading matching was always fragile.
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

      // Two or more means it's a mix shelf, not a stray card in some other row.
      if (mixes.length >= 2 || pats.some((p) => h.toLowerCase().includes(p))) {
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

  function readSources() {
    try { return JSON.parse(Spicetify.LocalStorage.get(SRC_KEY)) || []; } catch { return []; }
  }

  function unhideAll() {
    document.querySelectorAll('[data-home-mixes-hidden="1"]').forEach((s) => {
      s.style.display = "";
      delete s.dataset.homeMixesHidden;
      delete s.dataset.homeMixesChecked;
    });
  }

  // --- Your row --------------------------------------------------------------
  async function myMixes() {
    const rl = await Spicetify.Platform.RootlistAPI.getContents({ limit: 200 });
    return (rl?.items || []).filter(
      (p) => String(p?.uri).includes(":playlist:") && /^better /i.test(p?.name || "")
    );
  }

  function card(p) {
    const a = document.createElement("div");
    a.className = "hmx-card";
    a.innerHTML = `
      <div class="hmx-art">${(p.name || "?").replace(/better mix\s*—?\s*/i, "").slice(0, 2).toUpperCase()}</div>
      <div class="hmx-name">${(p.name || p.uri).replace(/</g, "&lt;")}</div>`;
    a.onclick = () => Spicetify.Platform.History.push(
      `/playlist/${String(p.uri).split(":").pop()}`
    );
    return a;
  }

  async function injectRow() {
    if (!enabled) return;
    // Only on Home.
    if (!/^\/?($|home)/.test(location.pathname.replace(/^\/+/, ""))) return;

    const container = document.querySelector(".main-view-container__scroll-node-child")
      || document.querySelector("main")
      || null;
    if (!container) return;

    const mixes = await myMixes();
    const existing = document.getElementById(ROW_ID);
    if (!mixes.length) { existing?.remove(); return; }
    if (existing) return;                       // already placed

    const row = document.createElement("section");
    row.id = ROW_ID;
    row.innerHTML = `<h2 class="hmx-heading">Your mixes</h2><div class="hmx-strip"></div>`;
    const strip = row.querySelector(".hmx-strip");
    mixes.forEach((p) => strip.appendChild(card(p)));
    container.prepend(row);
  }

  // --- Keeping up with navigation -------------------------------------------
  // Spotify re-renders Home constantly, so a one-shot pass isn't enough. Same
  // approach as hide-announcements: queue work and run it when idle, rather
  // than doing DOM scans inside the observer callback.
  let scheduled = false;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 250));

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    idle(() => { scheduled = false; scan(); injectRow(); });
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();

  // --- Styles ----------------------------------------------------------------
  const css = document.createElement("style");
  css.textContent = `
    #${ROW_ID} { padding: 8px 0 24px; }
    .hmx-heading { font-size: 24px; font-weight: 700; margin: 0 0 16px; color: var(--spice-text, #fff); }
    .hmx-strip { display: flex; gap: 18px; overflow-x: auto; padding-bottom: 6px; }
    .hmx-card { width: 160px; flex: 0 0 auto; cursor: pointer; border-radius: 8px; padding: 12px; background: var(--spice-card, #181818); transition: background-color 150ms ease; }
    .hmx-card:hover { background: var(--spice-highlight, #282828); }
    .hmx-art { width: 100%; aspect-ratio: 1; border-radius: 6px; display: flex; align-items: center; justify-content: center;
               font-size: 40px; font-weight: 700; color: var(--spice-main, #121212);
               background: linear-gradient(135deg, var(--spice-button, #1ed760), var(--spice-button-active, #1db954)); }
    .hmx-name { margin-top: 12px; font-size: 14px; font-weight: 600; color: var(--spice-text, #fff);
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  document.head.appendChild(css);

  // --- Toggle ----------------------------------------------------------------
  new Spicetify.Menu.Item("Replace Spotify's mix rows", enabled, (self) => {
    enabled = !enabled;
    self.setState(enabled);
    Spicetify.LocalStorage.set(SHOW_KEY, String(enabled));
    if (enabled) { schedule(); }
    else { unhideAll(); document.getElementById(ROW_ID)?.remove(); }
    Spicetify.showNotification(enabled ? "Showing your mixes" : "Spotify's rows restored");
  }).register();

  // --- Console helpers -------------------------------------------------------
  // Headings change with the time of day, so print what's actually on screen.
  window.homeShelves = () => {
    const rows = shelves()
      .filter((s) => s.id !== ROW_ID && headingOf(s))
      .map((s) => ({ heading: headingOf(s), mixes: mixesIn(s).length, hidden: s.dataset.homeMixesHidden === "1" }));
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
  window.homeSources.clear = () => {
    Spicetify.LocalStorage.set(SRC_KEY, "[]");
    console.log("captured mixes cleared");
  };
  window.homeRescan = () => {
    document.querySelectorAll("[data-home-mixes-checked]").forEach((s) => delete s.dataset.homeMixesChecked);
    schedule();
    console.log("rescanning…");
  };

  console.log(`[home-mixes] loaded — ${readSources().length} Spotify mixes recorded. ` +
    "homeShelves() lists your Home rows, homeSources() lists captured mixes.");
})();
