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
// WHY MATCH ON HEADING TEXT:
// Those shelves have no stable id, and their titles change with the day and
// time ("Soundtrack your Tuesday evening" -> "...Wednesday morning"). So we
// match substrings of the heading rather than exact strings or class names.
// ============================================================================

(function homeMixes() {
  if (!(Spicetify?.Platform?.RootlistAPI && Spicetify?.Menu && Spicetify?.LocalStorage)) {
    setTimeout(homeMixes, 300);
    return;
  }

  const HIDE_KEY = "home-mixes:patterns";
  const SRC_KEY = "home-mixes:sources";
  const SHOW_KEY = "home-mixes:enabled";
  const ROW_ID = "home-mixes-row";

  // Substring matches against shelf headings, case-insensitive. Edit via the
  // profile menu, or just change these defaults.
  const DEFAULT_PATTERNS = ["soundtrack your", "made for you", "jump back in"];

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

  function hideMatching() {
    if (!enabled) return;
    const pats = patterns().map((p) => p.toLowerCase());
    for (const s of shelves()) {
      if (s.dataset.homeMixesChecked === "1") continue;
      const h = headingOf(s).toLowerCase();
      if (!h) continue;
      s.dataset.homeMixesChecked = "1";
      if (pats.some((p) => h.includes(p))) {
        recordSources(s, headingOf(s));   // capture BEFORE hiding
        s.style.display = "none";
        s.dataset.homeMixesHidden = "1";
      }
    }
  }

  // Pull the playlist URIs and names out of a shelf and remember them.
  // Grabbing the name here avoids a second API call later, and these shelves
  // only exist on Home -- better-mix shouldn't depend on being on that page.
  function recordSources(shelf, heading) {
    const found = [];
    shelf.querySelectorAll('a[href*="/playlist/"]').forEach((a) => {
      const id = a.getAttribute("href")?.split("/playlist/")[1]?.split(/[?#]/)[0];
      if (!id) return;
      const name = (a.getAttribute("aria-label") || a.title || a.textContent || "").trim()
        || (a.closest("[role='group'],div")?.textContent || "").trim().slice(0, 60);
      if (name) found.push({ uri: "spotify:playlist:" + id, name, shelf: heading });
    });
    if (!found.length) return;

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
    idle(() => { scheduled = false; hideMatching(); injectRow(); });
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
    const rows = shelves().map((s) => headingOf(s)).filter(Boolean);
    console.table(rows.map((h) => ({ heading: h, hidden: patterns().some((p) => h.toLowerCase().includes(p.toLowerCase())) })));
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

  console.log(`[home-mixes] loaded — ${readSources().length} Spotify mixes recorded. ` +
    "homeShelves() lists your Home rows, homeSources() lists captured mixes.");
})();
