// ============================================================================
// hide-announcements.js — hide Spotify promos, and catch the rare ones
// ----------------------------------------------------------------------------
// TWO JOBS, TWO DIFFERENT TOOLS — this distinction matters:
//
//   HIDING  is done with one injected <style> tag. CSS applies to elements
//           that don't exist yet, so it can't be raced by React re-rendering.
//           Deleting nodes with an observer means fighting the app forever.
//
//   CATCHING is done with a MutationObserver, because here we genuinely need
//           the event -- we want to know an announcement appeared, and CSS
//           can't tell us that. Detection needs an observer; hiding doesn't.
//
// On Premium, promos are rare and appear on Spotify's schedule. You can't
// write a selector for something you can't see, so we log them as they occur
// and read the log later.
// ============================================================================

(function hideAnnouncements() {
  if (!(Spicetify?.Menu && Spicetify?.LocalStorage && Spicetify?.showNotification)) {
    setTimeout(hideAnnouncements, 300);
    return;
  }

  const ENABLED_KEY = "hide-announcements:enabled";
  const LOG_KEY = "hide-announcements:log";
  const STYLE_ID = "hide-announcements-style";
  const LOG_LIMIT = 60;

  // Spotify's own internal names for promo surfaces. "marquee" and "nudge"
  // are their terms for the big overlay promos -- worth watching for.
  const WATCH_WORDS = [
    "upsell", "promo", "announce", "upgrade", "whats-new",
    "marquee", "nudge", "campaign", "takeover", "banner",
  ];

  const SELECTORS = [
    '[data-testid*="upsell"]',
    '[data-testid*="announcement"]',
    '[data-testid*="whats-new"]',
    '[data-testid*="marquee"]',
    '[data-testid*="nudge"]',
    '[data-testid="download-app-banner"]',
    '.main-topBar-UpgradeButton',
    'button[data-testid="upgrade-button"]',
    '.main-noticeBar-container',
    '.main-leaderboardComponent-container',
  ];

  // --- Hiding ----------------------------------------------------------------
  function enable() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `${SELECTORS.join(",\n")} { display: none !important; }`;
    document.head.appendChild(style);
  }
  const disable = () => document.getElementById(STYLE_ID)?.remove();

  // LocalStorage stores strings. A stored "false" is a truthy string, so
  // compare explicitly or the toggle silently stops working.
  let enabled = Spicetify.LocalStorage.get(ENABLED_KEY) !== "false";
  if (enabled) enable();

  // --- Catching --------------------------------------------------------------
  const readLog = () => {
    try { return JSON.parse(Spicetify.LocalStorage.get(LOG_KEY) || "[]"); }
    catch { return []; }
  };
  const writeLog = (rows) =>
    Spicetify.LocalStorage.set(LOG_KEY, JSON.stringify(rows.slice(-LOG_LIMIT)));

  const seen = new Set(readLog().map((r) => r.testid));

  function record(el) {
    const id = el.dataset?.testid;
    if (!id || seen.has(id)) return;              // one entry per kind
    if (!WATCH_WORDS.some((w) => id.toLowerCase().includes(w))) return;
    seen.add(id);

    const rows = readLog();
    rows.push({
      testid: id,
      selector: `[data-testid="${id}"]`,
      text: (el.textContent || "").trim().slice(0, 120),
      page: location.hash || location.pathname,
      at: new Date().toISOString(),
      hiddenAlready: SELECTORS.some((s) => { try { return el.matches(s); } catch { return false; } }),
    });
    writeLog(rows);
    console.log(`[hide-announcements] caught "${id}" — run announcementLog()`);
    // Silent success is indistinguishable from failure, so say something.
    Spicetify.showNotification(`Hid an announcement (${rows.length} total)`);
  }

  // Spotify mutates the DOM constantly, so do NOT scan inside the observer
  // callback. Queue the nodes and process them when the browser is idle,
  // otherwise this becomes a performance problem on every navigation.
  let queue = [];
  let scheduled = false;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));

  function flush() {
    scheduled = false;
    const nodes = queue;
    queue = [];
    for (const node of nodes) {
      if (node.dataset?.testid) record(node);
      node.querySelectorAll?.("[data-testid]").forEach(record);
    }
  }

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) queue.push(node);
      }
    }
    if (queue.length && !scheduled) { scheduled = true; idle(flush); }
  }).observe(document.body, { childList: true, subtree: true });

  // --- Menu toggle -----------------------------------------------------------
  new Spicetify.Menu.Item("Hide announcements", enabled, (self) => {
    enabled = !enabled;
    self.setState(enabled);
    Spicetify.LocalStorage.set(ENABLED_KEY, String(enabled));
    enabled ? enable() : disable();
    Spicetify.showNotification(enabled ? "Announcements hidden" : "Announcements shown");
  }).register();

  // --- Console helpers -------------------------------------------------------
  // Everything caught so far, including things that appeared and vanished.
  window.announcementLog = function () {
    const rows = readLog();
    if (!rows.length) {
      console.log("[hide-announcements] nothing caught yet — it logs as promos appear");
      return;
    }
    console.table(rows);
    return rows;
  };
  window.announcementLog.clear = function () {
    Spicetify.LocalStorage.set(LOG_KEY, "[]");
    seen.clear();
    console.log("[hide-announcements] log cleared");
  };

  // Scan what's on screen right now.
  window.findAnnouncements = function () {
    const hits = [...document.querySelectorAll("[data-testid]")].filter((el) =>
      WATCH_WORDS.some((w) => el.dataset.testid.toLowerCase().includes(w))
    );
    if (!hits.length) {
      console.log("[hide-announcements] nothing on screen right now");
      return;
    }
    console.table(hits.map((el) => ({
      selector: `[data-testid="${el.dataset.testid}"]`,
      visible: el.offsetParent !== null,
      text: (el.textContent || "").trim().slice(0, 60),
    })));
  };

  // Prove both halves work right now, rather than waiting for a real promo.
  // Injects a fake announcement, checks it gets hidden AND logged, cleans up.
  window.testAnnouncement = function () {
    const ID = "upsell-selftest";
    seen.delete(ID);                                   // allow repeat runs

    const el = document.createElement("div");
    el.dataset.testid = ID;
    el.textContent = "Test announcement — you should NOT be seeing this.";
    el.style.cssText =
      "position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:99999;" +
      "padding:16px 24px;background:#c0392b;color:#fff;border-radius:8px;font-size:15px;";
    document.body.appendChild(el);

    // Wait past the observer's idle-callback flush before judging.
    setTimeout(() => {
      const hidden = getComputedStyle(el).display === "none";
      const logged = readLog().some((r) => r.testid === ID);

      console.log(`hide   ${hidden ? "PASS — element is display:none" : "FAIL — element is visible"}`);
      console.log(`catch  ${logged ? "PASS — observer wrote it to the log" : "FAIL — observer missed it"}`);
      Spicetify.showNotification(
        hidden && logged ? "Self-test passed" : "Self-test FAILED — see console", !(hidden && logged)
      );

      el.remove();
      writeLog(readLog().filter((r) => r.testid !== ID));   // don't pollute the real log
      seen.delete(ID);
    }, 1500);

    return "running self-test…";
  };

  console.log(
    `[hide-announcements] loaded — watching. ${readLog().length} caught so far. ` +
    `Run testAnnouncement() to verify it works.`
  );
})();
