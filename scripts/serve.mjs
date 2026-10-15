// Static development server for the OpenFini web app (zero dependencies).
//
//   npm start                              serves app/ on http://localhost:4173
//   node scripts/serve.mjs --root dist     serves the production build instead
//   node scripts/serve.mjs --port 8080 --host 0.0.0.0
//   node scripts/serve.mjs --csp           also send the desktop app's Content-Security-Policy
//
// Everything is sent with `Cache-Control: no-store`, so edits show up on reload.
// The service worker is served as is; without the tokens injected by the build
// it unregisters itself (see app/sw.js), so development is never stale.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".ofini": "application/x-openfini",
};

/**
 * Maps a request URL to a file inside `root`, or returns null when the URL
 * would escape it (or is malformed).
 * @param {string} root  absolute, normalized root directory
 * @param {string} requestUrl
 * @returns {string | null}
 */
export function resolveRequestPath(root, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;
  // Windows treats "\" as a separator too; refuse it outright instead of reasoning about it.
  if (pathname.includes("\\")) return null;
  let target = normalize(join(root, pathname));
  if (target !== root && !target.startsWith(root + sep)) return null;
  if (target.length > root.length) target = target.replace(/[\\/]+$/, ""); // "/dir/" -> "/dir"
  return target;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

/**
 * Creates (but does not start) the dev server.
 * @param {{ root: string, spa?: boolean, csp?: string }} options
 *   `spa` serves index.html for extension-less paths that do not exist;
 *   `csp` is sent as the Content-Security-Policy header of every response.
 * @returns {import("node:http").Server}
 */
export function createServer({ root, spa = false, csp }) {
  const absoluteRoot = resolve(root);

  return createHttpServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
      }
      let file = resolveRequestPath(absoluteRoot, req.url ?? "/");
      if (file === null) return send(res, 400, "Bad request");

      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        file = join(file, "index.html");
        info = await stat(file).catch(() => null);
      }
      if (!info && spa && !extname(file)) {
        file = join(absoluteRoot, "index.html");
        info = await stat(file).catch(() => null);
      }
      if (!info?.isFile()) return send(res, 404, "Not found");

      res.writeHead(200, {
        "Content-Type": MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(csp ? { "Content-Security-Policy": csp } : {}),
      });
      if (req.method === "HEAD") return res.end();

      const stream = createReadStream(file);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    } catch (err) {
      console.error("serve:", err);
      if (!res.headersSent) send(res, 500, "Internal server error");
      else res.destroy();
    }
  });
}

/** The CSP of the desktop app (src-tauri/tauri.conf.json) as a header value. */
export async function desktopCsp() {
  const conf = JSON.parse(await readFile(join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"));
  const csp = conf.app?.security?.csp;
  if (typeof csp === "string") return csp;
  if (!csp || typeof csp !== "object") throw new Error("app.security.csp is not set");
  return Object.entries(csp)
    .map(([directive, sources]) => `${directive} ${Array.isArray(sources) ? sources.join(" ") : sources}`)
    .join("; ");
}

function parseArgs(argv) {
  const options = { root: join(projectRoot, "app"), port: 4173, host: "localhost", spa: false, csp: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      return next;
    };
    if (arg === "--port" || arg === "-p") {
      options.port = Number(value());
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        throw new Error("--port must be an integer between 0 and 65535");
      }
    } else if (arg === "--root" || arg === "-r") options.root = resolve(value());
    else if (arg === "--host") options.host = value();
    else if (arg === "--spa") options.spa = true;
    else if (arg === "--csp") options.csp = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/serve.mjs [--root <dir>] [--port <n>] [--host <name>] [--spa] [--csp]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`serve: ${err.message}`);
    process.exit(2);
  }
  const info = await stat(options.root).catch(() => null);
  if (!info?.isDirectory()) {
    console.error(`serve: root directory not found: ${options.root}${options.root.endsWith("dist") ? " (run \"npm run build\" first)" : ""}`);
    process.exit(1);
  }

  let csp;
  if (options.csp) {
    try {
      csp = await desktopCsp();
    } catch (err) {
      console.error(`serve: --csp needs src-tauri/tauri.conf.json: ${err.message}`);
      process.exit(1);
    }
    console.log("serve: sending the desktop app's Content-Security-Policy; violations show up in the browser console");
  }
  const server = createServer({ ...options, csp });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`serve: port ${options.port} is already in use. Try: node scripts/serve.mjs --port ${options.port + 1}`);
    } else {
      console.error(`serve: ${err.message}`);
    }
    process.exit(1);
  });
  server.listen(options.port, options.host, () => {
    const { port } = server.address();
    console.log(`OpenFini dev server: http://${options.host}:${port}/  (serving ${options.root})`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
