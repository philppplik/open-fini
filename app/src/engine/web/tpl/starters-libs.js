// Starters built on one library loaded from a CDN with a pinned version (engine/web/starters.js). The preview needs a
// network connection for these; Code > Libraries can download the files into the project (vendor/) for offline use.
import { page, BASE_CSS } from "./fw-shared.js";

export const LIB_CDN = {
  phaser: "https://cdn.jsdelivr.net/npm/phaser@3.87.0/dist/phaser.min.js",
  p5: "https://cdn.jsdelivr.net/npm/p5@1.11.2/lib/p5.min.js",
  chartjs: "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js",
  leafletCss: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
  leaflet: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
  d3: "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm",
  pico: "https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.min.css",
  bulma: "https://cdn.jsdelivr.net/npm/bulma@1.0.2/css/bulma.min.css",
  mithril: "https://cdn.jsdelivr.net/npm/mithril@2.2.2/mithril.min.js",
  jquery: "https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js",
};

const project = (title, description, { head = "", body, css = "", js = null, module = false }) => ({
  "index.html": page({ title, description, head: `${head}  <link rel="stylesheet" href="css/style.css">\n${js ? `  <script src="js/main.js"${module ? ' type="module"' : " defer"}></script>\n` : ""}`, body }),
  "css/style.css": css,
  ...(js ? { "js/main.js": js } : {}),
});
const script = (src) => `  <script src="${src}" defer></script>\n`;

const phaser = project("Phaser game", "A platformer starting point with Phaser.", {
  head: script(LIB_CDN.phaser),
  body: `<main id="game" aria-label="Game. Arrow keys move, up jumps."></main>`,
  css: "body { margin: 0; background: #0b1020; display: grid; place-items: center; min-height: 100vh; }\n",
  js: `// A minimal Phaser 3 scene: platforms drawn as rectangles, a player with arcade physics, coins to collect.
class Play extends Phaser.Scene {
  create() {
    this.platforms = this.physics.add.staticGroup();
    for (const [x, y, w] of [[400, 584, 800], [600, 420, 200], [160, 320, 200], [520, 220, 160]]) {
      this.platforms.add(this.add.rectangle(x, y, w, 24, 0x334155));
    }
    this.player = this.add.rectangle(100, 450, 28, 40, 0x38bdf8);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.platforms);
    this.coins = this.physics.add.staticGroup();
    for (const [x, y] of [[600, 380], [160, 280], [520, 180], [740, 540]]) this.coins.add(this.add.circle(x, y, 10, 0xfacc15));
    this.score = 0;
    this.label = this.add.text(16, 16, "Coins: 0", { color: "#e2e8f0", fontSize: "20px" });
    this.physics.add.overlap(this.player, this.coins, (p, coin) => {
      coin.destroy();
      this.label.setText("Coins: " + ++this.score);
    });
    this.keys = this.input.keyboard.createCursorKeys();
  }
  update() {
    const body = this.player.body;
    body.setVelocityX(this.keys.left.isDown ? -220 : this.keys.right.isDown ? 220 : 0);
    if (this.keys.up.isDown && body.blocked.down) body.setVelocityY(-430);
  }
}

new Phaser.Game({ type: Phaser.AUTO, width: 800, height: 600, parent: "game", backgroundColor: "#0b1020", physics: { default: "arcade", arcade: { gravity: { y: 900 } } }, scene: Play });
`,
});

const p5 = project("p5.js sketch", "Creative coding with p5.js.", {
  head: script(LIB_CDN.p5),
  body: `<main><p>Move the mouse. Click to clear.</p></main>`,
  css: "body { margin: 0; background: #111; color: #eee; font-family: system-ui, sans-serif; }\nmain { position: fixed; left: 12px; top: 8px; }\n",
  js: `// p5.js global mode: setup() runs once, draw() every frame.
let hue = 0;

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100, 1);
  background(0);
  noStroke();
}

function draw() {
  hue = (hue + 1) % 360;
  fill(hue, 80, 100, 0.6);
  const size = 10 + dist(mouseX, mouseY, pmouseX, pmouseY) * 1.5;
  circle(mouseX, mouseY, size);
}

function mousePressed() {
  background(0);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
`,
});

const chartjs = project("Dashboard", "A small dashboard with Chart.js.", {
  head: script(LIB_CDN.chartjs),
  body: `<main class="dash">
  <h1>Sales dashboard</h1>
  <div class="kpis"><div class="card"><span>Revenue</span><b>€48,200</b></div><div class="card"><span>Orders</span><b>1,284</b></div><div class="card"><span>Conversion</span><b>3.4 %</b></div></div>
  <div class="charts">
    <div class="card"><canvas id="line" aria-label="Revenue per month"></canvas></div>
    <div class="card"><canvas id="bar" aria-label="Orders per channel"></canvas></div>
    <div class="card"><canvas id="pie" aria-label="Share per region"></canvas></div>
  </div>
</main>`,
  css: `${BASE_CSS}
.dash { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px; }
.kpis span { display: block; color: var(--muted); }
.kpis b { font-size: 28px; }
.charts { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
.charts .card:first-child { grid-column: 1 / -1; }

@media (max-width: 767px) {
  .kpis, .charts { grid-template-columns: 1fr; }
}
`,
  js: `// Three Chart.js charts from inline data; replace the arrays with your own numbers or a fetch().
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
new Chart(document.getElementById("line"), {
  type: "line",
  data: { labels: months, datasets: [{ label: "Revenue (€k)", data: [6.1, 7.4, 7.0, 8.3, 9.1, 10.3], tension: 0.3 }] },
});
new Chart(document.getElementById("bar"), {
  type: "bar",
  data: { labels: ["Web", "App", "Store", "Phone"], datasets: [{ label: "Orders", data: [640, 380, 190, 74] }] },
});
new Chart(document.getElementById("pie"), {
  type: "doughnut",
  data: { labels: ["North", "South", "East", "West"], datasets: [{ data: [34, 22, 26, 18] }] },
});
`,
});

const leaflet = project("Map", "An interactive map with Leaflet.", {
  head: `  <link rel="stylesheet" href="${LIB_CDN.leafletCss}">\n${script(LIB_CDN.leaflet)}`,
  body: `<header><h1>Places</h1></header>\n<main id="map" aria-label="Map"></main>`,
  css: "body { margin: 0; font-family: system-ui, sans-serif; display: grid; grid-template-rows: auto 1fr; height: 100vh; }\nheader { padding: 8px 16px; }\nheader h1 { margin: 0; font-size: 20px; }\n#map { min-height: 300px; }\n",
  js: `// Leaflet map with OpenStreetMap tiles (keep the attribution) and a few markers.
const map = L.map("map").setView([48.8566, 2.3522], 12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const places = [
  [48.8584, 2.2945, "Eiffel Tower"],
  [48.8606, 2.3376, "Louvre"],
  [48.853, 2.3499, "Notre-Dame"],
];
for (const [lat, lng, name] of places) L.marker([lat, lng]).addTo(map).bindPopup(name);
`,
});

const d3 = project("Data visualization", "A bar chart with D3.", {
  body: `<main><h1>Fruit sold this week</h1><svg id="chart" width="640" height="360" role="img" aria-label="Bar chart"></svg></main>`,
  css: `${BASE_CSS}\nmain { max-width: 700px; margin: 24px auto; padding: 0 16px; }\nsvg { max-width: 100%; height: auto; }\n.bar { fill: var(--accent); }\n.bar:hover { opacity: 0.8; }\n`,
  module: true,
  js: `// D3 as an ES module: scales, axes and one rect per datum.
import * as d3 from "${LIB_CDN.d3}";

const data = [
  { name: "Apples", value: 42 },
  { name: "Bananas", value: 31 },
  { name: "Cherries", value: 18 },
  { name: "Grapes", value: 27 },
  { name: "Pears", value: 12 },
];
const svg = d3.select("#chart");
const width = +svg.attr("width");
const height = +svg.attr("height");
const m = { top: 20, right: 20, bottom: 40, left: 40 };
const x = d3.scaleBand().domain(data.map((d) => d.name)).range([m.left, width - m.right]).padding(0.2);
const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d.value)]).nice().range([height - m.bottom, m.top]);
svg.append("g").attr("transform", "translate(0," + (height - m.bottom) + ")").call(d3.axisBottom(x));
svg.append("g").attr("transform", "translate(" + m.left + ",0)").call(d3.axisLeft(y));
svg.selectAll("rect").data(data).join("rect").attr("class", "bar").attr("x", (d) => x(d.name)).attr("y", (d) => y(d.value)).attr("width", x.bandwidth()).attr("height", (d) => y(0) - y(d.value)).append("title").text((d) => d.name + ": " + d.value);
`,
});

const pico = project("Pico CSS site", "Semantic HTML styled by Pico CSS.", {
  head: `  <link rel="stylesheet" href="${LIB_CDN.pico}">\n`,
  body: `<header class="container"><nav><ul><li><strong>Brand</strong></li></ul><ul><li><a href="#">About</a></li><li><a href="#contact" role="button">Contact</a></li></ul></nav></header>
<main class="container">
  <hgroup><h1>Write HTML, get a design</h1><p>Pico styles plain elements: no classes needed.</p></hgroup>
  <div class="grid">
    <article><h3>Fast</h3><p>One small stylesheet.</p></article>
    <article><h3>Accessible</h3><p>Semantic elements first.</p></article>
    <article><h3>Dark mode</h3><p>Follows the system automatically.</p></article>
  </div>
  <section id="contact">
    <h2>Contact</h2>
    <form><label>Email <input type="email" name="email" required></label><label>Message <textarea name="message"></textarea></label><button type="submit">Send</button></form>
  </section>
</main>`,
  css: "/* Your own rules go here; Pico's variables (--pico-primary ...) can be overridden in :root. */\n",
});

const bulma = project("Bulma site", "A landing page with Bulma.", {
  head: `  <link rel="stylesheet" href="${LIB_CDN.bulma}">\n`,
  body: `<section class="hero is-primary is-medium">
  <div class="hero-body"><div class="container"><p class="title">Build faster with Bulma</p><p class="subtitle">A modern CSS framework based on Flexbox.</p><a class="button is-light" href="#features">Learn more</a></div></div>
</section>
<section class="section" id="features">
  <div class="container">
    <div class="columns">
      <div class="column"><div class="box"><h3 class="title is-5">Responsive</h3><p>Columns stack on small screens.</p></div></div>
      <div class="column"><div class="box"><h3 class="title is-5">Modular</h3><p>Only the components you need.</p></div></div>
      <div class="column"><div class="box"><h3 class="title is-5">Readable</h3><p>Class names that say what they do.</p></div></div>
    </div>
  </div>
</section>
<footer class="footer"><div class="content has-text-centered"><p>Made with Bulma.</p></div></footer>`,
  css: "/* Your own rules go here. */\n",
});

const mithril = project("Mithril app", "A small single-page app with Mithril.", {
  head: script(LIB_CDN.mithril),
  body: `<main id="app" class="app"></main>`,
  css: `${BASE_CSS}\n.app { max-width: 560px; margin: 32px auto; padding: 0 16px; }\nnav a { margin-right: 12px; }\nnav a.active { font-weight: 700; }\n`,
  js: `// Mithril: components are objects with view(); m.route switches pages without reloading (no eval, works under strict CSP).
const state = { count: 0, todos: ["Read the Mithril docs"], text: "" };

const Nav = { view: () => m("nav", [m(m.route.Link, { href: "/" }, "Counter"), m(m.route.Link, { href: "/todos" }, "To-do")]) };

const Counter = {
  view: () => [m(Nav), m("h1", "Counter"), m("button", { onclick: () => state.count++ }, "Clicked " + state.count + " times")],
};

const Todos = {
  view: () => [
    m(Nav),
    m("h1", "To-do"),
    m("form", { onsubmit: (e) => { e.preventDefault(); if (state.text.trim()) state.todos.push(state.text.trim()); state.text = ""; } }, [
      m("input", { value: state.text, oninput: (e) => (state.text = e.target.value), "aria-label": "Task", placeholder: "Add a task" }),
      m("button", "Add"),
    ]),
    m("ul", state.todos.map((t) => m("li", t))),
  ],
};

m.route(document.getElementById("app"), "/", { "/": Counter, "/todos": Todos });
`,
});

const jquery = project("jQuery page", "Tabs, an accordion and a filtered list with jQuery.", {
  head: script(LIB_CDN.jquery),
  body: `<main class="page">
  <h1>jQuery widgets</h1>
  <div class="tabs" role="tablist"><button class="active" data-tab="one">One</button><button data-tab="two">Two</button></div>
  <div class="panel" id="one">First tab content.</div>
  <div class="panel" id="two" hidden>Second tab content.</div>
  <h2>Accordion</h2>
  <div class="acc"><h3>Question one</h3><p>Answer one.</p><h3>Question two</h3><p>Answer two.</p></div>
  <h2>Filter</h2>
  <input id="filter" placeholder="Filter fruit" aria-label="Filter">
  <ul id="fruit"><li>Apple</li><li>Banana</li><li>Cherry</li><li>Grape</li></ul>
</main>`,
  css: `${BASE_CSS}\n.page { max-width: 640px; margin: 24px auto; padding: 0 16px; }\n.tabs button { font: inherit; padding: 6px 14px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }\n.tabs .active { background: var(--accent); color: var(--accent-ink); }\n.panel { border: 1px solid var(--border); padding: 12px; }\n.acc h3 { cursor: pointer; margin: 8px 0; }\n.acc p { display: none; margin: 0 0 8px; }\n`,
  js: `// jQuery: event delegation, show/hide and filtering.
$(function () {
  $(".tabs").on("click", "button", function () {
    $(".tabs button").removeClass("active");
    $(this).addClass("active");
    $(".panel").attr("hidden", true);
    $("#" + $(this).data("tab")).attr("hidden", false);
  });
  $(".acc h3").on("click", function () {
    $(this).next("p").slideToggle(150);
  });
  $("#filter").on("input", function () {
    const q = $(this).val().toLowerCase();
    $("#fruit li").each(function () {
      $(this).toggle($(this).text().toLowerCase().includes(q));
    });
  });
});
`,
});

export const FILES = { phaser, p5, chartjs, leaflet, d3, pico, bulma, mithril, jquery };
