// ============================================================================
// Better Mix — custom app
// ----------------------------------------------------------------------------
// The PAGE for a virtual mix. Extensions can't own a route; a custom app can.
// Spicetify calls render() whenever /better-mix is active and mounts what it
// returns in the main view, so this gets a URL, back/forward, and the full
// height -- everything a modal couldn't give it.
//
// /better-mix          -> all your mixes
// /better-mix?id=...   -> one mix, laid out like a normal playlist page
//
// No JSX (no build step), so React.createElement via a short alias.
// ============================================================================

// Resolved lazily: this file runs at load, before Spicetify.React exists.
// Reading it at the top level would throw and the app would never mount.
const h = (...a) => Spicetify.React.createElement(...a);
const useState = (...a) => Spicetify.React.useState(...a);
const useEffect = (...a) => Spicetify.React.useEffect(...a);
const ROUTE = "/better-mix";

const readStore = () => { try { return JSON.parse(localStorage.getItem("better-mix:virtual")) || []; } catch { return []; } };
const idOf = (uri) => String(uri || "").split(":").pop();
const go = (to) => Spicetify.Platform.History.push(to);
const openMix = (m) => go({ pathname: ROUTE, search: `?id=${m.id}`, state: { id: m.id } });

const fmtTrack = (ms) => {
  ms = Number(ms);
  if (!ms) return "–:––";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtTotal = (ms) => {
  ms = Number(ms);
  if (!ms) return "";
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
};
const ago = (iso) => {
  const t = Date.parse(iso || ""); if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
};
// Spotify's own action-bar icons, taken from a real playlist page. Same 24px
// viewBox and artwork as their controls, so these render at identical weight
// instead of being 16px glyphs scaled up (which fattened every stroke).
const ICONS = {
  play:  '<path d="m7.05 3.606 13.49 7.788a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606"/>',
  // Spotify's download ring, reused as the circle for save / saved.
  ring:  '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M1 12C1 5.925 5.925 1 12 1s11 4.925 11 11-4.925 11-11 11S1 18.075 1 12"/>',
  plus:  '<path d="M11 7h2v4h4v2h-4v4h-2v-4H7v-2h4z"/>',
  check: '<path d="m10.9 16.2-3.6-3.6 1.4-1.4 2.2 2.2 4.4-4.4 1.4 1.4z"/>',
  shuffle: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/></g>',
  more:  '<path d="M4.5 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m15 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m-7.5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3"/>',
  // Spotify has no rebuild icon; drawn at 2px stroke to match their weight.
  refresh: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.4 12a8.4 8.4 0 1 1-2.46-5.94"/><path d="M20.9 4.2v4.4h-4.4"/></g>',
};
const sicon = (...names) =>
  h("span", { className: "bmx-svg", dangerouslySetInnerHTML: { __html: `<svg viewBox="0 0 24 24" fill="currentColor">${names.map((n) => ICONS[n]).join("")}</svg>` } });

const icon = (name, cls = "bmx-svg") =>
  h("span", { className: cls, dangerouslySetInnerHTML: { __html: `<svg viewBox="0 0 16 16" fill="currentColor">${Spicetify.SVGIcons[name] || ""}</svg>` } });

// --- Hooks ----------------------------------------------------------------
// The route stays /better-mix when you go from one mix to another, so React
// won't remount on its own. Subscribe to History and re-render on change.
function useLocation() {
  const H = Spicetify.Platform.History;
  const [loc, setLoc] = useState(() => H.location);
  useEffect(() => {
    // Newer history versions hand the listener {location, action}, older
    // ones hand the location itself. Accept either.
    const un = H.listen((x) => setLoc(x?.location ?? x));
    return typeof un === "function" ? un : undefined;
  }, []);
  return loc;
}
// better-mix.js fires this after every write, so a rebuild or a save shows
// up here without a refresh.
function useStore() {
  const [store, setStore] = useState(readStore);
  useEffect(() => {
    const f = () => setStore(readStore());
    window.addEventListener("better-mix:updated", f);
    return () => window.removeEventListener("better-mix:updated", f);
  }, []);
  return store;
}

// --- Pieces ---------------------------------------------------------------
function Cover({ mix, className = "" }) {
  const imgs = [...new Set((mix.tracks || []).map((t) => t.image).filter(Boolean))].slice(0, 4);
  if (imgs.length >= 4)
    return h("div", { className: `bmx-cover bmx-mosaic ${className}` }, imgs.map((u, i) => h("img", { key: i, src: u, alt: "" })));
  if (imgs.length)
    return h("img", { className: `bmx-cover ${className}`, src: imgs[0], alt: "" });
  return h("div", { className: `bmx-cover bmx-fallback ${className}` },
    (mix.name || "?").replace(/^better\s+/i, "").slice(0, 2).toUpperCase());
}

// Spotify tints a playlist page with a colour extracted from its cover.
// colorExtractor hits the same internal endpoint their UI uses, so the tint
// matches what Spotify would have picked. Keyed by track so navigating back
// to a page doesn't refetch, and failure just leaves the default background.
const accentCache = new Map();
function useAccent(mix) {
  const seed = (mix?.tracks || []).find((t) => t.uri)?.uri;
  const [accent, setAccent] = useState(() => accentCache.get(seed) || null);
  useEffect(() => {
    if (!seed || accentCache.has(seed)) return;
    let alive = true;
    Spicetify.colorExtractor(seed)
      .then((c) => {
        // Preset names vary by client version; prefer the least garish.
        const pick = c && (c.vibrantNonAlarming || c.desaturated || c.vibrant || c.prominent || Object.values(c)[0]);
        if (pick) { accentCache.set(seed, pick); if (alive) setAccent(pick); }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [seed]);
  return accent;
}

function useProgress() {
  const [p, setP] = useState(() => window.BetterMix?.progress || { active: false });
  useEffect(() => {
    const f = (e) => setP({ ...(e.detail || {}) });
    window.addEventListener("better-mix:progress", f);
    return () => window.removeEventListener("better-mix:progress", f);
  }, []);
  return p;
}
function Progress() {
  const p = useProgress();
  if (!p?.active) return null;
  return h("div", { className: "bmx-progress" },
    `Building today's mixes — ${p.done} of ${p.total}` + (p.current?.length ? `  ·  ${p.current.join(", ")}` : ""));
}

function Index({ store }) {
  return h("div", { className: "bmx-page bmx-index" },
    h(Progress),
    h("div", { className: "bmx-index-head" },
      h("h1", null, "Your mixes"),
      h("button", { className: "bmx-pill", onClick: () => window.BetterMix?.open?.() }, store.length ? "Rebuild" : "Build mixes")),
    store.length
      ? h("div", { className: "bmx-grid" }, store.map((m) =>
          h("div", { className: "bmx-card", key: m.id, onClick: () => openMix(m) },
            h(Cover, { mix: m, className: "bmx-card-cover" }),
            h("div", { className: "bmx-card-name" }, m.name),
            h("div", { className: "bmx-card-sub" }, `${(m.tracks || []).length} songs${m.savedUri ? " · saved" : ""}`))))
      : h("p", { className: "bmx-empty" }, "Nothing built yet. Open Home once so your Spotify mixes get recorded, then hit Build."));
}

function MixPage({ mix }) {
  const BM = window.BetterMix;
  const tracks = mix.tracks || [];
  const total = tracks.reduce((a, t) => a + (Number(t.duration) || 0), 0);
  const [busy, setBusy] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [shuffled, setShuffled] = useState(() => !!BM?.getShuffle?.());
  const toggleShuffle = () => { const v = !shuffled; BM?.setShuffle?.(v); setShuffled(v); };

  const rebuild = async () => {
    if (!BM?.rebuildOne) return Spicetify.showNotification("Better Mix isn't loaded", true);
    setRebuilding(true);
    try { await BM.rebuildOne(mix.sourceUri); Spicetify.showNotification(`Rebuilt ${mix.name}`); }
    catch (e) { Spicetify.showNotification("Rebuild failed: " + (e?.message || e), true); }
    finally { setRebuilding(false); }
  };

  const play = (i = 0) =>
    BM?.play ? BM.play(mix, i) : Spicetify.showNotification("Better Mix isn't loaded", true);

  const save = async () => {
    if (mix.savedUri) return go(`/playlist/${idOf(mix.savedUri)}`);
    if (!BM?.saveVirtual) return Spicetify.showNotification("Better Mix isn't loaded", true);
    setBusy(true);
    try { await BM.saveVirtual(mix.id); Spicetify.showNotification(`Saved "${mix.name}" to your library`); }
    catch (e) { Spicetify.showNotification("Couldn't save: " + (e?.message || e), true); }
    finally { setBusy(false); }
  };

  const link = (label, path) =>
    h("a", { className: "bmx-a", onClick: (e) => { e.stopPropagation(); go(path); } }, label);

  const accent = useAccent(mix);
  const iconBtn = (glyphs, title, onClick, extra = "", disabled = false) =>
    h("button", { className: "bmx-iconbtn " + extra, title, "aria-label": title, onClick, disabled },
      sicon(...(Array.isArray(glyphs) ? glyphs : [glyphs])));

  return h("div", { className: "bmx-page" },
    h(Progress),
    // Header and actions share one tinted panel, as they do on a real
    // playlist page: the colour is strongest at the top and fades into the
    // page background by the end of the action row.
    h("div", { className: "bmx-top", style: accent ? { "--bmx-accent": accent } : undefined },
      h("header", { className: "bmx-hero" },
        h(Cover, { mix, className: "bmx-hero-cover" }),
        h("div", { className: "bmx-hero-text" },
          h("span", { className: "bmx-eyebrow" }, "Better Mix"),
          h("h1", { className: "bmx-title" }, mix.name),
          h("p", { className: "bmx-desc" }, `Popular songs that fit ${mix.sourceName || "this mix"}, by artists you don't already play.`),
          h("div", { className: "bmx-stats" },
            h("b", null, "You"), ` • ${tracks.length} songs${total ? `, ${fmtTotal(total)}` : ""}${mix.builtAt ? ` • built ${ago(mix.builtAt)}` : ""}`))),

      // Icon buttons with tooltips, like Spotify's -- text links read as
      // web-page furniture next to their controls.
      h("div", { className: "bmx-actions" },
        h("button", { className: "bmx-playbtn", title: "Play", "aria-label": "Play", onClick: () => play(0) }, sicon("play")),
        iconBtn("shuffle", shuffled ? "Disable shuffle" : "Enable shuffle", toggleShuffle, shuffled ? "bmx-on" : ""),
        iconBtn(mix.savedUri ? ["ring", "check"] : ["ring", "plus"],
          mix.savedUri ? "Open the saved playlist" : "Save as a playlist",
          save, mix.savedUri ? "bmx-on" : "", busy),
        iconBtn("refresh", rebuilding ? "Rebuilding…" : "Rebuild this mix", rebuild, rebuilding ? "bmx-spin" : "", rebuilding),
        iconBtn("more", "Settings", () => BM?.open?.()))),

    h("div", { className: "bmx-table" },
      h("div", { className: "bmx-thead" },
        h("span", null, "#"), h("span", null, "Title"), h("span", null, "Album"), icon("clock", "bmx-svg bmx-clock")),
      tracks.map((t, i) =>
        h("div", { className: "bmx-tr", key: t.uri || i, onClick: () => play(i), title: "Play from here" },
          h("span", { className: "bmx-num", title: t.why ? `admitted as: ${t.why}` : "" },
            h("span", { className: "bmx-idx" }, i + 1),
            icon("play", "bmx-svg bmx-rowplay")),
          h("span", { className: "bmx-titlecell" },
            t.image ? h("img", { className: "bmx-thumb", src: t.image, alt: "" }) : h("span", { className: "bmx-thumb" }),
            h("span", { className: "bmx-tt" },
              h("span", { className: "bmx-tname" }, t.name),
              h("span", { className: "bmx-tartists" },
                (t.artists || []).map((a, j) =>
                  h(Spicetify.React.Fragment, { key: j }, j ? ", " : "", a.uri ? link(a.name, `/artist/${idOf(a.uri)}`) : a.name))))),
          h("span", { className: "bmx-album" },
            t.album?.uri ? link(t.album.name, `/album/${idOf(t.album.uri)}`) : (t.album?.name || "")),
          h("span", { className: "bmx-dur" }, fmtTrack(t.duration))))));
}

function App() {
  const loc = useLocation();
  const store = useStore();
  const id = new URLSearchParams(loc.search || "").get("id") || loc.state?.id;
  const mix = id ? store.find((m) => m.id === id) : null;

  if (id && !mix)
    return h("div", { className: "bmx-page" },
      h("p", { className: "bmx-empty" }, "That mix isn't in the store any more — it was probably rebuilt."),
      h("button", { className: "bmx-pill", onClick: () => go(ROUTE) }, "All mixes"));

  // key forces a clean remount when switching between mixes
  return mix ? h(MixPage, { mix, key: mix.id }) : h(Index, { store });
}

// Catches anything App throws and prints it on the page, instead of Spotify's
// generic "something went wrong". Defined lazily because it extends
// Spicetify.React.Component, which doesn't exist when this file loads.
let Boundary;
const boundary = () => Boundary ||= class extends Spicetify.React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return h("div", { className: "bmx-page" },
      h("h2", null, "Better Mix hit an error"),
      h("pre", { className: "bmx-err" }, String(this.state.err?.stack || this.state.err)),
      h("button", { className: "bmx-pill", onClick: () => this.setState({ err: null }) }, "Try again"));
  }
};

const render = () => h(boundary(), null, h(App));
