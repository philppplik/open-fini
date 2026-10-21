// Applies the materialized view of a TreeCRDT (collab/tree-crdt.js) to a live document (core/doc.js Doc) WITHOUT
// touching its undo history. Pure apart from the Doc it is given (no DOM), so it runs in Node tests.
//
// applyView(doc, crdt, { graveyard, changed }) → { nodes:Set, structure:boolean, meta:boolean }
//   * existing objects keep their identity (undo closures, selections and caches keep pointing at them);
//   * objects that disappear go to `graveyard` (Map id → object) and come back from there when an entry is restored;
//   * `changed` (Set of ids, optional) limits the field pass to those entries; structure is always rebuilt.
// Invariant after the call: flattenDoc(doc) describes exactly crdt.view() (the binding relies on this for echo
// suppression: a diff right after applyView yields no ops).
import { DOC_FIELDS, DOC_ID, ROOTS } from "./tree-crdt.js";

const SKIP = new Set(["id", "children", "mask"]);

function patch(obj, props, skip, changedOut) {
  let changed = false;
  for (const [f, s] of props) {
    if (skip.has(f) || f === "children") continue;
    if (JSON.stringify(obj[f]) !== s) {
      obj[f] = JSON.parse(s);
      changed = true;
    }
  }
  for (const k of Object.keys(obj)) {
    if (skip.has(k) || k === "children" || k.charCodeAt(0) === 95 || props.has(k)) continue;
    if (obj[k] === undefined || typeof obj[k] === "function") continue;
    delete obj[k];
    changed = true;
  }
  if (changed && changedOut) changedOut.add(obj);
  return changed;
}

export function applyView(doc, crdt, { graveyard = new Map(), changed = null } = {}) {
  const V = crdt.view();
  const touched = new Set();
  let meta = false;
  let structure = false;

  // the document's own fields
  const dp = crdt.propsOf(DOC_ID);
  for (const f of DOC_FIELDS) {
    const s = dp.get(f);
    if (s === undefined) continue;
    if (JSON.stringify(doc[f]) !== s) {
      doc[f] = JSON.parse(s);
      meta = true;
    }
  }

  // every live object by id (nodes of pages and masters, pages, stories, assets)
  const objs = new Map();
  const pagesById = new Map();
  for (const p of [...doc.pages, ...doc.masters]) {
    pagesById.set(p.id, p);
    const visit = (n) => {
      objs.set(n.id, n);
      if (n.children) n.children.forEach(visit);
      if (n.mask) visit(n.mask);
    };
    visit(p.root);
  }
  const objFor = (id, make) => {
    let o = objs.get(id) || pagesById.get(id) || graveyard.get(id);
    if (!o) {
      o = make();
      structure = true;
    }
    graveyard.delete(id);
    return o;
  };
  const doFields = (id) => !changed || changed.has(id);

  // nodes (and page roots): fields
  const nodeObj = new Map();
  for (const id of V.visible) {
    const p = V.parent.get(id);
    if (id === DOC_ID || p === ROOTS.pages || p === ROOTS.masters || p === ROOTS.stories || p === ROOTS.assets) continue;
    const fresh = !objs.has(id);
    const o = objFor(id, () => ({ id }));
    nodeObj.set(id, o);
    if (fresh || doFields(id)) patch(o, crdt.propsOf(id), SKIP, touched);
    const hasKids = crdt.propsOf(id).has("children");
    if (hasKids && !Array.isArray(o.children)) o.children = [];
    if (!hasKids && o.children) delete o.children;
  }

  // structure: children arrays and masks
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  for (const [id, o] of nodeObj) {
    if (Array.isArray(o.children)) {
      const want = V.kids(id).map((k) => nodeObj.get(k)).filter(Boolean);
      if (!sameList(o.children, want)) {
        for (const c of o.children) if (!want.includes(c)) graveyard.set(c.id, c);
        o.children.length = 0;
        o.children.push(...want);
        touched.add(o);
        structure = true;
      }
    }
    const m = V.mask(id);
    const mo = m ? nodeObj.get(m) : null;
    if ((o.mask || null) !== (mo || null)) {
      if (o.mask) graveyard.set(o.mask.id, o.mask);
      if (mo) o.mask = mo;
      else delete o.mask;
      touched.add(o);
      structure = true;
    }
  }

  // pages and masters (a page shows only once its root arrived)
  const pageList = (root) =>
    V.kids(root)
      .map((pid) => {
        const rootId = V.root(pid);
        const r = rootId && nodeObj.get(rootId);
        if (!r) return null;
        const pg = objFor(pid, () => ({ id: pid }));
        if (doFields(pid) || !pagesById.has(pid)) if (patch(pg, crdt.propsOf(pid), new Set(["id", "root"]), null)) meta = true;
        if (pg.root !== r) {
          pg.root = r;
          structure = true;
        }
        return pg;
      })
      .filter(Boolean);
  const pages = pageList(ROOTS.pages);
  const masters = pageList(ROOTS.masters);
  if (pages.length && !sameList(doc.pages, pages)) {
    for (const p of doc.pages) if (!pages.includes(p)) graveyard.set(p.id, p);
    doc.pages = pages;
    structure = true;
    meta = true;
  }
  if (!sameList(doc.masters, masters)) {
    for (const p of doc.masters) if (!masters.includes(p)) graveyard.set(p.id, p);
    doc.masters = masters;
    structure = true;
    meta = true;
  }

  // stories (text content shared by text frames)
  const stories = {};
  const storyChanged = new Set();
  for (const id of V.kids(ROOTS.stories)) {
    const cur = doc.stories[id];
    const props = crdt.propsOf(id);
    const entry = cur || { id };
    const s = props.get("story");
    if (s !== undefined && JSON.stringify(entry.story) !== s) {
      entry.story = JSON.parse(s);
      storyChanged.add(id);
    }
    const d = props.get("defaults");
    if (d === undefined && entry.defaults !== undefined) {
      delete entry.defaults;
      storyChanged.add(id);
    } else if (d !== undefined && JSON.stringify(entry.defaults) !== d) {
      entry.defaults = JSON.parse(d);
      storyChanged.add(id);
    }
    stories[id] = entry;
  }
  if (Object.keys(doc.stories).some((k) => !stories[k]) || Object.keys(stories).some((k) => !doc.stories[k])) meta = true;
  doc.stories = stories;

  // assets: metadata only (bytes are not live; a missing image shows as a placeholder until a snapshot arrives)
  const assets = {};
  for (const id of V.kids(ROOTS.assets)) {
    const a = doc.assets[id] || { id };
    patch(a, crdt.propsOf(id), new Set(["id", "bytes"]), null);
    assets[id] = a;
  }
  if (Object.keys(doc.assets).length !== Object.keys(assets).length) meta = true;
  doc.assets = assets;

  doc.relink();
  const nodes = new Set();
  for (const o of touched) {
    if (doc.find(o.id) !== o) continue;
    doc.touch(o);
    nodes.add(o);
  }
  if (storyChanged.size) {
    doc.walkAll((n) => {
      if (n.type === "text" && storyChanged.has(n.storyId)) {
        doc.touch(n);
        nodes.add(n);
      }
    }, { masters: true });
  }
  return { nodes, structure, meta };
}
