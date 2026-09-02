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

function Index({ store }) {
  return h("div", { className: "bmx-page bmx-index" },
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

  return h("div", { className: "bmx-page" },
    // Header: the same shape as a playlist page -- big cover, eyebrow, title,
    // description, then "owner • N songs, duration".
    h("header", { className: "bmx-hero" },
      h(Cover, { mix, className: "bmx-hero-cover" }),
      h("div", { className: "bmx-hero-text" },
        h("span", { className: "bmx-eyebrow" }, "Better Mix"),
        h("h1", { className: "bmx-title" }, mix.name),
        h("p", { className: "bmx-desc" }, `Popular songs that fit ${mix.sourceName || "this mix"}, by artists you don't already play.`),
        h("div", { className: "bmx-stats" },
          h("b", null, "You"), ` • ${tracks.length} songs${total ? `, ${fmtTotal(total)}` : ""}${mix.builtAt ? ` • built ${ago(mix.builtAt)}` : ""}`))),

    h("div", { className: "bmx-actions" },
      h("button", { className: "bmx-playbtn", title: "Play", onClick: () => play(0) }, icon("play")),
      h("button", { className: "bmx-pill", disabled: busy, onClick: save }, mix.savedUri ? "Open playlist" : "Save as playlist"),
      h("button", { className: "bmx-textbtn", disabled: rebuilding, onClick: rebuild }, rebuilding ? "Rebuilding…" : "Rebuild this mix"),
      h("button", { className: "bmx-textbtn", onClick: () => BM?.open?.() }, "Settings")),

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
