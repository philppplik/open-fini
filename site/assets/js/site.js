// The only script of the website (docs/concepts/website.md): theme toggle, a one-time hint to the German pages, and
// the download detection with a refresh of the latest release. Every page works without it.
import { detectPlatform, formatSize, pickDownloads } from "./platforms.js";

const root = document.documentElement;
const store = {
  get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
  set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------- theme
const toggle = document.querySelector(".theme-toggle");
if (toggle) {
  const effective = () => root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const sync = () => toggle.setAttribute("aria-pressed", String(effective() === "dark"));
  toggle.hidden = false;
  sync();
  toggle.addEventListener("click", () => {
    const next = effective() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    store.set("of-site-theme", next);
    sync();
  });
}

// ---------------------------------------------------------------- German hint (never a redirect)
if (document.body.dataset.lang === "en" && /^de\b/i.test(navigator.languages?.[0] || navigator.language || "") && !store.get("of-site-de-hint")) {
  const de = document.querySelector('link[rel=alternate][hreflang="de"]');
  if (de) {
    const bar = document.createElement("div");
    bar.className = "langhint";
    bar.lang = "de";
    bar.innerHTML = `<p>Diese Seite gibt es auch auf Deutsch. <a></a></p><button type="button" class="icon-btn" aria-label="Schließen">×</button>`;
    const a = bar.querySelector("a");
    a.href = new URL(de.href).pathname;
    a.textContent = "Zur deutschen Seite →";
    bar.querySelector("button").addEventListener("click", () => { store.set("of-site-de-hint", "1"); bar.remove(); });
    document.querySelector(".top")?.after(bar);
  }
}

// ---------------------------------------------------------------- downloads
async function platform() {
  const env = { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };
  try {
    const hints = await navigator.userAgentData?.getHighEntropyValues(["platform", "architecture", "bitness"]);
    if (hints) Object.assign(env, { platform: hints.platform, architecture: hints.architecture, bitness: hints.bitness });
  } catch { /* not Chromium */ }
  return detectPlatform(env);
}

function build(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null) n.append(k);
  return n;
}

function render(box, data, plat) {
  const s = data.strings;
  const f = (k, vars = {}) => s[k].replace(/\{(\w+)\}/g, (m, x) => vars[x] ?? m);
  const osName = s[`os.${plat.os}`] || "";
  const archName = (a) => (a.os === "macos" ? s[`arch.mac.${a.arch}`] : s[`arch.${a.arch}`]) || "";
  const { primary, others, archKnown } = pickDownloads(plat, data.assets);
  box.replaceChildren();
  if (!primary) {
    if (["android", "ios", "chromeos"].includes(plat.os)) box.append(build("p", { className: "dl__hint" }, f("dl.detected", { platform: osName })), build("p", {}, s["dl.mobile"]));
    else box.append(build("p", { className: "dl__hint" }, box.dataset.fallback || ""));
    return;
  }
  const label = `${osName}${plat.arch ? ` ${archName(primary)}` : ""}`;
  box.append(
    build("p", { className: "label" }, f("dl.detected", { platform: label })),
    build("a", { className: "btn btn--primary btn--lg", href: primary.url },
      build("span", {}, f("cta.downloadFor", { os: `${osName} ${archName(primary)}`.trim() })),
      build("span", { className: "btn__meta" }, `${primary.name} · ${formatSize(primary.size, data.locale)}`)),
  );
  if (plat.os === "macos" && !archKnown) box.append(build("p", { className: "dl__note" }, s["dl.archUnknown"]));
  if (others.length) {
    box.append(build("p", { className: "dl__others-h" }, s["dl.otherFiles"]),
      build("ul", { className: "dl__others" }, others.map((a) => build("li", {}, build("a", { href: a.url }, a.name), ` · ${archName(a)} ${s[`kind.${a.kind}`]} · ${formatSize(a.size, data.locale)}`))));
  }
}

async function latest(data) {
  const key = "of-site-release";
  const cached = JSON.parse(store.get(key, sessionStorage) || "null");
  if (cached && Date.now() - cached.at < 3600e3) return cached.rel;
  const res = await fetch(`https://api.github.com/repos/${data.repo}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) return null;
  const r = await res.json();
  const rel = { tag: r.tag_name, assets: r.assets.map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })) };
  store.set(key, JSON.stringify({ at: Date.now(), rel }), sessionStorage);
  return rel;
}

const box = document.querySelector("[data-dl]");
const payload = document.getElementById("release-data");
if (box && payload) {
  const data = JSON.parse(payload.textContent);
  box.dataset.fallback = box.textContent.trim();
  const plat = await platform();
  render(box, data, plat);
  latest(data).then((rel) => {
    if (!rel || !rel.tag || rel.tag === data.tag) return;
    // a release newer than the build: offer its files (the table keeps the checksums of the build's release)
    render(box, { ...data, tag: rel.tag, assets: rel.assets }, plat);
    const note = document.querySelector("[data-dl-notice]");
    if (note) { note.textContent = data.strings["dl.newer"].replace("{v}", rel.tag.replace(/^v/, "")); note.hidden = false; }
  }).catch(() => { /* offline or rate limited: the build-time list stays */ });
} else if (document.querySelector("[data-dl-cta]")) {
  // other pages: name the visitor's system on the download buttons
  platform().then((plat) => {
    const names = { windows: "Windows", macos: "macOS", linux: "Linux" };
    if (!names[plat.os]) return;
    document.querySelectorAll("[data-dl-cta]").forEach((a) => { a.querySelector("span").textContent = a.dataset.dlCta.replace("{os}", names[plat.os]); });
  });
}

// ---------------------------------------------------------------- copy checksums
document.querySelectorAll("code.sha").forEach((code) => {
  const data = payload && JSON.parse(payload.textContent);
  const b = build("button", { type: "button", className: "copy", textContent: data?.strings["dl.copy"] || "Copy" });
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code.title);
      b.textContent = data?.strings["dl.copied"] || "Copied";
      setTimeout(() => { b.textContent = data?.strings["dl.copy"] || "Copy"; }, 1600);
    } catch { /* clipboard blocked */ }
  });
  code.after(b);
});

// ---------------------------------------------------------------- docs sidebar: open on wide screens
const docnav = document.querySelector(".docnav__details");
if (docnav && matchMedia("(min-width: 960px)").matches) docnav.open = true;

// ---------------------------------------------------------------- docs search (titles and headings, no service)
const search = document.querySelector("form[data-search]");
if (search) {
  const input = search.querySelector("input[type=search]");
  const list = search.querySelector(".docsearch__results");
  let index = null;
  const load = () => (index ??= fetch(search.dataset.search).then((r) => r.json()).catch(() => []));
  const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const show = async () => {
    const q = norm(input.value.trim());
    if (q.length < 2) { list.hidden = true; return; }
    const words = q.split(/\s+/);
    const hits = [];
    for (const p of await load()) {
      const title = norm(p.t);
      if (words.every((w) => title.includes(w))) hits.push({ score: title.startsWith(words[0]) ? 0 : 1, text: p.t, sub: p.s, url: p.u });
      for (const [h, id] of p.h) {
        if (words.every((w) => norm(h).includes(w) || title.includes(w))) hits.push({ score: 2, text: h, sub: p.t, url: `${p.u}#${id}` });
      }
    }
    hits.sort((a, b) => a.score - b.score);
    list.replaceChildren(...(hits.length
      ? hits.slice(0, 12).map((h) => build("li", {}, build("a", { href: h.url }, build("span", {}, h.text), build("small", {}, h.sub))))
      : [build("li", { className: "docsearch__none" }, search.dataset.none)]));
    list.hidden = false;
  };
  input.addEventListener("focus", load, { once: true });
  input.addEventListener("input", show);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { input.value = ""; list.hidden = true; }
    if (e.key === "ArrowDown") { list.querySelector("a")?.focus(); e.preventDefault(); }
  });
  list.addEventListener("keydown", (e) => {
    const links = [...list.querySelectorAll("a")];
    const i = links.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { links[i + 1]?.focus(); e.preventDefault(); }
    if (e.key === "ArrowUp") { (links[i - 1] ?? input).focus(); e.preventDefault(); }
    if (e.key === "Escape") { list.hidden = true; input.focus(); }
  });
  // Enter opens the first result; without results the form searches the repository on GitHub
  search.addEventListener("submit", (e) => {
    const first = list.querySelector("a");
    if (first && !list.hidden) { e.preventDefault(); location.href = first.href; }
  });
}
