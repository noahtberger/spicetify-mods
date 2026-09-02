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

  // Every console helper exists from the first tick and delegates to the real
  // implementation once init has run. Until then -- or if init threw -- they
  // say so, instead of being undefined and looking like the file never loaded.
  const notReady = (name) => () =>
    console.warn(`[home-mixes] ${name}: not initialised yet` + (window.__homeMixesError ? ` — init failed: ${window.__homeMixesError}` : ""));
  const api = () => window.__homeMixesApi;
  window.homeHide   ||= (...p) => (api() ? api().hide(...p)   : notReady("homeHide")());
  window.homeHide.reset ||= () => (api() ? api().reset()      : notReady("homeHide.reset")());
  window.homeShelves ||= ()  => (api() ? api().shelves()      : notReady("homeShelves")());
  window.homeRescan  ||= ()  => (api() ? api().rescan()       : notReady("homeRescan")());
  window.homeMixes   ||= ()  => (api() ? api().mixes()        : notReady("homeMixes")());
  window.homeSources.clear ||= () => (api() ? api().clearSources() : notReady("homeSources.clear")());
  if (window.__homeMixesError) return;

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
  try {

  const HIDE_KEY = "home-mixes:patterns";
  const SHOW_KEY = "home-mixes:enabled";
  const ROW_ID   = "home-mixes-row";

  // Spotify's algorithmically generated playlists all share this id prefix.
  // With "Mix" in the name that's a precise test for Daily Mix, Driving Mix,
  // Chill Happy Mix -- without catching your own playlists that say "mix".
  const MIX_ID = /^37i9dQZF1E/;
  // Must END with "Mix" or "Mix <number>" ("Daily Mix 3"): song-radio
  // playlists share the id prefix and can carry "Mix" mid-name
  // ("… DJ Gius Mix, Radio Edit Radio").
  const isMix = (name, id) => MIX_ID.test(id) && /\bmix(\s+\d+)?\s*$/i.test(String(name).trim());

  // Shelves to hide by heading, beyond the auto-detected mix rows. These are
  // Spotify's promotional picks -- a single album pushed at you -- not mixes.
  // Add more from the console with homeHide("heading text").
  const DEFAULT_PATTERNS = ["picked for you"];
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
      .filter((s) => !s.querySelector("section") && !s.classList.contains("hmx-row"));
  }
  const headingOf = (el) => el.querySelector("h1,h2,h3")?.textContent?.trim() || "";

  // Count CARDS, not links. A mood-mix card carries extra "Also try pop,
  // indie, …" playlist links inside it, so counting links made a shelf of
  // five mixes look like 5 of 20 -- a minority -- and it was never hidden.
  // Links are grouped by the card they sit in; a text-only link with no card
  // ancestor and no image (a stray "Also try" link) isn't a card at all.
  const CARD_SEL = '.main-card-card, [data-testid*="card"], article, li';
  function mixesIn(shelf) {
    const links = [];
    shelf.querySelectorAll('a[href*="/playlist/"]').forEach((a) => {
      const id = a.getAttribute("href")?.split("/playlist/")[1]?.split(/[?#]/)[0];
      if (!id) return;
      const name = (a.getAttribute("aria-label") || a.title || a.textContent || "").trim();
      links.push({ a, id, name, mix: !!name && isMix(name, id), card: a.closest(CARD_SEL), img: !!a.querySelector("img") });
    });
    const distinctMixIds = new Set(links.filter((l) => l.mix).map((l) => l.id));

    // Group links by the card they sit in, so a mix card's "Also try pop,
    // indie…" sub-links don't each count as a card of their own.
    let cards = new Set(), mixCards = new Set();
    for (const l of links) {
      if (!l.card && !l.mix && !l.img) continue;      // stray text link
      const key = l.card || l.a;
      cards.add(key);
      if (l.mix) mixCards.add(key);
    }
    // If several distinct mixes collapsed into one "card", the ancestor we
    // matched was the shelf itself, not a card. Fall back to per-link
    // counting, where only image links and mix links count as cards.
    if (mixCards.size < Math.min(2, distinctMixIds.size)) {
      cards = new Set(links.filter((l) => l.mix || l.img).map((l) => l.a));
      mixCards = new Set(links.filter((l) => l.mix).map((l) => l.id));
    }

    const out = [];
    const seenId = new Set();
    for (const l of links) if (l.mix && !seenId.has(l.id)) { seenId.add(l.id); out.push({ uri: "spotify:playlist:" + l.id, name: l.name }); }
    out.links = Math.max(cards.size, out.length);
    return out;
  }

  function scan() {
    if (!enabled) return;
    const pats = patterns().map((p) => p.toLowerCase());
    const found = [];
    for (const s of shelves()) {
      if (s.classList.contains("hmx-row") || s.dataset.homeMixesChecked === "1") continue;
      const h = headingOf(s);
      if (!h) continue;
      s.dataset.homeMixesChecked = "1";
      const mixes = mixesIn(s);
      found.push(...mixes);
      // A mix shelf is MOSTLY mixes. "Recently played" can hold a couple of
      // Daily Mixes among your own playlists -- that row should stay.
      const mixShelf = mixes.length >= 2 && mixes.length * 2 >= mixes.links;
      if (mixes.length >= 2 && !mixShelf)
        console.log(`[home-mixes] "${h}": ${mixes.length} mix cards of ${mixes.links} — left visible (not a mix shelf)`);
      if (mixShelf || pats.some((p) => h.toLowerCase().includes(p))) {
        s.style.display = "none";
        s.dataset.homeMixesHidden = "1";
        s.dataset.homeMixesShelf = h;                        // so each of our rows can take the right slot
        s.dataset.homeMixesKind = mixShelf ? "mix" : "pattern"; // pattern-hidden shelves aren't row slots
      }
    }
    if (found.length) record(found);

    // What's on Home RIGHT NOW, from every hidden shelf present -- not just
    // the ones this pass checked, or a shelf that renders late would replace
    // the list instead of joining it. better-mix builds from this.
    if (onHome()) {
      const current = [...document.querySelectorAll('[data-home-mixes-hidden="1"]')]
        .flatMap((s) => mixesIn(s).map((m) => ({ ...m, shelf: s.dataset.homeMixesShelf || headingOf(s) })));
      if (current.length) writeCurrent(current);
    }
  }

  const CUR_KEY = "home-mixes:current";
  const readCurrent = () => { try { return JSON.parse(localStorage.getItem(CUR_KEY)) || []; } catch { return []; } };
  function writeCurrent(list) {
    const next = JSON.stringify(list.map((m) => ({ uri: m.uri, name: m.name, shelf: m.shelf || "" })));
    let prev = null; try { prev = localStorage.getItem(CUR_KEY); } catch {}
    if (prev === next) return;
    try { localStorage.setItem(CUR_KEY, next); } catch {}
    window.dispatchEvent(new Event("home-mixes:current"));   // better-mix listens
    document.querySelectorAll(".hmx-row").forEach((r) => r.remove());   // redraw with the new set
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
    Spicetify.Platform.History.push(`/better-mix?id=${encodeURIComponent(mix.id)}`, { id: mix.id });

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

  // Shown while a mix is still being built, so the row never looks like
  // Spotify's simply vanished.
  function pendingCard(name) {
    const el = document.createElement("div");
    el.className = "hmx-card hmx-pending";
    el.innerHTML = `
      <div class="hmx-art"><div class="hmx-fallback hmx-shimmer"></div></div>
      <div class="hmx-name">${esc(name)}</div>
      <div class="hmx-meta"><span>building…</span></div>`;
    return el;
  }

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

  // Put a row where the shelf it replaces WAS. Daily Mixes and the mood mixes
  // live in different Spotify shelves, so each of our rows goes into its own
  // slot; if the exact shelf isn't found, any hidden shelf; failing that,
  // after the first shelf, and it moves into the real slot once that renders.
  function placeRow(row, shelfHeading) {
    const hidden = [...document.querySelectorAll('[data-home-mixes-hidden="1"]')];
    const slot = hidden.find((s) => s.dataset.homeMixesShelf === shelfHeading)
      || hidden.find((s) => s.dataset.homeMixesKind === "mix") || hidden[0];
    if (slot) { slot.parentNode.insertBefore(row, slot); row.dataset.placed = "slot"; return true; }
    const first = shelves().find((s) => headingOf(s));
    if (first) { first.after(row); row.dataset.placed = "fallback"; return true; }
    return false;
  }

  const OTHER_ROW_CAP = 16;   // cards in the "Your mixes" row; the rest are behind Show all
  const isDaily = (name) => /^daily mix/i.test(String(name).replace(/^better\s+/i, ""));

  function buildRow(id, title, items) {
    const row = document.createElement("section");
    row.id = id;
    row.className = "hmx-row";
    row.innerHTML = `
      <div class="hmx-head">
        <h2 class="hmx-heading">${esc(title)}</h2>
        <span><span class="hmx-progress"></span><button class="hmx-rebuild hmx-showall">Show all</button></span>
      </div>
      <div class="hmx-strip"></div>`;
    row.querySelector(".hmx-showall").onclick = () => Spicetify.Platform.History.push("/better-mix");
    const strip = row.querySelector(".hmx-strip");
    items.forEach((m) => strip.appendChild(m.pending ? pendingCard(m.name) : card(m)));
    return row;
  }

  function injectRow() {
    if (!enabled) return;
    if (!onHome()) { document.querySelectorAll(".hmx-row").forEach((r) => r.remove()); return; }

    // Better versions of exactly the mixes we hid, in the same order. Ones
    // still building show as placeholders. Split into Daily Mixes and the rest.
    const store = readVirtual();
    const current = readCurrent();
    const entryFor = (c) => ({
      shelf: c.shelf || "",
      ...(store.find((m) => m.sourceUri === c.uri) ||
          { pending: true, name: "Better " + String(c.name).replace(/^better\s+/i, "") }),
    });
    // Daily row: EVERY Daily Mix we know about, in number order, whether or
    // not Spotify's shelf happens to be showing it right now -- they're all
    // rebuilt daily regardless. Other row: the mood/artist mixes on Home today.
    const dailyNum = (m) => parseInt(String(m.name).replace(/\D/g, ""), 10) || 0;
    const dailySources = readSources().filter((m) => isDaily(m.name)).sort((a, b) => dailyNum(a) - dailyNum(b));
    const dailyShelf = current.find((c) => isDaily(c.name))?.shelf || "";
    const groups = [
      { id: ROW_ID + "-daily", title: "Your daily mixes", items: dailySources.map((c) => entryFor({ ...c, shelf: dailyShelf })) },
      // Featured first (what Spotify's shelf shows right now), then the rest of
      // what's built, newest first. Spotify features only 4-5 at a time and a
      // row that thin wastes the other ten good ones; Show all has everything.
      { id: ROW_ID + "-other", title: "Your mixes", items: (() => {
          const featured = current.filter((c) => !isDaily(c.name)).map(entryFor);
          const shown = new Set(current.map((c) => c.uri));
          const rest = store.filter((m) => !isDaily(m.name) && !shown.has(m.sourceUri))
            .sort((a, b) => Date.parse(b.builtAt || 0) - Date.parse(a.builtAt || 0))
            .map((m) => ({ shelf: "", ...m }));
          return [...featured, ...rest].slice(0, OTHER_ROW_CAP);
        })() },
    ];

    for (const g of groups) {
      const existing = document.getElementById(g.id);
      if (!g.items.length) { existing?.remove(); continue; }
      const shelf = g.items.find((m) => m.shelf)?.shelf || "";
      if (existing) {
        if (existing.dataset.placed === "fallback") {
          const slot = [...document.querySelectorAll('[data-home-mixes-hidden="1"]')]
            .find((s) => s.dataset.homeMixesShelf === shelf)
            || document.querySelector('[data-home-mixes-hidden="1"][data-home-mixes-kind="mix"]');
          if (slot && existing.nextElementSibling !== slot) {
            slot.parentNode.insertBefore(existing, slot);
            existing.dataset.placed = "slot";
          }
        }
        continue;
      }
      placeRow(buildRow(g.id, g.title, g.items), shelf);   // no anchor yet -> next pass
    }
  }

  const redraw = () => { document.querySelectorAll(".hmx-row").forEach((r) => r.remove()); schedule(); };
  window.addEventListener("better-mix:updated", redraw);
  window.addEventListener("better-mix:progress", (e) => {
    const p = e.detail || {};
    const txt = p.active ? `building ${p.done} of ${p.total}…` : "";
    document.querySelectorAll(".hmx-progress").forEach((el) => (el.textContent = txt));
  });

  // --- Keeping up with navigation -------------------------------------------
  let scheduled = false;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 250));
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    idle(() => { scheduled = false; scan(); injectRow(); });
  }

  // Never rewrite the recorded sources through the name rule -- when that rule
  // regressed it silently deleted every Daily Mix from storage. Filtering
  // happens on read (readSources), so a bad rule only hides entries until it's
  // fixed. Startup only drops entries whose id isn't Spotify-generated at all.
  try {
    const raw = JSON.parse(Spicetify.LocalStorage.get(SRC_KEY)) || [];
    const kept = raw.filter((x) => MIX_ID.test(String(x?.uri).split(":").pop()));
    if (kept.length !== raw.length) Spicetify.LocalStorage.set(SRC_KEY, JSON.stringify(kept));
  } catch {}

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();

  // --- Styles ------------------------------------------------------------------
  const css = document.createElement("style");
  css.textContent = `
    .hmx-row { padding: 8px 0 24px; }
    .hmx-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
    .hmx-heading { font-size: 24px; font-weight: 700; margin: 0; color: var(--spice-text, #fff); }
    .hmx-progress { font-size: 13px; color: var(--spice-subtext, #b3b3b3); }
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
    .hmx-pending { opacity: .7; }
    .hmx-shimmer { background: linear-gradient(110deg, var(--spice-card, #222) 30%, var(--spice-highlight, #333) 50%, var(--spice-card, #222) 70%);
                   background-size: 200% 100%; animation: hmx-shimmer 1.4s linear infinite; }
    @keyframes hmx-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  `;
  document.head.appendChild(css);

  // --- Toggle ------------------------------------------------------------------
  try {
  new Spicetify.Menu.Item("Replace Spotify's mix rows", enabled, (self) => {
    enabled = !enabled;
    self.setState(enabled);
    Spicetify.LocalStorage.set(SHOW_KEY, String(enabled));
    if (enabled) schedule();
    else { unhideAll(); document.querySelectorAll(".hmx-row").forEach((r) => r.remove()); }
    Spicetify.showNotification(enabled ? "Showing your mixes" : "Spotify's rows restored");
  }).register();
  } catch (e) { console.warn("[home-mixes] profile-menu toggle unavailable:", e); }

  // --- Console helpers ---------------------------------------------------------
  window.__homeMixesApi = {
    shelves() {
      const rows = shelves()
        .filter((s) => !s.classList.contains("hmx-row") && headingOf(s))
        .map((s) => { const m = mixesIn(s); return { heading: headingOf(s), mixes: m.length, cards: m.links, hidden: s.dataset.homeMixesHidden === "1" }; });
      console.table(rows);
      return rows;
    },
    hide(...pats) {
      const next = [...new Set([...patterns(), ...pats.map(String)])];
      Spicetify.LocalStorage.set(HIDE_KEY, JSON.stringify(next));
      document.querySelectorAll("[data-home-mixes-checked]").forEach((s) => delete s.dataset.homeMixesChecked);
      schedule();
      console.log("hiding:", next);
    },
    reset() {
      Spicetify.LocalStorage.set(HIDE_KEY, JSON.stringify(DEFAULT_PATTERNS));
      unhideAll(); schedule();
      console.log("reset to:", DEFAULT_PATTERNS);
    },
    rescan() {
      document.querySelectorAll("[data-home-mixes-checked]").forEach((s) => delete s.dataset.homeMixesChecked);
      redraw();
      console.log("rescanning…");
    },
    mixes() {
      const v = readVirtual();
      console.table(v.map((m) => ({ name: m.name, songs: m.tracks?.length, saved: !!m.savedUri, built: m.builtAt })));
      return v;
    },
    clearSources() { Spicetify.LocalStorage.set(SRC_KEY, "[]"); console.log("captured mixes cleared"); },
  };
  window.homeSources = () => { console.table(readSources()); return readSources(); };
  window.homeSources.clear = () => window.__homeMixesApi.clearSources();

  console.log(`[home-mixes] ${readSources().length} Spotify mixes recorded, ${readVirtual().length} of yours built. ` +
    "homeShelves() · homeSources() · homeMixes() · homeHide(\"heading\")");
  } catch (e) {
    window.__homeMixesError = e?.message || String(e);
    console.error("[home-mixes] init FAILED:", e);
  }
})();
