import { BASE_CSS, page } from "./fw-shared.js";

const icon = (bg, pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="${bg}"/><circle cx="256" cy="256" r="${pad}" fill="#ffffff"/><path d="M256 150l54 109h-37v103h-34V259h-37z" fill="${bg}"/></svg>
`;

const html = page({
  title: "PWA starter",
  description: "An installable, offline-capable web app: manifest, service worker and an offline page.",
  head: `  <meta name="theme-color" content="#4f46e5">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="assets/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="assets/icon.svg">
  <link rel="stylesheet" href="css/style.css">
  <script src="js/main.js" defer></script>
`,
  body: `  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header"><div class="container"><a class="brand" href="index.html">Pocket Notes</a><span class="muted" id="net" role="status">Online</span></div></header>
  <main id="main" class="container">
    <h1>Installable and offline-ready</h1>
    <p class="lead">This page registers a service worker that caches the app shell, so it keeps working without a connection. Notes below are saved in this browser.</p>
    <section class="card" aria-labelledby="notes-title">
      <h2 id="notes-title">Notes</h2>
      <form class="row" id="note-form"><input type="text" id="note-text" aria-label="New note" placeholder="Write a note" required><button type="submit" class="primary">Save</button></form>
      <ul class="plain" id="notes"></ul>
    </section>
    <section class="card" aria-labelledby="pwa-title" style="margin-top: 1rem;">
      <h2 id="pwa-title">App status</h2>
      <p id="sw-status" role="status" class="muted">Checking the service worker&hellip;</p>
      <button type="button" id="install" hidden>Install app</button>
    </section>
  </main>`,
});

const swJs = `// Service worker: precaches the app shell and answers from the cache when the network is not available.
// Bump CACHE when you change any precached file so that visitors receive the update.
const CACHE = "pocket-notes-v1";
const SHELL = ["./", "index.html", "offline.html", "css/style.css", "js/main.js", "manifest.webmanifest", "assets/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => (request.mode === "navigate" ? caches.match("offline.html") : Response.error()));
    }),
  );
});
`;

const mainJs = `// Registers the service worker, shows the connection state, offers installation and stores notes locally.
(function () {
  var status = document.getElementById("sw-status");
  var net = document.getElementById("net");
  var install = document.getElementById("install");
  var deferred = null;

  function say(text) { if (status) status.textContent = text; }

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").then(function () {
      say("Service worker active: the app shell is cached for offline use.");
    }).catch(function (err) {
      say("The service worker could not be registered: " + err.message);
    });
  } else {
    say("Service workers are not available here (the editor preview is sandboxed). Export the site and host it over HTTPS to try offline mode.");
  }

  function updateNet() { if (net) net.textContent = navigator.onLine ? "Online" : "Offline"; }
  window.addEventListener("online", updateNet);
  window.addEventListener("offline", updateNet);
  updateNet();

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferred = event;
    if (install) install.hidden = false;
  });
  if (install) install.addEventListener("click", function () {
    if (!deferred) return;
    deferred.prompt();
    deferred = null;
    install.hidden = true;
  });

  var list = document.getElementById("notes");
  var form = document.getElementById("note-form");
  var input = document.getElementById("note-text");
  var notes = [];
  try { notes = JSON.parse(localStorage.getItem("notes") || "[]"); } catch (e) { notes = []; }

  function save() { try { localStorage.setItem("notes", JSON.stringify(notes)); } catch (e) { /* storage unavailable */ } }

  function render() {
    if (!list) return;
    list.textContent = "";
    notes.forEach(function (text, index) {
      var li = document.createElement("li");
      li.className = "row";
      var span = document.createElement("span");
      span.textContent = text;
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", "Delete note: " + text);
      remove.addEventListener("click", function () { notes.splice(index, 1); save(); render(); });
      li.append(span, remove);
      list.append(li);
    });
  }

  if (form) form.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    notes.push(text);
    input.value = "";
    save();
    render();
  });
  render();
})();
`;

export const pwa = {
  id: "pwa",
  name: "PWA starter",
  description: "Installable offline-ready web app: manifest, service worker, offline page and local notes.",
  category: "Starter",
  accent: "#4f46e5",
  framework: true,
  libs: [],
  files: {
    "index.html": html,
    "offline.html": page({
      title: "Offline",
      description: "Shown when the app cannot reach the network.",
      head: `  <link rel="stylesheet" href="css/style.css">\n`,
      body: `  <main id="main" class="container"><h1>You are offline</h1><p class="lead">This page is not cached yet. Check your connection and <a href="index.html">try again</a>.</p></main>`,
    }),
    "css/style.css": BASE_CSS,
    "js/main.js": mainJs,
    "sw.js": swJs,
    "manifest.webmanifest": `{
  "name": "Pocket Notes",
  "short_name": "Notes",
  "description": "A tiny offline-ready notes app.",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#4f46e5",
  "icons": [
    { "src": "assets/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "assets/icon-maskable.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "maskable" }
  ]
}
`,
    "assets/icon.svg": icon("#4f46e5", 170),
    "assets/icon-maskable.svg": icon("#4f46e5", 120),
  },
};
