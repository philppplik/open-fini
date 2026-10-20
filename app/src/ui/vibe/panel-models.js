// Vibe Studio ▸ Models: connections to AI providers (OpenRouter, OpenAI, Anthropic, DeepSeek, xAI, Gemini, Groq,
// Ollama and any OpenAI-compatible endpoint), keys, default models and the key vault.
import { h, empty } from "../../core/util.js";
import { vibeStore } from "../../vibe/store.js";
import { PROVIDER_PRESETS, createPkce, openRouterAuthUrl } from "../../ai/index.js";
import { promptDialog, confirmDialog } from "../dialogs.js";
import { platform } from "../../platform/index.js";
import { iconEl } from "../toolbox.js";

const mask = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-3)}` : "no key");

export function createModelsPanel(vs) {
  const { app, session } = vs;
  const el = h("div.of-vmodels");

  function field(label, control, hint) {
    return h("label.of-vfield", h("span", label), control, hint ? h("small", hint) : null);
  }

  function form(existing) {
    const preset0 = PROVIDER_PRESETS.find((p) => p.id === (existing?.preset || "openrouter"));
    const presetSel = h("select.of-vfield__in", PROVIDER_PRESETS.map((p) => h("option", { value: p.id, selected: p.id === preset0.id }, p.label)));
    const label = h("input.of-vfield__in", { value: existing?.label || preset0.label, spellcheck: false });
    const url = h("input.of-vfield__in", { value: existing?.baseUrl || preset0.baseUrl, spellcheck: false, placeholder: "https://…/v1" });
    const key = h("input.of-vfield__in", { type: "password", value: existing ? vibeStore.getKey(existing.id) : "", placeholder: preset0.needsKey === false ? "Not needed" : "Paste your API key", autocomplete: "off", spellcheck: false });
    const keyLink = h("a.of-vlink", { href: "#" }, "Get a key");
    const status = h("div.of-vstatus");
    const onPreset = () => {
      const p = PROVIDER_PRESETS.find((x) => x.id === presetSel.value);
      if (!existing) {
        label.value = p.label;
        url.value = p.baseUrl;
      }
      key.placeholder = p.needsKey === false ? "Not needed" : "Paste your API key";
      keyLink.style.display = p.keyUrl ? "" : "none";
      keyLink.onclick = (e) => {
        e.preventDefault();
        import("../links.js").then((m) => m.openLink(p.keyUrl));
      };
      note.textContent = p.note || "";
    };
    const note = h("p.of-hint", preset0.note || "");
    presetSel.addEventListener("change", onPreset);
    const save = async () => {
      const p = PROVIDER_PRESETS.find((x) => x.id === presetSel.value);
      const rec = await vibeStore.saveProvider({ id: existing?.id, preset: p.id, label: label.value.trim() || p.label, kind: p.kind, baseUrl: url.value.trim().replace(/\/+$/, ""), apiKey: key.value.trim() });
      return rec;
    };
    const test = h("button.of-btn", { type: "button" }, "Save and test");
    test.addEventListener("click", async () => {
      status.replaceChildren(h("sl-spinner"), " Connecting…");
      try {
        const rec = await save();
        const prov = await session.providerFor(rec.id);
        const models = await prov.listModels();
        status.replaceChildren(iconEl("check-circle-fill"), ` Connected — ${models.length} model${models.length === 1 ? "" : "s"} available.`);
        status.className = "of-vstatus ok";
        if (!vibeStore.settings.model || !vibeStore.settings.activeProvider) {
          const pick = (PROVIDER_PRESETS.find((x) => x.id === rec.preset)?.models || [])[0] || models[0]?.id || "";
          await vibeStore.saveSettings({ activeProvider: rec.id, model: pick });
        }
      } catch (err) {
        status.replaceChildren(iconEl("exclamation-triangle-fill"), ` ${err.message}`);
        status.className = "of-vstatus bad";
      }
    });
    const rows = [field("Provider", presetSel), field("Name", label), field("Base URL", url, "OpenAI-compatible servers: the URL that ends in /v1."), field("API key", key, "Stored on this device only. Sent only to the base URL above."), h("div.of-vrow", keyLink), note];
    if (preset0.id === "openrouter" || !existing) {
      if (!platform.isDesktop) {
        rows.push(h("button.of-btn", { type: "button", onclick: async () => {
          if (!app.network.allowed("oauth")) return app.toast(app.network.message("oauth"), "warning", 5000);
          const pk = await createPkce();
          sessionStorage.setItem("vibe.pkce", JSON.stringify(pk));
          location.href = openRouterAuthUrl({ callbackUrl: `${location.origin}${location.pathname}?vibe_oauth=openrouter`, challenge: pk.challenge });
        } }, iconEl("box-arrow-in-right"), "Sign in with OpenRouter"));
      }
    }
    rows.push(h("div.of-vrow", test, h("button.of-btn", { type: "button", onclick: render }, "Close")), status);
    onPreset();
    return h("div.of-vform", ...rows);
  }

  async function render() {
    empty(el);
    const s = vibeStore.settings;
    el.append(h("p.of-vlead", "Use your own accounts: nothing is routed through OpenFini servers (there are none). Pick any provider — you are never locked in."));
    if (vibeStore.locked) {
      el.append(h("div.of-vcard", h("strong", "API keys are locked"), h("p.of-hint", "You protected your keys with a passphrase."), h("button.of-btn.of-btn--primary", { type: "button", onclick: async () => {
        const p = await promptDialog({ title: "Unlock API keys", label: "Passphrase", type: "password", ok: "Unlock" });
        if (!p) return;
        try {
          await vibeStore.unlock(p);
          render();
        } catch {
          app.toast("That passphrase did not unlock the keys.", "danger", 2400);
        }
      } }, "Unlock")));
    }
    const list = h("div.of-vcard");
    list.append(h("div.of-vcard__head", h("strong", "Connections"), h("button.of-btn", { type: "button", onclick: () => el.replaceChildren(form(null)) }, iconEl("plus-lg"), "Add")));
    list.append(h("div.of-vconn", h("div", h("strong", "Demo (offline)"), h("small", "Built-in scripted assistant — no key, no network")), h("button.of-btn", { type: "button", onclick: () => vibeStore.saveSettings({ activeProvider: null, model: "demo" }) }, s.activeProvider ? "Use" : "Active")));
    for (const p of vibeStore.providers) {
      list.append(h("div.of-vconn", h("div", h("strong", p.label), h("small", `${p.baseUrl} · ${mask(vibeStore.getKey(p.id))}`)), h("div.of-vrow", h("button.of-btn", { type: "button", onclick: () => el.replaceChildren(form(p)) }, "Edit"), h("button.of-btn", { type: "button", onclick: async () => { if (await confirmDialog({ title: "Remove connection", message: `Remove “${p.label}” and its key from this device?`, ok: "Remove", danger: true })) { await vibeStore.removeProvider(p.id); render(); } } }, "Remove"))));
    }
    el.append(list);

    // default models
    const provSel = (value, onChange, none) => {
      const sel = h("select.of-vfield__in", h("option", { value: "" }, none), vibeStore.providers.map((p) => h("option", { value: p.id, selected: p.id === value }, p.label)));
      sel.addEventListener("change", () => onChange(sel.value || null));
      return sel;
    };
    const text = (value, onChange, ph) => {
      const i = h("input.of-vfield__in", { value: value || "", placeholder: ph, spellcheck: false });
      i.addEventListener("change", () => onChange(i.value.trim()));
      i.addEventListener("keydown", (e) => e.stopPropagation());
      return i;
    };
    el.append(h("div.of-vcard", h("strong", "Image generation"), h("p.of-hint", "Used by the generate_image and edit_image tools (OpenAI image models, OpenRouter image models, …)."), field("Provider", provSel(s.imageProvider, (v) => vibeStore.saveSettings({ imageProvider: v }), "Off")), field("Model", text(s.imageModel, (v) => vibeStore.saveSettings({ imageModel: v }), "e.g. gpt-image-1"))));
    el.append(h("div.of-vcard", h("strong", "Knowledge search (optional)"), h("p.of-hint", "Without an embedding model, knowledge search uses keyword ranking on your device. With one, it also uses semantic search."), field("Provider", provSel(s.embedProvider, (v) => vibeStore.saveSettings({ embedProvider: v }), "Keywords only")), field("Model", text(s.embedModel, (v) => vibeStore.saveSettings({ embedModel: v }), "e.g. text-embedding-3-small"))));

    const instr = h("textarea.of-vfield__in", { rows: 3, placeholder: "e.g. Always use our brand colors. Answer in German.", spellcheck: true });
    instr.value = s.extraInstructions || "";
    instr.addEventListener("change", () => vibeStore.saveSettings({ extraInstructions: instr.value.trim() }));
    instr.addEventListener("keydown", (e) => e.stopPropagation());
    const steps = h("input.of-vfield__in", { type: "number", min: 1, max: 100, value: String(s.maxSteps || 24) });
    steps.addEventListener("change", () => vibeStore.saveSettings({ maxSteps: Math.max(1, Math.min(100, Number(steps.value) || 24)) }));
    steps.addEventListener("keydown", (e) => e.stopPropagation());
    const shots = h("input", { type: "checkbox", checked: s.sendScreenshots !== false });
    shots.addEventListener("change", () => vibeStore.saveSettings({ sendScreenshots: shots.checked }));
    el.append(h("div.of-vcard", h("strong", "Assistant behavior"), h("p.of-hint", "Applies to every chat and to right-click AI actions."), field("Standing instructions", instr, "Added to every request."), field("Maximum steps per request", steps, "Stops runaway loops."), h("label.of-vrow", shots, h("span", "Let the assistant look at screenshots of my pages (sent to the provider)"))));

    const vault = h("div.of-vcard", h("strong", "Key protection"), h("p.of-hint", vibeStore.settings.vault ? "Your keys are encrypted with your passphrase (AES-GCM). You unlock them once per session." : "Keys are stored unencrypted in this browser's or app's private storage. Add a passphrase to encrypt them."), h("button.of-btn", { type: "button", onclick: async () => {
      if (vibeStore.settings.vault) {
        if (await confirmDialog({ title: "Remove passphrase", message: "Store the keys without a passphrase again?", ok: "Remove" })) await vibeStore.setVault("");
      } else {
        const p = await promptDialog({ title: "Protect keys", label: "New passphrase (you cannot recover it)", type: "password", ok: "Protect" });
        if (p) await vibeStore.setVault(p);
      }
      render();
    } }, vibeStore.settings.vault ? "Remove passphrase" : "Set a passphrase…"));
    el.append(vault);
  }

  vibeStore.on("change", (g) => (g === "providers" || g === "settings") && el.isConnected && !el.querySelector(".of-vform") && render());
  render();
  return { el, show: render };
}
