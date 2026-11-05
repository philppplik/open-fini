// Policy of the assistant's run_command tool (desktop app only, off by default, every call approved). Pure: decides
// whether an argv may run and where; the Rust side (src-tauri/src/cmd.rs) runs it without a shell and enforces the
// working directory, time limit and output cap again. Docs: docs/security.md ▸ Terminal access.
//
// Public API
//   DEFAULT_TERMINAL()  normalizeTerminal(t)  programName(argv0) → "git"
//   checkCommand(argv, policy) → null | reason      resolveCwd(cwd, roots) → absolute path (throws outside the roots)
//   parseArgv(text) → string[]   (UI helper for the user's own console: quotes, no expansion, no operators)
//   tunnelUrl(kind, text) → public URL printed by cloudflared / ngrok / tailscale, or ""

export const DEFAULT_TERMINAL = () => ({
  enabled: false,
  allow: ["git", "node", "npm", "npx", "pnpm", "yarn", "deno", "bun", "python", "python3", "py", "pip", "cargo", "rustc", "go", "dotnet", "make", "ls", "dir", "tsc", "eslint", "prettier"],
  deny: ["rm", "rmdir", "del", "erase", "format", "mkfs", "dd", "shutdown", "reboot", "sudo", "su", "doas", "runas", "chmod", "chown", "reg", "diskpart", "curl", "wget", "ssh", "scp", "sftp", "nc", "ncat", "telnet", "sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "cmd", "powershell", "pwsh", "wsl", "osascript", "open", "start", "xdg-open", "explorer", "eval", "exec", "env", "xargs"],
  denyPatterns: ["git push --force", "git push -f", "git reset --hard", "git clean", "npm publish", "cargo publish", "pip uninstall", "--global", "-g"],
  timeoutMs: 60_000,
  maxOutputBytes: 256 * 1024,
});

export const normalizeTerminal = (t) => ({ ...DEFAULT_TERMINAL(), ...(t || {}) });

/** Lower-case program name without directory and Windows extension. */
export const programName = (p) => String(p || "").split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, "");

/** Null when the argv may run under `policy`, else a reason. Deny wins over allow; shells are never allowed. */
export function checkCommand(argv, policy) {
  const p = normalizeTerminal(policy);
  if (!p.enabled) return "Terminal access is switched off (Settings ▸ Artificial intelligence ▸ Terminal).";
  if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== "string")) return "argv must be a non-empty array of strings.";
  if (argv.some((a) => /[\0\r\n]/.test(a))) return "Arguments cannot contain line breaks or NUL characters.";
  if (argv.length > 64 || argv.join(" ").length > 8000) return "The command line is too long.";
  const name = programName(argv[0]);
  if (/[\\/]/.test(argv[0])) return "Give the program by name (it is looked up on PATH), not by path.";
  if (["sh", "bash", "zsh", "fish", "cmd", "powershell", "pwsh"].includes(name)) return `Shells (${name}) are never allowed: run the program directly with its arguments.`;
  if (p.deny.map(programName).includes(name)) return `“${name}” is on the deny list.`;
  if (!p.allow.map(programName).includes(name)) return `“${name}” is not on the allow list (Settings ▸ Artificial intelligence ▸ Terminal).`;
  const line = ` ${argv.map((a) => a.toLowerCase()).join(" ")} `;
  for (const pat of p.denyPatterns) {
    const q = String(pat).trim().toLowerCase();
    if (q && (q.includes(" ") ? line.includes(` ${q} `) : argv.slice(1).some((a) => a.toLowerCase() === q))) return `The command matches the deny pattern “${pat}”.`;
  }
  return null;
}

const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");

/** Resolves `cwd` (absolute, or relative to the first root) and checks it lies inside one of `roots`. */
export function resolveCwd(cwd, roots) {
  const rs = (roots || []).map(norm).filter(Boolean);
  if (!rs.length) throw new Error("Open a folder first (File ▸ Open Folder): commands only run inside opened folders.");
  const raw = cwd ? norm(cwd) : rs[0];
  const abs = /^([a-z]:\/|\/)/i.test(raw) ? raw : `${rs[0]}/${raw}`;
  const parts = [];
  for (const seg of abs.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  const out = (abs.startsWith("/") ? "/" : "") + parts.join("/");
  const ci = /^[a-z]:/i.test(out);
  const eq = (a, b) => (ci ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!rs.some((r) => eq(out, r) || eq(out.slice(0, r.length + 1), `${r}/`))) throw new Error(`“${cwd}” is outside the opened folders.`);
  return out;
}

/** Splits a console line into argv: whitespace separated, "double" and 'single' quotes, no variables, globs or operators. */
export function parseArgv(text) {
  const out = [];
  let cur = "";
  let q = "";
  let has = false;
  for (const ch of String(text)) {
    if (q) {
      if (ch === q) q = "";
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else if (/[|&;<>`$]/.test(ch)) throw new Error(`“${ch}” is a shell operator; this console runs one program without a shell.`);
    else cur += ch;
  }
  if (q) throw new Error("Unclosed quote.");
  if (cur || has) out.push(cur);
  return out;
}

/** The public URL a tunnel CLI printed, or "". */
export function tunnelUrl(kind, text) {
  const s = String(text);
  const re = kind === "cloudflared" ? /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i : kind === "ngrok" ? /url=(https:\/\/[^\s"]+)|(https:\/\/[a-z0-9-]+\.ngrok(?:-free)?\.(?:app|io|dev))/i : /(https:\/\/[a-z0-9.-]+\.ts\.net\S*)/i;
  const m = re.exec(s);
  return m ? (m[1] || m[2] || m[0]).replace(/[)"',]+$/, "") : "";
}
