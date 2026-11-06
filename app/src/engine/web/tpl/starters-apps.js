// App and PWA starters (engine/web/starters.js): plain HTML, CSS and JavaScript, data stays in the browser.
import { page, BASE_CSS } from "./fw-shared.js";

const APP_CSS = `${BASE_CSS}
.app { max-width: 560px; margin: 32px auto; padding: 0 16px; }
.row { display: flex; gap: 8px; }
input, textarea, button { font: inherit; }
input, textarea { flex: 1; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); }
button { padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
button.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
ul.list { list-style: none; padding: 0; }
.muted { color: var(--muted); }
`;

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#16a34a"/><path d="M140 270l80 80 160-180" fill="none" stroke="#fff" stroke-width="48" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;

const todo = {
  "index.html": page({
    title: "To-do",
    description: "A to-do list that works offline.",
    head: `  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="icon.svg">
  <meta name="theme-color" content="#16a34a">
  <link rel="stylesheet" href="css/style.css">
  <script src="js/app.js" type="module"></script>
`,
    body: `<main class="app">
  <h1>To-do</h1>
  <form class="row" id="add">
    <label class="sr" for="text">New task</label>
    <input id="text" placeholder="What needs doing?" autocomplete="off" required>
    <button class="primary" type="submit">Add</button>
  </form>
  <ul class="list" id="list"></ul>
  <p class="muted" id="left"></p>
</main>`,
  }),
  "css/style.css": `${APP_CSS}.list li { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.list li.done span { text-decoration: line-through; color: var(--muted); }
.list li span { flex: 1; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`,
  "js/app.js": `// Tasks live in localStorage; the service worker caches the app so it opens offline.
const KEY = "todo-items";
let items = JSON.parse(localStorage.getItem(KEY) || "[]");
const list = document.getElementById("list");

function save() {
  localStorage.setItem(KEY, JSON.stringify(items));
  render();
}

function render() {
  list.replaceChildren(...items.map((item, i) => {
    const li = document.createElement("li");
    li.className = item.done ? "done" : "";
    const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: item.done, ariaLabel: "Done" });
    box.addEventListener("change", () => ((items[i].done = box.checked), save()));
    const text = Object.assign(document.createElement("span"), { textContent: item.text });
    const del = Object.assign(document.createElement("button"), { type: "button", textContent: "Delete" });
    del.addEventListener("click", () => (items.splice(i, 1), save()));
    li.append(box, text, del);
    return li;
  }));
  const left = items.filter((i) => !i.done).length;
  document.getElementById("left").textContent = left + (left === 1 ? " task left" : " tasks left");
}

document.getElementById("add").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("text");
  items.push({ text: input.value.trim(), done: false });
  input.value = "";
  save();
});

render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
`,
  "sw.js": `// Cache-first service worker: the app shell is cached at install time.
const CACHE = "todo-v1";
const FILES = ["./", "index.html", "css/style.css", "js/app.js", "icon.svg", "manifest.webmanifest"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));
self.addEventListener("fetch", (e) => e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request))));
`,
  "manifest.webmanifest": `${JSON.stringify({ name: "To-do", short_name: "To-do", start_url: "./", display: "standalone", background_color: "#ffffff", theme_color: "#16a34a", icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml" }] }, null, 2)}\n`,
  "icon.svg": icon,
};

const notes = {
  "index.html": page({
    title: "Notes",
    description: "Notes saved in your browser.",
    head: `  <link rel="stylesheet" href="css/style.css">\n  <script src="js/app.js" type="module"></script>\n`,
    body: `<div class="notes">
  <aside>
    <div class="row"><input id="search" type="search" placeholder="Search" aria-label="Search notes"><button class="primary" id="new" type="button">New</button></div>
    <ul class="list" id="list"></ul>
  </aside>
  <main>
    <input id="title" placeholder="Title" aria-label="Title">
    <textarea id="body" placeholder="Write here. *bold*, _italic_ and lines starting with - become lists." aria-label="Note"></textarea>
    <section id="preview" class="preview" aria-label="Preview"></section>
  </main>
</div>`,
  }),
  "css/style.css": `${APP_CSS}.notes { display: grid; grid-template-columns: 260px 1fr; min-height: 100vh; }
aside { border-right: 1px solid var(--border); padding: 12px; background: var(--surface); }
main { padding: 16px; display: grid; gap: 10px; grid-template-rows: auto 1fr auto; }
textarea { min-height: 240px; resize: vertical; }
.list li { padding: 8px; border-radius: 8px; cursor: pointer; }
.list li.active { background: var(--accent); color: var(--accent-ink); }
.preview { border-top: 1px solid var(--border); padding-top: 8px; }

@media (max-width: 767px) {
  .notes { grid-template-columns: 1fr; }
  aside { border-right: 0; border-bottom: 1px solid var(--border); }
}
`,
  "js/app.js": `// Notes in localStorage with a tiny, safe Markdown-like preview (text is escaped before formatting).
const KEY = "notes";
let notes = JSON.parse(localStorage.getItem(KEY) || "[]");
let current = notes[0]?.id ?? null;
const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function format(text) {
  return esc(text)
    .split("\\n")
    .map((l) => (l.startsWith("- ") ? "<li>" + l.slice(2) + "</li>" : l ? "<p>" + l + "</p>" : ""))
    .join("")
    .replace(/\\*([^*]+)\\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(notes));
}

function render() {
  const q = $("search").value.toLowerCase();
  $("list").replaceChildren(...notes.filter((n) => (n.title + n.body).toLowerCase().includes(q)).map((n) => {
    const li = document.createElement("li");
    li.textContent = n.title || "Untitled";
    li.className = n.id === current ? "active" : "";
    li.addEventListener("click", () => ((current = n.id), render()));
    return li;
  }));
  const note = notes.find((n) => n.id === current);
  $("title").value = note?.title ?? "";
  $("body").value = note?.body ?? "";
  $("preview").innerHTML = note ? format(note.body) : "";
}

function edit() {
  const note = notes.find((n) => n.id === current);
  if (!note) return;
  note.title = $("title").value;
  note.body = $("body").value;
  save();
  $("preview").innerHTML = format(note.body);
}

$("new").addEventListener("click", () => {
  const note = { id: Date.now(), title: "", body: "" };
  notes.unshift(note);
  current = note.id;
  save();
  render();
  $("title").focus();
});
$("title").addEventListener("input", () => (edit(), render()));
$("body").addEventListener("input", edit);
$("search").addEventListener("input", render);
render();
`,
};

const calculator = {
  "index.html": page({
    title: "Calculator",
    description: "A keyboard-operable calculator.",
    head: `  <link rel="stylesheet" href="css/style.css">\n  <script src="js/app.js" type="module"></script>\n`,
    body: `<main class="app calc">
  <output id="display" aria-live="polite">0</output>
  <div class="keys" id="keys">
${["C", "(", ")", "/", "7", "8", "9", "*", "4", "5", "6", "-", "1", "2", "3", "+", "0", ".", "⌫", "="].map((k) => `    <button type="button" data-key="${k}"${k === "=" ? ' class="primary"' : ""}>${k}</button>`).join("\n")}
  </div>
  <h2>History</h2>
  <ol id="history" class="muted"></ol>
</main>`,
  }),
  "css/style.css": `${APP_CSS}.calc { max-width: 340px; }
output { display: block; font-size: 36px; text-align: right; padding: 12px; background: var(--surface); border-radius: var(--radius); margin-bottom: 12px; overflow-x: auto; font-variant-numeric: tabular-nums; }
.keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.keys button { font-size: 20px; padding: 14px 0; }
`,
  "js/app.js": `// A calculator with its own small parser (no eval): + - * / and parentheses.
let expr = "";
const display = document.getElementById("display");

function evaluate(src) {
  const tokens = src.match(/\\d+(?:\\.\\d+)?|[-+*/()]/g) || [];
  let i = 0;
  const peek = () => tokens[i];
  const factor = () => {
    const t = tokens[i++];
    if (t === "(") {
      const v = sum();
      i++;
      return v;
    }
    if (t === "-") return -factor();
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error("Syntax");
    return n;
  };
  const product = () => {
    let v = factor();
    while (peek() === "*" || peek() === "/") v = tokens[i++] === "*" ? v * factor() : v / factor();
    return v;
  };
  const sum = () => {
    let v = product();
    while (peek() === "+" || peek() === "-") v = tokens[i++] === "+" ? v + product() : v - product();
    return v;
  };
  const v = sum();
  if (i < tokens.length) throw new Error("Syntax");
  return Math.round(v * 1e10) / 1e10;
}

function press(key) {
  if (key === "C" || key === "Escape") expr = "";
  else if (key === "⌫" || key === "Backspace") expr = expr.slice(0, -1);
  else if (key === "=" || key === "Enter") {
    try {
      const result = String(evaluate(expr));
      const li = document.createElement("li");
      li.textContent = expr + " = " + result;
      document.getElementById("history").prepend(li);
      expr = result;
    } catch {
      expr = "";
      display.textContent = "Error";
      return;
    }
  } else if (/^[\\d.+\\-*/()]$/.test(key)) expr += key;
  else return;
  display.textContent = expr || "0";
}

document.getElementById("keys").addEventListener("click", (e) => e.target.dataset.key && press(e.target.dataset.key));
document.addEventListener("keydown", (e) => press(e.key));
`,
};

export const FILES = { "todo-pwa": todo, notes, calculator };
