// ============================================================================
// sleep-timer.js — pause Spotify after a set time
// ----------------------------------------------------------------------------
// Desktop Spotify has no sleep timer; mobile does. This adds one to the right
// side of the now-playing bar, next to queue and devices. Presets, a custom
// duration, and a gentle volume fade before it stops.
//
// The wrapper below polls until Spicetify exists. Extensions are injected
// before the client finishes booting, so touching Spicetify.Player at load
// time throws and the extension dies with no visible error.
// ============================================================================

(function sleepTimer() {
  if (!(Spicetify?.Player && Spicetify?.Playbar && Spicetify?.PopupModal && Spicetify?.showNotification)) {
    setTimeout(sleepTimer, 300);
    return;
  }

  const FADE_SECONDS = 20;   // volume ramp-down before the pause
  const PRESETS = [
    { label: "15 min", minutes: 15 },
    { label: "30 min", minutes: 30 },
    { label: "1 hr",   minutes: 60 },
    { label: "90 min", minutes: 90 },
    { label: "2 hr",   minutes: 120 },
  ];

  let deadline = null;       // epoch ms when we should pause, or null
  let tickHandle = null;
  let button = null;

  // --- Helpers ---------------------------------------------------------------
  const minutesLeft = () =>
    deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 60000)) : 0;

  // "118m" is unreadable at the longer presets, so roll it into hours.
  function formatLeft() {
    const m = minutesLeft();
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60), rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }

  function updateButton() {
    if (!button) return;
    button.label = deadline ? `Sleep: ${formatLeft()}` : "Sleep timer";
    // Playbar buttons have a built-in active state -- it adds the same dot
    // indicator Spotify puts under shuffle and repeat. Using theirs means it
    // matches the client automatically instead of drifting from it.
    button.active = !!deadline;
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
      wrap.appendChild(mkBtn(`Cancel (${formatLeft()} left)`, () => stop()));
    }
    PRESETS.forEach((p) => wrap.appendChild(mkBtn(p.label, () => start(p.minutes))));
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

  // Spicetify's icon helper wraps named icons with BOTH fill and stroke set
  // to currentColor. Spotify's own playbar icons use fill only, so a named
  // icon renders visibly heavier than its neighbours. Passing raw SVG skips
  // that wrapper entirely -- the setter only wraps strings that match a known
  // icon name, so this goes through verbatim.
  const CLOCK_ICON =
    `<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">` +
    `${Spicetify.SVGIcons.clock}</svg>`;

  // Playbar.Button is the right-hand controls cluster (queue, devices,
  // volume). Playbar.Widget would put it on the left by the track name.
  button = new Spicetify.Playbar.Button("Sleep timer", CLOCK_ICON, openMenu);
  button.element.classList.add("sleep-timer-btn");

  // Scoped by the modal's aria-label, which Spicetify sets from the title.
  // The modal markup is shared with Spotify's own dialogs, so an unscoped
  // rule here would move the close button in those too.
  const css = document.createElement("style");
  css.textContent = `
    /* Inline SVG sits on the text baseline, which lifts it above the
       neighbouring icons. Block layout takes it off the baseline. */
    .sleep-timer-btn { display: flex; align-items: center; justify-content: center; }
    .sleep-timer-btn svg { display: block; }

    .GenericModal[aria-label="Sleep timer"] .main-trackCreditsModal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .GenericModal[aria-label="Sleep timer"] .main-trackCreditsModal-closeBtn {
      margin-left: auto;
    }
  `;
  document.head.appendChild(css);

  updateButton();
  console.log("[sleep-timer] loaded");
})();
