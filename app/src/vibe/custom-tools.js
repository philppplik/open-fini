// Custom tools: small JavaScript functions the user (or the assistant, with approval) writes to extend Vibe.
// They run in a sandboxed iframe without access to the app: the only thing they can do beyond computing is call
// OpenFini's own tools through `openfini.call(name, args)`, which goes through the same permission checks.

const RUNTIME = `
const __pending = new Map();
let __seq = 0;
const openfini = {
  call(name, args) {
    return new Promise((resolve, reject) => {
      const id = ++__seq;
      __pending.set(id, { resolve, reject });
      parent.postMessage({ vc: 1, type: "call", id, name, args: args || {} }, "*");
    });
  },
  log(...a) { parent.postMessage({ vc: 1, type: "log", text: a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ") }, "*"); },
};
addEventListener("message", (e) => {
  const m = e.data;
  if (!m || m.vc !== 1) return;
  const p = __pending.get(m.id);
  if (!p) return;
  __pending.delete(m.id);
  m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
});
`;

/** Builds the document of the sandbox for one tool and one set of arguments. */
function buildDoc(code, args, isolated = false) {
  const body = `${RUNTIME}
(async () => {
  try {
    const args = ${JSON.stringify(args ?? {}).replace(/</g, "\\u003c")};
    const result = await (async (args, openfini) => {
${code}
    })(args, openfini);
    parent.postMessage({ vc: 1, type: "result", result: result === undefined ? null : JSON.parse(JSON.stringify(result)) }, "*");
  } catch (err) {
    parent.postMessage({ vc: 1, type: "error", message: String(err && err.message || err) }, "*");
  }
})();`;
  const src = `data:text/javascript;charset=utf-8,${encodeURIComponent(body)}`;
  // isolated (the evaluate tool): a CSP that blocks every network request (fetch, images, sockets) from the snippet
  const csp = isolated ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src data:">` : "";
  return `<!doctype html><meta charset="utf-8">${csp}<script src="${src}"><\/script>`;
}

/**
 * @param {object} tool { name, code }
 * @param {object} args
 * @param {(name: string, args: object) => Promise<any>} callTool executes an OpenFini tool (with approvals)
 * @param {{timeoutMs?: number, onLog?: (s: string) => void}} [opts]
 */
export function runCustomTool(tool, args, callTool, { timeoutMs = 30000, onLog, isolated = false } = {}) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;border:0";
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      fn(v);
    };
    const timer = setTimeout(() => finish(reject, new Error(`The tool “${tool.name}” took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`)), timeoutMs);
    async function onMessage(e) {
      const m = e.data;
      if (e.source !== frame.contentWindow || !m || m.vc !== 1) return;
      if (m.type === "result") finish(resolve, m.result);
      else if (m.type === "error") finish(reject, new Error(m.message));
      else if (m.type === "log") onLog?.(m.text);
      else if (m.type === "call") {
        try {
          const result = await callTool(m.name, m.args);
          frame.contentWindow?.postMessage({ vc: 1, id: m.id, result: JSON.parse(JSON.stringify(result ?? null)) }, "*");
        } catch (err) {
          frame.contentWindow?.postMessage({ vc: 1, id: m.id, error: String(err.message || err) }, "*");
        }
      }
    }
    window.addEventListener("message", onMessage);
    document.body.append(frame);
    frame.srcdoc = buildDoc(tool.code, args, isolated);
  });
}

/** Turns stored custom tools into agent tool definitions. */
export function customToolDefs(list, callTool, onLog) {
  return list
    .filter((t) => t.enabled !== false)
    .map((t) => ({
      name: t.name,
      description: `${t.description} (custom tool)`,
      inputSchema: t.inputSchema?.type ? t.inputSchema : { type: "object", properties: {} },
      needsApproval: () => `Run your custom tool “${t.name}”?`,
      run: (input) => runCustomTool(t, input, callTool, { onLog }),
    }));
}
