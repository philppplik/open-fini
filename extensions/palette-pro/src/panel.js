// Palette Pro panel UI. lib.js is prepended by the packer. `openfini` is the extension API.
const $ = (id) => document.getElementById(id);
const t = (key, vars = {}) => String(STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
let source = [];
let current = [];

const say = (text) => { $("status").textContent = text; };

function swatches(el, colors, onClick) {
  el.replaceChildren(...colors.map((hex) => {
    const b = document.createElement("button");
    b.type = "button";
    b.style.background = hex;
    b.title = `${hex} (click to copy)`;
    b.setAttribute("role", "listitem");
    b.setAttribute("aria-label", hex);
    const label = document.createElement("span");
    label.textContent = hex.slice(1);
    b.append(label);
    b.addEventListener("click", () => onClick(hex));
    return b;
  }));
}

async function copy(hex) {
  try { await navigator.clipboard.writeText(hex); say(t("copied", { hex })); } catch { say(hex); }
}

function refresh() {
  const base = $("base").value;
  swatches($("source"), source, (hex) => { $("base").value = hex; $("fg").value = hex; refresh(); checkContrast(); });
  current = harmony(base, $("kind").value, 5);
  swatches($("harm"), current, copy);
}

async function fromSelection() {
  try {
    const { selection } = await openfini.document.readSelection();
    const colors = colorsFromLayers(selection);
    if (!colors.length) return say(t("noColors"));
    source = colors.slice(0, 24);
    $("base").value = source[0];
    await openfini.storage.set("source", source);
    refresh();
    say(`${source.length} colors read from ${selection.length} layers.`);
  } catch (e) { say(e.message); }
}

async function fromImage() {
  try {
    const [file] = await openfini.files.open({ description: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] });
    if (!file) return;
    const bmp = await createImageBitmap(new Blob([file.data]));
    const s = Math.min(1, 160 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    source = dominantColors(ctx.getImageData(0, 0, c.width, c.height).data, 6);
    if (!source.length) return say(t("imageFailed"));
    $("base").value = source[0];
    refresh();
    say(`${source.length} dominant colors from ${file.name}.`);
  } catch (e) { say(e.code === "PERMISSION_DENIED" ? e.message : t("imageFailed")); }
}

async function apply() {
  try {
    const { selection } = await openfini.document.readSelection();
    if (!selection.length) return say(t("noSelection"));
    const palette = current.length ? current : source;
    for (const g of assignPalette(selection.map((l) => l.id), palette)) await openfini.document.callTool("set_style", { ids: g.ids, fill: g.fill });
    say(t("applied", { n: selection.length }));
  } catch (e) { say(e.message); }
}

function checkContrast() {
  const fg = $("fg").value;
  const bg = $("bg").value;
  const ratio = contrastRatio(fg, bg);
  const w = wcagLevel(ratio);
  const mark = (ok) => `<b class="${ok ? "ok" : "bad"}">${ok ? "Pass" : "Fail"}</b>`;
  $("result").innerHTML = `<b>${ratio.toFixed(2)}:1</b> &mdash; ${w.level}<br>Normal text AA ${mark(w.aa)} &middot; AAA ${mark(w.aaa)}<br>Large text AA ${mark(w.aaLarge)} &middot; AAA ${mark(w.aaaLarge)}`;
  const fixes = w.aa ? [] : suggestFix(fg, bg, 4.5);
  $("fixes").replaceChildren(...fixes.map((f) => {
    const row = document.createElement("div");
    row.className = "fix";
    row.innerHTML = `<span class="chip" style="background:${f.color}"></span><span>${f.color} is ${f.direction} &mdash; ${f.ratio}:1</span>`;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Use";
    b.addEventListener("click", () => { $("fg").value = f.color; checkContrast(); });
    row.append(b);
    return row;
  }));
}

async function pairFromSelection() {
  const { selection } = await openfini.document.readSelection();
  const fills = selection.map((l) => l.fill).filter((f) => parseColor(f || ""));
  if (fills.length < 2) return say("Select two layers with solid colors.");
  $("fg").value = toHex(parseColor(fills[0]));
  $("bg").value = toHex(parseColor(fills[1]));
  checkContrast();
}

async function renderSaved() {
  const saved = await openfini.storage.get("saved", []);
  $("saved").replaceChildren(...saved.map((p, i) => {
    const row = document.createElement("div");
    row.className = "row";
    const holder = document.createElement("div");
    holder.className = "sw";
    swatches(holder, p.colors, copy);
    const use = document.createElement("button");
    use.type = "button";
    use.textContent = `Use ${p.name}`;
    use.addEventListener("click", () => { source = p.colors; $("base").value = p.colors[0]; refresh(); });
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.addEventListener("click", async () => { saved.splice(i, 1); await openfini.storage.set("saved", saved); renderSaved(); });
    row.append(holder, use, del);
    return row;
  }));
}

async function savePalette() {
  const colors = current.length ? current : source;
  if (!colors.length) return;
  const saved = await openfini.storage.get("saved", []);
  saved.push({ name: `Palette ${saved.length + 1}`, colors });
  await openfini.storage.set("saved", saved.slice(-12));
  renderSaved();
}

async function boot() {
  $("kind").replaceChildren(...Object.keys(HARMONIES).map((k) => Object.assign(document.createElement("option"), { value: k, textContent: k })));
  $("kind").value = "analogous";
  source = await openfini.storage.get("source", []);
  if (source[0]) $("base").value = source[0];
  $("from-sel").addEventListener("click", fromSelection);
  $("from-img").addEventListener("click", fromImage);
  $("apply").addEventListener("click", apply);
  $("save").addEventListener("click", savePalette);
  $("base").addEventListener("input", refresh);
  $("kind").addEventListener("change", refresh);
  $("fg").addEventListener("input", checkContrast);
  $("bg").addEventListener("input", checkContrast);
  $("swap").addEventListener("click", () => { const f = $("fg").value; $("fg").value = $("bg").value; $("bg").value = f; checkContrast(); });
  $("pair").addEventListener("click", pairFromSelection);
  refresh();
  checkContrast();
  renderSaved();
}
boot();
