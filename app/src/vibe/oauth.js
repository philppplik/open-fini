// Finishes "Sign in with OpenRouter": the provider sends the browser back with ?vibe_oauth=openrouter&code=…;
// the code is traded (PKCE) for an API key that is stored on this device like any other key.
import { vibeStore } from "./store.js";

export function isOAuthReturn(params) {
  return params.get("vibe_oauth") === "openrouter" && params.has("code");
}

export async function finishOAuth(app, params) {
  const code = params.get("code");
  // remove the one-time code from the address bar right away
  history.replaceState(null, "", `${location.pathname}${params.get("studio") ? `?studio=${params.get("studio")}` : ""}`);
  let pk = null;
  try {
    pk = JSON.parse(sessionStorage.getItem("vibe.pkce") || "null");
    sessionStorage.removeItem("vibe.pkce");
  } catch {
    /* unavailable */
  }
  if (!pk?.verifier) return app.toast("The OpenRouter sign-in expired. Please try again.", "warning", 4000);
  try {
    app.network?.assert("oauth");
    const { exchangeOpenRouterCode, PROVIDER_PRESETS } = await import("../ai/index.js");
    await vibeStore.load();
    const { key } = await exchangeOpenRouterCode({ code, verifier: pk.verifier });
    const preset = PROVIDER_PRESETS.find((p) => p.id === "openrouter");
    const existing = vibeStore.providers.find((p) => p.preset === "openrouter");
    const rec = await vibeStore.saveProvider({ id: existing?.id, preset: "openrouter", label: preset?.label || "OpenRouter", kind: preset?.kind || "openai", baseUrl: preset?.baseUrl || "https://openrouter.ai/api/v1", apiKey: key });
    if (!vibeStore.settings.model) await vibeStore.saveSettings({ activeProvider: rec.id, model: (preset?.models || [])[0] || "" });
    app.setPref("aiEnabled", true);
    app.setStudio("vibe");
    app.toast("Signed in with OpenRouter. Your key is stored on this device.", "success", 4000);
  } catch (err) {
    app.toast(`OpenRouter sign-in failed: ${err.message}`, "danger", 6000);
  }
}
