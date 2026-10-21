// Library manager of the Code studio (no UI): finds, adds, updates, removes and "vendors" libraries of a website
// project. The panel (libraries-ui.js) and the Vibe tools (vibe/tools/frameworks.js) both use it, so the rules are the
// same everywhere: libraries come from CDNs the desktop CSP allows, every network access goes through
// `app.network.assert("cdn")` (offline mode), and nothing changes on the page without an editor edit that can be undone.
import {
  listPageLibraries, listCodeImports, addLibraryToPage, removeLibraryFromPage, retargetLibrary, catalogUrl, CATALOG, cdnUrl, parseCdnUrl,
  isAllowedCdnUrl, compareVersions, isPrerelease, npmSearchUrl, parseNpmSearch, jsdelivrPackageUrl, parseJsdelivrPackage, jsdelivrFilesUrl,
  parseJsdelivrFiles, cdnjsSearchUrl, parseCdnjsSearch, cdnjsLibraryUrl, parseCdnjsLibrary, vendorFromUrl, vendoredRef, setImportMapEntry, languageOf,
} from "../../engine/web/index.js";

const TIMEOUT_MS = 20000;

export function createLibraryManager(ws) {
  const app = ws.app;
  const web = ws.web;

  function assertNetwork(url) {
    if (app.network?.assert) app.network.assert("cdn", url);
  }

  async function request(url, kind) {
    assertNetwork(url);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctl.signal, referrerPolicy: "no-referrer", credentials: "omit" });
      if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}${res.status === 404 ? " (not found)" : ""}.`);
      return kind === "json" ? await res.json() : new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      if (err?.name === "NetworkBlockedError" || err?.code === "offline_mode") throw err;
      if (err?.name === "AbortError") throw new Error(`${new URL(url).hostname} did not answer within ${TIMEOUT_MS / 1000} seconds.`);
      if (err instanceof TypeError) throw new Error(`Could not reach ${new URL(url).hostname}. Check your connection; libraries that are already in the project keep working.`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  const pagePath = (page) => {
    const p = page || ws.page || web.pages()[0];
    if (!p || !web.has(p)) throw new Error("This project has no HTML page to add libraries to. Create one first.");
    return p;
  };

  const manager = {
    catalog: CATALOG,

    /** Libraries used by the project: every page's tags and import map entries plus CDN imports in JavaScript files. */
    list() {
      const out = [];
      for (const page of web.pages()) out.push(...listPageLibraries(ws.model.html(page), page));
      for (const p of web.paths) {
        if (languageOf(p) !== "javascript" || !web.isText(p) || /(^|\/)vendor\//.test(p)) continue;
        out.push(...listCodeImports(web.text(p), p));
      }
      return out;
    },

    /** Searches npm (registry) or cdnjs. Resolves to [{ name, version, description, source }]. */
    async search(query, source = "npm") {
      const q = String(query || "").trim();
      if (!q) return [];
      if (source === "cdnjs") return parseCdnjsSearch(await request(cdnjsSearchUrl(q), "json")).map((r) => ({ ...r, source: "cdnjs" }));
      return parseNpmSearch(await request(npmSearchUrl(q), "json")).map((r) => ({ ...r, source: "npm" }));
    },

    /** Versions of a package (jsDelivr data API; cdnjs for cdnjs libraries). */
    async versions(name, source = "npm") {
      if (source === "cdnjs") {
        const lib = parseCdnjsLibrary(await request(cdnjsLibraryUrl(name), "json"));
        if (!lib) throw new Error(`cdnjs has no library “${name}”.`);
        return { name, latest: lib.latest, versions: lib.versions, filename: lib.filename };
      }
      const info = parseJsdelivrPackage(await request(jsdelivrPackageUrl(name), "json"));
      if (!info) throw new Error(`jsDelivr has no npm package “${name}”.`);
      return { name, latest: info.latest, versions: info.versions };
    },

    /** Files of a package version with suggestions (scripts, modules, styles). */
    async files(name, version) {
      return parseJsdelivrFiles(await request(jsdelivrFilesUrl(name, version), "json"));
    },

    /** Latest published versions for the CDN libraries in `libs`: { [id]: latest }. Failures are skipped. */
    async checkUpdates(libs) {
      const out = {};
      const seen = new Map();
      for (const lib of libs) {
        const c = parseCdnUrl(lib.url);
        if (!c || !c.version || c.cdn === "esm.sh") continue;
        const key = `${c.cdn}:${c.pkg}`;
        if (!seen.has(key)) {
          seen.set(key, manager.versions(c.pkg, c.cdn === "cdnjs" ? "cdnjs" : "npm").then((v) => v.latest).catch((err) => {
            if (err?.code === "offline_mode") throw err;
            return null;
          }));
        }
        const latest = await seen.get(key);
        if (latest && compareVersions(latest, c.version) > 0 && !isPrerelease(latest)) out[lib.id] = latest;
      }
      return out;
    },

    /** Adds a library to a page. spec: { kind, url, specifier?, defer?, position?, page? } Returns the page it went to. */
    add(spec) {
      const page = pagePath(spec.page);
      if (!/^https?:\/\//i.test(spec.url) && !spec.url.startsWith("./") && !spec.url.startsWith("../")) throw new Error("A library URL must start with https://.");
      if (/^https?:/i.test(spec.url) && !isAllowedCdnUrl(spec.url)) {
        app.toast?.("This host is not allowed by the desktop app's security policy (jsDelivr, cdnjs and unpkg are). It may still work in the web version.", "warning", 5000);
      }
      const changes = addLibraryToPage(ws.model.html(page), spec);
      if (!changes.length) return { page, added: false };
      ws.editors.applyChanges(page, changes);
      return { page, added: true };
    },

    addCatalog(id, opts = {}) {
      const entry = CATALOG.find((c) => c.id === id);
      if (!entry) throw new Error(`Unknown library “${id}”. Use list_libraries or the Popular tab.`);
      return manager.add({ kind: entry.kind, url: catalogUrl(entry, opts.cdn), specifier: entry.specifier, defer: entry.defer, page: opts.page });
    },

    remove(lib) {
      const parsed = ws.model.html(lib.file);
      if (lib.kind === "import") throw new Error("This library is imported from JavaScript. Remove the import in the code.");
      const changes = removeLibraryFromPage(parsed, lib);
      if (!changes.length) return false;
      ws.editors.applyChanges(lib.file, changes);
      return true;
    },

    /** New URL for a library at another version (same file, same CDN). */
    urlForVersion(lib, version) {
      const c = parseCdnUrl(lib.url);
      if (!c) throw new Error("Only CDN libraries can change version.");
      return cdnUrl({ cdn: c.cdn === "esm.sh" ? "jsdelivr" : c.cdn, pkg: c.pkg, version, file: c.file });
    },

    update(lib, version) {
      const url = manager.urlForVersion(lib, version);
      if (lib.kind === "import") {
        const text = web.text(lib.file);
        const changes = [{ from: lib.start, to: lib.end, insert: url }];
        if (text.slice(lib.start, lib.end) !== lib.url) throw new Error("The file changed; reload the list and try again.");
        ws.editors.applyChanges(lib.file, changes);
        return url;
      }
      const changes = retargetLibrary(ws.model.html(lib.file), lib, url);
      if (changes.length) ws.editors.applyChanges(lib.file, changes);
      return url;
    },

    /**
     * Downloads a CDN library (and what it needs) into vendor/ and points the page at the copy, so the exported site works
     * offline. Resolves to { entry, files: [paths], warnings }.
     */
    async vendor(lib) {
      if (lib.vendored || !/^https?:\/\//i.test(lib.url)) throw new Error("This library is already part of the project.");
      const res = await vendorFromUrl(lib.url, (u) => request(u, "bytes"), { allowHost: (u) => /^https:\/\//i.test(u) && isAllowedCdnUrl(u) });
      for (const [path, bytes] of Object.entries(res.files)) web.put(path, bytes);
      if (lib.kind === "import") {
        const ref = vendoredRef(lib.file, res.entry);
        ws.editors.applyChanges(lib.file, [{ from: lib.start, to: lib.end, insert: ref }]);
      } else {
        const ref = vendoredRef(lib.file, res.entry);
        const changes = retargetLibrary(ws.model.html(lib.file), lib, ref);
        if (changes.length) ws.editors.applyChanges(lib.file, changes);
      }
      return { entry: res.entry, files: Object.keys(res.files), warnings: res.warnings };
    },

    /** Convenience for tools: add a catalog or custom library, optionally vendored. */
    async install(spec, { vendor = false } = {}) {
      const r = spec.id ? manager.addCatalog(spec.id, spec) : manager.add(spec);
      if (!vendor) return { ...r, vendored: null };
      const page = r.page;
      const url = spec.id ? catalogUrl(CATALOG.find((c) => c.id === spec.id)) : spec.url;
      const lib = manager.list().find((l) => l.file === page && l.url === url);
      if (!lib) return { ...r, vendored: null };
      return { ...r, vendored: await manager.vendor(lib) };
    },

    /** Google Fonts helper: preconnect + stylesheet link in the page head. */
    addGoogleFont(family, weights = "400;700", page) {
      const name = String(family || "").trim();
      if (!/^[A-Za-z0-9 ]{2,60}$/.test(name)) throw new Error("Enter a font family name such as Inter or Open Sans.");
      const w = /^[0-9;]+$/.test(weights) ? weights : "400;700";
      const url = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, "+")}:wght@${w}&display=swap`;
      const p = pagePath(page);
      const parsed = ws.model.html(p);
      if (parsed.elements.some((e) => e.tag === "link" && (e.attrs.find((a) => a.name === "href")?.value || "") === url)) return { page: p, url, added: false };
      ws.editors.applyChanges(p, [
        ...addLibraryToPage(parsed, { kind: "style", url }),
      ]);
      return { page: p, url, added: true };
    },

    importMapEntry(page, specifier, url) {
      const p = pagePath(page);
      const changes = setImportMapEntry(ws.model.html(p), specifier, url);
      if (changes.length) ws.editors.applyChanges(p, changes);
      return p;
    },
  };
  return manager;
}

/** The library manager of a workspace (created on first use). */
export function libraryManager(ws) {
  return (ws._libraryManager ||= createLibraryManager(ws));
}
