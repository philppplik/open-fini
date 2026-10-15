// "Settings" dock panel of the Code studio: tag, id, classes, attributes and text of the selected element.
import { h, empty, frameScheduler } from "../../core/util.js";
import { classList, getAttr, hasAttr, elementText, relativeRef, mimeOf } from "../../engine/web/index.js";
import { button, section } from "../controls.js";

const TAGS = ["div", "section", "header", "footer", "main", "nav", "article", "aside", "figure", "p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "a", "button", "ul", "ol", "li", "form", "label", "blockquote", "pre", "code", "small", "strong", "em", "address", "details", "summary"];
const SKIP_ATTRS = new Set(["class", "id", "style"]);

const TAG_FIELDS = {
  a: [["href", "Link", "link"], ["target", "Open in", "target"], ["rel", "Relationship", "text"], ["download", "Download", "bool"]],
  img: [["src", "Source", "asset"], ["alt", "Alt text", "text"], ["width", "Width", "text"], ["height", "Height", "text"], ["loading", "Loading", "loading"]],
  input: [["type", "Type", "inputType"], ["name", "Name", "text"], ["placeholder", "Placeholder", "text"], ["value", "Value", "text"], ["required", "Required", "bool"], ["disabled", "Disabled", "bool"]],
  textarea: [["name", "Name", "text"], ["placeholder", "Placeholder", "text"], ["rows", "Rows", "text"], ["required", "Required", "bool"]],
  select: [["name", "Name", "text"], ["required", "Required", "bool"], ["multiple", "Multiple", "bool"]],
  button: [["type", "Type", "buttonType"], ["name", "Name", "text"], ["disabled", "Disabled", "bool"]],
  label: [["for", "For", "text"]],
  form: [["action", "Action", "text"], ["method", "Method", "method"]],
  video: [["src", "Source", "asset"], ["poster", "Poster", "asset"], ["controls", "Controls", "bool"], ["autoplay", "Autoplay", "bool"], ["muted", "Muted", "bool"], ["loop", "Loop", "bool"]],
  audio: [["src", "Source", "asset"], ["controls", "Controls", "bool"], ["autoplay", "Autoplay", "bool"], ["loop", "Loop", "bool"]],
  iframe: [["src", "Source", "text"], ["title", "Title", "text"], ["loading", "Loading", "loading"]],
  source: [["src", "Source", "asset"], ["type", "Type", "text"]],
  meta: [["name", "Name", "text"], ["content", "Content", "text"]],
  link: [["rel", "Relationship", "text"], ["href", "Link", "link"]],
  script: [["src", "Source", "asset"], ["type", "Type", "text"], ["defer", "Defer", "bool"]],
};
const OPTIONS = {
  target: [["", "Same tab"], ["_blank", "New tab"]],
  loading: [["", "Default"], ["lazy", "Lazy"], ["eager", "Eager"]],
  inputType: ["text", "email", "password", "number", "tel", "url", "search", "date", "time", "color", "range", "checkbox", "radio", "file", "hidden", "submit"].map((v) => [v, v]),
  buttonType: [["button", "Button"], ["submit", "Submit"], ["reset", "Reset"]],
  method: [["", "GET"], ["post", "POST"]],
};

export function createElementPanel(app) {
  const el = h("div.of-panel.of-elpanel");
  let ws = null;
  let off = [];

  function bind() {
    for (const o of off) o();
    off = [];
    ws = app.codeUI?.built ? app.codeUI : null;
    if (ws) for (const ev of ["selection", "project", "swap", "page"]) off.push(ws.on(ev, sched));
    build();
  }

  function field(label, control) {
    return h("label.of-attr", h("span.of-attr__label", label), control);
  }
  function textInput(value, onCommit, { list, placeholder } = {}) {
    const i = h("input.of-attr__input", { type: "text", value: value ?? "", spellcheck: false, placeholder: placeholder || "", list });
    i.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") i.blur();
      else if (e.key === "Escape") {
        i.value = value ?? "";
        i.blur();
      }
    });
    i.addEventListener("change", () => onCommit(i.value));
    return i;
  }
  function selectInput(options, value, onCommit) {
    const s = h("select.of-attr__input", options.map(([v, l]) => h("option", { value: v, selected: v === value }, l)));
    if (!options.some(([v]) => v === value)) s.append(h("option", { value, selected: true }, value || "—"));
    s.addEventListener("change", () => onCommit(s.value));
    return s;
  }
  function boolInput(on, onCommit) {
    const c = h("input", { type: "checkbox", checked: on });
    c.addEventListener("change", () => onCommit(c.checked));
    return c;
  }

  function control(cur, name, kind) {
    const val = getAttr(cur.el, name);
    const set = (v) => ws.setAttribute(name, v === "" || v == null ? null : v);
    switch (kind) {
      case "bool":
        return boolInput(hasAttr(cur.el, name), (on) => ws.setAttribute(name, on ? "" : null));
      case "link": {
        const pages = ws.web.pages().map((p) => [relativeRef(ws.page, p), p]);
        const list = h("datalist", { id: `of-pages-${name}` }, pages.map(([r]) => h("option", { value: r })), h("option", { value: "#" }), h("option", { value: "mailto:" }), h("option", { value: "https://" }));
        return h("span.of-attr__combo", textInput(val, set, { list: list.id, placeholder: "page.html, #section or https://…" }), list);
      }
      case "asset": {
        const assets = ws.web.paths.filter((p) => /^(image|video|audio)\//.test(mimeOf(p)) || /\.(js|mjs)$/.test(p));
        const list = h("datalist", { id: `of-assets-${name}` }, assets.map((p) => h("option", { value: relativeRef(ws.page, p) })));
        return h("span.of-attr__combo", textInput(val, set, { list: list.id, placeholder: "path or URL" }), list);
      }
      default:
        if (OPTIONS[kind]) return selectInput(OPTIONS[kind], val ?? "", (v) => set(v));
        return textInput(val, set);
    }
  }

  function build() {
    empty(el);
    if (!ws) {
      el.append(h("div.of-empty", "Open a website project in the Code studio to edit element settings."));
      return;
    }
    const cur = ws.current();
    if (!cur) {
      const meta = ws.pageMeta();
      if (meta) {
        const t = textInput(meta.title, (v) => ws.setPageMeta({ title: v.trim() }), { placeholder: "Page title" });
        const d = textInput(meta.description, (v) => ws.setPageMeta({ description: v.trim() }), { placeholder: "Shown in search results" });
        const l = textInput(meta.lang, (v) => ws.setPageMeta({ lang: v.trim() }), { placeholder: "en-US" });
        el.append(section(`Page — ${ws.page}`, h("div.of-form", field("Title", t), field("Description", d), field("Language", l), h("p.of-hint", "Shown in the browser tab and in search results."))));
      }
      el.append(h("div.of-empty", "Select an element on the canvas or in the Navigator to edit its settings."));
      return;
    }
    const { el: node, parsed } = cur;
    // ---- element
    const tagSel = selectInput(TAGS.includes(node.tag) ? TAGS.map((t) => [t, `<${t}>`]) : [[node.tag, `<${node.tag}>`], ...TAGS.map((t) => [t, `<${t}>`])], node.tag, (t) => ws.setTag(t));
    if (["html", "head", "body", "script", "style", "link", "meta", "img", "input", "br", "hr", "svg", "video", "audio", "iframe", "textarea", "select", "table"].includes(node.tag)) tagSel.disabled = true;
    const idInput = textInput(getAttr(node, "id"), (v) => {
      const val = v.trim().replace(/\s+/g, "-");
      if (val && parsed.elements.some((e) => e !== node && getAttr(e, "id") === val)) return app.toast(`The id “${val}” is already used on this page.`, "warning", 2400);
      ws.setAttribute("id", val || null);
    }, { placeholder: "none" });

    // ---- classes
    const classes = classList(node);
    const known = h("datalist", { id: "of-known-classes" }, ws.model.classNames().map((c) => h("option", { value: c })));
    const add = h("input.of-attr__input.of-classadd", { type: "text", placeholder: "Add class…", list: "of-known-classes", spellcheck: false, "aria-label": "Add class" });
    add.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const names = add.value.split(/[\s,]+/).map((s) => s.replace(/^\./, "").trim()).filter(Boolean);
        if (names.length) {
          ws.setClasses([...new Set([...classes, ...names])]);
          ws.setStyleSelector(`.${names[names.length - 1]}`);
        }
      }
    });
    const pills = h("div.of-pills", classes.map((c) => {
      const p = h("span.of-pill", h("span", c), h("button", { type: "button", "aria-label": `Remove class ${c}`, onclick: () => ws.setClasses(classes.filter((x) => x !== c)) }, "×"));
      return p;
    }));

    el.append(
      section("Element", h("div.of-form", field("Tag", tagSel), field("ID", idInput), h("div.of-attr.of-attr--col", h("span.of-attr__label", "Classes"), pills, add, known), h("div.of-row", button("Show in code", () => ws.revealInCode(node.id)), button("Select parent", () => ws.selectParent())))),
    );

    // ---- tag specific attributes
    const fields = TAG_FIELDS[node.tag] || [];
    const common = [["title", "Tooltip", "text"], ["aria-label", "Accessible label", "text"], ["role", "Role", "text"]];
    const rows = [...fields, ...common.filter(([n]) => !fields.some(([x]) => x === n))];
    el.append(section("Attributes", h("div.of-form", rows.map(([name, label, kind]) => field(label, control(cur, name, kind))))));

    // ---- other attributes
    const shown = new Set([...rows.map(([n]) => n), ...SKIP_ATTRS]);
    const others = node.attrs.filter((a) => !shown.has(a.name) && !a.name.startsWith("data-of"));
    const list = h("div.of-form");
    for (const a of others) {
      const del = h("button.of-attr__del", { type: "button", "aria-label": `Remove ${a.name}`, onclick: () => ws.setAttribute(a.name, null) }, "×");
      list.append(h("div.of-attr", h("span.of-attr__label", { title: a.name }, a.name), textInput(a.value ?? "", (v) => ws.setAttribute(a.name, v), {}), del));
    }
    const nameIn = h("input.of-attr__input", { type: "text", placeholder: "name", spellcheck: false, "aria-label": "Attribute name" });
    const valIn = h("input.of-attr__input", { type: "text", placeholder: "value", spellcheck: false, "aria-label": "Attribute value" });
    const addAttr = () => {
      const n = nameIn.value.trim().toLowerCase();
      if (!/^[a-z_:][\w:.-]*$/.test(n)) return;
      ws.setAttribute(n, valIn.value);
      nameIn.value = valIn.value = "";
    };
    for (const i of [nameIn, valIn]) i.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") addAttr();
    });
    list.append(h("div.of-row", nameIn, valIn, button("Add", addAttr)));
    el.append(section("Custom attributes", list, { open: others.length > 0 }));

    // ---- text
    const textOnly = !node.void && node.children.every((c) => c.type === "text" || c.type === "comment") && !["script", "style"].includes(node.tag);
    if (textOnly) {
      const ta = h("textarea.of-attr__text", { rows: 3, spellcheck: true, "aria-label": "Text content" }, elementText(parsed, node));
      ta.addEventListener("keydown", (e) => e.stopPropagation());
      ta.addEventListener("change", () => ws.applyTextEdit(node.id, ta.value, false));
      el.append(section("Text", h("div.of-form", ta, h("p.of-hint", "Tip: double-click text on the canvas to edit it in place."))));
    }
    // ---- actions
    el.append(
      h("div.of-elactions", button("Duplicate", () => ws.duplicateSelected()), button("Wrap", () => ws.wrapSelected("div")), button("Delete", () => ws.deleteSelected(), { variant: "danger" })),
    );
  }

  const sched = frameScheduler(() => {
    // do not rebuild while the user is typing into one of the panel's own fields
    if (el.contains(document.activeElement) && document.activeElement.matches("input, textarea, select")) {
      const tag = ws?.current()?.el;
      if (tag && el.dataset.id === String(tag.id)) return;
    }
    build();
    el.dataset.id = String(ws?.current()?.el.id ?? "");
  });
  app.on("codeui", bind);
  app.on("studio", bind);
  app.on("doc", bind);
  bind();
  return { el, show: bind };
}
