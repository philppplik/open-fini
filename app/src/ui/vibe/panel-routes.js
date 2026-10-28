// Settings ▸ Artificial intelligence ▸ Models ▸ "Fallback chain" card and the provider health row.
// The model chosen in the model menu is always the primary; the targets listed here are tried after it, in order
// (see ai/routing.js). Everything is stored in vibeStore.settings: routes: [route], activeRoute: route.id | null.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { vibeStore } from "../../vibe/store.js";
import { routePresets, addTargets, moveTarget } from "../../vibe/route-presets.js";
import { iconEl } from "../toolbox.js";

const ROUTE_ID = "default";
const pct = (r) => (r == null ? t("no data yet") : `${Math.round(r * 100)} %`);

function currentRoute() {
  const s = vibeStore.settings;
  return s.routes.find((r) => r.id === ROUTE_ID) || { id: ROUTE_ID, name: "Fallback chain", targets: [], policy: {} };
}
async function saveRoute(route, active) {
  const routes = [...vibeStore.settings.routes.filter((r) => r.id !== ROUTE_ID), route];
  await vibeStore.saveSettings({ routes, activeRoute: active === undefined ? vibeStore.settings.activeRoute : active });
}

/** @param {object} vs workspace context ({ hub, session, app }) */
export function createRoutesCard(vs) {
  const el = h("div.of-vcard.of-vroute");
  let testResults = null;
  let stats = null;

  async function load() {
    const glue = await import("../../vibe/routing-glue.js");
    stats = (await glue.routeRuntime(vs.hub)).stats;
    paint();
  }

  const key = (tg) => `${tg.providerId}/${tg.model}`;
  const provLabel = (id) => vibeStore.providers.find((p) => p.id === id)?.label || t("(removed connection)");
  const tgLabel = (tg) => tg.label || `${provLabel(tg.providerId)} · ${String(tg.model).split("/").pop()}`;
  const num = (value, min, max, on) => {
    const i = h("input.of-vfield__in", { type: "number", min, max, value: String(value) });
    i.addEventListener("change", () => on(Math.max(min, Math.min(max, Math.round(Number(i.value)) || min))));
    i.addEventListener("keydown", (e) => e.stopPropagation());
    return i;
  };

  function paint() {
    const s = vibeStore.settings;
    const route = currentRoute();
    const policy = route.policy || {};
    const active = s.activeRoute === ROUTE_ID;
    const update = (patch, rerender = true) => saveRoute({ ...currentRoute(), ...patch }).then(() => rerender && paint());
    const setTargets = (targets) => update({ targets });
    el.replaceChildren();

    const toggle = h("input", { type: "checkbox", checked: active, "aria-label": t("Use a fallback chain") });
    toggle.addEventListener("change", () => saveRoute(currentRoute(), toggle.checked ? ROUTE_ID : null).then(paint));
    el.append(h("div.of-vcard__head", h("strong", t("Fallback chain")), h("label.of-vrow", toggle, h("span", t("On")))));
    el.append(h("p.of-hint", t("When your model does not answer (rate limit, overload, timeout, network error, unavailable model), Vibe switches to the next model below and tells you. Authentication and invalid-request errors are shown instead of hidden.")));

    // suggestion from local counts
    if (stats && !active) {
      const primary = { providerId: s.activeProvider, model: s.model, label: s.model };
      let sug = null;
      import("../../ai/routing.js").then(({ suggestFallback }) => {
        sug = suggestFallback(stats, { targets: [primary] });
        if (sug && !el.querySelector(".of-vroute__sug")) {
          const add = h("button.of-btn", { type: "button" }, t("Set up a fallback"));
          add.addEventListener("click", () => saveRoute(currentRoute(), ROUTE_ID).then(paint));
          el.querySelector(".of-hint")?.after(h("div.of-vroute__sug", { role: "status" }, iconEl("lightbulb"), h("span", t("Your model “{model}” failed {n} times today. Add a fallback model?", { model: s.model, n: sug.failures })), add));
        }
      });
    }

    // primary row (read only: it follows the model menu)
    const list = h("ol.of-vroute__list");
    const prim = s.activeProvider ? `${provLabel(s.activeProvider)} · ${s.model}` : t("Demo (offline)");
    list.append(h("li.of-vroute__row.primary", h("span.of-vroute__n", "1"), h("div.of-vroute__main", h("strong", prim), h("small", t("Primary: the model chosen in the model menu"))), h("small", stats ? `${t("Success")}: ${pct(stats.summary(key({ providerId: s.activeProvider || "demo", model: s.model || "demo" })).rate)}` : "")));
    route.targets.forEach((tg, i) => {
      const row = h("li.of-vroute__row", { draggable: "true", "data-i": String(i), class: tg.enabled === false ? "off" : "" });
      const en = h("input", { type: "checkbox", checked: tg.enabled !== false, "aria-label": t("Enabled") });
      en.addEventListener("change", () => setTargets(route.targets.map((x, j) => (j === i ? { ...x, enabled: en.checked } : x))));
      const to = num(tg.timeoutMs ? Math.round(tg.timeoutMs / 1000) : 0, 0, 600, (v) => update({ targets: route.targets.map((x, j) => (j === i ? { ...x, timeoutMs: v ? v * 1000 : undefined } : x)) }, false));
      to.title = t("Seconds to wait for the first token (0 = default {n} s)", { n: 45 });
      to.setAttribute("aria-label", t("First-token timeout in seconds"));
      const up = h("button.of-btn", { type: "button", "aria-label": t("Move up"), title: t("Move up"), disabled: i === 0 }, iconEl("arrow-up"));
      const down = h("button.of-btn", { type: "button", "aria-label": t("Move down"), title: t("Move down"), disabled: i === route.targets.length - 1 }, iconEl("arrow-down"));
      const rm = h("button.of-btn", { type: "button", "aria-label": t("Remove"), title: t("Remove") }, iconEl("trash"));
      up.addEventListener("click", () => setTargets(moveTarget(route.targets, i, -1)));
      down.addEventListener("click", () => setTargets(moveTarget(route.targets, i, 1)));
      rm.addEventListener("click", () => setTargets(route.targets.filter((_, j) => j !== i)));
      const sm = stats?.summary(key(tg));
      row.append(h("label.of-vroute__en", en), h("span.of-vroute__n", String(i + 2)), h("div.of-vroute__main", h("strong", tgLabel(tg)), h("small", sm?.total ? `${t("Success")}: ${pct(sm.rate)} (${sm.ok}/${sm.total})` : t("No requests yet"))), h("label.of-vroute__to", h("small", t("Timeout (s)")), to), h("div.of-vrow", up, down, rm));
      row.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/plain", String(i)));
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer?.getData("text/plain"));
        if (Number.isInteger(from) && from !== i) setTargets(moveTarget(route.targets, from, i - from));
      });
      list.append(row);
    });
    el.append(list);

    // add a target: provider + model
    const provSel = h("select.of-vfield__in", { "aria-label": t("Connection") }, vibeStore.providers.map((p) => h("option", { value: p.id }, p.label)), h("option", { value: "demo" }, t("Demo (offline)")));
    const modelIn = h("input.of-vfield__in", { placeholder: t("Model id"), spellcheck: false, list: "of-route-models", "aria-label": t("Model") });
    const dl = h("datalist", { id: "of-route-models" });
    modelIn.addEventListener("keydown", (e) => e.stopPropagation());
    const fillModels = async () => {
      dl.replaceChildren();
      try {
        const prov = await vs.session.providerFor(provSel.value === "demo" ? null : provSel.value);
        for (const m of (await prov.listModels()).slice(0, 300)) dl.append(h("option", { value: m.id }));
      } catch {
        /* no model list: the user types the id */
      }
    };
    provSel.addEventListener("change", fillModels);
    const add = h("button.of-btn", { type: "button" }, iconEl("plus-lg"), t("Add fallback"));
    add.addEventListener("click", () => {
      const model = provSel.value === "demo" ? "demo" : modelIn.value.trim();
      if (!model) return modelIn.focus();
      setTargets(addTargets(route, [{ providerId: provSel.value === "demo" ? null : provSel.value, model }]).targets);
    });
    if (vibeStore.providers.length) fillModels();
    el.append(h("div.of-vroute__add", provSel, modelIn, dl, add));

    // presets
    const presets = routePresets(s, vibeStore.providers);
    el.append(h("div.of-vroute__presets", h("small", t("Presets")), presets.map((p) => {
      const b = h("button.of-btn", { type: "button", title: p.reason || p.hint }, t(p.label));
      b.addEventListener("click", () => {
        if (!p.targets.length) return vs.app.toast(p.reason || p.hint, "warning", 4500);
        saveRoute(addTargets(route, p.targets), ROUTE_ID).then(paint);
      });
      return b;
    })));

    // policy
    const chk = (field, label, def) => {
      const c = h("input", { type: "checkbox", checked: policy[field] ?? def });
      c.addEventListener("change", () => update({ policy: { ...policy, [field]: c.checked } }, false));
      return h("label.of-vrow", c, h("span", label));
    };
    el.append(
      h("label.of-vfield", h("span", t("Retry the same model N times first")), num(policy.retriesPerTarget ?? 1, 0, 5, (v) => update({ policy: { ...policy, retriesPerTarget: v } }, false)), h("small", t("With growing pauses (and jitter). 0 = switch immediately."))),
      h("label.of-vfield", h("span", t("Wait for the first answer (seconds)")), num(Math.round((policy.firstTokenTimeoutMs ?? 45000) / 1000), 5, 600, (v) => update({ policy: { ...policy, firstTokenTimeoutMs: v * 1000 } }, false))),
      chk("fallbackBackground", t("Use the fallback chain for sub-agents and background runs too"), true),
      chk("fallbackOnAuth", t("Also fall back on authentication errors (wrong or expired key)"), false),
    );

    // test
    const test = h("button.of-btn", { type: "button" }, iconEl("activity"), t("Test route"));
    const out = h("ul.of-vroute__test", { "aria-live": "polite" });
    const showResults = () => {
      out.replaceChildren(...(testResults || []).map((r) => h("li", { class: r.ok ? "ok" : "bad" }, iconEl(r.ok ? "check-circle-fill" : "exclamation-triangle-fill"), h("span", `${r.target} — ${r.ok ? `${r.ms} ms` : `${r.category}: ${r.message}`}`))));
    };
    test.addEventListener("click", async () => {
      test.disabled = true;
      out.replaceChildren(h("li", h("sl-spinner"), ` ${t("Testing…")}`));
      try {
        const glue = await import("../../vibe/routing-glue.js");
        const ai = await vs.hub.ai();
        testResults = await glue.testRouteTargets(vs.hub, ai.resolveRoute({ ...s, activeRoute: ROUTE_ID, routes: [{ ...route, id: ROUTE_ID }] }));
        showResults();
      } catch (e) {
        out.replaceChildren(h("li.bad", e.message));
      }
      test.disabled = false;
    });
    el.append(h("div.of-vrow", test), out);
    showResults();
  }

  paint();
  load();
  vs.hub?.on?.("route-stats", () => el.isConnected && stats && !el.contains(document.activeElement) && paint());
  return el;
}

/** Health row for one connection: dot, latency, model count, last error, Test button. */
export function createHealthRow(vs, rec, onChange) {
  const dot = h("span.of-vdot");
  const text = h("small");
  const btn = h("button.of-btn", { type: "button" }, t("Test"));
  const paint = (r) => {
    dot.className = `of-vdot ${r ? (r.ok ? "ok" : "bad") : ""}`;
    dot.title = r ? (r.ok ? t("Reachable") : t("Failed")) : t("Not tested");
    text.textContent = r ? (r.ok ? `${r.ms} ms · ${t("{n} models", { n: r.models })}` : r.error) : "";
    text.className = r && !r.ok ? "err" : "";
  };
  import("../../vibe/routing-glue.js").then(async (g) => paint((await g.routeRuntime(vs.hub)).results.get(rec.id)));
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    text.textContent = t("Testing…");
    const g = await import("../../vibe/routing-glue.js");
    paint(await g.checkProvider(vs.hub, rec.id));
    btn.disabled = false;
    onChange?.();
  });
  return h("div.of-vrow.of-vhealth", dot, text, btn);
}
