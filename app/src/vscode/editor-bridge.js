// Bridges VS Code extension features into the Code studio's CodeMirror editor. Loaded by host.js (lazy).
//
// Public API
//   installEditorBridge(app, host)   registers one editor contribution (app.editorContributions, read by
//                                    ui/code/editor.js for every file state) and one formatter (app.codeFormatters)
//   insertSnippet(view, text, at, path)  inserts VS Code snippet syntax at a position (TextEditor.insertSnippet)
//
// What the contribution adds to each file's editor state (all dynamic, so installing or removing an extension takes
// effect without rebuilding states; editor.js reconfigures the compartment on the "editor-contrib" app event):
// - a tracker that tells the host which file is active, its selections and edits (activeTextEditor, versions)
// - a completion source: snippets contributed by extensions (by VS Code language id) and completion providers of
//   running web extensions (async RPC with a 1.5 s timeout)
// - a hover tooltip for hover providers (sanitized Markdown, no remote images)
// - comment tokens and auto-closing pairs from language-configuration.json for languages OpenFini has no mode for
import * as CM from "../../vendor/codemirror/codemirror.js";
import { languageOf } from "../engine/web/paths.js";
import { toCodeMirror, snippetVariables } from "./snippets.js";

const KIND = ["text", "method", "function", "function", "property", "variable", "class", "interface", "namespace", "property", "constant", "constant", "enum", "keyword", "text", "constant", "text", "variable", "text", "enum", "constant", "class", "variable", "keyword", "type"];

function posOf(state, off) {
  const line = state.doc.lineAt(off);
  return { line: line.number - 1, character: off - line.from };
}
function offOf(state, p) {
  const line = state.doc.line(Math.min(Math.max(1, (p?.line | 0) + 1), state.doc.lines));
  return line.from + Math.min(Math.max(0, p?.character | 0), line.length);
}

function varsFor(state, path) {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  return snippetVariables({ path, selection: state.sliceDoc(sel.from, sel.to), line: line.text, word: /[\w$-]*$/.exec(line.text.slice(0, sel.head - line.from))?.[0] || "" });
}

/** Inserts VS Code snippet syntax at `at` ({line, character}) in the view, with tab stops. */
export function insertSnippet(view, text, at, path) {
  const from = at ? offOf(view.state, at) : view.state.selection.main.from;
  const c = CM.snippetCompletion(toCodeMirror(text, varsFor(view.state, path)), { label: "snippet" });
  c.apply(view, c, from, from === view.state.selection.main.from ? view.state.selection.main.to : from);
  return true;
}

function completionSource(host, path) {
  return async (ctx) => {
    const lid = host.languageIdOf(path);
    const word = ctx.matchBefore(/[\w$-]+/);
    const from = word ? word.from : ctx.pos;
    const options = [];
    const snippets = host.snippetsFor(lid);
    const afterTrigger = !word && host.hasCompletion(path) && host.triggerCharacters(path).has(ctx.state.sliceDoc(ctx.pos - 1, ctx.pos));
    if (snippets.length && (word || ctx.explicit) && !afterTrigger) {
      const vars = varsFor(ctx.state, path);
      for (const s of snippets) for (const prefix of s.prefix) options.push(CM.snippetCompletion(toCodeMirror(s.body, vars), { label: prefix, detail: s.label === prefix ? s.ext : s.label, info: s.description || undefined, type: "text", boost: -1 }));
    }
    if (host.hasCompletion(path)) {
      const ch = ctx.state.sliceDoc(ctx.pos - 1, ctx.pos);
      const trigger = host.triggerCharacters(path).has(ch) ? ch : null;
      if (ctx.explicit || trigger || word) {
        const items = await host.complete(path, posOf(ctx.state, ctx.pos), trigger);
        if (ctx.aborted) return null;
        for (const it of items.slice(0, 500)) {
          if (!it.label) continue;
          const opt = { label: it.label, detail: it.detail || it.ext, info: it.documentation || undefined, type: KIND[it.kind] || "text", boost: it.preselect ? 1 : 0 };
          const rng = it.range ? { from: offOf(ctx.state, it.range.start), to: offOf(ctx.state, it.range.end) } : null;
          if (it.snippet !== null && it.snippet !== undefined) {
            const snip = CM.snippetCompletion(toCodeMirror(it.snippet, varsFor(ctx.state, path)), opt);
            opt.apply = rng ? (view, c, f, t) => snip.apply(view, c, Math.min(rng.from, f), Math.max(rng.to, t)) : snip.apply;
          } else {
            const insert = it.insertText ?? it.label;
            opt.apply = (view, c, f, t) => {
              const a = rng ? Math.min(rng.from, f) : f;
              const b = rng ? Math.max(rng.to, t) : t;
              view.dispatch({ changes: { from: a, to: b, insert }, selection: { anchor: a + insert.length }, userEvent: "input.complete" });
            };
          }
          options.push(opt);
        }
      }
    }
    return options.length ? { from, options } : null;
  };
}

/** A small hover tooltip (CodeMirror's hoverTooltip is not part of the vendored bundle). */
function hoverPlugin(host, path) {
  return CM.ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.timer = 0;
        this.tip = null;
        this.seq = 0;
        this.move = (e) => {
          clearTimeout(this.timer);
          if (this.tip && !this.tip.contains(e.target)) this.hide();
          if (!host.hasHover(path)) return;
          const { clientX: x, clientY: y } = e;
          this.timer = setTimeout(() => this.show(x, y), 450);
        };
        this.leave = () => {
          clearTimeout(this.timer);
          setTimeout(() => !this.tip?.matches(":hover") && this.hide(), 200);
        };
        view.dom.addEventListener("mousemove", this.move);
        view.dom.addEventListener("mouseleave", this.leave);
      }
      async show(x, y) {
        const pos = this.view.posAtCoords({ x, y });
        if (pos === null) return;
        const id = ++this.seq;
        const contents = await host.hover(path, posOf(this.view.state, pos));
        if (id !== this.seq || !contents.length) return;
        const { renderMarkdown } = await import("../engine/web/markdown.js");
        const html = renderMarkdown(contents.join("\n\n---\n\n"), { resolveUrl: (u, kind) => (kind === "image" ? null : u) }).html;
        this.hide();
        const tip = document.createElement("div");
        tip.className = "of-vsx-hover";
        tip.setAttribute("role", "tooltip");
        tip.innerHTML = html; // sanitized by renderMarkdown (allowlist, no scripts, no event handlers, no remote images)
        tip.style.left = `${Math.min(x + 12, innerWidth - 420)}px`;
        tip.style.top = `${Math.min(y + 16, innerHeight - 120)}px`;
        tip.addEventListener("mouseleave", () => this.hide());
        tip.addEventListener("click", (e) => {
          const a = e.target.closest?.("a[href]");
          if (!a) return;
          e.preventDefault();
          if (/^https?:/i.test(a.getAttribute("href"))) window.open(a.href, "_blank", "noopener,noreferrer");
        });
        document.body.append(tip);
        this.tip = tip;
      }
      hide() {
        this.tip?.remove();
        this.tip = null;
      }
      update(u) {
        if (u.docChanged) this.hide();
      }
      destroy() {
        clearTimeout(this.timer);
        this.view.dom.removeEventListener("mousemove", this.move);
        this.view.dom.removeEventListener("mouseleave", this.leave);
        this.hide();
      }
    },
  );
}

export function installEditorBridge(app, host) {
  if (app.__vsxBridge) return;
  app.__vsxBridge = true;
  app.editorContributions ||= [];
  app.editorContributions.push((path) => {
    if (!path) return [];
    const tracker = CM.ViewPlugin.define((view) => {
      host.editorChanged(path, view, false);
      return {
        update(u) {
          if (u.docChanged || u.selectionSet || u.focusChanged) host.editorChanged(path, u.view, u.docChanged);
        },
        destroy() {
          if (host.view === view && host.path === path) host.view = null;
        },
      };
    });
    const plainText = languageOf(path) === "text";
    const source = completionSource(host, path); // one function per file: CodeMirror tracks async sources by identity
    return [
      tracker,
      hoverPlugin(host, path),
      CM.EditorState.languageData.of(() => {
        const data = plainText ? host.languageDataFor(host.languageIdOf(path)) : null;
        return [{ autocomplete: source }, ...(data ? [data] : [])];
      }),
    ];
  });
  app.codeFormatters ||= [];
  app.codeFormatters.push({ name: "VS Code extensions", match: (path) => host.hasFormatter(path), format: (path) => host.format(path) });
  app.emit("editor-contrib");
}
