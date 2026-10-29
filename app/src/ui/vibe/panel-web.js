// Settings ▸ Artificial intelligence ▸ Web access: master switch (off by default), search backend, domain lists, limits.
import { h, empty } from "../../core/util.js";
import { t, N_ } from "../../i18n/index.js";
import { vibeStore } from "../../vibe/store.js";
import { DEFAULT_WEB, normalizeWeb } from "../../vibe/web-access.js";
import { parseDomainList } from "../../vibe/web-hosts.js";

const BACKENDS = [
  ["wikipedia", N_("Wikipedia (no key, articles only)")],
  ["searxng", N_("SearXNG (your own instance, no key)")],
  ["brave", N_("Brave Search (API key)")],
  ["tavily", N_("Tavily (API key)")],
];

export function createWebPanel() {
  const el = h("div.of-vweb");
  const get = () => normalizeWeb(vibeStore.settings.webAccess);
  const save = (patch) => vibeStore.saveSettings({ webAccess: { ...get(), ...patch } });
  const field = (label, control, hint) => h("label.of-vfield", h("span", label), control, hint ? h("small", hint) : null);
  const text = (value, onChange, extra = {}) => {
    const i = h("input.of-vfield__in", { value: value || "", spellcheck: false, ...extra });
    i.addEventListener("change", () => onChange(i.value.trim()));
    i.addEventListener("keydown", (e) => e.stopPropagation());
    return i;
  };
  const list = (value, onChange) => {
    const a = h("textarea.of-vfield__in", { rows: 3, spellcheck: false, placeholder: "example.com\n*.example.org" });
    a.value = (value || []).join("\n");
    a.addEventListener("change", () => onChange(parseDomainList(a.value)));
    a.addEventListener("keydown", (e) => e.stopPropagation());
    return a;
  };
  const num = (value, unit, onChange, min) => text(String(Math.round(value / unit)), (v) => Number(v) >= min && onChange(Number(v) * unit), { inputmode: "numeric" });

  function render() {
    empty(el);
    const w = get();
    const on = h("sl-switch", { size: "small" }, t("Allow the assistant to use the web"));
    on.checked = !!w.enabled;
    on.addEventListener("sl-change", () => {
      save({ enabled: on.checked });
      render();
    });
    el.append(h("div.of-vcard", h("strong", t("Web access")), h("p.of-hint", t("Lets the assistant search the web, read pages and download images (tools web_search, fetch_page, download_image). Off by default. Every request asks for your approval per domain; local and private addresses are always blocked; no cookies or credentials are sent; fetched text is treated as untrusted data.")), on));
    if (!w.enabled) return;
    const backend = h("select.of-vfield__in", BACKENDS.map(([v, l]) => h("option", { value: v, selected: v === w.searchBackend }, t(l))));
    backend.addEventListener("change", () => {
      save({ searchBackend: backend.value });
      render();
    });
    const search = h("div.of-vcard", h("strong", t("Search")), field(t("Web search backend"), backend, t("Image search always uses Openverse and Wikimedia Commons (openly licensed, no key).")));
    if (w.searchBackend === "searxng") search.append(field(t("SearXNG address"), text(w.searxngUrl, (v) => save({ searxngUrl: v }), { placeholder: "https://searx.example.org" }), t("The instance must allow the json format and, in a browser, cross-origin requests.")));
    if (w.searchBackend === "brave" || w.searchBackend === "tavily") search.append(field(t("API key"), text(w.apiKey, (v) => save({ apiKey: v }), { type: "password", autocomplete: "off" }), t("Stored on this device and sent only to the search service.")));
    el.append(search);
    el.append(h("div.of-vcard", h("strong", t("Domains")),
      field(t("Always allowed"), list(w.allowDomains, (v) => save({ allowDomains: v })), t("No approval is asked for these (subdomains match too). Added when you choose “Always allow this domain”.")),
      field(t("Blocked"), list(w.blockDomains, (v) => save({ blockDomains: v })), t("Always refused, even when approved."))));
    el.append(h("div.of-vcard", h("strong", t("Limits")),
      field(t("Largest page (KiB)"), num(w.maxPageBytes, 1024, (v) => save({ maxPageBytes: v }), 16)),
      field(t("Largest image (MiB)"), num(w.maxImageBytes, 1048576, (v) => save({ maxImageBytes: v }), 1)),
      field(t("Largest image (megapixels)"), num(w.maxPixels, 1e6, (v) => save({ maxPixels: v }), 1)),
      field(t("Timeout (seconds)"), num(w.timeoutMs, 1000, (v) => save({ timeoutMs: v }), 3)),
      h("button.of-btn", { type: "button", onclick: () => { save({ ...DEFAULT_WEB(), enabled: true }); render(); } }, t("Reset to defaults"))));
  }
  render();
  return { el, show: render };
}
