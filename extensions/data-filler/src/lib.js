// Lorem & Data Filler: deterministic placeholder content (seeded). Pure; no OpenFini API.
// The packer strips `export` and prepends this file to main.js / panel.js; keep it import-free.

export const STRINGS = {
  title: "Lorem & Data Filler",
  noText: "Select text layers (or frames in the Code studio) to fill.",
  filled: "Filled {n} layers.",
  inserted: "Inserted {n} items.",
};

/** mulberry32: small, fast, deterministic PRNG. Seeds may be numbers or strings. */
export function rng(seed = 1) {
  let a = typeof seed === "number" ? seed >>> 0 : [...String(seed)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  return next;
}

const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum curabitur pretium tincidunt lacus nunc vitae semper nibh porta felis euismod libero rhoncus vulputate massa interdum".split(" ");
const FIRST = "Olivia Liam Emma Noah Ava Elijah Sophia Lucas Mia Mason Isabella Ethan Amelia Logan Harper Aria Leo Nora Jack Zoe Hannah Felix Clara Jonas Lena Mateo Yara Omar Priya Kenji Ingrid Tomas Aisha Diego".split(" ");
const LAST = "Smith Johnson Brown Garcia Miller Davis Martinez Anderson Taylor Moore Jackson Martin Lee Walker Hall Young King Wright Lopez Hill Scott Green Adams Baker Nelson Carter Mitchell Roberts Turner Phillips Campbell Parker Evans Edwards Collins".split(" ");
const STREETS = "Maple Oak Cedar Pine Elm Washington Lake Hill Park Sunset Willow River Church Mill Spring Highland Meadow Forest".split(" ");
const SUFFIX = "Street Avenue Road Lane Boulevard Drive Way Court".split(" ");
const CITIES = [["Springfield", "IL"], ["Riverton", "WY"], ["Fairview", "OR"], ["Lakewood", "CO"], ["Georgetown", "TX"], ["Madison", "WI"], ["Franklin", "TN"], ["Clinton", "NY"], ["Salem", "MA"], ["Bristol", "CT"]];
const DOMAINS = ["example.com", "example.org", "example.net", "mail.test"];
const ADJ = "Aero Nova Pure Smart Urban Classic Eco Prime Zen Swift Bold Cozy Ultra Mini Pro".split(" ");
const NOUN = "Backpack Lamp Headphones Notebook Bottle Chair Watch Speaker Jacket Mug Keyboard Camera Sneakers Blanket Planter Wallet".split(" ");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function words(r, n) {
  return Array.from({ length: n }, () => r.pick(LOREM)).join(" ");
}
export function sentence(r, min = 6, max = 14) {
  return `${cap(words(r, r.int(min, max)))}${r.int(0, 9) === 0 ? "?" : "."}`;
}
export function paragraph(r, min = 3, max = 6) {
  return Array.from({ length: r.int(min, max) }, () => sentence(r)).join(" ");
}

export function fullName(r) {
  return `${r.pick(FIRST)} ${r.pick(LAST)}`;
}
export function email(r, name = fullName(r)) {
  return `${name.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, r.int(0, 1) ? "." : "")}@${r.pick(DOMAINS)}`;
}
export function address(r) {
  const [city, st] = r.pick(CITIES);
  return `${r.int(10, 9899)} ${r.pick(STREETS)} ${r.pick(SUFFIX)}, ${city}, ${st} ${String(r.int(10000, 99950))}`;
}
export function date(r, { from = 2020, to = 2026, style = "long" } = {}) {
  const y = r.int(from, to);
  const m = r.int(0, 11);
  const d = r.int(1, 28);
  if (style === "iso") return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (style === "short") return `${String(m + 1).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
  return `${MONTHS[m]} ${d}, ${y}`;
}
export function price(r, { min = 5, max = 250, currency = "$" } = {}) {
  return `${currency}${(r.int(min * 100, max * 100) / 100 - 0.01).toFixed(2)}`;
}
export function product(r) {
  return `${r.pick(ADJ)} ${r.pick(NOUN)}`;
}
export function initials(name) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
export function phone(r) {
  return `(${r.int(201, 989)}) ${r.int(200, 999)}-${String(r.int(0, 9999)).padStart(4, "0")}`;
}
export function company(r) {
  return `${r.pick(LAST)} ${r.pick(["Labs", "Studio", "Works", "Group", "& Co.", "Systems", "Partners"])}`;
}

/** Kinds offered by the UI: id -> [label, generator(r, opts)]. */
export const KINDS = {
  words: ["Lorem words", (r, o) => words(r, o.count || 5)],
  sentences: ["Lorem sentences", (r, o) => Array.from({ length: o.count || 2 }, () => sentence(r)).join(" ")],
  paragraphs: ["Lorem paragraphs", (r, o) => Array.from({ length: o.count || 2 }, () => paragraph(r)).join("\n\n")],
  name: ["Full name", (r) => fullName(r)],
  email: ["Email", (r) => email(r)],
  address: ["Address", (r) => address(r)],
  phone: ["Phone", (r) => phone(r)],
  date: ["Date", (r, o) => date(r, { style: o.dateStyle || "long" })],
  price: ["Price", (r, o) => price(r, { currency: o.currency || "$" })],
  product: ["Product name", (r) => product(r)],
  company: ["Company", (r) => company(r)],
  initials: ["Initials (avatar)", (r) => initials(fullName(r))],
};

/** Generates `count` values of one kind, deterministically for a seed. */
export function generate(kind, { seed = 1, count = 1, ...opts } = {}) {
  const def = KINDS[kind];
  if (!def) throw new Error(`Unknown kind “${kind}”.`);
  const r = rng(seed);
  const single = kind === "words" || kind === "sentences" || kind === "paragraphs";
  return single ? [def[1](r, { ...opts, count })] : Array.from({ length: count }, () => def[1](r, opts));
}

/** Guesses the best kind for a layer from its name and current text ("Price" -> price). Falls back to `fallback`. */
export function guessKind(name = "", text = "", fallback = "sentences") {
  const s = `${name} ${text}`.toLowerCase();
  const rules = [[/e-?mail|@/, "email"], [/phone|tel\b|mobile/, "phone"], [/price|cost|\$|€|amount|total/, "price"], [/date|day|month|published|posted/, "date"], [/address|street|location/, "address"], [/product|item|sku/, "product"], [/company|brand|organization|agency/, "company"], [/avatar|initials/, "initials"], [/\bname\b|author|user|person|customer|contact/, "name"], [/title|headline|heading|label|button|cta|tag/, "words"], [/paragraph|body|description|text|lorem|content|bio/, "paragraphs"]];
  for (const [re, kind] of rules) if (re.test(s)) return kind;
  return fallback;
}

/** Text for one layer: fixed kind, or "auto" (guess from name/text). Short boxes get short text. */
export function fillValue(layer, { kind = "auto", seed = 1, index = 0 } = {}) {
  const k = kind === "auto" ? guessKind(layer.name, layer.text, layer.w && layer.h && layer.h < 60 ? "words" : "sentences") : kind;
  const opts = k === "paragraphs" && layer.h && layer.h < 200 ? { count: 1 } : {};
  return generate(k, { seed: `${seed}:${index}`, ...opts })[0];
}

// ---- HTML for the Code studio ---------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Fake rows: [{name, email, company, date, price}] */
export function fakeRows(count, seed = 1) {
  const r = rng(seed);
  return Array.from({ length: count }, () => {
    const name = fullName(r);
    return { name, email: email(r, name), company: company(r), date: date(r, { style: "iso" }), price: price(r), product: product(r), initials: initials(name), blurb: sentence(r, 8, 14) };
  });
}

export function htmlList(count, seed = 1) {
  return `<ul class="people">\n${fakeRows(count, seed).map((p) => `  <li><strong>${esc(p.name)}</strong> <a href="mailto:${esc(p.email)}">${esc(p.email)}</a></li>`).join("\n")}\n</ul>`;
}

export function htmlTable(count, seed = 1) {
  const rows = fakeRows(count, seed);
  return `<table class="data">\n  <caption>Customers</caption>\n  <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Company</th><th scope="col">Since</th><th scope="col">Spend</th></tr></thead>\n  <tbody>\n${rows.map((p) => `    <tr><th scope="row">${esc(p.name)}</th><td>${esc(p.email)}</td><td>${esc(p.company)}</td><td>${esc(p.date)}</td><td>${esc(p.price)}</td></tr>`).join("\n")}\n  </tbody>\n</table>`;
}

export function htmlCards(count, seed = 1) {
  const rows = fakeRows(count, seed);
  return `<div class="card-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">\n${rows.map((p) => `  <article class="card" style="border:1px solid #ddd;border-radius:12px;padding:16px">\n    <div class="avatar" aria-hidden="true" style="width:44px;height:44px;border-radius:50%;background:#e0e7ff;display:grid;place-items:center;font-weight:600">${esc(p.initials)}</div>\n    <h3>${esc(p.product)}</h3>\n    <p>${esc(p.blurb)}</p>\n    <p><strong>${esc(p.price)}</strong> &middot; ${esc(p.name)}</p>\n  </article>`).join("\n")}\n</div>`;
}

export const HTML_BLOCKS = { list: htmlList, table: htmlTable, cards: htmlCards };

// ---- presets ---------------------------------------------------------------------------------------------------

export const PRESETS = [
  { id: "article", label: "Article block", kind: "paragraphs", count: 3 },
  { id: "headline", label: "Headline", kind: "words", count: 6 },
  { id: "people", label: "People names", kind: "name", count: 1 },
  { id: "shop", label: "Product + price", kind: "product", count: 1 },
  { id: "contact", label: "Email", kind: "email", count: 1 },
  { id: "smart", label: "Smart fill (by layer name)", kind: "auto", count: 1 },
];

// ---- API-driven operations (take the `openfini` object so tests can pass a mock) ----------------------------------

const flatten = (layers) => layers.flatMap((l) => (l.children ? flatten(l.children) : [l]));

/** Fills the selected text layers (groups are searched). Returns the number of layers filled. */
export async function fillSelection(api, { kind = "auto", seed = 1 } = {}) {
  const { selection } = await api.document.readSelection();
  const targets = flatten(selection).filter((l) => l.type === "text");
  for (const [i, layer] of targets.entries()) {
    await api.document.callTool("set_style", { ids: [layer.id], text: fillValue(layer, { kind, seed, index: i }) });
    // set_style renames a text layer after its new text; keep the designer's layer name (it drives "smart" fill)
    if (layer.name) await api.document.callTool("set_style", { ids: [layer.id], name: layer.name });
  }
  return targets.length;
}

/** Adds `count` initials avatars (circle + letters) in a row at the page center. */
export async function insertAvatars(api, { count = 4, seed = 1, size = 96 } = {}) {
  const info = await api.document.pageInfo();
  const r = rng(seed);
  const colors = ["#c7d2fe", "#fecaca", "#bbf7d0", "#fde68a", "#bae6fd", "#fbcfe8"];
  const x0 = Math.max(0, ((info?.width || 800) - count * (size + 16)) / 2);
  const y0 = Math.max(0, ((info?.height || 600) - size) / 2);
  for (let i = 0; i < count; i++) {
    const x = x0 + i * (size + 16);
    await api.document.callTool("add_shape", { type: "ellipse", x, y: y0, w: size, h: size, fill: r.pick(colors), name: "Avatar" });
    await api.document.callTool("add_text", { text: initials(fullName(r)), x: x + size * 0.2, y: y0 + size * 0.3, w: size * 0.6, fontSize: Math.round(size * 0.32), fontWeight: 600, align: "center", color: "#1f2937", name: "Avatar initials" });
  }
  return count;
}

/** Inserts a fake-data HTML block (list, table or cards) into the Code studio page. */
export async function insertHtmlBlock(api, { block = "cards", count = 6, seed = 1 } = {}) {
  const make = HTML_BLOCKS[block];
  if (!make) throw new Error(`Unknown block “${block}”.`);
  await api.document.callTool("insert_html", { html: make(count, seed) });
  return count;
}
