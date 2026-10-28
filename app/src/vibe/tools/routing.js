// Tools for the model fallback chain (ai/routing.js). get_model_route reads it; set_model_route changes it and always
// needs the user's approval because it decides which providers receive the user's prompts.
import { tool, S } from "./helpers.js";
import { vibeStore } from "../store.js";
import { resolveRoute } from "../../ai/routing.js";

export function routingTools(app) {
  const connections = () => vibeStore.providers.map((p) => ({ id: p.id, label: p.label, kind: p.kind }));
  const find = (v) => vibeStore.providers.find((p) => p.id === v || p.label.toLowerCase() === String(v).toLowerCase());
  const describe = () => {
    const s = vibeStore.settings;
    const r = s.routes.find((x) => x.id === s.activeRoute);
    const eff = resolveRoute(s);
    const name = (id) => (id ? vibeStore.provider(id)?.label || id : "Demo (offline)");
    return {
      fallbackChainEnabled: !!r,
      primary: { connection: name(s.activeProvider), model: s.model || "demo" },
      fallbacks: (r?.targets || []).map((t) => ({ connection: name(t.providerId), model: t.model, enabled: t.enabled !== false, timeoutSeconds: t.timeoutMs ? t.timeoutMs / 1000 : undefined })),
      policy: eff.policy,
      connections: connections(),
      note: "The primary model is chosen in the model menu. Fallbacks are tried in order when the primary fails with a rate limit, overload, timeout, network error or unavailable model. Authentication errors are not hidden by a fallback unless fallbackOnAuth is on.",
    };
  };
  return [
    tool("get_model_route", "Shows the model routing of this assistant: the primary model, the ordered fallback models, the retry/timeout policy and the available connections.", {}, [], () => describe(), { readOnly: true }),
    tool(
      "set_model_route",
      "Configures the fallback chain: which models take over, in order, when the primary model does not answer. Replaces the fallback list when `fallbacks` is given. Only use connections listed by get_model_route.",
      {
        enabled: S.bool("Turn the fallback chain on or off"),
        fallbacks: { type: "array", description: "Ordered fallback targets", items: { type: "object", properties: { connection: S.str("Connection id or name from get_model_route"), model: S.str("Model id"), enabled: S.bool("Default true"), timeoutSeconds: S.num("Seconds to wait for the first token", { minimum: 1, maximum: 600 }) }, required: ["connection", "model"] } },
        retries: S.num("Retries on the same model before switching (0-5)", { minimum: 0, maximum: 5 }),
        fallbackBackground: S.bool("Use the chain for sub-agents and background runs too"),
        fallbackOnAuth: S.bool("Also fall back on authentication errors"),
      },
      [],
      async (input) => {
        const s = vibeStore.settings;
        const cur = s.routes.find((r) => r.id === "default") || { id: "default", name: "Fallback chain", targets: [], policy: {} };
        let targets = cur.targets;
        if (input.fallbacks) {
          targets = input.fallbacks.map((f) => {
            const p = find(f.connection);
            if (!p) throw new Error(`Unknown connection “${f.connection}”. Available: ${vibeStore.providers.map((x) => x.label).join(", ") || "none"}.`);
            return { providerId: p.id, model: f.model, enabled: f.enabled !== false, ...(f.timeoutSeconds ? { timeoutMs: Math.round(f.timeoutSeconds * 1000) } : {}) };
          });
        }
        const policy = { ...cur.policy };
        if (input.retries != null) policy.retriesPerTarget = input.retries;
        if (input.fallbackBackground != null) policy.fallbackBackground = input.fallbackBackground;
        if (input.fallbackOnAuth != null) policy.fallbackOnAuth = input.fallbackOnAuth;
        const enabled = input.enabled ?? s.activeRoute === "default";
        await vibeStore.saveSettings({ routes: [...s.routes.filter((r) => r.id !== "default"), { ...cur, targets, policy }], activeRoute: enabled ? "default" : null });
        return describe();
      },
      { needsApproval: (input) => `Change the model fallback chain${input.fallbacks ? ` (${input.fallbacks.map((f) => f.model).join(" → ") || "empty"})` : ""}? Your prompts may then be sent to those providers.` },
    ),
  ];
}
