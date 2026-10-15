// Layout-studio panels: Pages (with masters) and Styles (paragraph and character styles).
import { h, empty, clone, uid, frameScheduler, debounce } from "../../core/util.js";
import { buildPageDL } from "../../engine/dl.js";
import { renderToCanvas } from "../../engine/backends/canvas.js";
import { iconButton, button, selectField, switchField, section } from "../controls.js";
import { promptDialog, confirmDialog } from "../dialogs.js";
import { currentFormat, textTargets } from "../../studios/tools/text.js";
import * as T from "../../engine/layout/text-model.js";

// ------------------------------------------------------------------ pages

export function createPagesPanel(app) {
  const grid = h("div.of-pages__grid");
  const mastersBox = h("div.of-pages__masters");
  const masterSel = h("div.of-pages__assign");
  const facing = switchField({ label: "Facing pages", value: false, onChange: (v) => {
    app.doc.settings.facing = v;
    app.doc.relayoutPages(v);
    app.cv?.fitAll();
  } });
  const bar = h(
    "div.of-pages__bar",
    iconButton({ icon: "file-earmark-plus", label: "Add page after the current page", onClick: () => app.run("doc.addPage") }),
    iconButton({ icon: "files", label: "Duplicate page", onClick: () => app.run("doc.duplicatePage") }),
    iconButton({ icon: "trash3", label: "Delete page", onClick: () => app.run("doc.deletePage") }),
    h("span.grow"),
    iconButton({ icon: "layout-sidebar", label: "Fit all pages", onClick: () => app.cv?.fitAll() }),
  );
  const el = h("div.of-panel.of-pages", bar, grid, section("Masters", h("div", mastersBox, masterSel, button("New master page", () => app.run("doc.addMaster"))), { open: true }), h("div.of-pages__foot", facing.el));
  let dragPage = null;

  function thumb(page) {
    const maxW = 92;
    const s = Math.min(maxW / page.w, 120 / page.h);
    const w = Math.max(1, Math.round(page.w * s));
    const hh = Math.max(1, Math.round(page.h * s));
    const c = renderToCanvas(buildPageDL(app.doc, page), { scale: s, width: w, height: hh, bg: page.bg || "#ffffff" });
    c.className = "of-pagethumb__img";
    c.style.width = `${w}px`;
    c.style.height = `${hh}px`;
    return c;
  }

  function render() {
    empty(grid);
    empty(mastersBox);
    empty(masterSel);
    const doc = app.doc;
    if (!doc) return;
    const cur = app.page;
    doc.pages.forEach((page, i) => {
      const master = doc.masters.find((m) => m.id === page.masterId);
      const card = h("div.of-pagethumb", { class: page === cur ? "active" : "", draggable: true, title: page.name }, thumb(page), h("span.of-pagethumb__label", `${i + 1}${master ? ` · ${master.name}` : ""}`));
      card.addEventListener("click", () => {
        app.setActivePage(page);
        app.cv?.fitPage(page);
      });
      card.addEventListener("dragstart", () => (dragPage = page));
      card.addEventListener("dragover", (e) => {
        if (dragPage && dragPage !== page) {
          e.preventDefault();
          card.classList.add("drop");
        }
      });
      card.addEventListener("dragleave", () => card.classList.remove("drop"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("drop");
        if (dragPage && dragPage !== page) {
          doc.tx("Reorder Pages", () => {
            doc.movePage(dragPage, doc.pages.indexOf(page));
            doc.relayoutPages(doc.settings.facing);
          });
          render();
        }
      });
      grid.append(card);
    });
    for (const m of doc.masters) {
      const row = h("div.of-masterrow", { class: m === cur ? "active" : "" }, h("sl-icon", { name: "file-earmark-text" }), h("span", m.name), h("span.grow"));
      row.append(
        iconButton({ icon: "pencil", label: "Edit master page", onClick: () => {
          app.setActivePage(m);
          app.cv?.fitPage(m);
        } }),
        iconButton({ icon: "trash3", label: "Delete master page", onClick: async () => {
          if (!(await confirmDialog({ title: "Delete master", message: `Delete “${m.name}”?`, ok: "Delete", danger: true }))) return;
          doc.tx("Delete Master", () => {
            for (const p of doc.pages) if (p.masterId === m.id) doc.set(p, { masterId: null });
            doc.masters.splice(doc.masters.indexOf(m), 1);
          });
          if (app.page === m) app.setActivePage(doc.pages[0]);
          render();
        } }),
      );
      mastersBox.append(row);
    }
    if (doc.masters.includes(cur)) {
      masterSel.append(h("p.of-hint", `Editing master “${cur.name}”. Items placed here appear on every page that uses it. Use a page-number field from the Text menu to number pages automatically.`), button("Done editing master", () => {
        app.setActivePage(doc.pages[0]);
        app.cv?.fitPage(doc.pages[0]);
      }, { variant: "primary" }));
    } else if (doc.masters.length) {
      const f = selectField({
        label: "Master for this page",
        value: cur.masterId || "",
        options: [{ value: "", label: "None" }, ...doc.masters.map((m) => ({ value: m.id, label: m.name }))],
        onChange: (v) => doc.set(cur, { masterId: v || null }, "Apply Master"),
      });
      masterSel.append(f.el);
    }
    facing.set(!!doc.settings.facing);
  }

  const sched = frameScheduler(render);
  const slow = debounce(render, 400);
  for (const ev of ["doc", "page", "selection"]) app.on(ev, sched);
  app.on("docchange", slow);
  render();
  return { el, show: render };
}

// ------------------------------------------------------------------ styles

export function createStylesPanel(app) {
  const paraList = h("div.of-styles__list");
  const charList = h("div.of-styles__list");
  const el = h(
    "div.of-panel.of-styles",
    section(
      "Paragraph styles",
      h("div", paraList, h("div.of-row", button("New from selection", () => createStyle("paragraph")), button("Add defaults", addDefaults))),
    ),
    section("Character styles", h("div", charList, h("div.of-row", button("New from selection", () => createStyle("character"))))),
    h("p.of-hint", "Select text (or a text frame), then click a style to apply it. Use “Update” to redefine a style from the current formatting."),
  );

  function stylesCopy() {
    return clone(app.doc.styles);
  }

  async function createStyle(kind) {
    const f = currentFormat(app);
    if (!f) return app.toast("Select some text first.", "warning");
    const name = await promptDialog({ title: `New ${kind} style`, label: "Name", value: kind === "paragraph" ? "Paragraph Style" : "Character Style" });
    if (!name) return;
    const styles = stylesCopy();
    const id = uid("st");
    if (kind === "paragraph") styles.paragraph[id] = { name, attrs: pickPara(f.para), char: pickChar(f.char) };
    else styles.character[id] = { name, attrs: pickChar(f.char) };
    app.doc.setStyles(styles, "New Style");
    render();
  }

  function addDefaults() {
    const styles = stylesCopy();
    const add = (name, attrs, char) => {
      if (Object.values(styles.paragraph).some((s) => s.name === name)) return;
      styles.paragraph[uid("st")] = { name, attrs, char };
    };
    add("Body", { lineHeight: 1.45, spaceAfter: 8, align: "left", hyphenate: true }, { fontSize: 14, fontWeight: 400 });
    add("Heading 1", { lineHeight: 1.1, spaceBefore: 18, spaceAfter: 10, keepWithNext: true }, { fontSize: 40, fontWeight: 700 });
    add("Heading 2", { lineHeight: 1.15, spaceBefore: 14, spaceAfter: 8, keepWithNext: true }, { fontSize: 28, fontWeight: 650 });
    add("Heading 3", { lineHeight: 1.2, spaceBefore: 10, spaceAfter: 6, keepWithNext: true }, { fontSize: 20, fontWeight: 600 });
    add("Caption", { lineHeight: 1.3, spaceAfter: 6 }, { fontSize: 11, fontStyle: "italic" });
    add("Quote", { lineHeight: 1.5, indentLeft: 28, spaceBefore: 8, spaceAfter: 8 }, { fontSize: 18, fontStyle: "italic" });
    app.doc.setStyles(styles, "Add Default Styles");
    render();
  }

  function applyStyle(kind, id) {
    const { session, nodes } = textTargets(app);
    const doc = app.doc;
    if (!nodes.length) return app.toast("Select some text first.", "warning");
    const fn = kind === "paragraph" ? T.applyParaStyle : T.applyCharStyle;
    doc.tx("Apply Style", () => {
      for (const n of nodes) {
        const story = doc.stories[n.storyId].story;
        let from = 0;
        let to = T.storyLength(story);
        if (session && session.node === n) {
          from = Math.min(session.caret, session.anchor);
          to = Math.max(session.caret, session.anchor);
        }
        doc.setStory(n.storyId, fn(story, from, to, id), "Apply Style");
      }
    });
  }

  function listFor(kind, list) {
    empty(list);
    const defs = app.doc?.styles[kind] || {};
    const ids = Object.keys(defs);
    if (!ids.length) list.append(h("div.of-empty", kind === "paragraph" ? "No paragraph styles yet." : "No character styles yet."));
    for (const id of ids) {
      const st = defs[id];
      const row = h("div.of-stylerow", h("button.of-stylerow__name", { type: "button", title: "Apply style" }, st.name));
      row.firstChild.addEventListener("click", () => applyStyle(kind, id));
      row.append(
        iconButton({ icon: "arrow-repeat", label: "Update style from current formatting", onClick: () => {
          const f = currentFormat(app);
          if (!f) return;
          const styles = stylesCopy();
          if (kind === "paragraph") {
            styles.paragraph[id].attrs = pickPara(f.para);
            styles.paragraph[id].char = pickChar(f.char);
          } else styles.character[id].attrs = pickChar(f.char);
          app.doc.setStyles(styles, "Update Style");
        } }),
        iconButton({ icon: "pencil", label: "Rename", onClick: async () => {
          const name = await promptDialog({ title: "Rename style", label: "Name", value: st.name });
          if (!name) return;
          const styles = stylesCopy();
          styles[kind][id].name = name;
          app.doc.setStyles(styles, "Rename Style");
          render();
        } }),
        iconButton({ icon: "trash3", label: "Delete style", onClick: () => {
          const styles = stylesCopy();
          delete styles[kind][id];
          app.doc.setStyles(styles, "Delete Style");
          render();
        } }),
      );
      list.append(row);
    }
  }

  function render() {
    listFor("paragraph", paraList);
    listFor("character", charList);
  }
  const sched = frameScheduler(render);
  for (const ev of ["doc", "docchange"]) app.on(ev, sched);
  render();
  return { el, show: render };
}

const PARA_KEYS = ["align", "lineHeight", "spaceBefore", "spaceAfter", "indentFirst", "indentLeft", "indentRight", "hyphenate", "keepWithNext", "keepLinesTogether", "bullet", "dropCap"];
const CHAR_KEYS = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "color", "underline", "strike", "tracking", "baselineShift", "caps"];
const pickKeys = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== false && o[k] !== 0).map((k) => [k, o[k]]));
const pickPara = (a) => pickKeys(a, PARA_KEYS);
const pickChar = (a) => pickKeys(a, CHAR_KEYS);
