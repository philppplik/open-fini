// Publishing a website project: profiles (saved with the project, without secrets), the dry-run plan, pre-publish checks,
// the deploy itself and the deploy history. No DOM; used by the Publish tab and by the Vibe tools.
import { uid } from "../../core/util.js";
import { getSecret, setSecret } from "./secrets.js";

const MAX_HISTORY = 40;

export function publishServiceFor(app, web) {
  return (web._publish ||= new PublishService(app, web));
}

export class PublishService {
  constructor(app, web) {
    this.app = app;
    this.web = web;
  }
  get state() {
    return (this.web.settings.publish ||= { targets: [], history: [] });
  }
  profiles() {
    return this.state.targets;
  }
  profile(idOrLabel) {
    const t = this.state.targets;
    return t.find((p) => p.id === idOrLabel) || t.find((p) => p.label.toLowerCase() === String(idOrLabel || "").toLowerCase()) || null;
  }
  history() {
    return this.state.history;
  }
  save() {
    this.web._dirtySoon();
  }
  /** Creates or updates a profile (config holds no secrets). */
  upsert(p) {
    const list = this.state.targets;
    const rec = { id: p.id || uid("pub"), kind: p.kind, label: p.label || p.kind, config: { ...(p.config || {}) }, include: p.include || "", exclude: p.exclude || "", minify: p.minify !== false };
    const i = list.findIndex((x) => x.id === rec.id);
    if (i >= 0) list[i] = rec;
    else list.push(rec);
    this.save();
    return rec;
  }
  remove(id) {
    this.state.targets = this.state.targets.filter((p) => p.id !== id);
    this.save();
  }
  secretKey(p) {
    return `publish:${p.id}`;
  }
  async hasSecret(p) {
    return !!(await getSecret(this.secretKey(p)).catch(() => ""));
  }
  setSecret(p, v) {
    return setSecret(this.secretKey(p), v);
  }

  /**
   * What would be uploaded: the built site, filtered by the profile's include/exclude globs, plus the checks.
   * @returns {Promise<{ files: {path: string, bytes: Uint8Array}[], skipped: string[], summary: object, issues: object[], buildWarnings: string[] }>}
   */
  async plan(profile) {
    const [{ buildSite }, { selectFiles, summarize }, { preflight }] = await Promise.all([import("../../engine/web/index.js"), import("../../engine/publish/files.js"), import("../../engine/publish/preflight.js")]);
    const web = this.web;
    if (web.flush) web.flush();
    const site = buildSite(web.source, { minify: profile?.minify !== false, siteUrl: web.settings.siteUrl || undefined, entry: web.entry });
    const sel = selectFiles(site.files, { include: profile?.include, exclude: profile?.exclude });
    return { files: sel.files, skipped: sel.skipped, summary: summarize(sel.files), issues: preflight(web.source, { entry: web.entry }), buildWarnings: site.warnings };
  }

  /** Where the secret of this target is sent (shown in the confirmation). */
  destination(profile) {
    const c = profile.config || {};
    const host = (u) => {
      try {
        return new URL(u).host;
      } catch {
        return "";
      }
    };
    return { netlify: "api.netlify.com", vercel: "api.vercel.com", "github-pages": "api.github.com", webdav: host(c.url), ftp: c.host || "", helper: host(c.helperUrl || "http://127.0.0.1:4310") + (c.host ? ` → ${c.host}` : "") }[profile.kind] || profile.kind;
  }

  /**
   * The desktop app's FTP client with "trust this certificate?" prompts; the accepted fingerprint is kept in the
   * profile (`config.pinnedCert`, not secret). Null in browsers (the target then explains that it needs the desktop app).
   */
  async nativeClient(profile) {
    const net = await import("../../platform/native-net.js");
    if (!net.nativeNetAvailable()) return null;
    const trust = async (run) => {
      const { confirmCertificate } = await import("../net-trust.js");
      return net.withTrust(run, {
        pin: profile.config?.pinnedCert || "",
        confirm: (c) => confirmCertificate({ host: profile.config?.host || "", ...c }),
        save: (fp) => {
          profile.config.pinnedCert = fp;
          this.save();
        },
      });
    };
    return {
      ftpUpload: (target, files, opts) => trust((pin) => net.ftpUpload({ ...target, pinnedCert: pin || null }, files, opts)),
      ftpTest: (target) => trust((pin) => net.ftpTest({ ...target, pinnedCert: pin || null })),
    };
  }

  /** "Test connection" of a desktop-only target: connects and signs in, uploads nothing. */
  async test(profile, secret) {
    const { ftpTarget } = await import("../../engine/publish/targets.js");
    const native = await this.nativeClient(profile);
    if (!native) throw new Error("This needs the OpenFini desktop app: a browser cannot open FTP connections.");
    this.app.network?.assert?.("publish", `https://${profile.config?.host || ""}`);
    return native.ftpTest(ftpTarget(profile.config, secret || (await getSecret(this.secretKey(profile)))));
  }

  /**
   * Deploys. `secret` overrides the stored one (helper: a JSON string { token, password }).
   * @returns {Promise<{ url: string, message: string, files: number, bytes: number }>}
   */
  async run(profile, { secret, signal, onProgress, plan } = {}) {
    const { deploy, targetById } = await import("../../engine/publish/targets.js");
    const t = targetById(profile.kind);
    if (!t) throw new Error(`Unknown publish target “${profile.kind}”.`);
    if (t.unavailable) throw new Error(t.unavailable);
    const dest = this.destination(profile);
    this.app.network?.assert?.("publish", profile.kind === "helper" ? profile.config?.helperUrl || "http://127.0.0.1:4310" : `https://${dest}`);
    const native = t.desktopOnly ? await this.nativeClient(profile) : null;
    const p = plan || (await this.plan(profile));
    if (!p.files.length) throw new Error("There are no files to publish. Check the include and exclude patterns.");
    const sec = secret ?? (await getSecret(this.secretKey(profile)));
    const res = await deploy(profile.kind, { files: p.files, config: profile.config, secret: sec, fetch: (...a) => fetch(...a), native, signal, onProgress, site: { name: this.app.doc?.name || "site" } });
    if (res.config) Object.assign(profile.config, res.config);
    const rec = { time: Date.now(), profile: profile.label, kind: profile.kind, url: res.url || "", files: p.files.length, bytes: p.summary.bytes };
    this.state.history.unshift(rec);
    this.state.history.length = Math.min(this.state.history.length, MAX_HISTORY);
    this.save();
    return { ...res, files: rec.files, bytes: rec.bytes };
  }
}
