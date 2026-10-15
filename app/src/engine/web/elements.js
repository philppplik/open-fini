// Catalog of insertable elements and sections for the Code studio's "Add" panel. Snippets are semantic HTML with plain
// class names; `css` carries only the baseline rules for those classes (with fallbacks for custom properties, so a
// snippet looks right in any project). Placeholder images are inline SVG data URIs. See docs/web-engine.md.
import { parseHtml, findAttr, escapeAttr, decodeEntities } from "./html.js";
import { formatCss } from "./css.js";
import { insertHtml, appendRulesIfMissing, applyChanges } from "./edit.js";
import { svgUri } from "./tpl/shared.js";

/**
 * @typedef {{ id: string, label: string, icon: string, description: string, html: string, css?: string }} ElementDef
 * @typedef {import('./edit.js').Change} Change
 */

// ------------------------------------------------------------------------------------------------ helpers

const color = {
  text: "var(--text, #1f2937)",
  muted: "var(--muted, #6b7280)",
  border: "var(--border, #e5e7eb)",
  accent: "var(--accent, #4f46e5)",
  surface: "var(--surface, #f9fafb)",
};

/** Gray landscape placeholder (data URI). */
const photo = (w, h, bg = "#e5e7eb", hills = "#cbd5e1", sun = "#f8fafc") => {
  const r = (n) => Math.round(n);
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/><path d="M0 ${r(h * 0.8)}l${r(w * 0.25)}-${r(h * 0.32)} ${r(w * 0.2)} ${r(h * 0.24)} ${r(w * 0.25)}-${r(h * 0.4)} ${r(w * 0.3)} ${r(h * 0.4)}V${h}H0z" fill="${hills}"/><circle cx="${r(w * 0.78)}" cy="${r(h * 0.28)}" r="${r(h * 0.09)}" fill="${sun}"/></svg>`);
};

/** Neutral person placeholder (data URI). */
const person = (bg) =>
  svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/><circle cx="100" cy="78" r="38" fill="#ffffff" opacity="0.9"/><path d="M26 200c0-44 33-72 74-72s74 28 74 72z" fill="#ffffff" opacity="0.9"/></svg>`);

const icon = (paths) =>
  `<svg class="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Reusable CSS fragments. */
const CSS = {
  container: `.container { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 24px; }
@media (max-width: 478px) { .container { padding: 0 16px; } }`,
  section: `.section { padding: 96px 0; }
@media (max-width: 991px) { .section { padding: 72px 0; } }
@media (max-width: 767px) { .section { padding: 56px 0; } }`,
  btn: `.btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.75rem 1.4rem; border: 2px solid transparent; border-radius: 10px; font: inherit; font-weight: 600; line-height: 1.2; text-decoration: none; cursor: pointer; }
.btn-primary { background: ${color.accent}; color: #ffffff; }
.btn-secondary { border-color: ${color.border}; background: #ffffff; color: ${color.text}; }`,
  columns: `.columns { display: grid; gap: 24px; }`,
  field: `.field { display: grid; gap: 6px; margin-bottom: 16px; font-weight: 600; }
.field input, .field textarea, .field select { width: 100%; padding: 0.7rem 0.9rem; border: 1px solid ${color.border}; border-radius: 10px; background: #ffffff; color: ${color.text}; font: inherit; font-weight: 400; }
.field input:focus-visible, .field textarea:focus-visible, .field select:focus-visible { outline: 3px solid ${color.accent}; outline-offset: 1px; }`,
  head: `.section-head { max-width: 40rem; margin: 0 auto 3rem; text-align: center; }
.section-head p { color: ${color.muted}; }`,
};

/** @param {string} id */
const def = (id, label, icon, description, html, css) => ({ id, label, icon, description, html: html.trim(), ...(css ? { css: formatCss(css) } : {}) });

// ------------------------------------------------------------------------------------------------ catalog

const heading = (n) => def(`heading-${n}`, `Heading ${n}`, `type-h${n}`, `A level ${n} heading.`, `<h${n}>Heading ${n}</h${n}>`);

const columns = (n) =>
  def(
    `columns-${n}`, `${n} columns`, n === 2 ? "layout-sidebar" : n === 3 ? "layout-three-columns" : "columns-gap",
    `A responsive grid with ${n} equal columns.`,
    `<div class="columns columns-${n}">\n${Array.from({ length: n }, (_, i) => `  <div class="column">\n    <h3>Column ${i + 1}</h3>\n    <p>Write something useful here.</p>\n  </div>`).join("\n")}\n</div>`,
    `${CSS.columns}
.columns-${n} { grid-template-columns: repeat(${n}, 1fr); }
${n === 4 ? "@media (max-width: 991px) { .columns-4 { grid-template-columns: repeat(2, 1fr); } }\n" : n === 3 ? "@media (max-width: 991px) { .columns-3 { grid-template-columns: repeat(2, 1fr); } }\n" : ""}@media (max-width: 767px) { .columns-${n} { grid-template-columns: 1fr; } }`,
  );

const layout = [
  def("section", "Section", "window", "A full-width section with a centered container, a heading and a paragraph.", `
<section class="section">
  <div class="container">
    <h2>Section title</h2>
    <p>Tell visitors what this part of the page is about.</p>
  </div>
</section>`, `${CSS.section}\n${CSS.container}`),
  def("container", "Container", "bounding-box", "A centered box with a maximum width.", `
<div class="container">
  <p>Content goes here.</p>
</div>`, CSS.container),
  def("div-block", "Div block", "square", "A generic box for grouping other elements.", `
<div class="block">
  <p>Div block</p>
</div>`, `.block { padding: 16px; }`),
  columns(2),
  columns(3),
  columns(4),
  def("flex-row", "Flex row", "distribute-horizontal", "Items in a row that wrap on small screens.", `
<div class="flex-row">
  <div>First</div>
  <div>Second</div>
  <div>Third</div>
</div>`, `.flex-row { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }`),
  def("stack", "Stack", "distribute-vertical", "Items in a column with even spacing.", `
<div class="stack">
  <div>First</div>
  <div>Second</div>
  <div>Third</div>
</div>`, `.stack { display: flex; flex-direction: column; gap: 16px; }`),
  def("spacer", "Spacer", "arrows-vertical", "Empty vertical space.", `<div class="spacer" aria-hidden="true"></div>`, `.spacer { height: 48px; }\n@media (max-width: 767px) { .spacer { height: 32px; } }`),
];

const typography = [
  heading(1), heading(2), heading(3), heading(4), heading(5), heading(6),
  def("paragraph", "Paragraph", "text-paragraph", "A paragraph of text.", `<p>Write a short paragraph. Say what you mean in plain words.</p>`),
  def("link", "Link", "link-45deg", "A text link.", `<a href="#">Link text</a>`),
  def("button", "Button", "hand-index", "A call-to-action button styled as a link.", `<a class="btn btn-primary" href="#">Button text</a>`, CSS.btn),
  def("list-bulleted", "Bulleted list", "list-ul", "An unordered list.", `
<ul>
  <li>First item</li>
  <li>Second item</li>
  <li>Third item</li>
</ul>`),
  def("list-numbered", "Numbered list", "list-ol", "An ordered list.", `
<ol>
  <li>First step</li>
  <li>Second step</li>
  <li>Third step</li>
</ol>`),
  def("quote", "Quote", "quote", "A quotation with an attribution.", `
<figure class="quote">
  <blockquote>
    <p>Design is how it works, not only how it looks.</p>
  </blockquote>
  <figcaption>Alex Morgan, product designer</figcaption>
</figure>`, `.quote { margin: 0 0 1.5rem; padding-left: 1.25rem; border-left: 4px solid ${color.accent}; }
.quote blockquote { margin: 0 0 0.5rem; font-size: 1.25rem; line-height: 1.5; }
.quote blockquote p { margin: 0; }
.quote figcaption { color: ${color.muted}; font-size: 0.9375rem; }`),
  def("code-block", "Code block", "code-slash", "Preformatted code.", `
<pre class="code-block"><code>const greeting = "Hello, world";
console.log(greeting);</code></pre>`, `.code-block { margin: 0 0 1.5rem; padding: 16px 20px; overflow-x: auto; border-radius: 12px; background: #111827; color: #e5e7eb; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9rem; line-height: 1.6; }
.code-block code { font: inherit; }`),
  def("divider", "Divider", "hr", "A horizontal rule between two parts of the page.", `<hr class="divider">`, `.divider { height: 1px; margin: 2rem 0; border: 0; background: ${color.border}; }`),
];

const media = [
  def("image", "Image", "image", "An image with a placeholder you can replace.", `<img class="image" src="${photo(800, 500)}" width="800" height="500" alt="Placeholder image" loading="lazy">`, `.image { display: block; max-width: 100%; height: auto; border-radius: 12px; }`),
  def("video", "Video", "play-btn", "A video player. Set the src attribute to a video file.", `<video class="video" controls preload="none" width="800" height="450" poster="${photo(800, 450, "#1f2937", "#374151", "#4b5563")}"></video>`, `.video { display: block; width: 100%; height: auto; border-radius: 12px; background: #111827; }`),
  def("audio", "Audio", "music-note-beamed", "An audio player. Set the src attribute to an audio file.", `<audio class="audio" controls preload="none"></audio>`, `.audio { display: block; width: 100%; }`),
  def("embed", "Embed", "code-square", "A responsive 16:9 frame for embedded content.", `
<div class="embed">
  <iframe src="about:blank" title="Embedded content" loading="lazy" allowfullscreen></iframe>
</div>`, `.embed { position: relative; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 12px; background: ${color.surface}; }
.embed iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }`),
  def("figure", "Figure with caption", "card-image", "An image with a caption.", `
<figure class="figure">
  <img src="${photo(800, 500)}" width="800" height="500" alt="Placeholder image" loading="lazy">
  <figcaption>Describe what the image shows.</figcaption>
</figure>`, `.figure { margin: 0 0 1.5rem; }
.figure img { display: block; max-width: 100%; height: auto; border-radius: 12px; }
.figure figcaption { margin-top: 0.5rem; color: ${color.muted}; font-size: 0.9375rem; }`),
  def("svg-icon", "SVG icon", "star", "An inline icon that takes the text color.", icon('<path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z"/>'), `.icon { flex: none; width: 24px; height: 24px; }`),
];

const forms = [
  def("form", "Form", "ui-checks", "A contact form with two fields and a submit button.", `
<form class="form" action="#" method="post">
  <label class="field">
    <span>Name</span>
    <input type="text" name="name" autocomplete="name" required>
  </label>
  <label class="field">
    <span>Email</span>
    <input type="email" name="email" autocomplete="email" required>
  </label>
  <button class="btn btn-primary" type="submit">Send message</button>
</form>`, `.form { max-width: 480px; }\n${CSS.field}\n${CSS.btn}`),
  def("input-text", "Text input", "input-cursor-text", "A labeled single-line text field.", `
<label class="field">
  <span>Label</span>
  <input type="text" name="text" placeholder="Type here">
</label>`, CSS.field),
  def("input-email", "Email input", "envelope", "A labeled email field.", `
<label class="field">
  <span>Email</span>
  <input type="email" name="email" placeholder="you@example.com" autocomplete="email">
</label>`, CSS.field),
  def("textarea", "Textarea", "textarea-t", "A labeled multi-line text field.", `
<label class="field">
  <span>Message</span>
  <textarea name="message" rows="5"></textarea>
</label>`, CSS.field),
  def("select", "Select", "menu-button-wide", "A labeled drop-down list.", `
<label class="field">
  <span>Choose an option</span>
  <select name="choice">
    <option>Option one</option>
    <option>Option two</option>
    <option>Option three</option>
  </select>
</label>`, CSS.field),
  def("checkbox", "Checkbox", "check-square", "A single checkbox with its label.", `
<label class="check">
  <input type="checkbox" name="agree">
  <span>I agree to the terms</span>
</label>`, `.check { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }\n.check input { width: 1.125rem; height: 1.125rem; accent-color: ${color.accent}; }`),
  def("radio-group", "Radio group", "ui-radios", "A group of options where only one can be chosen.", `
<fieldset class="fieldset">
  <legend>Choose one</legend>
  <label class="check">
    <input type="radio" name="choice-group" value="a" checked>
    <span>Option A</span>
  </label>
  <label class="check">
    <input type="radio" name="choice-group" value="b">
    <span>Option B</span>
  </label>
  <label class="check">
    <input type="radio" name="choice-group" value="c">
    <span>Option C</span>
  </label>
</fieldset>`, `.fieldset { margin: 0 0 16px; padding: 0; border: 0; }\n.fieldset legend { margin-bottom: 8px; padding: 0; font-weight: 600; }\n.check { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }\n.check input { width: 1.125rem; height: 1.125rem; accent-color: ${color.accent}; }`),
  def("label", "Label", "tag", "A text label wrapped around its input.", `
<label class="field">
  <span>Label text</span>
  <input type="text" name="field">
</label>`, CSS.field),
  def("submit", "Submit button", "send", "A button that submits the surrounding form.", `<button class="btn btn-primary" type="submit">Submit</button>`, CSS.btn),
];

const navigation = [
  def("navbar", "Navbar", "list", "A top bar with a brand and links.", `
<header class="navbar">
  <div class="container navbar-inner">
    <a class="navbar-brand" href="#">Brand</a>
    <nav aria-label="Primary">
      <ul class="navbar-links">
        <li><a href="#">Home</a></li>
        <li><a href="#">About</a></li>
        <li><a href="#">Contact</a></li>
      </ul>
    </nav>
  </div>
</header>`, `${CSS.container}
.navbar { border-bottom: 1px solid ${color.border}; background: #ffffff; }
.navbar-inner { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 68px; }
.navbar-brand { color: ${color.text}; font-size: 1.125rem; font-weight: 700; text-decoration: none; }
.navbar-links { display: flex; gap: 24px; margin: 0; padding: 0; list-style: none; }
.navbar-links a { color: ${color.muted}; font-weight: 500; text-decoration: none; }
.navbar-links a:hover { color: ${color.text}; }
@media (max-width: 767px) { .navbar-inner { flex-direction: column; justify-content: center; gap: 8px; padding-top: 12px; padding-bottom: 12px; } }
@media (max-width: 478px) { .navbar-links { gap: 16px; } }`),
  def("footer", "Footer", "window-dock", "A page footer with a copyright line and links.", `
<footer class="footer">
  <div class="container footer-inner">
    <p>&copy; 2026 Your company. All rights reserved.</p>
    <ul class="footer-links">
      <li><a href="#">Privacy</a></li>
      <li><a href="#">Terms</a></li>
      <li><a href="#">Contact</a></li>
    </ul>
  </div>
</footer>`, `${CSS.container}
.footer { padding: 32px 0; border-top: 1px solid ${color.border}; color: ${color.muted}; font-size: 0.9375rem; }
.footer-inner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
.footer-inner p { margin: 0; }
.footer-links { display: flex; gap: 20px; margin: 0; padding: 0; list-style: none; }
.footer-links a { color: inherit; }
@media (max-width: 767px) { .footer-inner { flex-direction: column; text-align: center; } }`),
  def("breadcrumbs", "Breadcrumbs", "signpost-split", "A trail showing where the page sits in the site.", `
<nav class="breadcrumbs" aria-label="Breadcrumb">
  <ol>
    <li><a href="#">Home</a></li>
    <li><a href="#">Section</a></li>
    <li aria-current="page">Current page</li>
  </ol>
</nav>`, `.breadcrumbs ol { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 1.5rem; padding: 0; font-size: 0.9375rem; list-style: none; }
.breadcrumbs li + li::before { content: "/"; margin-right: 8px; color: ${color.muted}; }
.breadcrumbs [aria-current="page"] { color: ${color.muted}; }`),
  def("pagination", "Pagination", "three-dots", "Links to move between pages of results.", `
<nav class="pagination" aria-label="Pagination">
  <ul>
    <li><a href="#" aria-label="Previous page">Previous</a></li>
    <li><a href="#" aria-current="page">1</a></li>
    <li><a href="#">2</a></li>
    <li><a href="#">3</a></li>
    <li><a href="#" aria-label="Next page">Next</a></li>
  </ul>
</nav>`, `.pagination ul { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: 2rem 0; padding: 0; list-style: none; }
.pagination a { display: block; min-width: 40px; padding: 0.5rem 0.85rem; border: 1px solid ${color.border}; border-radius: 8px; color: ${color.text}; text-align: center; text-decoration: none; }
.pagination a:hover { border-color: ${color.accent}; color: ${color.accent}; }
.pagination [aria-current="page"] { border-color: ${color.accent}; background: ${color.accent}; color: #ffffff; }`),
];

const sections = [
  def("hero", "Hero", "stars", "A headline, a short pitch and two buttons.", `
<section class="hero">
  <div class="container">
    <p class="eyebrow">Introducing</p>
    <h1>A headline that says what you do</h1>
    <p class="lead">One or two sentences that explain who it is for and why it matters.</p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="#">Get started</a>
      <a class="btn btn-secondary" href="#">Learn more</a>
    </div>
  </div>
</section>`, `${CSS.container}\n${CSS.btn}
.hero { padding: 112px 0 96px; text-align: center; }
.eyebrow { margin: 0 0 1rem; color: ${color.accent}; font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.hero h1 { max-width: 18ch; margin: 0 auto 1rem; font-size: 3.5rem; line-height: 1.1; letter-spacing: -0.02em; }
.lead { max-width: 36rem; margin: 0 auto 2rem; color: ${color.muted}; font-size: 1.25rem; }
.hero-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
@media (max-width: 991px) { .hero { padding: 80px 0 64px; } .hero h1 { font-size: 2.75rem; } }
@media (max-width: 767px) { .hero h1 { font-size: 2.25rem; } .lead { font-size: 1.125rem; } }
@media (max-width: 478px) { .hero { padding: 56px 0 48px; } .hero h1 { font-size: 2rem; } .hero-actions .btn { width: 100%; } }`),
  def("feature-grid", "Feature grid", "grid", "Three highlights with an icon, a title and a sentence each.", `
<section class="section features">
  <div class="container">
    <div class="section-head">
      <h2>Everything you need</h2>
      <p>A short sentence that introduces the features below.</p>
    </div>
    <ul class="feature-grid">
      <li class="feature">
        <span class="feature-icon">${icon('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>')}</span>
        <h3>Fast by default</h3>
        <p>Explain the first benefit in one or two sentences.</p>
      </li>
      <li class="feature">
        <span class="feature-icon">${icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>')}</span>
        <h3>Private and secure</h3>
        <p>Explain the second benefit in one or two sentences.</p>
      </li>
      <li class="feature">
        <span class="feature-icon">${icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>')}</span>
        <h3>Simple to use</h3>
        <p>Explain the third benefit in one or two sentences.</p>
      </li>
    </ul>
  </div>
</section>`, `${CSS.section}\n${CSS.container}\n${CSS.head}
.feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin: 0; padding: 0; list-style: none; }
.feature { padding: 28px; border: 1px solid ${color.border}; border-radius: 16px; background: #ffffff; }
.feature p { margin: 0; color: ${color.muted}; }
.feature-icon { display: inline-grid; place-items: center; width: 48px; height: 48px; margin-bottom: 1rem; border-radius: 12px; background: ${color.surface}; color: ${color.accent}; }
@media (max-width: 991px) { .feature-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 767px) { .feature-grid { grid-template-columns: 1fr; } }`),
  def("pricing-table", "Pricing table", "currency-dollar", "Three plans side by side with the middle one highlighted.", `
<section class="section pricing">
  <div class="container">
    <div class="section-head">
      <h2>Simple pricing</h2>
      <p>Pick a plan and change it any time.</p>
    </div>
    <div class="pricing-grid">
      <article class="plan">
        <h3>Starter</h3>
        <p class="price">$0 <span>per month</span></p>
        <ul>
          <li>One project</li>
          <li>Community support</li>
        </ul>
        <a class="btn btn-secondary" href="#">Start free</a>
      </article>
      <article class="plan plan-featured">
        <h3>Pro</h3>
        <p class="price">$12 <span>per month</span></p>
        <ul>
          <li>Unlimited projects</li>
          <li>Priority support</li>
          <li>Custom domain</li>
        </ul>
        <a class="btn btn-primary" href="#">Choose Pro</a>
      </article>
      <article class="plan">
        <h3>Team</h3>
        <p class="price">$29 <span>per month</span></p>
        <ul>
          <li>Everything in Pro</li>
          <li>Five seats</li>
          <li>Shared workspaces</li>
        </ul>
        <a class="btn btn-secondary" href="#">Contact us</a>
      </article>
    </div>
  </div>
</section>`, `${CSS.section}\n${CSS.container}\n${CSS.btn}\n${CSS.head}
.pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); align-items: start; gap: 24px; }
.plan { padding: 32px; border: 1px solid ${color.border}; border-radius: 20px; background: #ffffff; }
.plan-featured { border: 2px solid ${color.accent}; box-shadow: 0 12px 30px rgba(17, 24, 39, 0.12); }
.price { margin: 0.5rem 0 1.25rem; font-size: 2.5rem; font-weight: 800; letter-spacing: -0.03em; }
.price span { color: ${color.muted}; font-size: 1rem; font-weight: 400; letter-spacing: 0; }
.plan ul { margin: 0 0 1.5rem; padding-left: 1.25rem; }
.plan .btn { width: 100%; }
@media (max-width: 991px) { .pricing-grid { grid-template-columns: 1fr; max-width: 440px; margin: 0 auto; } }`),
  def("testimonial", "Testimonial", "chat-quote", "A customer quote with a name and photo.", `
<section class="section testimonial">
  <div class="container">
    <figure class="testimonial-card">
      <blockquote>
        <p>This changed how our whole team works. We shipped our new site in a single afternoon.</p>
      </blockquote>
      <figcaption>
        <img src="${person("#a5b4fc")}" width="56" height="56" alt="Portrait of Sam Rivera">
        <span><strong>Sam Rivera</strong><br>Head of design, Northwind</span>
      </figcaption>
    </figure>
  </div>
</section>`, `${CSS.section}\n${CSS.container}
.testimonial-card { max-width: 720px; margin: 0 auto; padding: 40px; border-radius: 20px; background: ${color.surface}; text-align: center; }
.testimonial-card blockquote { margin: 0 0 1.5rem; font-size: 1.5rem; line-height: 1.45; }
.testimonial-card blockquote p { margin: 0; }
.testimonial-card figcaption { display: inline-flex; align-items: center; gap: 14px; text-align: left; }
.testimonial-card img { width: 56px; height: 56px; border-radius: 50%; }
@media (max-width: 767px) { .testimonial-card { padding: 28px 20px; } .testimonial-card blockquote { font-size: 1.25rem; } }`),
  def("cta", "Call to action", "megaphone", "A colored band that asks for one action.", `
<section class="cta">
  <div class="container">
    <h2>Ready to get started?</h2>
    <p>Create your first project in a few minutes. No credit card needed.</p>
    <a class="btn btn-light" href="#">Start for free</a>
  </div>
</section>`, `${CSS.container}\n${CSS.btn}
.cta { padding: 80px 0; background: ${color.accent}; color: #ffffff; text-align: center; }
.cta h2 { margin: 0 0 0.5rem; font-size: 2.25rem; }
.cta p { margin: 0 0 1.75rem; opacity: 0.9; }
.btn-light { background: #ffffff; color: ${color.text}; }
@media (max-width: 767px) { .cta { padding: 56px 0; } .cta h2 { font-size: 1.75rem; } }
@media (max-width: 478px) { .cta .btn { width: 100%; } }`),
  def("gallery", "Image gallery", "images", "A responsive grid of six images.", `
<section class="section gallery">
  <div class="container">
    <div class="section-head">
      <h2>Gallery</h2>
      <p>A few moments worth sharing.</p>
    </div>
    <ul class="gallery-grid">
${["#e5e7eb|#cbd5e1", "#fde68a|#fbbf24", "#bfdbfe|#93c5fd", "#fecaca|#fca5a5", "#bbf7d0|#86efac", "#ddd6fe|#c4b5fd"].map((c, i) => `      <li><img src="${photo(600, 450, c.split("|")[0], c.split("|")[1])}" width="600" height="450" alt="Gallery image ${i + 1}" loading="lazy"></li>`).join("\n")}
    </ul>
  </div>
</section>`, `${CSS.section}\n${CSS.container}\n${CSS.head}
.gallery-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 0; padding: 0; list-style: none; }
.gallery-grid img { width: 100%; height: auto; border-radius: 12px; }
@media (max-width: 991px) { .gallery-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 478px) { .gallery-grid { grid-template-columns: 1fr; } }`),
  def("faq", "FAQ", "question-circle", "Questions and answers that open and close.", `
<section class="section faq">
  <div class="container">
    <div class="section-head">
      <h2>Frequently asked questions</h2>
    </div>
    <div class="faq-list">
      <details>
        <summary>How do I get started?</summary>
        <p>Answer the question in a sentence or two. Keep it friendly and direct.</p>
      </details>
      <details>
        <summary>Can I cancel at any time?</summary>
        <p>Answer the question in a sentence or two. Keep it friendly and direct.</p>
      </details>
      <details>
        <summary>Where can I get help?</summary>
        <p>Answer the question in a sentence or two. Keep it friendly and direct.</p>
      </details>
    </div>
  </div>
</section>`, `${CSS.section}\n${CSS.container}\n${CSS.head}
.faq-list { max-width: 760px; margin: 0 auto; }
.faq-list details { border-bottom: 1px solid ${color.border}; }
.faq-list summary { padding: 1.1rem 0; font-weight: 600; cursor: pointer; }
.faq-list details p { margin: 0 0 1.1rem; color: ${color.muted}; }`),
  def("stats-row", "Stats row", "bar-chart", "Four big numbers with captions.", `
<section class="stats">
  <div class="container">
    <ul class="stats-grid">
      <li><strong>10k+</strong><span>Happy customers</span></li>
      <li><strong>99.9%</strong><span>Uptime</span></li>
      <li><strong>24/7</strong><span>Support</span></li>
      <li><strong>40</strong><span>Countries</span></li>
    </ul>
  </div>
</section>`, `${CSS.container}
.stats { padding: 56px 0; background: ${color.surface}; }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin: 0; padding: 0; text-align: center; list-style: none; }
.stats-grid strong { display: block; font-size: 2.5rem; letter-spacing: -0.02em; }
.stats-grid span { color: ${color.muted}; }
@media (max-width: 767px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 478px) { .stats-grid strong { font-size: 2rem; } }`),
  def("team-cards", "Team cards", "people", "Three team members with a photo, a name and a role.", `
<section class="section team">
  <div class="container">
    <div class="section-head">
      <h2>Meet the team</h2>
      <p>The people behind the work.</p>
    </div>
    <ul class="team-grid">
      <li class="team-card">
        <img src="${person("#fda4af")}" width="200" height="200" alt="Portrait of Jordan Lee" loading="lazy">
        <h3>Jordan Lee</h3>
        <p>Founder and CEO</p>
      </li>
      <li class="team-card">
        <img src="${person("#93c5fd")}" width="200" height="200" alt="Portrait of Priya Shah" loading="lazy">
        <h3>Priya Shah</h3>
        <p>Head of engineering</p>
      </li>
      <li class="team-card">
        <img src="${person("#86efac")}" width="200" height="200" alt="Portrait of Diego Alvarez" loading="lazy">
        <h3>Diego Alvarez</h3>
        <p>Design lead</p>
      </li>
    </ul>
  </div>
</section>`, `${CSS.section}\n${CSS.container}\n${CSS.head}
.team-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin: 0; padding: 0; list-style: none; }
.team-card { padding: 24px; border: 1px solid ${color.border}; border-radius: 16px; background: #ffffff; text-align: center; }
.team-card img { width: 120px; height: 120px; margin: 0 auto 1rem; border-radius: 50%; }
.team-card h3 { margin: 0 0 0.25rem; }
.team-card p { margin: 0; color: ${color.muted}; }
@media (max-width: 991px) { .team-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 478px) { .team-grid { grid-template-columns: 1fr; } }`),
];

/** @type {{ id: string, label: string, items: ElementDef[] }[]} */
export const ELEMENT_CATEGORIES = [
  { id: "layout", label: "Layout", items: layout },
  { id: "typography", label: "Typography", items: typography },
  { id: "media", label: "Media", items: media },
  { id: "forms", label: "Forms", items: forms },
  { id: "navigation", label: "Navigation", items: navigation },
  { id: "sections", label: "Sections", items: sections },
];

/**
 * Finds a definition by id.
 * @param {string} id
 * @returns {ElementDef|null}
 */
export function getElementDef(id) {
  for (const c of ELEMENT_CATEGORIES) for (const i of c.items) if (i.id === id) return i;
  return null;
}

// ------------------------------------------------------------------------------------------------ insertion

/** Makes the ids and radio group names of a snippet unique within a document by adding -2, -3, ... */
function uniqueNames(html, existingIds, existingRadios) {
  const parsed = parseHtml(html);
  const changes = [];
  const idMap = new Map();
  const radioMap = new Map();
  const taken = new Set(existingIds);
  const takenRadios = new Set(existingRadios);
  const fresh = (base, set) => {
    if (!set.has(base)) return base;
    for (let n = 2; ; n++) if (!set.has(`${base}-${n}`)) return `${base}-${n}`;
  };
  for (const el of parsed.elements) {
    const id = findAttr(el, "id");
    if (id && id.value) {
      const v = decodeEntities(id.value);
      const nv = fresh(v, taken);
      taken.add(nv);
      if (nv !== v) {
        idMap.set(v, nv);
        changes.push({ from: id.valueStart, to: id.valueEnd, insert: escapeAttr(nv) });
      }
    }
    const type = findAttr(el, "type");
    const name = findAttr(el, "name");
    if (el.tag === "input" && type && type.value === "radio" && name && name.value) {
      const v = decodeEntities(name.value);
      if (!radioMap.has(v)) {
        const nv = fresh(v, takenRadios);
        radioMap.set(v, nv);
        takenRadios.add(nv);
      }
      const nv = radioMap.get(v);
      if (nv !== v) changes.push({ from: name.valueStart, to: name.valueEnd, insert: escapeAttr(nv) });
    }
  }
  if (idMap.size) {
    for (const el of parsed.elements) {
      for (const a of el.attrs) {
        if (a.value === null) continue;
        const v = decodeEntities(a.value);
        if ((a.name === "for" || a.name === "aria-labelledby" || a.name === "aria-controls" || a.name === "aria-describedby") && idMap.has(v)) {
          changes.push({ from: a.valueStart, to: a.valueEnd, insert: escapeAttr(idMap.get(v)) });
        } else if (a.name === "href" && v.startsWith("#") && idMap.has(v.slice(1))) {
          changes.push({ from: a.valueStart, to: a.valueEnd, insert: "#" + escapeAttr(idMap.get(v.slice(1))) });
        }
      }
    }
  }
  return changes.length ? applyChanges(html, changes) : html;
}

/**
 * Plans the insertion of an element into a page: the HTML change (with the offset of the new fragment) and the CSS
 * changes that add the baseline rules the snippet needs (only rules that the stylesheet does not have yet).
 * ids and radio group names inside the snippet are made unique within the page.
 * `cssSource` null means the page has no stylesheet to extend (no CSS changes).
 * @param {import('./html.js').ParsedHtml} htmlParsed
 * @param {string|null} cssSource
 * @param {number|null} parentId
 * @param {number} index
 * @param {ElementDef} elDef
 * @returns {{ html: { changes: Change[], at: number }, css: Change[] }}
 */
export function planInsert(htmlParsed, cssSource, parentId, index, elDef) {
  const ids = [];
  const radios = [];
  for (const el of htmlParsed.elements) {
    const id = findAttr(el, "id");
    if (id && id.value) ids.push(decodeEntities(id.value));
    const type = findAttr(el, "type");
    const name = findAttr(el, "name");
    if (el.tag === "input" && type && type.value === "radio" && name && name.value) radios.push(decodeEntities(name.value));
  }
  const html = uniqueNames(elDef.html, ids, radios);
  const res = insertHtml(htmlParsed, parentId, index, html);
  const css = cssSource === null || cssSource === undefined || !elDef.css ? [] : appendRulesIfMissing(cssSource, elDef.css);
  return { html: res, css };
}
