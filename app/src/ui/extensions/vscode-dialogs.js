// Dialogs of the VS Code extension support: the install consent (compatibility, contributions, activation events,
// optional network origins), `window.showXMessage` with buttons, and `window.showQuickPick`.
//
// Public API
//   vscodeConsent(info)                 -> Promise<{ ok: boolean, network: string[] }>  (info from VscodeHost.inspect + source)
//   messageDialog({title, text, detail, items, kind}) -> Promise<number|null> (index of the pressed item)
//   quickPick({title, items, many})      -> Promise<number|number[]|null>
//   compatBadge(compat)                  the colored compatibility badge element
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { openDialog } from "../dialogs.js";

const LEVEL = { full: "ok", partial: "warn", none: "bad" };

export function compatBadge(compat) {
  return h("span", { class: `of-ext-badge of-vsx-compat ${LEVEL[compat.level] || ""}`, title: compat.label }, compat.label);
}

/** Plain-language summary of what an extension adds (for the consent dialog and the details pane). */
export function contributionSummary(m) {
  const c = m.contributes;
  const out = [];
  const n = (count, one, many) => (count ? out.push(`${count} ${count === 1 ? t(one) : t(many)}`) : null);
  n(c.themes.length, "color theme", "color themes");
  n(c.snippets.length, "snippet file", "snippet files");
  n(c.languages.length, "language", "languages");
  n(c.commands.length, "command", "commands");
  n(c.keybindings.length, "key binding", "key bindings");
  n(Object.keys(c.configuration).length, "setting", "settings");
  n(c.grammars.length, "grammar (not used)", "grammars (not used)");
  return out;
}

/** The install consent. Resolves { ok, network } where network lists the origins the user allowed. */
export function vscodeConsent({ manifest, compat, source = {}, existing }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const src = source.type === "openvsx" ? t("Open VSX (open-vsx.org), {ns}.{name}", { ns: source.namespace || manifest.publisher, name: source.extName || manifest.name }) : t("Local file {name}", { name: source.name || ".vsix" });
    const adds = contributionSummary(manifest);
    const events = manifest.activationEvents.slice(0, 12);
    const canRun = compat.runsCode;
    const net = h("sl-textarea", { size: "small", rows: 2, label: t("Allow network access to (optional, one https origin per line)"), placeholder: "https://api.example.com", "help-text": t("Empty means no network access at all. Allow only origins the extension's documentation asks for.") });
    net.value = (existing?.rec.network || []).join("\n");
    net.addEventListener("keydown", (e) => e.stopPropagation());
    const body = h(
      "div.of-ext-consent.of-vsx-consent",
      h("div.of-ext-consent__head", h("h3", manifest.displayName), h("small", `${manifest.id} · ${t("version")} ${manifest.version} · ${t("publisher")} ${manifest.publisher}`)),
      manifest.description ? h("p", manifest.description) : null,
      h("p.of-ext-consent__src", t("Source: {src}", { src })),
      h("p", compatBadge(compat)),
      compat.reasons.length ? h("ul.of-vsx-reasons", compat.reasons.map((r) => h("li", r))) : null,
      adds.length ? h("p", h("strong", t("What it adds: ")), adds.join(", "), ".") : null,
      canRun
        ? h("div", h("p", h("strong", t("Its code may: ")), t("read and edit the file open in the Code studio (each change is one undo step), read the project's files, show messages and prompts, and keep its own settings and state. It runs in a sandbox without access to OpenFini, your keys or other extensions.")), events.length ? h("p.of-hint", t("Activation events: {list}", { list: events.join(", ") })) : null, net)
        : h("p", h("strong", t("No code runs: ")), manifest.main ? t("its code needs the Node.js extension host of VS Code, so OpenFini installs only its contributions.") : t("it only contributes data.")),
      h("p.of-ext-consent__warn", t("VS Code extensions were written for VS Code: OpenFini runs only the declarative parts and a subset of the web extension API. Install only extensions you trust.")),
    );
    openDialog({
      title: existing ? t("Update “{name}”?", { name: existing.manifest.displayName }) : t("Install VS Code extension?"),
      body,
      width: 600,
      cls: "of-ext-dialog",
      buttons: [
        { label: "Cancel", onClick: (close) => (finish({ ok: false }), close()) },
        {
          label: existing ? "Update" : "Install",
          variant: "primary",
          onClick: (close) => {
            const network = String(net.value || "")
              .split(/\s+/)
              .map((s) => s.trim().replace(/\/+$/, ""))
              .filter((s) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(s));
            finish({ ok: true, network });
            close();
          },
        },
      ],
      onClose: () => finish({ ok: false }),
    });
  });
}

/** A message with buttons (`showInformationMessage("…", "Yes", "No")`). */
export function messageDialog({ title, text, detail = "", items = [], kind = "info" }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const icon = kind === "error" ? "x-circle" : kind === "warning" ? "exclamation-triangle" : "info-circle";
    openDialog({
      title,
      body: h("div.of-vsx-message", h("sl-icon", { name: icon, "aria-hidden": "true" }), h("div", h("p.of-dialog__text", text), detail ? h("p.of-hint", detail) : null)),
      width: 460,
      buttons: [{ label: "Close", onClick: (close) => (finish(null), close()) }, ...items.map((label, i) => ({ label, variant: i === 0 ? "primary" : "default", onClick: (close) => (finish(i), close()) }))],
      onClose: () => finish(null),
    });
  });
}

/** A filterable list (`showQuickPick`). Keyboard: type to filter, arrows to move, Enter to choose. */
export function quickPick({ title, items, many = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const chosen = new Set(items.map((x, i) => (x.picked ? i : -1)).filter((i) => i >= 0));
    const input = h("sl-input", { size: "small", placeholder: t("Type to filter"), clearable: true, "aria-label": t("Filter") });
    const list = h("div.of-vsx-pick", { role: "listbox", "aria-multiselectable": String(many), tabindex: "-1" });
    let visible = [];
    let cursor = 0;
    let close = () => {};
    const draw = () => {
      const q = String(input.value || "").toLowerCase();
      visible = items.map((x, i) => [x, i]).filter(([x]) => !q || `${x.label} ${x.description} ${x.detail}`.toLowerCase().includes(q));
      cursor = Math.min(cursor, Math.max(0, visible.length - 1));
      list.replaceChildren(
        ...visible.map(([x, i], k) => {
          const row = h("button.of-vsx-pick__item", { type: "button", role: "option", "aria-selected": String(many ? chosen.has(i) : k === cursor), class: k === cursor ? "active" : "" }, many ? h("span.of-vsx-pick__check", chosen.has(i) ? "✓" : "") : null, h("strong", x.label), x.description ? h("small", x.description) : null, x.detail ? h("small.of-vsx-pick__detail", x.detail) : null);
          row.addEventListener("click", () => {
            if (many) {
              chosen.has(i) ? chosen.delete(i) : chosen.add(i);
              cursor = k;
              draw();
            } else {
              finish(i);
              close();
            }
          });
          return row;
        }),
      );
      if (!visible.length) list.append(h("div.of-empty", t("No matching items.")));
    };
    input.addEventListener("sl-input", () => ((cursor = 0), draw()));
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        cursor = Math.max(0, Math.min(visible.length - 1, cursor + (e.key === "ArrowDown" ? 1 : -1)));
        draw();
        list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && visible[cursor]) {
        e.preventDefault();
        if (many) {
          const i = visible[cursor][1];
          chosen.has(i) ? chosen.delete(i) : chosen.add(i);
          draw();
        } else {
          finish(visible[cursor][1]);
          close();
        }
      }
    });
    draw();
    const dlg = openDialog({
      title,
      body: h("div.of-vsx-pickwrap", input, list),
      width: 520,
      buttons: [{ label: "Cancel", onClick: (c) => (finish(null), c()) }, ...(many ? [{ label: "OK", variant: "primary", onClick: (c) => (finish([...chosen].sort((a, b) => a - b)), c()) }] : [])],
      onClose: () => finish(null),
    });
    close = dlg.close;
    dlg.dlg.addEventListener("sl-after-show", () => input.focus());
  });
}
