// UI for the OAuth sign-ins in Settings > Artificial intelligence: the "OpenAI account" connection form and the per-server
// MCP "Sign in" controls. Logic is in vibe/account-auth.js (glue) and ai/openai-account.js, ai/mcp-oauth.js (pure).
// Public API: createAccountForm, createMcpSignInRow.
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { vibeStore } from "../../vibe/store.js";
import { platform } from "../../platform/index.js";
import { iconEl } from "../toolbox.js";
import { confirmDialog } from "../dialogs.js";

const field = (label, control) => h("label.of-vfield", h("span", label), control);

/**
 * The "OpenAI account" connection form.
 * @param {{app:any, session:any}} vs
 * @param {object|null} existing stored provider record
 * @param {()=>void} close re-renders the Models panel
 */
export function createAccountForm(vs, existing, close) {
  const { app, session } = vs;
  const status = h("div.of-vstatus", { role: "status" });
  const body = h("div");
  let rec = existing;
  const say = (ok, text) => {
    status.className = `of-vstatus ${ok ? "ok" : "bad"}`;
    status.replaceChildren(iconEl(ok ? "check-circle-fill" : "exclamation-triangle-fill"), ` ${text}`);
  };
  const run = (fn) => async () => {
    status.className = "of-vstatus";
    status.replaceChildren(h("sl-spinner"), ` ${t("Working…")}`);
    try {
      await fn();
    } catch (err) {
      say(false, err.message);
    }
  };
  const draw = async () => {
    const { accountInfo } = await import("../../vibe/account-auth.js");
    const info = rec ? accountInfo(rec.id) : { signedIn: false };
    const rows = [
      h("strong", t("OpenAI account (ChatGPT plan)")),
      h("p.of-hint", t("Use your ChatGPT plan's usage instead of an API key. OpenAI offers this as a preview for open-source apps: usage counts against your plan's limits, not your API balance, and it may change or end. Only models and features OpenAI allows for plan usage work (no images, embeddings or hosted tools).")),
    ];
    if (!platform.isDesktop) {
      rows.push(h("p.of-hint", t("OpenAI only allows this sign-in through a local callback (127.0.0.1), which a browser cannot receive. Use the desktop app, or connect with an API key in the OpenAI preset.")));
    } else if (info.signedIn) {
      rows.push(h("p", iconEl("person-check"), ` ${t("Signed in as {email}", { email: info.email || t("your OpenAI account") })}`));
      if (!info.planUsage) rows.push(h("p.of-vstatus.bad", t("Plan usage was not allowed during sign-in. Sign in again and allow it, or use an API key.")));
      rows.push(
        h("div.of-vrow",
          h("button.of-btn.of-btn--primary", { type: "button", onclick: run(async () => {
            const models = await (await session.providerFor(rec.id)).listModels();
            say(true, t("Connected: {n} models available to this account.", { n: models.length }));
            if (!vibeStore.settings.model || vibeStore.settings.activeProvider !== rec.id) await vibeStore.saveSettings({ activeProvider: rec.id, model: models[0]?.id || "" });
          }) }, t("Test connection")),
          h("button.of-btn", { type: "button", onclick: run(async () => {
            const { signInOpenAI } = await import("../../vibe/account-auth.js");
            rec = await signInOpenAI(app, rec.id);
            await draw();
            say(true, t("Signed in again."));
          }) }, t("Sign in again")),
          h("button.of-btn", { type: "button", onclick: run(async () => {
            if (!(await confirmDialog({ title: t("Sign out"), message: t("Revoke OpenFini's access to your OpenAI account and remove it from this device?"), ok: t("Sign out"), danger: true }))) return;
            const { signOutOpenAI } = await import("../../vibe/account-auth.js");
            const confirmed = await signOutOpenAI(rec.id);
            await vibeStore.removeProvider(rec.id);
            if (!confirmed) app.toast(t("Signed out here, but OpenAI did not confirm the revocation. Disconnect OpenFini in your ChatGPT settings."), "warning", 8000);
            close();
          }) }, t("Sign out")),
        ),
      );
    } else {
      rows.push(
        h("button.of-btn.of-btn--primary", { type: "button", onclick: run(async () => {
          const { signInOpenAI } = await import("../../vibe/account-auth.js");
          say(true, t("Finish the sign-in in your browser (this waits up to 2 minutes)."));
          rec = await signInOpenAI(app, rec?.id);
          await draw();
          say(true, t("Signed in. Use Test connection to list your models."));
        }) }, iconEl("box-arrow-in-right"), t("Sign in with OpenAI")),
      );
    }
    rows.push(status, h("div.of-vrow", h("button.of-btn", { type: "button", onclick: close }, t("Close")), h("a.of-vlink", { href: "#", onclick: (e) => { e.preventDefault(); import("../links.js").then((m) => m.openLink("https://developers.openai.com/siwc/token-sharing-open-source")); } }, t("About this preview"))));
    body.replaceChildren(...rows);
  };
  draw();
  return h("div.of-vform", body);
}

/**
 * Sign-in controls for one MCP server row: a "Sign in" button when the server asked for it (HTTP 401) or the user
 * wants OAuth, and "Sign out" when tokens are stored.
 * @param {{app:any}} vs @param {object} srv @param {HTMLElement} statusEl @param {()=>void} rerender
 */
export function createMcpSignInRow(vs, srv, statusEl, rerender) {
  const { app } = vs;
  const wrap = h("span");
  import("../../vibe/account-auth.js").then(({ mcpSignedIn, signInMcp, signOutMcp }) => {
    const signedIn = mcpSignedIn(srv);
    wrap.replaceChildren(
      signedIn
        ? h("button.of-btn", { type: "button", title: t("Revoke and remove the stored sign-in of this server"), onclick: async () => { await signOutMcp(srv); app.toast(t("Signed out of {name}.", { name: srv.name }), "success", 2400); rerender(); } }, t("Sign out"))
        : h("button.of-btn", { type: "button", title: t("Sign in to this server with OAuth (needs a server that supports it)"), onclick: async () => {
            statusEl.textContent = t("Opening sign-in…");
            try {
              const r = await signInMcp(app, srv);
              if (r.done) {
                app.toast(t("Signed in to {name}.", { name: srv.name }), "success", 3000);
                rerender();
              }
            } catch (e) {
              statusEl.textContent = e.message;
            }
          } }, t("Sign in")),
    );
  });
  return wrap;
}
