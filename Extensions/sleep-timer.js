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

    const opt = (text, onClick, extraClass) => {
      const b = document.createElement("button");
      b.className = "sleep-timer-opt" + (extraClass ? ` ${extraClass}` : "");
      b.textContent = text;
      b.onclick = () => { onClick(); Spicetify.PopupModal.hide(); };
      return b;
    };

    // Cancel goes first and full-width -- if a timer is running, that's the
    // reason you opened this, so it shouldn't be hidden among the presets.
    if (deadline) {
      wrap.appendChild(
        opt(`Cancel — ${formatLeft()} left`, () => stop(), "sleep-timer-cancel")
      );
    }

    const grid = document.createElement("div");
    grid.className = "sleep-timer-grid";
    PRESETS.forEach((p) => grid.appendChild(opt(p.label, () => start(p.minutes))));
    grid.appendChild(opt("End of track", stopAfterTrack));
    wrap.appendChild(grid);

    const row = document.createElement("div");
    row.className = "sleep-timer-custom-row";

    const custom = document.createElement("input");
    custom.className = "sleep-timer-input";
    custom.type = "number";
    custom.min = "1";
    custom.placeholder = "Custom minutes";

    const commit = () => {
      const v = parseInt(custom.value, 10);
      if (v > 0) { start(v); Spicetify.PopupModal.hide(); }
    };
    custom.onkeydown = (e) => { if (e.key === "Enter") commit(); };

    const setBtn = document.createElement("button");
    setBtn.className = "sleep-timer-opt";
    setBtn.textContent = "Set";
    setBtn.onclick = commit;

    row.append(custom, setBtn);
    wrap.appendChild(row);

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
  // Scoped by the modal's aria-label, which Spicetify sets from the title.
  // This markup is shared with Spotify's own dialogs (it reuses the track
  // credits modal), so unscoped rules here would restyle those too.
  const M = '.GenericModal[aria-label="Sleep timer"]';
  const css = document.createElement("style");
  css.textContent = `
    /* --- playbar button ------------------------------------------------ */
    /* Inline SVG sits on the text baseline, which lifts it above its
       neighbours. Block layout takes it off the baseline. */
    .sleep-timer-btn { display: flex; align-items: center; justify-content: center; }
    .sleep-timer-btn svg { display: block; }

    /* --- modal shell --------------------------------------------------- */
    ${M} { width: min(460px, 92vw); }
    ${M} .main-trackCreditsModal-container { padding: 0; border-radius: 12px; }

    ${M} .main-trackCreditsModal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 20px 24px 10px;
      margin: 0;
    }
    ${M} .main-trackCreditsModal-header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      line-height: 1.3;
    }

    /* The close button ships with no explicit box, so its hover circle sat
       off-centre from the X. Fixed square + centred flex makes them agree. */
    ${M} .main-trackCreditsModal-closeBtn {
      flex: 0 0 32px;
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--spice-subtext, #b3b3b3);
      cursor: pointer;
      transition: background-color 120ms ease, color 120ms ease;
    }
    ${M} .main-trackCreditsModal-closeBtn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--spice-text, #fff);
    }
    ${M} .main-trackCreditsModal-closeBtn svg { display: block; width: 14px; height: 14px; }

    ${M} .main-trackCreditsModal-mainSection { padding: 0; }
    ${M} .main-trackCreditsModal-originalCredits { padding: 6px 24px 24px; }

    /* --- modal contents ------------------------------------------------ */
    .sleep-timer-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .sleep-timer-opt {
      padding: 11px 12px;
      border-radius: 8px;
      border: 1px solid var(--spice-misc, #555);
      background: transparent;
      color: var(--spice-text, #fff);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: border-color 120ms ease, background-color 120ms ease, transform 100ms ease;
    }
    .sleep-timer-opt:hover {
      border-color: var(--spice-button, #1ed760);
      background: rgba(255, 255, 255, 0.06);
    }
    .sleep-timer-opt:active { transform: scale(0.97); }

    .sleep-timer-cancel {
      width: 100%;
      margin-bottom: 14px;
      border-color: var(--spice-notification-error, #cf4a3c);
      color: var(--spice-notification-error, #cf4a3c);
    }
    .sleep-timer-cancel:hover {
      border-color: var(--spice-notification-error, #cf4a3c);
      background: rgba(207, 74, 60, 0.12);
    }

    .sleep-timer-custom-row { display: flex; gap: 10px; margin-top: 14px; }
    .sleep-timer-input {
      flex: 1;
      min-width: 0;
      padding: 11px 12px;
      border-radius: 8px;
      border: 1px solid var(--spice-misc, #555);
      background: transparent;
      color: var(--spice-text, #fff);
      font-size: 14px;
    }
    .sleep-timer-input::placeholder { color: var(--spice-subtext, #a0a0a0); }
    .sleep-timer-input:focus {
      outline: none;
      border-color: var(--spice-button, #1ed760);
    }
  `;
  document.head.appendChild(css);

  updateButton();
  console.log("[sleep-timer] loaded");
})();
