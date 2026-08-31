// ============================================================================
// sleep-timer.js — pause Spotify after a set time
// ----------------------------------------------------------------------------
// Desktop Spotify has no sleep timer; mobile does. This adds one as a topbar
// button. Presets, a custom duration, and a gentle volume fade before it stops.
//
// The wrapper below polls until Spicetify exists. Extensions are injected
// before the client finishes booting, so touching Spicetify.Player at load
// time throws and the extension dies with no visible error.
// ============================================================================

(function sleepTimer() {
  if (!(Spicetify?.Player && Spicetify?.Topbar && Spicetify?.showNotification)) {
    setTimeout(sleepTimer, 300);
    return;
  }

  const FADE_SECONDS = 20;   // volume ramp-down before the pause
  const PRESETS = [15, 30, 45, 60, 90];

  let deadline = null;       // epoch ms when we should pause, or null
  let tickHandle = null;
  let button = null;

  // --- Helpers ---------------------------------------------------------------
  const minutesLeft = () =>
    deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 60000)) : 0;

  function updateButton() {
    if (!button) return;
    button.label = deadline ? `Sleep: ${minutesLeft()}m` : "Sleep timer";
    // Spotify's own accent marks it as armed without needing custom CSS.
    button.element.style.color = deadline ? "var(--spice-button, #1ed760)" : "";
  }

  // --- Fade + stop -----------------------------------------------------------
  // We restore the original volume AFTER pausing. Without this, the next time
  // you hit play the app is silent and it looks like something broke.
  async function fadeAndPause() {
    const original = Spicetify.Player.getVolume();
    const steps = FADE_SECONDS;

    for (let i = steps; i > 0; i--) {
      if (!deadline) {                       // cancelled mid-fade
        Spicetify.Player.setVolume(original);
        return;
      }
      Spicetify.Player.setVolume(original * (i / steps));
      await new Promise((r) => setTimeout(r, 1000));
    }

    Spicetify.Player.pause();
    Spicetify.Player.setVolume(original);
    stop(false);
    Spicetify.showNotification("Sleep timer: paused");
  }

  // --- Timer control ---------------------------------------------------------
  function start(minutes) {
    stop(false);
    deadline = Date.now() + minutes * 60000;

    tickHandle = setInterval(() => {
      const msLeft = deadline - Date.now();
      if (msLeft <= FADE_SECONDS * 1000) {
        clearInterval(tickHandle);
        tickHandle = null;
        fadeAndPause();
      } else {
        updateButton();
      }
    }, 1000);

    updateButton();
    Spicetify.showNotification(`Sleep timer set for ${minutes} min`);
  }

  function stop(notify = true) {
    deadline = null;
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = null;
    updateButton();
    if (notify) Spicetify.showNotification("Sleep timer cancelled");
  }

  // Stop at the end of whatever is playing now.
  function stopAfterTrack() {
    const once = () => {
      Spicetify.Player.removeEventListener("songchange", once);
      Spicetify.Player.pause();
      Spicetify.showNotification("Sleep timer: paused");
      stop(false);
    };
    Spicetify.Player.addEventListener("songchange", once);
    deadline = Date.now() + 1;   // marks the button as armed
    updateButton();
    Spicetify.showNotification("Will pause after this track");
  }

  // --- The menu --------------------------------------------------------------
  function openMenu() {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;padding:4px 0;";

    const mkBtn = (text, onClick) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.style.cssText =
        "padding:8px 14px;border-radius:20px;border:1px solid var(--spice-button,#1ed760);" +
        "background:transparent;color:var(--spice-text,#fff);cursor:pointer;font-size:14px;";
      b.onclick = () => { onClick(); Spicetify.PopupModal.hide(); };
      return b;
    };

    if (deadline) {
      wrap.appendChild(mkBtn(`Cancel (${minutesLeft()}m left)`, () => stop()));
    }
    PRESETS.forEach((m) => wrap.appendChild(mkBtn(`${m} min`, () => start(m))));
    wrap.appendChild(mkBtn("End of track", stopAfterTrack));

    const custom = document.createElement("input");
    custom.type = "number";
    custom.min = "1";
    custom.placeholder = "Custom (min)";
    custom.style.cssText =
      "padding:8px 12px;border-radius:20px;border:1px solid var(--spice-misc,#555);" +
      "background:transparent;color:var(--spice-text,#fff);width:130px;font-size:14px;";
    custom.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      const v = parseInt(custom.value, 10);
      if (v > 0) { start(v); Spicetify.PopupModal.hide(); }
    };
    wrap.appendChild(custom);

    Spicetify.PopupModal.display({ title: "Sleep timer", content: wrap });
  }

  button = new Spicetify.Topbar.Button("Sleep timer", "clock", openMenu);
  updateButton();
  console.log("[sleep-timer] loaded");
})();
