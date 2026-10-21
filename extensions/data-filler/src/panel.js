// Lorem & Data Filler panel. lib.js is prepended by the packer.
const $ = (id) => document.getElementById(id);
const t = (key, vars = {}) => String(STRINGS[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const say = (text) => { $("status").textContent = text; };
const seedOf = () => Number($("seed").value) || 0;

function preview() {
  const kind = $("kind").value === "auto" ? "sentences" : $("kind").value;
  $("preview").textContent = generate(kind, { seed: seedOf(), count: Math.min(30, Number($("count").value) || 1) }).join("\n");
}

async function fill() {
  try {
    const n = await fillSelection(openfini, { kind: $("kind").value, seed: seedOf() });
    say(n ? t("filled", { n }) : t("noText"));
  } catch (e) { say(e.message); }
}

async function boot() {
  $("kind").replaceChildren(...[["auto", "Smart (by layer name)"], ...Object.entries(KINDS).map(([k, d]) => [k, d[0]])].map(([v, l]) => Object.assign(document.createElement("option"), { value: v, textContent: l })));
  $("presets").replaceChildren(...PRESETS.map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p.label;
    b.addEventListener("click", () => { $("kind").value = p.kind; $("count").value = p.count; preview(); });
    return b;
  }));
  $("kind").addEventListener("change", preview);
  $("seed").addEventListener("input", preview);
  $("count").addEventListener("input", preview);
  $("fill").addEventListener("click", fill);
  $("reroll").addEventListener("click", () => { $("seed").value = Math.floor(Math.random() * 99999); preview(); });
  $("copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("preview").textContent); say("Copied."); } catch { say("Select the text and copy it."); } });
  $("avatars").addEventListener("click", async () => { try { await insertAvatars(openfini, { count: 4, seed: seedOf() }); say("Avatars inserted."); } catch (e) { say(e.message); } });
  for (const b of document.querySelectorAll("[data-block]")) b.addEventListener("click", async () => { try { await insertHtmlBlock(openfini, { block: b.dataset.block, count: Math.min(30, Number($("count").value) || 6), seed: seedOf() }); say("Inserted."); } catch (e) { say(e.message); } });
  const apply = (studio) => { $("code").hidden = studio !== "code"; $("design").hidden = studio === "code"; $("fill").parentElement.parentElement.hidden = studio === "code"; };
  apply(await openfini.studio.current());
  openfini.events.on("studioChanged", (e) => apply(e.studio));
  preview();
}
boot();
