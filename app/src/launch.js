// Launch screen controller (docs/launch-screen.md, ADR 0031). A classic script, not a module: index.html loads it
// synchronously right after the launch card, so the card is themed (or removed) before the first paint and nothing of
// it counts as start-up module code. splash.html (the desktop app's splash window) loads the same file.
//
// Public API while the app starts: window.__ofLaunch = { stage(id, label?), progress(id, fraction, label?), done(), reveal() }
//   stage()    a boot stage begins (the bar shows the stages before it as done and shimmers while this one has no measure)
//   progress() a measured part of a stage (0..1); the bar moves within the stage's share
//   done()     the app is ready: the card fades out (browser) or the splash window closes and the main window shows (desktop)
//   reveal()   show the app now and drop the card (app lock prompt, crash-loop panel): same as done() without the 100 %
// The pure part (createBootProgress) is exposed as globalThis.OpenFiniLaunch for tests (tests/ui/launch-screen.test.js).
(function () {
  "use strict";

  /** Boot stages in order, with their share of the bar (weights). Ids are used by main.js and boot.js. */
  var STAGES = [
    ["start", 5],
    ["language", 10],
    ["studios", 20],
    ["interface", 30],
    ["documents", 30],
    ["finish", 5],
  ];

  /**
   * Progress model of the launch bar. Never moves backwards; unknown stage ids are ignored.
   * @param {Array<[string, number]>} [stages]
   */
  function createBootProgress(stages) {
    var list = stages || STAGES;
    var total = 0;
    var starts = {};
    for (var i = 0; i < list.length; i++) {
      starts[list[i][0]] = { at: total, w: list[i][1], index: i };
      total += list[i][1];
    }
    var state = { value: 0, busy: true, stage: null, label: "", done: false };
    var clamp = function (v) {
      return v < 0 ? 0 : v > 1 ? 1 : v;
    };
    var set = function (value, busy, stage, label) {
      if (state.done) return state;
      state.value = Math.max(state.value, clamp(value));
      state.busy = busy;
      state.stage = stage;
      if (typeof label === "string" && label) state.label = label;
      return state;
    };
    return {
      /** A stage begins: everything before it is done; the stage itself has no measure yet (busy). */
      stage: function (id, label) {
        var s = starts[id];
        return s ? set(s.at / total, true, id, label) : state;
      },
      /** Measured progress inside a stage (fraction 0..1). Also begins the stage when it was not announced. */
      progress: function (id, fraction, label) {
        var s = starts[id];
        if (!s || !isFinite(fraction)) return state;
        return set((s.at + s.w * clamp(fraction)) / total, false, id, label);
      },
      done: function () {
        set(1, false, "finish");
        state.done = true;
        return state;
      },
      get state() {
        return state;
      },
    };
  }

  globalThis.OpenFiniLaunch = { createBootProgress: createBootProgress, STAGES: STAGES };
  if (typeof document === "undefined") return;

  var EVENT = "openfini://launch";
  var tauri = window.__TAURI__ || null;
  var splashWindow = document.documentElement.hasAttribute("data-launch-window");
  var root = document.getElementById("of-splash");
  var prefs = {};
  try {
    prefs = JSON.parse(localStorage.getItem("openfini.prefs.v1") || "{}") || {};
  } catch (e) {
    prefs = {};
  }
  var enabled = prefs.launchScreen !== false && !/[?&](safe|popout)=/.test(location.search);
  var invoke = function (cmd) {
    try {
      var p = tauri && tauri.core && tauri.core.invoke(cmd);
      if (p && p.catch) p.catch(function () {});
    } catch (e) {
      /* a missing command must never block the start */
    }
  };

  function applyTheme(el) {
    var mode = prefs.theme === "light" || prefs.theme === "dark" ? prefs.theme : null;
    if (!mode && window.matchMedia) mode = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    el.setAttribute("data-theme", mode || "dark");
    if (prefs.reduceMotion === "on" || prefs.animSpeed === "off") el.classList.add("is-calm");
  }

  function render(state) {
    if (!root) return;
    var bar = root.querySelector(".of-splash__bar");
    var fill = root.querySelector(".of-splash__fill");
    var status = root.querySelector("[data-of-status]");
    var pct = Math.round(state.value * 100);
    if (fill) fill.style.width = pct + "%";
    if (bar) {
      bar.classList.toggle("is-busy", !!state.busy && !state.done);
      if (state.busy && !state.done) bar.removeAttribute("aria-valuenow");
      else bar.setAttribute("aria-valuenow", String(pct));
    }
    if (status && state.label && status.textContent !== state.label) status.textContent = state.label;
    if (state.done) root.setAttribute("aria-busy", "false");
  }

  function fillVersion() {
    var v = root && root.querySelector("[data-of-version]");
    if (!v || v.textContent) return; // stamped by scripts/build.mjs from package.json
    var put = function (version) {
      if (version && !v.textContent) v.textContent = "v" + String(version).replace(/^v/, "");
    };
    if (tauri && tauri.app && tauri.app.getVersion) tauri.app.getVersion().then(put, function () {});
    else if (window.fetch) fetch("./build-info.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j) put(j.version); }).catch(function () {});
  }

  function fadeArtwork() {
    var img = root && root.querySelector(".of-splash__art img");
    if (!img || img.complete) return;
    img.classList.add("is-pending");
    var show = function () {
      img.classList.remove("is-pending");
    };
    img.addEventListener("load", show, { once: true });
    img.addEventListener("error", function () {
      img.remove(); // the placeholder gradient stays
    }, { once: true });
  }

  // ------------------------------------------------------------ desktop splash window (splash.html)
  if (splashWindow) {
    if (!enabled) {
      invoke("launch_ready"); // turned off: show the main window right away, as before the launch screen existed
      return;
    }
    if (root) {
      applyTheme(root);
      fillVersion();
      fadeArtwork();
      render({ value: 0, busy: true, label: "", done: false });
    }
    try {
      tauri.event.listen(EVENT, function (e) {
        if (e && e.payload) render(e.payload);
      });
    } catch (e) {
      /* no events: the bar stays indeterminate until the main window takes over */
    }
    var showSplash = function () {
      try {
        tauri.window.getCurrentWindow().show();
      } catch (e) {
        /* the main window still shows when the app is ready (or after the timeout in src-tauri/src/lib.rs) */
      }
    };
    requestAnimationFrame(function () {
      requestAnimationFrame(showSplash);
    });
    return;
  }

  // ------------------------------------------------------------ main window
  var model = createBootProgress();
  var finished = false;
  // Desktop: the card lives in the splash window (the main window is hidden until done()). Browser: the card is here.
  if (tauri || !enabled) {
    if (root) root.remove();
    root = null;
    if (tauri && !enabled) invoke("launch_ready");
  } else if (root) {
    applyTheme(root);
    fillVersion();
    fadeArtwork();
    render(model.state);
  }

  function publish(state) {
    render(state);
    if (!tauri || !enabled) return;
    try {
      tauri.event.emitTo("splash", EVENT, { value: state.value, busy: state.busy, label: state.label, done: state.done });
    } catch (e) {
      /* the splash window is optional */
    }
  }

  function finish(full) {
    if (finished) return;
    finished = true;
    clearTimeout(safety);
    publish(full ? model.done() : model.state);
    if (tauri) invoke("launch_ready");
    var el = root;
    root = null;
    if (!el) return;
    el.setAttribute("aria-busy", "false");
    el.classList.add("is-done");
    var calm = el.classList.contains("is-calm") || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    setTimeout(function () {
      el.remove();
    }, calm ? 0 : 320);
  }

  // never keep the card up when start-up fails: the error panels and the app must be reachable
  var safety = setTimeout(function () {
    finish(false);
  }, 15000);

  window.__ofLaunch = {
    stage: function (id, label) {
      if (!finished) publish(model.stage(id, label));
    },
    progress: function (id, fraction, label) {
      if (!finished) publish(model.progress(id, fraction, label));
    },
    done: function () {
      finish(true);
    },
    reveal: function () {
      finish(false);
    },
  };
  window.__ofLaunch.stage("start");
})();
