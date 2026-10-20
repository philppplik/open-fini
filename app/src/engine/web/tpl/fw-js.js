import { BASE_CSS, CDN, fx, header, importMap, page } from "./fw-shared.js";

const STYLE = `  <link rel="stylesheet" href="css/style.css">\n`;
const wrapMain = (name, inner) => `${header(name)}\n  <main id="main" class="container">\n${inner}\n  </main>`;

// ------------------------------------------------------------------------------------------------ Alpine.js

const alpine = {
  id: "alpine",
  name: "Alpine.js",
  description: "Interactive components with Alpine.js attributes: counter, to-do list and tabs. CSP-safe build.",
  category: "Framework",
  accent: "#2b6cb0",
  framework: true,
  libs: ["Alpine.js 3 CSP build (CDN)"],
  files: {
    "index.html": page({
      title: "Alpine.js starter",
      description: "Counter, to-do list and tabs built with Alpine.js attributes and no build step.",
      head: `${STYLE}  <style>[x-cloak] { display: none !important; }</style>\n  <script src="js/app.js"></script>\n  <script defer src="${CDN.alpine}"></script>\n`,
      body: wrapMain(
        "Alpine starter",
        `    <h1>Alpine.js</h1>
    <p class="lead">Behavior lives in HTML attributes. This build is the CSP-safe one, so components are registered with <code>Alpine.data()</code> in js/app.js.</p>
    <div class="grid">
      <section class="card" x-data="counter">
        <h2>Counter</h2>
        <p>Count: <strong x-text="count"></strong></p>
        <div class="row"><button type="button" @click="decrement">&minus;</button><button type="button" class="primary" @click="increment">+</button><button type="button" @click="reset">Reset</button></div>
      </section>
      <section class="card" x-data="todos">
        <h2>To-do list</h2>
        <form class="row" @submit.prevent="add"><input type="text" :value="draft" @input="setDraft" aria-label="New task" placeholder="Add a task"><button type="submit" class="primary">Add</button></form>
        <ul class="plain">
          <template x-for="task in tasks" :key="task.id">
            <li class="row"><input type="checkbox" :checked="task.done" :data-id="task.id" @change="toggle" :aria-label="task.title"><span :class="task.cls" x-text="task.title"></span></li>
          </template>
        </ul>
        <p class="muted"><span x-text="remaining"></span> open</p>
      </section>
      <section class="card" x-data="tabs">
        <h2>Tabs</h2>
        <div class="row" role="tablist" aria-label="Examples">
          <button type="button" role="tab" @click="showFirst" :aria-selected="firstSelected">First</button>
          <button type="button" role="tab" @click="showSecond" :aria-selected="secondSelected">Second</button>
        </div>
        <p role="tabpanel" :hidden="secondSelected">The first panel.</p>
        <p role="tabpanel" :hidden="firstSelected">The second panel.</p>
      </section>
    </div>`,
      ),
    }),
    "css/style.css": BASE_CSS,
    "js/app.js": `// Components for Alpine's CSP build: inline expressions such as x-data="{ open: false }" are not allowed there,
// so each component is registered by name and used as x-data="name". This file must load before Alpine.
document.addEventListener("alpine:init", function () {
  Alpine.data("counter", function () {
    return {
      count: 0,
      increment: function () { this.count++; },
      decrement: function () { this.count--; },
      reset: function () { this.count = 0; },
    };
  });

  Alpine.data("todos", function () {
    return {
      draft: "",
      next: 3,
      // "cls" is stored on each task because the CSP build cannot call methods with arguments in attributes
      tasks: [
        { id: 1, title: "Read the Alpine docs", done: true, cls: "done" },
        { id: 2, title: "Build something small", done: false, cls: "" },
      ],
      get remaining() { return this.tasks.filter(function (t) { return !t.done; }).length; },
      setDraft: function (event) { this.draft = event.target.value; },
      add: function () {
        var title = this.draft.trim();
        if (!title) return;
        this.tasks.push({ id: this.next++, title: title, done: false, cls: "" });
        this.draft = "";
      },
      toggle: function (event) {
        var id = Number(event.target.dataset.id);
        var task = this.tasks.find(function (t) { return t.id === id; });
        if (!task) return;
        task.done = !task.done;
        task.cls = task.done ? "done" : "";
      },
    };
  });

  Alpine.data("tabs", function () {
    return {
      current: "first",
      showFirst: function () { this.current = "first"; },
      showSecond: function () { this.current = "second"; },
      get firstSelected() { return this.current === "first"; },
      get secondSelected() { return this.current === "second"; },
    };
  });
});
`,
  },
};

// ------------------------------------------------------------------------------------------------ htmx

const htmx = {
  id: "htmx",
  name: "htmx",
  description: "HTML-over-the-wire interactions with hx-* attributes and an in-page mock server you can replace.",
  category: "Framework",
  accent: "#3366cc",
  framework: true,
  libs: ["htmx 2 (CDN)"],
  files: {
    "index.html": page({
      title: "htmx starter",
      description: "Click-to-load, search-as-you-type and an inline form with htmx. A tiny mock server answers the requests.",
      head: `${STYLE}  <meta name="htmx-config" content='{"allowEval": false}'>\n  <script src="${CDN.htmx}" defer></script>\n  <script src="js/mock-server.js" defer></script>\n`,
      body: wrapMain(
        "htmx starter",
        `    <h1>htmx</h1>
    <p class="lead">Elements with <code>hx-get</code> or <code>hx-post</code> request HTML and swap it into the page. Here a small script (js/mock-server.js) plays the server, so everything works offline. Delete it and point the attributes at a real server when you have one.</p>
    <div class="grid">
      <section class="card">
        <h2>Click to load</h2>
        <button type="button" class="primary" hx-get="/api/greeting" hx-target="#greeting" hx-swap="innerHTML">Say hello</button>
        <p id="greeting" aria-live="polite" class="muted">Nothing loaded yet.</p>
      </section>
      <section class="card">
        <h2>Search as you type</h2>
        <input type="search" name="q" aria-label="Search fruit" placeholder="Try &ldquo;an&rdquo;" hx-get="/api/search" hx-trigger="input changed delay:250ms" hx-target="#results">
        <ul id="results" class="plain" aria-live="polite"></ul>
      </section>
      <section class="card">
        <h2>Add an item</h2>
        <form hx-post="/api/items" hx-target="#items" hx-swap="beforeend" class="row">
          <input type="text" name="name" aria-label="Item name" placeholder="Item name" required>
          <button type="submit" class="primary">Add</button>
        </form>
        <ul id="items" class="plain"></ul>
      </section>
    </div>
    <template data-route="GET /api/greeting"><strong>Hello from the mock server!</strong> It is {{time}}.</template>
`,
      ),
    }),
    "css/style.css": BASE_CSS,
    "js/mock-server.js": `// A stand-in for a server. It answers htmx requests in the page itself, so the template works without a backend.
// Remove this file (and the <script> tag) when your hx-get / hx-post attributes point at a real server.
// On a static host you can also serve HTML fragments from files, for example hx-get="fragments/hello.html".
(function () {
  var FRUIT = ["Apple", "Apricot", "Banana", "Blueberry", "Cherry", "Mango", "Orange", "Papaya", "Peach", "Pear", "Plum"];

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var routes = {
    "GET /api/greeting": function () {
      var t = document.querySelector('template[data-route="GET /api/greeting"]');
      return t.innerHTML.replace("{{time}}", new Date().toLocaleTimeString());
    },
    "GET /api/search": function (params) {
      var q = String(params.q || "").trim().toLowerCase();
      if (!q) return "";
      var hits = FRUIT.filter(function (f) { return f.toLowerCase().indexOf(q) !== -1; });
      if (!hits.length) return '<li class="muted">No matches.</li>';
      return hits.map(function (f) { return "<li>" + escapeHtml(f) + "</li>"; }).join("");
    },
    "POST /api/items": function (params) {
      var name = String(params.name || "").trim();
      return name ? '<li class="card">' + escapeHtml(name) + "</li>" : "";
    },
  };

  document.addEventListener("htmx:beforeRequest", function (event) {
    var cfg = event.detail.requestConfig;
    var path = String(cfg.path || "").split("?")[0];
    var handler = routes[String(cfg.verb).toUpperCase() + " " + path];
    if (!handler) return; // not ours: let htmx send a real request
    event.preventDefault();
    var target = event.detail.target;
    var html = handler(cfg.parameters || {});
    var swap = (event.detail.elt.getAttribute("hx-swap") || "innerHTML").split(" ")[0];
    if (swap === "beforeend") target.insertAdjacentHTML("beforeend", html);
    else if (swap === "afterbegin") target.insertAdjacentHTML("afterbegin", html);
    else target.innerHTML = html;
    htmx.process(target);
    if (event.detail.elt.tagName === "FORM") event.detail.elt.reset();
  });
})();
`,
  },
};

// ------------------------------------------------------------------------------------------------ Vue

const vue = {
  id: "vue",
  name: "Vue 3",
  description: "Vue 3 as ES modules with an import map. Components use render functions, so it also runs under strict CSPs.",
  category: "Framework",
  accent: "#42b883",
  framework: true,
  libs: ["Vue 3 runtime (CDN)"],
  files: {
    "index.html": page({
      title: "Vue 3 starter",
      description: "A Vue 3 app without a build step: ES modules, an import map and render functions.",
      head: `${importMap({ vue: CDN.vue })}${STYLE}  <script type="module" src="js/main.js"></script>\n`,
      body: `${header("Vue 3 starter")}\n  <main id="main" class="container">\n    <div id="app"><p class="muted">Loading&hellip;</p></div>\n    <noscript>This page needs JavaScript.</noscript>\n  </main>`,
    }),
    "css/style.css": BASE_CSS,
    "js/main.js": `import { createApp } from "vue";
import App from "./App.js";

createApp(App).mount("#app");
`,
    "js/App.js": `import { h } from "vue";
import CounterButton from "./components/CounterButton.js";
import TaskList from "./components/TaskList.js";

// Components are plain objects. h() builds elements; this runtime-only build of Vue needs no template compiler,
// so it works even where the Content-Security-Policy forbids eval.
export default {
  name: "App",
  render() {
    return h("div", [
      h("h1", "Vue 3"),
      h("p", { class: "lead" }, "State lives in refs, the UI is a function of that state."),
      h("div", { class: "grid" }, [h(CounterButton, { label: "Clicked" }), h(TaskList)]),
    ]);
  },
};
`,
    "js/components/CounterButton.js": `import { h, ref } from "vue";

export default {
  name: "CounterButton",
  props: { label: { type: String, default: "Count" } },
  setup(props) {
    const count = ref(0);
    return () =>
      h("section", { class: "card" }, [
        h("h2", "Counter"),
        h("p", [props.label + ": ", h("strong", String(count.value))]),
        h("button", { type: "button", class: "primary", onClick: () => count.value++ }, "Add one"),
      ]);
  },
};
`,
    "js/components/TaskList.js": `import { h, ref, computed } from "vue";

export default {
  name: "TaskList",
  setup() {
    const draft = ref("");
    const tasks = ref([
      { id: 1, title: "Learn the Composition API", done: true },
      { id: 2, title: "Build a small app", done: false },
    ]);
    let nextId = 3;
    const open = computed(() => tasks.value.filter((t) => !t.done).length);

    function add(event) {
      event.preventDefault();
      const title = draft.value.trim();
      if (!title) return;
      tasks.value.push({ id: nextId++, title, done: false });
      draft.value = "";
    }

    return () =>
      h("section", { class: "card" }, [
        h("h2", "Tasks"),
        h("form", { class: "row", onSubmit: add }, [
          h("input", { type: "text", value: draft.value, "aria-label": "New task", placeholder: "Add a task", onInput: (e) => (draft.value = e.target.value) }),
          h("button", { type: "submit", class: "primary" }, "Add"),
        ]),
        h(
          "ul",
          { class: "plain" },
          tasks.value.map((task) =>
            h("li", { key: task.id, class: "row" }, [
              h("input", { type: "checkbox", checked: task.done, "aria-label": task.title, onChange: () => (task.done = !task.done) }),
              h("span", { class: task.done ? "done" : "" }, task.title),
            ]),
          ),
        ),
        h("p", { class: "muted" }, open.value + " open"),
      ]);
  },
};
`,
  },
};

// ------------------------------------------------------------------------------------------------ Preact + htm

const preact = {
  id: "preact-htm",
  name: "Preact + htm",
  description: "Preact with hooks and JSX-like tagged templates (htm). 4 KB, no compiler.",
  category: "Framework",
  accent: "#673ab8",
  framework: true,
  libs: ["Preact + htm (CDN)"],
  files: {
    "index.html": page({
      title: "Preact starter",
      description: "Preact components with hooks, written with htm tagged templates and no build step.",
      head: `${importMap({ "preact-htm": CDN.preact })}${STYLE}  <script type="module" src="js/main.js"></script>\n`,
      body: `${header("Preact starter")}\n  <main id="main" class="container"><div id="app"></div></main>`,
    }),
    "css/style.css": BASE_CSS,
    "js/main.js": fx(`import { html, render } from "preact-htm";
import { App } from "./App.js";

render(html@~<@{App} />@~, document.getElementById("app"));
`),
    "js/App.js": fx(`import { html } from "preact-htm";
import { Counter } from "./components/Counter.js";
import { Clock } from "./components/Clock.js";

export function App() {
  return html@~
    <h1>Preact + htm</h1>
    <p class="lead">Hooks, props and components in about 4 KB. Templates are tagged template literals, so no compiler is needed.</p>
    <div class="grid">
      <@{Counter} start=@{5} />
      <@{Clock} />
    </div>
  @~;
}
`),
    "js/components/Counter.js": fx(`import { html, useState } from "preact-htm";

export function Counter({ start = 0 }) {
  const [count, setCount] = useState(start);
  return html@~
    <section class="card">
      <h2>Counter</h2>
      <p>Count: <strong>@{count}</strong></p>
      <div class="row">
        <button type="button" onClick=@{() => setCount((c) => c - 1)}>&minus;</button>
        <button type="button" class="primary" onClick=@{() => setCount((c) => c + 1)}>+</button>
      </div>
    </section>
  @~;
}
`),
    "js/components/Clock.js": fx(`import { html, useEffect, useState } from "preact-htm";

export function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return html@~
    <section class="card">
      <h2>Clock</h2>
      <p aria-live="off">@{now.toLocaleTimeString()}</p>
      <p class="muted">An effect starts a timer and cleans it up.</p>
    </section>
  @~;
}
`),
  },
};

// ------------------------------------------------------------------------------------------------ React

const react = {
  id: "react",
  name: "React",
  description: "React 18 with hooks as ES modules from jsDelivr. Templates use htm, so there is no JSX compiler.",
  category: "Framework",
  accent: "#0ea5e9",
  framework: true,
  libs: ["React 18 + ReactDOM (CDN)", "htm"],
  files: {
    "index.html": page({
      title: "React starter",
      description: "React 18 components with hooks, loaded as ES modules from a CDN with an import map.",
      head: `${importMap({ react: CDN.react, "react-dom/client": CDN.reactDom, htm: CDN.htm })}${STYLE}  <script type="module" src="js/main.js"></script>\n`,
      body: `${header("React starter")}\n  <main id="main" class="container"><div id="root"></div></main>`,
    }),
    "css/style.css": BASE_CSS,
    "js/html.js": `import React from "react";
import htm from "htm";

// htm gives JSX-like syntax with tagged templates: html\`<\${Component} prop=\${value}>text</\${Component}>\`.
export const html = htm.bind(React.createElement);
`,
    "js/main.js": fx(`import { createRoot } from "react-dom/client";
import { html } from "./html.js";
import { App } from "./App.js";

createRoot(document.getElementById("root")).render(html@~<@{App} />@~);
`),
    "js/App.js": fx(`import { html } from "./html.js";
import { Counter } from "./components/Counter.js";
import { FilterList } from "./components/FilterList.js";

export function App() {
  return html@~
    <div>
      <h1>React 18</h1>
      <p className="lead">Hooks and components, delivered as ES modules. Edit the files in js/ and the preview updates.</p>
      <div className="grid">
        <@{Counter} />
        <@{FilterList} items=@{["Apple", "Banana", "Cherry", "Mango", "Orange", "Papaya"]} />
      </div>
    </div>
  @~;
}
`),
    "js/components/Counter.js": fx(`import { useState } from "react";
import { html } from "../html.js";

export function Counter() {
  const [count, setCount] = useState(0);
  return html@~
    <section className="card">
      <h2>Counter</h2>
      <p>Count: <strong>@{count}</strong></p>
      <button type="button" className="primary" onClick=@{() => setCount((c) => c + 1)}>Add one</button>
    </section>
  @~;
}
`),
    "js/components/FilterList.js": fx(`import { useMemo, useState } from "react";
import { html } from "../html.js";

export function FilterList({ items }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => items.filter((i) => i.toLowerCase().includes(query.toLowerCase())), [items, query]);
  return html@~
    <section className="card">
      <h2>Filter</h2>
      <input type="search" aria-label="Filter fruit" placeholder="Type to filter" value=@{query} onChange=@{(e) => setQuery(e.target.value)} />
      <ul className="plain">@{shown.map((i) => html@~<li key=@{i}>@{i}</li>@~)}</ul>
    </section>
  @~;
}
`),
  },
};

// ------------------------------------------------------------------------------------------------ Lit

const lit = {
  id: "lit",
  name: "Lit web components",
  description: "Reusable custom elements with Lit: reactive properties, scoped styles and slots.",
  category: "Framework",
  accent: "#324fff",
  framework: true,
  libs: ["Lit 3 (CDN)"],
  files: {
    "index.html": page({
      title: "Lit starter",
      description: "Custom elements built with Lit, loaded as ES modules from a CDN.",
      head: `${importMap({ lit: CDN.lit })}${STYLE}  <script type="module" src="js/main.js"></script>\n`,
      body: wrapMain(
        "Lit starter",
        `    <h1>Lit</h1>
    <p class="lead">Custom elements are real HTML elements: use them anywhere, with attributes and slots.</p>
    <div class="grid">
      <my-counter label="Clicks" count="3"></my-counter>
      <info-card heading="Scoped styles"><p>Styles inside the component do not leak out.</p></info-card>
      <info-card heading="Slots"><p>Children are projected into the card.</p></info-card>
    </div>`,
      ),
    }),
    "css/style.css": BASE_CSS,
    "js/main.js": `import "./components/my-counter.js";
import "./components/info-card.js";
`,
    "js/components/my-counter.js": fx(`import { LitElement, html, css } from "lit";

export class MyCounter extends LitElement {
  static properties = { label: { type: String }, count: { type: Number } };

  static styles = css@~
    :host { display: block; border: 1px solid var(--border, #ccc); border-radius: 12px; padding: 1.25rem; background: var(--surface, #f5f5f5); }
    h2 { margin: 0 0 0.5rem; font-size: 1.25rem; }
    button { font: inherit; padding: 0.5rem 1rem; border-radius: 10px; border: 1px solid var(--accent, #4f46e5); background: var(--accent, #4f46e5); color: var(--accent-ink, #fff); cursor: pointer; }
  @~;

  constructor() {
    super();
    this.label = "Count";
    this.count = 0;
  }

  render() {
    return html@~
      <h2>Counter</h2>
      <p>@{this.label}: <strong>@{this.count}</strong></p>
      <button type="button" @click=@{() => this.count++}>Add one</button>
    @~;
  }
}

customElements.define("my-counter", MyCounter);
`),
    "js/components/info-card.js": fx(`import { LitElement, html, css } from "lit";

export class InfoCard extends LitElement {
  static properties = { heading: { type: String } };

  static styles = css@~
    :host { display: block; border: 1px solid var(--border, #ccc); border-radius: 12px; padding: 1.25rem; background: var(--surface, #f5f5f5); }
    h2 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  @~;

  constructor() {
    super();
    this.heading = "";
  }

  render() {
    return html@~<h2>@{this.heading}</h2><slot></slot>@~;
  }
}

customElements.define("info-card", InfoCard);
`),
  },
};

// ------------------------------------------------------------------------------------------------ Vanilla web components

const webcomponents = {
  id: "web-components",
  name: "Web components",
  description: "Dependency-free custom elements with Shadow DOM: a card, accessible tabs and a toggle.",
  category: "Framework",
  accent: "#e44d26",
  framework: true,
  libs: [],
  files: {
    "index.html": page({
      title: "Web components starter",
      description: "Vanilla custom elements with Shadow DOM, slots and events. No libraries.",
      head: `${STYLE}  <script type="module" src="js/main.js"></script>\n`,
      body: wrapMain(
        "Web components",
        `    <h1>Web components</h1>
    <p class="lead">The browser's own component model. Elements are defined in js/components/ and used like any HTML tag.</p>
    <div class="grid">
      <ui-card heading="Plain card"><p>Content goes into the default slot.</p></ui-card>
      <ui-toggle label="Notifications"></ui-toggle>
    </div>
    <ui-tabs>
      <button slot="tab" type="button">Overview</button>
      <div slot="panel">The overview panel.</div>
      <button slot="tab" type="button">Details</button>
      <div slot="panel">The details panel.</div>
    </ui-tabs>`,
      ),
    }),
    "css/style.css": BASE_CSS,
    "js/main.js": `import "./components/ui-card.js";
import "./components/ui-toggle.js";
import "./components/ui-tabs.js";
`,
    "js/components/ui-card.js": fx(`const template = document.createElement("template");
template.innerHTML = @~
  <style>
    :host { display: block; border: 1px solid var(--border, #ccc); border-radius: 12px; padding: 1.25rem; background: var(--surface, #f5f5f5); }
    h2 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  </style>
  <h2 part="title"></h2>
  <slot></slot>
@~;

class UiCard extends HTMLElement {
  static observedAttributes = ["heading"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
  }

  attributeChangedCallback() {
    this.shadowRoot.querySelector("h2").textContent = this.getAttribute("heading") || "";
  }
}

customElements.define("ui-card", UiCard);
`),
    "js/components/ui-toggle.js": fx(`const template = document.createElement("template");
template.innerHTML = @~
  <style>
    :host { display: block; border: 1px solid var(--border, #ccc); border-radius: 12px; padding: 1.25rem; background: var(--surface, #f5f5f5); }
    button { font: inherit; padding: 0.4rem 0.9rem; border-radius: 999px; border: 1px solid var(--border, #ccc); background: transparent; color: inherit; cursor: pointer; }
    button[aria-checked="true"] { background: var(--accent, #4f46e5); color: var(--accent-ink, #fff); border-color: var(--accent, #4f46e5); }
  </style>
  <span id="label"></span>
  <button type="button" role="switch" aria-checked="false">Off</button>
@~;

class UiToggle extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    this.button = this.shadowRoot.querySelector("button");
    this.button.addEventListener("click", () => this.toggle());
  }

  connectedCallback() {
    this.shadowRoot.getElementById("label").textContent = this.getAttribute("label") || "";
  }

  toggle() {
    const on = this.button.getAttribute("aria-checked") !== "true";
    this.button.setAttribute("aria-checked", String(on));
    this.button.textContent = on ? "On" : "Off";
    this.dispatchEvent(new CustomEvent("change", { detail: { on }, bubbles: true }));
  }
}

customElements.define("ui-toggle", UiToggle);
`),
    "js/components/ui-tabs.js": fx(`const template = document.createElement("template");
template.innerHTML = @~
  <style>
    :host { display: block; margin-top: 1.5rem; }
    .tabs { display: flex; gap: 0.5rem; border-bottom: 1px solid var(--border, #ccc); }
    ::slotted([slot="tab"]) { font: inherit; padding: 0.5rem 1rem; border: 0; background: transparent; color: inherit; cursor: pointer; border-bottom: 2px solid transparent; }
    ::slotted([slot="tab"][aria-selected="true"]) { border-bottom-color: var(--accent, #4f46e5); font-weight: 600; }
    ::slotted([slot="panel"]) { display: none; padding: 1rem 0; }
    ::slotted([slot="panel"][data-active]) { display: block; }
  </style>
  <div class="tabs" role="tablist"><slot name="tab"></slot></div>
  <slot name="panel"></slot>
@~;

class UiTabs extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
  }

  connectedCallback() {
    this.tabs = [...this.querySelectorAll('[slot="tab"]')];
    this.panels = [...this.querySelectorAll('[slot="panel"]')];
    this.tabs.forEach((tab, i) => {
      tab.setAttribute("role", "tab");
      tab.addEventListener("click", () => this.select(i));
      tab.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") this.select((i + 1) % this.tabs.length, true);
        if (e.key === "ArrowLeft") this.select((i - 1 + this.tabs.length) % this.tabs.length, true);
      });
    });
    this.panels.forEach((p) => p.setAttribute("role", "tabpanel"));
    this.select(0);
  }

  select(index, focus = false) {
    this.tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      if (i === index && focus) tab.focus();
    });
    this.panels.forEach((panel, i) => panel.toggleAttribute("data-active", i === index));
  }
}

customElements.define("ui-tabs", UiTabs);
`),
  },
};

// ------------------------------------------------------------------------------------------------ Three.js

const three = {
  id: "three",
  name: "Three.js scene",
  description: "A 3D scene with lights and a rotating knot. Drag to rotate; honors reduced motion.",
  category: "Framework",
  accent: "#049ef4",
  framework: true,
  libs: ["Three.js r170 (CDN)"],
  files: {
    "index.html": page({
      title: "Three.js starter",
      description: "A WebGL scene built with Three.js as an ES module, with drag-to-rotate and a wireframe toggle.",
      head: `${importMap({ three: CDN.three })}${STYLE}  <link rel="stylesheet" href="css/scene.css">\n  <script type="module" src="js/main.js"></script>\n`,
      body: `${header("Three.js starter")}
  <main id="main" class="container">
    <h1>Three.js</h1>
    <p class="lead">Drag the scene to rotate it. The canvas resizes with the page.</p>
    <div class="stage" id="stage" role="img" aria-label="A rotating 3D torus knot"></div>
    <div class="row">
      <button type="button" id="pause" aria-pressed="false">Pause</button>
      <button type="button" id="wire" aria-pressed="false">Wireframe</button>
      <span class="muted" id="status" role="status"></span>
    </div>
  </main>`,
    }),
    "css/style.css": BASE_CSS,
    "css/scene.css": `.stage {
  position: relative;
  height: min(60vh, 480px);
  margin-bottom: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: radial-gradient(circle at 50% 40%, #2a2f45, #0f1118);
  touch-action: none;
  cursor: grab;
}

.stage:active { cursor: grabbing; }
.stage canvas { display: block; width: 100%; height: 100%; }
`,
    "js/main.js": `import * as THREE from "three";

const stage = document.getElementById("stage");
const status = document.getElementById("status");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (error) {
  status.textContent = "WebGL is not available in this browser.";
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.append(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 6);

const group = new THREE.Group();
scene.add(group);

const knot = new THREE.Mesh(
  new THREE.TorusKnotGeometry(1.2, 0.38, 160, 24),
  new THREE.MeshStandardMaterial({ color: 0x8b87ff, metalness: 0.35, roughness: 0.3 }),
);
group.add(knot);

const ring = new THREE.Mesh(
  new THREE.IcosahedronGeometry(2.4, 1),
  new THREE.MeshBasicMaterial({ color: 0x4f46e5, wireframe: true, transparent: true, opacity: 0.25 }),
);
group.add(ring);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 5, 6);
scene.add(sun);

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

// Drag to rotate.
let dragging = false;
let last = { x: 0, y: 0 };
stage.addEventListener("pointerdown", (e) => {
  dragging = true;
  last = { x: e.clientX, y: e.clientY };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  group.rotation.y += (e.clientX - last.x) * 0.01;
  group.rotation.x += (e.clientY - last.y) * 0.01;
  last = { x: e.clientX, y: e.clientY };
  if (paused) draw();
});
stage.addEventListener("pointerup", () => (dragging = false));

let paused = reduceMotion;
const pause = document.getElementById("pause");
const wire = document.getElementById("wire");
pause.setAttribute("aria-pressed", String(paused));
pause.textContent = paused ? "Play" : "Pause";
pause.addEventListener("click", () => {
  paused = !paused;
  pause.setAttribute("aria-pressed", String(paused));
  pause.textContent = paused ? "Play" : "Pause";
});
wire.addEventListener("click", () => {
  knot.material.wireframe = !knot.material.wireframe;
  wire.setAttribute("aria-pressed", String(knot.material.wireframe));
  if (paused) draw();
});

function draw() {
  renderer.render(scene, camera);
}

function frame() {
  if (!paused && !dragging) {
    group.rotation.y += 0.006;
    knot.rotation.x += 0.004;
  }
  draw();
  requestAnimationFrame(frame);
}
frame();
status.textContent = "Three.js r" + THREE.REVISION;
`,
  },
};

export const FRAMEWORK_JS_TEMPLATES = [alpine, htmx, vue, preact, react, lit, webcomponents, three];
