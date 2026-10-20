// A small, safe Markdown renderer for assistant messages (builds DOM nodes, never injects HTML).
import { h } from "../../core/util.js";
import { openLink } from "../links.js";

function inline(text) {
  const out = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<)]+)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h("code", m[1].slice(1, -1)));
    else if (m[2]) out.push(h("strong", m[2].slice(2, -2)));
    else if (m[3]) out.push(h("em", m[3].slice(1, -1)));
    else if (m[4]) out.push(link(m[4].slice(1, m[4].indexOf("](")), m[5]));
    else out.push(link(m[6], m[6]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function link(label, href) {
  const a = h("a", { href, rel: "noopener noreferrer", title: href }, label);
  a.addEventListener("click", (e) => {
    e.preventDefault();
    openLink(href); // asks first (Settings ▸ Security and privacy); chat links may come from the model
  });
  return a;
}

/** Renders Markdown text to a <div class="of-md">. */
export function renderMarkdown(src) {
  const root = h("div.of-md");
  const lines = String(src).replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) root.append(h("p", ...inline(para.join(" "))));
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      const pre = h("pre", h("code", code.join("\n")));
      const copy = h("button.of-md__copy", { type: "button", "aria-label": "Copy code" }, "Copy");
      copy.addEventListener("click", () => navigator.clipboard?.writeText(code.join("\n")).then(() => (copy.textContent = "Copied")));
      pre.append(copy);
      if (fence[1]) pre.dataset.lang = fence[1];
      root.append(pre);
      continue;
    }
    const head = /^(#{1,4})\s+(.*)$/.exec(line);
    if (head) {
      flush();
      root.append(h(`h${Math.min(4, head[1].length + 1)}`, ...inline(head[2])));
      i++;
      continue;
    }
    const li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]);
      const list = h(ordered ? "ol" : "ul");
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        list.append(h("li", ...inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""))));
        i++;
      }
      root.append(list);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      root.append(h("blockquote", ...inline(q.join(" "))));
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      flush();
      root.append(h("hr"));
      i++;
      continue;
    }
    if (!line.trim()) flush();
    else para.push(line.trim());
    i++;
  }
  flush();
  return root;
}
