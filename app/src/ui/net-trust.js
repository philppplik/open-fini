// "Trust this certificate?" for the built-in FTP/FTPS and SMTP clients (trust on first use). Lazy.
import { confirmDialog } from "./dialogs.js";
import { t, N_ } from "../i18n/index.js";

/** Asks whether to trust a server certificate the system does not know (or that changed). Resolves true/false. */
export function confirmCertificate({ host, fingerprint, changed }) {
  const message = changed
    ? t("The certificate of {host} is different from the one you trusted before. This happens when the server got a new certificate, but it can also mean someone is intercepting the connection. Only continue if the server's administrator confirms this fingerprint (SHA-256):\n\n{fingerprint}", { host, fingerprint })
    : t("{host} uses a certificate this computer does not trust (often a self-signed one on your own server). Compare this fingerprint (SHA-256) with the one your hosting provider or administrator shows, then trust it for this server:\n\n{fingerprint}", { host, fingerprint });
  return confirmDialog({ title: changed ? N_("Certificate changed") : N_("Trust this certificate?"), message, ok: changed ? N_("Trust the new certificate") : N_("Trust"), danger: changed });
}
