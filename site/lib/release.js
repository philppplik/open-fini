// The latest published release for the Download page. At build time the GitHub API is asked (with GITHUB_TOKEN when
// set, as in the Pages workflow); without network the committed snapshot site/data/release.json is used, so the
// page is always complete without JavaScript. `node site/build.mjs --update-snapshot` refreshes the snapshot.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { classifyAsset, parseSums } from "../assets/js/platforms.js";

export const REPO = "philppplik/open-fini";

/**
 * @typedef {{ tag: string, version: string, name: string, url: string, publishedAt: string,
 *   assets: { name: string, size: number, url: string, sha256?: string }[] }} Release
 */

async function getJson(url, token) {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "openfini-site-build", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

/**
 * @param {{ token?: string }} [opts]
 * @returns {Promise<Release>}
 */
export async function fetchRelease({ token } = {}) {
  const r = await (await getJson(`https://api.github.com/repos/${REPO}/releases/latest`, token)).json();
  let sums = {};
  const sumsAsset = r.assets.find((a) => /^SHA256SUMS(\.txt)?$/i.test(a.name));
  if (sumsAsset) {
    const res = await fetch(sumsAsset.browser_download_url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "openfini-site-build" } });
    if (res.ok) sums = parseSums(await res.text());
  }
  return {
    tag: r.tag_name,
    version: r.tag_name.replace(/^v/, ""),
    name: r.name,
    url: r.html_url,
    publishedAt: r.published_at,
    assets: r.assets
      .filter((a) => classifyAsset(a.name))
      .map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url, ...(sums[a.name] ? { sha256: sums[a.name] } : {}) })),
  };
}

/**
 * @param {{ snapshot: string, offline?: boolean, update?: boolean, token?: string, log?: (s: string) => void }} opts
 * @returns {Promise<Release|null>}
 */
export async function loadRelease({ snapshot, offline = false, update = false, token, log = () => {} }) {
  if (!offline) {
    try {
      const rel = await fetchRelease({ token });
      if (update) writeFileSync(snapshot, `${JSON.stringify(rel, null, 2)}\n`);
      log(`release ${rel.tag} from the GitHub API${update ? " (snapshot updated)" : ""}`);
      return rel;
    } catch (err) {
      log(`release: ${err.message}; using the snapshot`);
    }
  }
  if (!existsSync(snapshot)) return null;
  return JSON.parse(readFileSync(snapshot, "utf8"));
}
