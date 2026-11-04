// "Send by email…" (Export dialog): mails the exported file(s) through the user's own mail server with the desktop
// app's built-in SMTP client (src-tauri/src/smtp.rs). The account (server, port, encryption, user, sender) is a
// preference; the password lives in this device's key store (ui/code/secrets.js), never in a document or a log.
// Browsers and the PWA cannot open mail connections: the dialog says so and offers to save the file instead.
import { h, formatBytes } from "../core/util.js";
import { t, N_ } from "../i18n/index.js";
import { openDialog } from "./dialogs.js";

const SECRET = "smtp:default";
const SECURITY = [
  ["starttls", N_("STARTTLS (port 587, recommended)")],
  ["tls", N_("TLS (port 465)")],
  ["none", N_("None (only for a server on this computer)")],
];

/** The account preference with defaults. */
export function smtpAccount(prefs = {}) {
  const a = prefs.smtpAccount || {};
  return { host: a.host || "", port: a.port || "", security: a.security || "starttls", user: a.user || "", from: a.from || "", pinnedCert: a.pinnedCert || "" };
}

/** Recipients from "a@x.org, b@y.org; c@z.org". */
export function parseRecipients(text) {
  return String(text || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** What the Rust side receives as the server (password added separately). */
export function smtpTarget(acc, password) {
  return { host: acc.host.trim(), port: Number(acc.port) || null, security: acc.security, user: acc.user.trim() || null, password: password || null, pinnedCert: acc.pinnedCert || null };
}

/**
 * Opens the dialog for `files` ([{ name, bytes, mime }]); `fallbackSave()` saves them instead (browser).
 * @returns {Promise<void>}
 */
export async function sendByEmailDialog(app, files, { fallbackSave } = {}) {
  const net = await import("../platform/native-net.js");
  const total = files.reduce((s, f) => s + f.bytes.length, 0);
  const list = h("ul.of-mail__files", ...files.map((f) => h("li", `${f.name} (${formatBytes(f.bytes.length)})`)));
  if (!net.nativeNetAvailable()) {
    const body = h("div.of-form", h("p", t("Sending email is built into the OpenFini desktop app. A browser or the installed web app cannot connect to a mail server.")), h("p.of-hint", t("Save the file and attach it in your mail program instead:")), list);
    openDialog({ title: N_("Send by email"), body, width: 460, buttons: [{ label: N_("Close"), onClick: (c) => c() }, ...(fallbackSave ? [{ label: N_("Save file…"), variant: "primary", onClick: (c) => (c(), fallbackSave()) }] : [])] });
    return;
  }
  const acc = smtpAccount(app.prefs);
  const { getSecret, setSecret } = await import("./code/secrets.js");
  const hasPassword = !!(await getSecret(SECRET).catch(() => ""));
  const input = (value, attrs = {}) => h("input.of-gitform__input", { value, autocomplete: "off", spellcheck: "false", ...attrs });
  const field = (label, ctl, help) => h("label.of-gitform__field", h("span", label), ctl, help ? h("small", help) : null);
  const to = input("", { type: "email", multiple: true, placeholder: "name@example.org" });
  const subject = input(app.doc?.name || files[0]?.name || "");
  const text = h("textarea.of-gitform__input", { rows: 4, "aria-label": t("Message") });
  const host = input(acc.host, { placeholder: "smtp.example.org" });
  const port = input(acc.port, { inputmode: "numeric", placeholder: "587" });
  const security = h("select.of-gitform__input", ...SECURITY.map(([v, l]) => h("option", { value: v, selected: acc.security === v }, t(l))));
  const user = input(acc.user);
  const from = input(acc.from, { type: "email", placeholder: "me@example.org" });
  const password = input("", { type: "password", placeholder: hasPassword ? t("Saved on this device — leave empty to keep") : t("Not saved yet") });
  const status = h("p.of-hint", { role: "status", "aria-live": "polite" });
  const current = () => ({ ...acc, host: host.value.trim(), port: port.value.trim(), security: security.value, user: user.value.trim(), from: from.value.trim() || user.value.trim() });
  const remember = async () => {
    const next = current();
    if (next.host !== acc.host) next.pinnedCert = ""; // a pinned certificate belongs to one server
    Object.assign(acc, next);
    app.setPref("smtpAccount", { ...acc });
    if (password.value) await setSecret(SECRET, password.value);
    password.value = "";
    return acc;
  };
  const run = async (fn) => {
    const a = await remember();
    if (!a.host) throw new Error(t("Enter your mail server (SMTP), for example smtp.example.org."));
    app.network?.assert?.("publish", `https://${a.host}`);
    const pw = await getSecret(SECRET).catch(() => "");
    const { confirmCertificate } = await import("./net-trust.js");
    return net.withTrust((pin) => fn(smtpTarget({ ...a, pinnedCert: pin }, pw)), {
      pin: a.pinnedCert,
      confirm: (c) => confirmCertificate({ host: a.host, ...c }),
      save: (fp) => {
        acc.pinnedCert = fp;
        app.setPref("smtpAccount", { ...acc });
      },
    });
  };
  const testBtn = h("sl-button", { size: "small" }, t("Test connection"));
  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    status.textContent = t("Connecting…");
    try {
      status.textContent = await run((target) => net.smtpTest(target));
    } catch (e) {
      status.textContent = e.message;
    } finally {
      testBtn.disabled = false;
    }
  });
  const account = h(
    "details.of-mail__account",
    { open: !acc.host || undefined },
    h("summary", t("Mail account (SMTP)")),
    field(t("Server"), host),
    h("div.of-pub__row", field(t("Encryption"), security), field(t("Port (optional)"), port)),
    field(t("User name"), user),
    field(t("Password"), password, t("Kept in this device's key store (sealed when the vault is on). Sent only to this server, only over an encrypted connection.")),
    field(t("Sender address"), from),
    h("div.of-pub__row", testBtn),
  );
  const body = h("div.of-gitform.of-mail", field(t("To"), to, t("Separate several addresses with commas.")), field(t("Subject"), subject), field(t("Message"), text), h("p.of-hint", t("Attached: {size}", { size: formatBytes(total) })), list, account, status);
  openDialog({
    title: N_("Send by email"),
    body,
    width: 520,
    buttons: [
      { label: N_("Cancel"), onClick: (c) => c() },
      {
        label: N_("Send"),
        variant: "primary",
        onClick: async (close, dlg) => {
          const recipients = parseRecipients(to.value);
          if (!recipients.length) return void (status.textContent = t("Add at least one recipient."));
          const btns = dlg.querySelectorAll('[slot="footer"] sl-button');
          btns.forEach((b) => (b.disabled = true));
          status.textContent = t("Sending…");
          try {
            const msg = await run((target) => net.smtpSend(target, { from: acc.from || acc.user, to: recipients, subject: subject.value, text: text.value, attachments: files }, { onProgress: (p) => (status.textContent = p.text) }));
            close();
            app.toast(msg || t("Sent."), "success", 3000);
          } catch (e) {
            status.textContent = e.message;
            if (/sender/i.test(e.message)) account.open = true;
          } finally {
            btns.forEach((b) => (b.disabled = false));
          }
        },
      },
    ],
  });
}
