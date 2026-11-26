import test from "node:test";
import assert from "node:assert/strict";
import { changedRange, planPagePatch, morphKit } from "../../app/src/engine/web/live-patch.js";
import { parseHtml } from "../../app/src/engine/web/html.js";

// ------------------------------------------------------------------ a tiny DOM, enough for morphKit

class Node {
  constructor(type, name, value = null) {
    this.nodeType = type;
    this.nodeName = name;
    this.nodeValue = value;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = [];
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get nextSibling() {
    const s = this.parentNode?.childNodes;
    return s ? s[s.indexOf(this) + 1] || null : null;
  }
  hasAttribute(n) {
    return this.attributes.some((a) => a.name === n);
  }
  getAttribute(n) {
    return this.attributes.find((a) => a.name === n)?.value ?? null;
  }
  setAttribute(n, v) {
    const a = this.attributes.find((x) => x.name === n);
    if (a) a.value = String(v);
    else this.attributes.push({ name: n, value: String(v) });
  }
  removeAttribute(n) {
    this.attributes = this.attributes.filter((a) => a.name !== n);
  }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n);
    n.parentNode = this;
    return n;
  }
  appendChild(n) {
    return this.insertBefore(n, null);
  }
  removeChild(n) {
    this.childNodes.splice(this.childNodes.indexOf(n), 1);
    n.parentNode = null;
    return n;
  }
  clone() {
    const c = new Node(this.nodeType, this.nodeName, this.nodeValue);
    c.attributes = this.attributes.map((a) => ({ ...a }));
    for (const k of this.childNodes) c.appendChild(k.clone());
    return c;
  }
}

/** A DOM of the page as the preview builds it: every source element carries data-of = its parse id. */
function dom(src) {
  const parsed = parseHtml(src);
  const root = new Node(9, "#document");
  const add = (parent, nodes) => {
    for (const n of nodes) {
      if (n.type === "text") parent.appendChild(new Node(3, "#text", n.text));
      else if (n.type === "comment") parent.appendChild(new Node(8, "#comment", src.slice(n.start, n.end)));
      else if (n.type === "element") {
        const el = new Node(1, n.tag.toUpperCase());
        for (const a of n.attrs) el.setAttribute(a.name, a.value ?? "");
        el.setAttribute("data-of", n.id);
        parent.appendChild(el);
        add(el, n.children);
      }
    }
  };
  add(root, parsed.children);
  return root;
}
const serialize = (n) =>
  n.nodeType === 3 ? n.nodeValue : n.nodeType === 8 ? n.nodeValue : n.nodeType === 9 ? n.childNodes.map(serialize).join("") : `<${n.nodeName.toLowerCase()}${[...n.attributes].sort((x, y) => (x.name < y.name ? -1 : 1)).map((a) => ` ${a.name}="${a.value}"`).join("")}>${n.childNodes.map(serialize).join("")}</${n.nodeName.toLowerCase()}>`;
const find = (root, id) => {
  let hit = null;
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (hit) return;
      if (c.nodeType === 1 && c.getAttribute("data-of") === String(id)) hit = c;
      else walk(c);
    }
  };
  walk(root);
  return hit;
};

/** Plans, applies the patch to a live DOM of `a` and checks the result equals a fresh DOM of `b`. */
function roundTrip(a, b, extra) {
  const plan = planPagePatch(a, b);
  assert.equal(plan.kind, "patch", `expected a patch, got ${JSON.stringify(plan)}`);
  const live = dom(a);
  extra?.before?.(live);
  const next = dom(b);
  const kit = morphKit();
  kit.renumber(live, plan.keep, plan.removed, plan.added);
  const L = plan.root == null ? live : find(live, plan.root);
  const N = plan.root == null ? next : find(next, plan.root);
  assert.ok(L && N, "root found in both documents");
  const stats = kit.morph(L, N, { adopt: (n) => n.clone(), keep: extra?.keep });
  extra?.after?.(live);
  return { plan, live, next, stats };
}

// ------------------------------------------------------------------ changedRange

test("changedRange finds the one differing range", () => {
  assert.deepEqual(changedRange("abc", "abc"), { from: 3, oldTo: 3, newTo: 3 });
  assert.deepEqual(changedRange("<p>a</p>", "<p>ab</p>"), { from: 4, oldTo: 4, newTo: 5 });
  assert.deepEqual(changedRange("<p>abc</p>", "<p>ac</p>"), { from: 4, oldTo: 5, newTo: 4 });
  assert.deepEqual(changedRange("aaa", "aaaa"), { from: 3, oldTo: 3, newTo: 4 });
});

// ------------------------------------------------------------------ planPagePatch

const PAGE = (body) => `<!doctype html><html><head><title>T</title><link rel="stylesheet" href="a.css"></head><body>${body}<script src="app.js"></script></body></html>`;

test("typing text inside an element patches that element only", () => {
  const plan = planPagePatch(PAGE("<h1>Hello</h1><p>World</p>"), PAGE("<h1>Hello!</h1><p>World</p>"));
  assert.equal(plan.kind, "patch");
  assert.equal(plan.root, parseHtml(PAGE("<h1>Hello</h1><p>World</p>")).elements.find((e) => e.tag === "h1").id);
  assert.equal(plan.removed, 0);
  assert.equal(plan.added, 0);
});

test("no change plans nothing", () => {
  assert.deepEqual(planPagePatch("<p>a</p>", "<p>a</p>"), { kind: "none" });
});

test("inserting an element shifts later ids", () => {
  const a = PAGE("<main><p>one</p><p>three</p></main><footer>f</footer>");
  const b = PAGE("<main><p>one</p><p>two</p><p>three</p></main><footer>f</footer>");
  const plan = planPagePatch(a, b);
  assert.equal(plan.kind, "patch");
  assert.equal(plan.added - plan.removed, 1);
  const main = parseHtml(a).elements.find((e) => e.tag === "main");
  assert.equal(plan.root, main.id);
});

test("attribute edits patch the element itself", () => {
  const a = PAGE('<div class="a"><span>x</span></div>');
  const b = PAGE('<div class="ab"><span>x</span></div>');
  const plan = planPagePatch(a, b);
  assert.equal(plan.kind, "patch");
  assert.equal(plan.root, parseHtml(a).elements.find((e) => e.tag === "div").id);
  assert.equal(plan.removed, 0);
});

test("scripts, inline handlers and templates reload", () => {
  assert.equal(planPagePatch(PAGE("<p>a</p>"), PAGE("<p>a</p><script>x()</script>")).kind, "reload");
  assert.equal(planPagePatch("<body><script>var a=1</script></body>", "<body><script>var a=2</script></body>").reason, "script");
  assert.equal(planPagePatch('<button onclick="a()">b</button>', '<button onclick="b()">b</button>').reason, "handler");
  assert.equal(planPagePatch("<p>a</p>", '<p>a</p><i onclick="x()">i</i>').reason, "handler");
  assert.equal(planPagePatch("<template><p>a</p></template>", "<template><p>b</p></template>").reason, "template");
  // text right before a script is not a script edit
  assert.equal(planPagePatch(PAGE("<p>a</p>"), PAGE("<p>a</p><p>b</p>")).kind, "patch");
  // an element with a handler that is only an ancestor of the edit is fine
  assert.equal(planPagePatch('<div onclick="x()"><p>a</p></div>', '<div onclick="x()"><p>ab</p></div>').kind, "patch");
});

test("structural edits that move elements out of their parent reload", () => {
  // removing </div> makes the following <p> a child of the div
  const plan = planPagePatch("<body><div><i>a</i></div><p>b</p></body>", "<body><div><i>a</i><p>b</p></body>");
  assert.equal(plan.kind, "patch"); // the body is the root: everything that moved is inside it
  const plan2 = planPagePatch("<div><i>a</i></div><p>b</p>", "<div><i>a</i><p>b</p>");
  assert.equal(plan2.kind, "reload");
});

test("doctype edits reload", () => {
  assert.equal(planPagePatch("<!doctype html><p>a</p>", "<!doctype htm><p>a</p>").reason, "doctype");
});

test("renaming a tag replaces the element", () => {
  const plan = planPagePatch(PAGE("<b>x</b>"), PAGE("<i>x</b>"));
  assert.equal(plan.kind, "patch");
  assert.equal(plan.removed, 1);
  assert.equal(plan.added, 1);
});

// ------------------------------------------------------------------ morph

test("morph: text edit keeps every element node", () => {
  const a = PAGE("<h1>Hello</h1><p>World <b>bold</b></p>");
  const b = PAGE("<h1>Hello there</h1><p>World <b>bold</b></p>");
  let h1;
  let p;
  const { live, next, stats } = roundTrip(a, b, {
    before: (d) => {
      h1 = find(d, parseHtml(a).elements.find((e) => e.tag === "h1").id);
      p = find(d, parseHtml(a).elements.find((e) => e.tag === "p").id);
    },
  });
  assert.equal(serialize(live), serialize(next));
  assert.equal(h1.childNodes[0].nodeValue, "Hello there");
  assert.ok(p.parentNode, "the paragraph is the same node");
  assert.deepEqual(stats, { inserted: 0, removed: 0, moved: 0, text: 1 });
});

test("morph: inserting and deleting elements renumbers the rest", () => {
  const a = PAGE("<main><p>one</p><p>three</p></main><footer>f</footer>");
  const b = PAGE("<main><p>one</p><p>two</p><p>three</p></main><footer>f</footer>");
  let footer;
  const { live, next } = roundTrip(a, b, { before: (d) => (footer = find(d, parseHtml(a).elements.find((e) => e.tag === "footer").id)) });
  assert.equal(serialize(live), serialize(next));
  assert.equal(footer.getAttribute("data-of"), String(parseHtml(b).elements.find((e) => e.tag === "footer").id));
  const back = roundTrip(b, a);
  assert.equal(serialize(back.live), serialize(back.next));
});

test("morph: nested inline tags, entities and attribute changes", () => {
  for (const [a, b] of [
    ["<p>a <b>b</b> c</p>", "<p>a <b>b <i>i</i></b> c</p>"],
    ["<p>a &amp; b</p>", "<p>a &amp;&amp; b</p>"],
    ['<div class="x" id="d"><span>s</span></div>', '<div class="y"><span>s</span></div>'],
    ["<ul><li>1</li><li>2</li></ul>", "<ul><li>1</li></ul>"],
    ["<p>x</p><p>y</p>", "<p>y</p>"],
  ]) {
    const r = roundTrip(PAGE(a), PAGE(b));
    assert.equal(serialize(r.live), serialize(r.next), `${a} -> ${b}`);
  }
});

test("morph: keeps nodes made by scripts and the inspector overlay", () => {
  const a = PAGE('<div id="app"><h1>t</h1></div>');
  const b = PAGE('<div id="app"><h1>title</h1></div>');
  let made;
  let overlay;
  roundTrip(a, b, {
    before: (d) => {
      const app = find(d, parseHtml(a).elements.find((e) => e.tag === "div").id);
      made = app.appendChild(new Node(1, "CANVAS"));
      overlay = app.appendChild(new Node(1, "DIV"));
      overlay.setAttribute("id", "__of_ov");
    },
    keep: (n) => n.nodeType === 1 && n.getAttribute("id") === "__of_ov",
    after: () => {
      assert.ok(made.parentNode, "the script-made element stays");
      assert.ok(overlay.parentNode, "the overlay stays");
    },
  });
});

test("morph: a frozen element (inline text editing) is left alone", () => {
  const kit = morphKit();
  const live = dom("<p>typing…</p>");
  const next = dom("<p>old</p>");
  kit.morph(live, next, { adopt: (n) => n.clone(), frozen: (n) => n.nodeName === "P" });
  assert.equal(serialize(live), '<p data-of="0">typing…</p>');
});

test("morph never re-creates or empties scripts", () => {
  const kit = morphKit();
  const live = dom('<body><script src="a.js">x</script></body>');
  const next = dom('<body><script src="b.js"></script></body>');
  kit.morph(live, next, { adopt: (n) => n.clone() });
  const s = live.childNodes[0].childNodes[0];
  assert.equal(s.getAttribute("src"), "b.js");
  assert.equal(s.childNodes[0].nodeValue, "x");
});

test("fuzz: random single edits either reload or morph to the exact new document", () => {
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  const base = PAGE('<header class="h"><nav><a href="/">Home</a> <a href="/b">B</a></nav></header><main><h1>Title &amp; more</h1><p>Some <b>bold</b> and <i>it</i>.</p><ul><li>1</li><li>2</li></ul></main><footer>f</footer>');
  const bits = ["<p>x</p>", "<b>", "</b>", "a", " ", "<li>3", "</li>", "&lt;", '<span class="s">s</span>', "<div>", "</div>", ""];
  let patched = 0;
  for (let n = 0; n < 1500; n++) {
    const at = rnd(base.length);
    const len = rnd(6);
    const b = base.slice(0, at) + bits[rnd(bits.length)] + base.slice(at + len);
    const plan = planPagePatch(base, b);
    if (plan.kind !== "patch") continue;
    patched++;
    const live = dom(base);
    const next = dom(b);
    const kit = morphKit();
    kit.renumber(live, plan.keep, plan.removed, plan.added);
    const L = plan.root == null ? live : find(live, plan.root);
    const N = plan.root == null ? next : find(next, plan.root);
    kit.morph(L, N, { adopt: (x) => x.clone() });
    assert.equal(serialize(live), serialize(next), `edit at ${at}: ${JSON.stringify(b.slice(at - 5, at + 20))}`);
  }
  assert.ok(patched > 500, `most edits patch (${patched})`);
});
