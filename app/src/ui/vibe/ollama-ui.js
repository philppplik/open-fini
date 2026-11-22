// Models tab ▸ Ollama: detect the server, test the connection with a clear verdict, show the exact OLLAMA_ORIGINS fix
// for this operating system (browser only), list every model with its capabilities and pull a model with progress.
import { h, empty } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { platform } from "../../platform/index.js";
import { testOllama, detectOllama, originFixes, detectOs, normalizeOllamaBase, describeOllamaModel, createOllamaFetch, OLLAMA_DEFAULT_BASES } from "../../ai/index.js";
import { createOllamaProvider } from "../../ai/providers/ollama.js";

/**
 * @param {{getBase:()=>string, setBase:(url:string)=>void, getKey:()=>string, cloud?:boolean}} o
 */
export function createOllamaTools({ getBase, setBase, getKey, cloud = false }) {
  const el = h("div.of-vollama");
  const status = h("div.of-vstatus");
  const fix = h("div.of-vollama__fix");
  const models = h("div.of-vollama__models");
  const desktop = !!platform.isDesktop;
  const fetchFn = createOllamaFetch();

  const copy = async (text, btn) => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = t("Copied");
    } catch {
      btn.textContent = t("Copy failed");
    }
    setTimeout(() => (btn.textContent = t("Copy command")), 1800);
  };

  function showFix(origin) {
    empty(fix);
    const fixes = originFixes(origin);
    const mine = detectOs();
    fix.append(h("p.of-hint", t("Ollama only accepts browser pages listed in OLLAMA_ORIGINS. This page's origin is {origin}. Set it for your system, restart Ollama, then test again. The desktop app does not need this.", { origin: origin || t("(unknown)") })));
    for (const key of [mine, ...Object.keys(fixes).filter((k) => k !== mine)]) {
      const f = fixes[key];
      const btn = h("button.of-btn", { type: "button" }, t("Copy command"));
      btn.addEventListener("click", () => copy(f.command, btn));
      fix.append(h("details", { open: key === mine }, h("summary", f.title), h("ol", f.steps.map((s) => h("li", s))), btn));
    }
  }

  function setStatus(r) {
    const ok = r.status === "ok";
    status.className = `of-vstatus ${ok ? "ok" : "bad"}`;
    status.replaceChildren(r.message);
    empty(fix);
    if (r.status === "origin-blocked") showFix(r.origin || globalThis.location?.origin || "");
  }

  async function run(detect) {
    status.className = "of-vstatus";
    status.replaceChildren(h("sl-spinner"), detect ? t(" Looking for Ollama…") : t(" Connecting…"));
    const o = { base: getBase() || OLLAMA_DEFAULT_BASES[0], apiKey: getKey() || undefined, fetch: fetchFn, desktop };
    const r = cloud ? await testOllama(o) : detect ? await detectOllama(o) : await testOllama(o);
    if (r.status === "ok" && normalizeOllamaBase(getBase()) !== r.base) setBase(r.base);
    setStatus(r);
    if (r.status === "ok") await listModels(r.base);
    else empty(models);
  }

  async function listModels(base) {
    models.replaceChildren(h("sl-spinner"), t(" Loading models…"));
    const prov = createOllamaProvider({ baseUrl: base, apiKey: getKey() || undefined, fetch: fetchFn, cloud });
    try {
      const list = await prov.listModels();
      empty(models);
      if (!list.length) models.append(h("p.of-hint", cloud ? t("No models on this account.") : t("No models installed yet. Pull one below, for example llama3.2 or qwen3.")));
      for (const group of [false, true]) {
        const part = list.filter((m) => m.cloud === group);
        if (!part.length) continue;
        models.append(h("strong", group ? t("Cloud") : t("Local")));
        for (const m of part) models.append(h("div.of-vconn", h("div", h("strong", m.id), h("small", describeOllamaModel(m)))));
      }
      if (!cloud) models.append(pullRow(prov, base));
    } catch (e) {
      models.replaceChildren(h("p.of-hint", t("Could not list models: {msg}", { msg: e.message })));
    }
  }

  function pullRow(prov, base) {
    const input = h("input.of-vfield__in", { placeholder: t("Model to download, e.g. llama3.2"), spellcheck: false });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") go.click();
    });
    const bar = h("progress", { max: 1, value: 0, hidden: true });
    const text = h("small");
    let ctl = null;
    const go = h("button.of-btn", { type: "button" }, t("Pull"));
    go.addEventListener("click", async () => {
      if (ctl) return ctl.abort();
      const name = input.value.trim();
      if (!name) return;
      ctl = new AbortController();
      go.textContent = t("Cancel");
      bar.hidden = false;
      bar.removeAttribute("value");
      try {
        await prov.pull(name, {
          signal: ctl.signal,
          onProgress: (p) => {
            if (p.fraction != null) bar.value = p.fraction;
            text.textContent = p.fraction != null ? `${p.status} ${Math.round(p.fraction * 100)}%` : p.status;
          },
        });
        text.textContent = t("Downloaded {name}.", { name });
        await listModels(base);
      } catch (e) {
        text.textContent = ctl.signal.aborted ? t("Canceled.") : t("Could not pull {name}: {msg}", { name, msg: e.message });
      } finally {
        ctl = null;
        go.textContent = t("Pull");
        bar.hidden = true;
      }
    });
    return h("div.of-vollama__pull", input, go, bar, text);
  }

  const detect = h("button.of-btn", { type: "button", onclick: () => run(true) }, t("Detect"));
  const test = h("button.of-btn", { type: "button", onclick: () => run(false) }, t("Test connection"));
  el.append(h("div.of-vrow", ...(cloud ? [test] : [detect, test])), status, fix, models);
  return { el, run };
}
