// Crash-loop guard entry point. It is a separate script (loaded before main.js) so that it still runs when the main
// application bundle fails to load or crashes while starting. After two failed starts in a row it shows a plain,
// dependency-free panel that offers safe mode. main.js calls markBootOk() once the app has started.
import { beginBoot, resetBootFailures, isSafeMode, safeModeUrl } from "./core/bootguard.js";

const store = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

const safe = isSafeMode(location.search);
const state = store ? beginBoot(store) : { failures: 0, offerSafeMode: false };
window.__ofBoot = { failures: state.failures, safe };

function el(tag, css, text) {
  const e = document.createElement(tag);
  Object.assign(e.style, css);
  if (text) e.textContent = text;
  return e;
}

function showPanel() {
  const wrap = el("div", { position: "fixed", inset: "0", zIndex: "2147483000", display: "grid", placeItems: "center", background: "rgba(14,15,18,.82)", font: "15px/1.45 system-ui, sans-serif", color: "#e6e6ea" });
  wrap.setAttribute("role", "alertdialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-labelledby", "of-bg-title");
  const box = el("div", { maxWidth: "30rem", margin: "1rem", padding: "1.4rem 1.5rem", background: "#25262b", border: "1px solid #3a3b42", borderRadius: "12px", boxShadow: "0 12px 40px rgba(0,0,0,.5)" });
  const title = el("h2", { margin: "0 0 .6rem", fontSize: "1.15rem" }, "OpenFini did not start properly");
  title.id = "of-bg-title";
  const p = el("p", { margin: "0 0 1rem" }, `The last ${state.failures} starts did not finish. Safe mode starts OpenFini without restoring your last session, without extensions and with AI turned off; your saved settings and documents are not changed. If you have autosaved work, it is still on this device.`);
  const row = el("div", { display: "flex", flexWrap: "wrap", gap: ".5rem" });
  const btn = (label, primary, onClick) => {
    const b = el("button", { padding: ".5rem .9rem", borderRadius: "8px", border: "1px solid #5a5b66", background: primary ? "#7c6df2" : "transparent", color: primary ? "#fff" : "#e6e6ea", font: "inherit", cursor: "pointer" }, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    row.append(b);
    return b;
  };
  const first = btn("Start in safe mode", true, () => location.assign(safeModeUrl(location.pathname)));
  btn("Continue normally", false, () => {
    if (store) resetBootFailures(store);
    wrap.remove();
  });
  btn("Reset app data…", false, async () => {
    if (!window.confirm("Reset OpenFini on this device?\n\nThis deletes settings, the autosaved session, recent files, saved AI keys and the offline cache. Documents you saved as files are not touched.")) return;
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("openfini")) localStorage.removeItem(k);
      await new Promise((resolve) => {
        const r = indexedDB.deleteDatabase("openfini");
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      });
      for (const n of await caches.keys()) await caches.delete(n);
      for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    } catch {
      /* best effort */
    }
    location.assign(`${location.pathname}?fresh=1`);
  });
  box.append(title, p, row);
  wrap.append(box);
  const mount = () => {
    document.body.append(wrap);
    first.focus();
  };
  if (document.body) mount();
  else addEventListener("DOMContentLoaded", mount, { once: true });
}

if (state.offerSafeMode && !safe) showPanel();
