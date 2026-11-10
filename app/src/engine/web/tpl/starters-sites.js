// Static site starters (engine/web/starters.js): plain HTML and CSS, no external requests.
import { page, BASE_CSS } from "./fw-shared.js";

const css = (extra) => `${BASE_CSS}
.wrap { max-width: 960px; margin: 0 auto; padding: 0 20px; }
header.top, footer.bottom { padding: 20px 0; }
footer.bottom { color: var(--muted); border-top: 1px solid var(--border); margin-top: 48px; }
.btn { display: inline-block; padding: 10px 18px; border-radius: var(--radius); background: var(--accent); color: var(--accent-ink); text-decoration: none; font-weight: 600; border: 0; cursor: pointer; font: inherit; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
.grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
input, textarea, select { font: inherit; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); width: 100%; }
label { display: grid; gap: 4px; font-weight: 600; }

@media (max-width: 767px) {
  .wrap { padding: 0 16px; }
}
${extra}`;

const site = (title, description, body, extraCss, script) => ({
  "index.html": page({ title, description, head: `  <link rel="stylesheet" href="css/style.css">\n${script ? '  <script src="js/main.js" defer></script>\n' : ""}`, body }),
  "css/style.css": css(extraCss),
  ...(script ? { "js/main.js": script } : {}),
});

const resume = site(
  "Alex Morgan — Resume",
  "Resume of Alex Morgan, product designer.",
  `<main class="wrap resume">
  <header class="top">
    <h1>Alex Morgan</h1>
    <p class="role">Product designer · Berlin · <a href="mailto:alex@example.com">alex@example.com</a></p>
  </header>
  <section>
    <h2>Experience</h2>
    <article>
      <h3>Lead designer, Northwind <small>2021 – today</small></h3>
      <p>Led the redesign of the booking flow; conversion up 18 %.</p>
    </article>
    <article>
      <h3>Designer, Contoso <small>2017 – 2021</small></h3>
      <p>Built the design system used by six product teams.</p>
    </article>
  </section>
  <section>
    <h2>Skills</h2>
    <ul class="tags"><li>User research</li><li>Prototyping</li><li>Design systems</li><li>HTML and CSS</li></ul>
  </section>
  <section>
    <h2>Education</h2>
    <p>B.A. Interaction Design, 2017</p>
  </section>
</main>`,
  `.resume h3 small { color: var(--muted); font-weight: 400; margin-left: 8px; }
.role { color: var(--muted); margin-top: -8px; }
.tags { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.tags li { background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 2px 12px; }

@media print {
  a { color: inherit; text-decoration: none; }
  body { font-size: 12pt; }
}
`,
);

const restaurant = site(
  "Trattoria Sole",
  "Fresh pasta and wood-fired pizza in the old town.",
  `<header class="hero">
  <div class="wrap">
    <h1>Trattoria Sole</h1>
    <p>Fresh pasta and wood-fired pizza since 1998.</p>
    <a class="btn" href="#reserve">Reserve a table</a>
  </div>
</header>
<main class="wrap">
  <section id="menu">
    <h2>Menu</h2>
    <div class="grid">
      <div class="card"><h3>Tagliatelle al ragù</h3><p>Slow-cooked beef ragù.</p><strong>€14</strong></div>
      <div class="card"><h3>Pizza Margherita</h3><p>Tomato, fior di latte, basil.</p><strong>€11</strong></div>
      <div class="card"><h3>Tiramisù</h3><p>Made fresh every morning.</p><strong>€7</strong></div>
    </div>
  </section>
  <section id="hours" class="split">
    <div>
      <h2>Opening hours</h2>
      <dl><dt>Tue – Fri</dt><dd>12:00 – 22:00</dd><dt>Sat – Sun</dt><dd>12:00 – 23:00</dd><dt>Mon</dt><dd>Closed</dd></dl>
    </div>
    <div>
      <h2>Find us</h2>
      <address>Via Roma 12<br>00100 Rome</address>
    </div>
  </section>
  <section id="reserve">
    <h2>Reserve a table</h2>
    <form class="form">
      <label>Name <input name="name" required></label>
      <label>Date <input name="date" type="date" required></label>
      <label>Guests <input name="guests" type="number" min="1" max="12" value="2"></label>
      <button class="btn" type="submit">Request reservation</button>
    </form>
  </section>
</main>
<footer class="bottom"><div class="wrap">© Trattoria Sole</div></footer>`,
  `.hero { background: linear-gradient(135deg, #b45309, #f59e0b); color: #fff; padding: 80px 0; }
.hero .btn { background: #fff; color: #7c2d12; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; }
dd { margin: 0; }
.form { display: grid; gap: 12px; max-width: 420px; }

@media (max-width: 767px) {
  .split { grid-template-columns: 1fr; }
  .hero { padding: 48px 0; }
}
`,
);

const event = site(
  "FrontConf 2027",
  "A one-day conference about the web platform.",
  `<header class="hero">
  <div class="wrap">
    <p class="date">June 12, 2027 · Hamburg</p>
    <h1>FrontConf 2027</h1>
    <p>One day, one track, twelve talks about the web platform.</p>
    <a class="btn" href="#tickets">Get tickets</a>
  </div>
</header>
<main class="wrap">
  <section>
    <h2>Schedule</h2>
    <table class="schedule">
      <tr><th>09:00</th><td>Doors open and coffee</td></tr>
      <tr><th>10:00</th><td>Keynote: The next ten years of CSS</td></tr>
      <tr><th>11:30</th><td>Fast pages without frameworks</td></tr>
      <tr><th>14:00</th><td>Accessibility in practice</td></tr>
    </table>
  </section>
  <section>
    <h2>Speakers</h2>
    <div class="grid">
      <div class="card"><h3>Sam Lee</h3><p>CSS working group</p></div>
      <div class="card"><h3>Riya Patel</h3><p>Performance engineer</p></div>
      <div class="card"><h3>Jonas Weber</h3><p>Accessibility lead</p></div>
    </div>
  </section>
  <section id="tickets">
    <h2>Tickets</h2>
    <div class="grid">
      <div class="card"><h3>Early bird</h3><p class="price">€199</p></div>
      <div class="card"><h3>Regular</h3><p class="price">€299</p></div>
    </div>
  </section>
</main>
<footer class="bottom"><div class="wrap">FrontConf · hello@example.com</div></footer>`,
  `.hero { background: radial-gradient(circle at 20% 20%, #a78bfa, #4c1d95); color: #fff; padding: 88px 0; }
.hero .btn { background: #fff; color: #4c1d95; }
.date { text-transform: uppercase; letter-spacing: 0.08em; font-size: 14px; }
.schedule { width: 100%; border-collapse: collapse; }
.schedule th, .schedule td { text-align: left; padding: 10px; border-bottom: 1px solid var(--border); }
.schedule th { width: 90px; color: var(--muted); }
.price { font-size: 28px; font-weight: 700; margin: 0; }
`,
);

const product = site(
  "Lumen — Focus timer",
  "Lumen keeps your work sessions focused.",
  `<header class="top wrap nav"><strong>Lumen</strong><nav><a href="#features">Features</a> <a href="#pricing">Pricing</a> <a href="#faq">FAQ</a></nav></header>
<main>
  <section class="hero wrap">
    <h1>Do deep work, every day.</h1>
    <p>Lumen plans focus sessions, blocks distractions and shows your progress.</p>
    <a class="btn" href="#pricing">Start free</a>
  </section>
  <section id="features" class="wrap grid">
    <div class="card"><h3>Smart sessions</h3><p>Lengths adapt to your energy through the day.</p></div>
    <div class="card"><h3>Quiet mode</h3><p>Notifications wait until the session ends.</p></div>
    <div class="card"><h3>Weekly report</h3><p>See where your time went.</p></div>
  </section>
  <section id="pricing" class="wrap">
    <h2>Pricing</h2>
    <div class="grid">
      <div class="card"><h3>Free</h3><p class="price">€0</p><p>Three sessions a day.</p></div>
      <div class="card featured"><h3>Pro</h3><p class="price">€4 / month</p><p>Unlimited sessions and reports.</p></div>
    </div>
  </section>
  <section id="faq" class="wrap">
    <h2>FAQ</h2>
    <details><summary>Can I cancel any time?</summary><p>Yes, with one click.</p></details>
    <details><summary>Does it work offline?</summary><p>Yes, sessions sync later.</p></details>
  </section>
</main>
<footer class="bottom"><div class="wrap">© Lumen</div></footer>`,
  `.nav { display: flex; justify-content: space-between; align-items: center; }
.nav a { margin-left: 16px; color: var(--text); text-decoration: none; }
.hero { padding: 72px 20px; text-align: center; }
.hero h1 { font-size: clamp(32px, 6vw, 56px); margin: 0 0 12px; }
.price { font-size: 26px; font-weight: 700; margin: 0; }
.featured { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
details { border-bottom: 1px solid var(--border); padding: 12px 0; }
summary { cursor: pointer; font-weight: 600; }
`,
);

const comingSoon = site(
  "Something new is coming",
  "We are launching soon. Leave your email to hear first.",
  `<main class="center">
  <h1>Something new is coming</h1>
  <p class="count" id="count" aria-live="polite">–</p>
  <form class="signup" id="signup">
    <label class="sr" for="email">Email</label>
    <input id="email" type="email" placeholder="you@example.com" required>
    <button class="btn" type="submit">Notify me</button>
  </form>
  <p id="thanks" hidden>Thanks! We will write to you at launch.</p>
</main>`,
  `body { min-height: 100vh; display: grid; place-items: center; background: linear-gradient(160deg, #fdf2f8, #fbcfe8); color: #500724; }
.center { text-align: center; padding: 24px; }
.count { font-size: clamp(28px, 7vw, 64px); font-weight: 800; font-variant-numeric: tabular-nums; }
.signup { display: flex; gap: 8px; max-width: 420px; margin: 0 auto; }
.btn { background: #db2777; color: #fff; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`,
  `// Countdown to the launch date and a sign-up form that only says thank you (connect it to your mail service).
const launch = new Date(Date.now() + 30 * 864e5);
const count = document.getElementById("count");
function tick() {
  const s = Math.max(0, Math.floor((launch - Date.now()) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  count.textContent = d + "d " + h + "h " + m + "m " + (s % 60) + "s";
}
tick();
setInterval(tick, 1000);
document.getElementById("signup").addEventListener("submit", (e) => {
  e.preventDefault();
  e.target.hidden = true;
  document.getElementById("thanks").hidden = false;
});
`,
);

const svg = (hue) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 60%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 70% 35%)"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="600" cy="160" r="70" fill="rgba(255,255,255,.6)"/><path d="M0 600 L260 300 L420 460 L560 340 L800 600Z" fill="rgba(0,0,0,.25)"/></svg>\n`;
const photos = [20, 80, 140, 200, 260, 320];
const gallery = {
  ...site(
    "Gallery",
    "A responsive photo gallery.",
    `<main class="wrap">
  <header class="top"><h1>Gallery</h1><p>Click a photo to view it larger. Use the arrow keys to move, Escape to close.</p></header>
  <ul class="photos">
${photos.map((h, i) => `    <li><button type="button" data-full="images/photo-${i + 1}.svg"><img src="images/photo-${i + 1}.svg" alt="Landscape ${i + 1}" loading="lazy"></button></li>`).join("\n")}
  </ul>
</main>
<dialog id="lightbox" aria-label="Photo"><img alt=""><button type="button" class="close" aria-label="Close">×</button></dialog>`,
    `.photos { list-style: none; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.photos button { padding: 0; border: 0; background: none; cursor: zoom-in; display: block; width: 100%; }
.photos img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--radius); display: block; }
dialog { padding: 0; border: 0; background: transparent; max-width: 92vw; }
dialog::backdrop { background: rgba(0, 0, 0, 0.85); }
dialog img { max-width: 92vw; max-height: 86vh; display: block; border-radius: 8px; }
.close { position: absolute; top: 8px; right: 8px; font-size: 28px; background: rgba(0, 0, 0, 0.5); color: #fff; border: 0; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; }
`,
    `// Lightbox: a <dialog> with the full image; arrow keys move between photos.
const dlg = document.getElementById("lightbox");
const img = dlg.querySelector("img");
const items = [...document.querySelectorAll(".photos button")];
let current = 0;
function show(i) {
  current = (i + items.length) % items.length;
  img.src = items[current].dataset.full;
  img.alt = items[current].querySelector("img").alt;
  if (!dlg.open) dlg.showModal();
}
items.forEach((b, i) => b.addEventListener("click", () => show(i)));
dlg.querySelector(".close").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
document.addEventListener("keydown", (e) => {
  if (!dlg.open) return;
  if (e.key === "ArrowRight") show(current + 1);
  if (e.key === "ArrowLeft") show(current - 1);
});
`,
  ),
  ...Object.fromEntries(photos.map((h, i) => [`images/photo-${i + 1}.svg`, svg(h)])),
};

export const FILES = { resume, restaurant, event, product, "coming-soon": comingSoon, gallery };
