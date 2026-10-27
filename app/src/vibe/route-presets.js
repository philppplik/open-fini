// Fallback-chain presets (Settings ▸ Artificial intelligence ▸ Models ▸ Fallback chain). Pure: no DOM, no storage.
//   routePresets({ activeProvider, model }, providers) -> [{ id, label, hint, targets, reason? }]
// `providers` are stored connections { id, preset, label }. A preset whose prerequisites are missing has `targets: []`
// and a `reason` the UI shows instead of adding anything.

// A smaller / cheaper model per preset id (hints only; the user can edit every target afterwards).
export const SMALL_MODELS = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-5-mini",
  "google-gemini": "gemini-2.5-flash-lite",
  openrouter: "google/gemini-2.5-flash",
  deepseek: "deepseek-chat",
  xai: "grok-4-fast",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-medium-latest",
  together: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "opencode-zen": "gpt-5.4-nano",
};
const LOCAL = { ollama: "llama3.1", lmstudio: "" };

/** @returns {{id:string,label:string,hint:string,targets:{providerId:string,model:string}[],reason?:string}[]} */
export function routePresets(settings, providers) {
  const primary = (providers || []).find((p) => p.id === settings.activeProvider);
  const out = [];
  const small = primary && SMALL_MODELS[primary.preset];
  out.push({
    id: "same-smaller",
    label: "Same provider, smaller model",
    hint: "Keeps your key and data handling; a lighter model takes over when the main one is busy.",
    targets: small && small !== settings.model ? [{ providerId: primary.id, model: small }] : [],
    ...(!primary ? { reason: "Pick a model first." } : !small || small === settings.model ? { reason: "No smaller model is known for this provider. Add a target by hand." } : {}),
  });
  const other = (providers || []).find((p) => p.id !== settings.activeProvider && SMALL_MODELS[p.preset]);
  out.push({
    id: "fast-cheap",
    label: "Fast & cheap fallback",
    hint: "A different provider's inexpensive model, so a provider-wide outage does not stop you.",
    targets: other ? [{ providerId: other.id, model: SMALL_MODELS[other.preset] }] : [],
    ...(other ? {} : { reason: "Add a second connection (for example OpenRouter or Google Gemini) first." }),
  });
  const local = (providers || []).find((p) => p.preset in LOCAL);
  out.push({
    id: "local-last",
    label: "Local model as last resort (Ollama)",
    hint: "Runs on your machine, so it works offline and never hits a rate limit. Quality depends on the model.",
    targets: local ? [{ providerId: local.id, model: LOCAL[local.preset] || "llama3.1" }] : [],
    ...(local ? {} : { reason: "Add an Ollama or LM Studio connection first." }),
  });
  return out;
}

/** Appends targets, skipping duplicates. */
export function addTargets(route, targets) {
  const list = [...(route.targets || [])];
  for (const t of targets) if (!list.some((x) => x.providerId === t.providerId && x.model === t.model)) list.push({ ...t, enabled: true });
  return { ...route, targets: list };
}

/** Moves item `i` by `delta` (clamped). Returns a new array. */
export function moveTarget(list, i, delta) {
  const j = Math.max(0, Math.min(list.length - 1, i + delta));
  if (j === i) return list.slice();
  const out = list.slice();
  const [x] = out.splice(i, 1);
  out.splice(j, 0, x);
  return out;
}
