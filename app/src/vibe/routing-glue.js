// Glue between the pure router (ai/routing.js) and the Vibe hub: builds routed providers from stored settings,
// owns the shared circuit-breaker state and the counts-only success statistics (kv "vibe.routeStats"), and runs
// connection health checks. No DOM.
//
//   const rt = await routeRuntime(hub)                      // { health, stats, results }
//   const provider = await buildRoutedProvider(hub, route)  // route from resolveRoute(); first target = primary
//   const r = await checkProvider(hub, providerId)          // { ok, ms, models, error?, at }
//
// Invariants: statistics never contain prompts or answers (counts, timestamps and error categories only).
import { kvGet, kvSet } from "../core/storage.js";
import { vibeStore } from "./store.js";

const KEY = "vibe.routeStats";

export async function routeRuntime(hub) {
  if (hub._routeRt) return hub._routeRt;
  const ai = await hub.ai();
  const saved = await kvGet(KEY).catch(() => null);
  const stats = new ai.RouteStats(saved || {});
  const record = stats.record.bind(stats);
  let timer = null;
  stats.record = (...a) => {
    record(...a);
    clearTimeout(timer);
    timer = setTimeout(() => kvSet(KEY, stats.toJSON()).catch(() => {}), 1500);
    hub.emit?.("route-stats", {});
  };
  hub._routeRt = { health: new ai.RouteHealth(), stats, results: new Map() };
  return hub._routeRt;
}

/** Capabilities of a stored connection, from its preset. */
function capsOf(ai, rec) {
  const preset = ai.PROVIDER_PRESETS.find((p) => p.id === rec?.preset);
  return preset ? { tools: preset.capabilities.tools, vision: preset.capabilities.vision } : {};
}

/**
 * @param {import("./hub.js").VibeHub} hub
 * @param {{targets:{providerId:string|null, model:string, label?:string, timeoutMs?:number}[], policy:object}} route
 * @param {{primaryModel?:string}} [o] replaces the model of the FIRST target (sub-agent model)
 */
export async function buildRoutedProvider(hub, route, { primaryModel } = {}) {
  const ai = await hub.ai();
  const rt = await routeRuntime(hub);
  const targets = [];
  const problems = [];
  for (let i = 0; i < route.targets.length; i++) {
    const t = route.targets[i];
    const id = t.providerId || "demo";
    try {
      const provider = await hub.providerFor(id === "demo" ? null : id);
      const rec = id === "demo" ? null : vibeStore.provider(id);
      const model = i === 0 && primaryModel ? primaryModel : id === "demo" ? "demo" : t.model;
      targets.push({ providerId: id, model, label: t.label || (rec ? `${rec.label} · ${String(model).split("/").pop()}` : "Demo"), timeoutMs: t.timeoutMs, provider, capabilities: capsOf(ai, rec) });
    } catch (e) {
      if (i === 0) throw e; // the primary must work; broken fallbacks are skipped (and reported)
      problems.push(`${t.label || t.model}: ${e.message}`);
    }
  }
  const p = ai.createRoutedProvider({ targets, policy: route.policy, health: rt.health, stats: rt.stats });
  p.problems = problems;
  return p;
}

/** Tests every target of a route separately (Settings ▸ Models ▸ Test route). */
export async function testRouteTargets(hub, route, { signal } = {}) {
  const ai = await hub.ai();
  const built = [];
  const out = [];
  for (const t of route.targets) {
    try {
      const id = t.providerId || "demo";
      const provider = await hub.providerFor(id === "demo" ? null : id);
      const rec = id === "demo" ? null : vibeStore.provider(id);
      built.push({ providerId: id, model: id === "demo" ? "demo" : t.model, label: t.label || (rec ? `${rec.label} · ${String(t.model).split("/").pop()}` : "Demo"), provider });
    } catch (e) {
      out.push({ target: t.label || t.model, key: `${t.providerId}/${t.model}`, ok: false, ms: 0, category: "auth", message: e.message });
    }
  }
  return [...out, ...(await ai.testRoute(built, { signal }))];
}

/** Health check of one connection: model list request with timing. Stores the result in the runtime for the UI. */
export async function checkProvider(hub, id, { signal } = {}) {
  const rt = await routeRuntime(hub);
  const t0 = Date.now();
  let res;
  try {
    const prov = await hub.providerFor(id);
    const models = prov.health ? (await prov.health({ signal }), await prov.listModels({ signal }).catch(() => [])) : await prov.listModels({ signal });
    res = { ok: true, ms: Date.now() - t0, models: models.length, at: Date.now() };
  } catch (e) {
    res = { ok: false, ms: Date.now() - t0, models: 0, error: String(e.message || e).slice(0, 300), category: e.category || "unknown", at: Date.now() };
  }
  rt.results.set(id, res);
  hub.emit?.("route-stats", {});
  return res;
}
