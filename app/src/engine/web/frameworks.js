// Framework knowledge for the Code studio: which frameworks a project uses, class and attribute completions
// (Tailwind CSS, Bootstrap 5, Alpine.js, htmx) and ready-made component snippets for the Add panel. Pure data and
// small helpers: no DOM, no network.

/**
 * Detects the frameworks a project uses from its HTML, import maps and scripts.
 * @param {{ list(): string[], readText(path: string): string | null }} files
 * @returns {Set<'tailwind'|'bootstrap'|'alpine'|'htmx'|'vue'|'react'|'preact'|'lit'|'three'>}
 */
export function detectFrameworks(files) {
  const found = new Set();
  const tests = [
    ["tailwind", /tailwindcss|cdn\.tailwindcss\.com|\btext\/tailwindcss\b|@import\s+["']tailwindcss/i],
    ["bootstrap", /bootstrap(?:@[\d.]+)?\/dist|bootstrap\.(?:min\.)?(?:css|js)|bootstrap\.bundle/i],
    ["alpine", /alpinejs|@alpinejs\/|\bx-data\s*=/i],
    ["htmx", /htmx\.org|htmx(?:\.min)?\.js|\bhx-(?:get|post|put|delete|patch|trigger|target|swap)\s*=/i],
    ["vue", /\bvue(?:@[\d.]+)?\/dist|from\s+["']vue["']|\bcreateApp\b/],
    ["react", /from\s+["']react(?:-dom\/client)?["']|react@\d|react-dom@\d/],
    ["preact", /\bpreact\b/],
    ["lit", /from\s+["']lit["']|lit@\d|\bLitElement\b/],
    ["three", /from\s+["']three["']|three@\d|THREE\./],
  ];
  for (const path of files.list()) {
    if (!/\.(html?|m?js|css|jsx|tsx|ts)$/i.test(path)) continue;
    const text = files.readText(path);
    if (!text) continue;
    for (const [id, re] of tests) if (!found.has(id) && re.test(text.length > 200000 ? text.slice(0, 200000) : text)) found.add(id);
    if (found.size === tests.length) break;
  }
  return found;
}

// ------------------------------------------------------------------------------------------------ Tailwind

const SPACING = ["0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14", "16", "20", "24", "28", "32", "36", "40", "44", "48", "52", "56", "60", "64", "72", "80", "96"];
const COLORS = ["slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const FRACTIONS = ["1/2", "1/3", "2/3", "1/4", "2/4", "3/4", "1/5", "2/5", "3/5", "4/5", "1/6", "5/6", "1/12", "11/12"];

let cached = null;

/** A compact list of Tailwind CSS v4 utility class names for completion (generated once; variants such as `md:` are handled by the UI). */
export function tailwindClasses() {
  if (cached) return cached;
  const out = new Set();
  const add = (...names) => names.forEach((n) => out.add(n));
  const spaced = ["p", "px", "py", "pt", "pr", "pb", "pl", "ps", "pe", "m", "mx", "my", "mt", "mr", "mb", "ml", "ms", "me", "gap", "gap-x", "gap-y", "space-x", "space-y", "inset", "top", "right", "bottom", "left", "w", "h", "size", "min-w", "min-h", "basis", "scroll-m", "scroll-p"];
  for (const p of spaced) for (const s of SPACING) add(`${p}-${s}`);
  for (const p of ["m", "mx", "my", "mt", "mr", "mb", "ml", "w", "h", "size", "inset", "top", "right", "bottom", "left"]) add(`${p}-auto`);
  for (const p of ["w", "h", "size", "min-w", "min-h", "max-w", "max-h", "inset", "top", "right", "bottom", "left", "basis"]) {
    add(`${p}-full`, `${p}-px`);
    for (const f of FRACTIONS) add(`${p}-${f}`);
  }
  add("w-screen", "h-screen", "h-dvh", "h-svh", "min-h-screen", "min-h-dvh", "min-w-0", "max-w-none", "w-min", "w-max", "w-fit", "h-min", "h-max", "h-fit");
  for (const s of ["3xs", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "prose", "screen-sm", "screen-md", "screen-lg", "screen-xl", "screen-2xl"]) add(`max-w-${s}`);
  for (const p of ["bg", "text", "border", "ring", "outline", "fill", "stroke", "from", "via", "to", "divide", "shadow", "decoration", "accent", "caret", "placeholder"]) {
    for (const c of COLORS) for (const sh of SHADES) add(`${p}-${c}-${sh}`);
    add(`${p}-white`, `${p}-black`, `${p}-transparent`, `${p}-current`);
  }
  for (const n of ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"]) add(`text-${n}`);
  for (const w of ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"]) add(`font-${w}`);
  add("font-sans", "font-serif", "font-mono", "italic", "not-italic", "underline", "overline", "line-through", "no-underline", "uppercase", "lowercase", "capitalize", "normal-case", "truncate", "text-ellipsis", "text-clip", "text-balance", "text-pretty", "antialiased", "subpixel-antialiased");
  add("text-left", "text-center", "text-right", "text-justify", "text-start", "text-end", "align-top", "align-middle", "align-bottom", "whitespace-nowrap", "whitespace-normal", "whitespace-pre", "whitespace-pre-wrap", "break-words", "break-all", "break-normal");
  for (const l of ["none", "tight", "snug", "normal", "relaxed", "loose"]) add(`leading-${l}`);
  for (const l of ["tighter", "tight", "normal", "wide", "wider", "widest"]) add(`tracking-${l}`);
  for (let i = 3; i <= 10; i++) add(`leading-${i}`);
  add("block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid", "contents", "hidden", "table", "flow-root", "sr-only", "not-sr-only");
  add("flex-row", "flex-row-reverse", "flex-col", "flex-col-reverse", "flex-wrap", "flex-nowrap", "flex-wrap-reverse", "flex-1", "flex-auto", "flex-initial", "flex-none", "grow", "grow-0", "shrink", "shrink-0");
  for (const v of ["start", "end", "center", "between", "around", "evenly", "stretch", "baseline", "normal"]) add(`justify-${v}`, `items-${v}`, `content-${v}`);
  for (const v of ["auto", "start", "end", "center", "stretch", "baseline"]) add(`self-${v}`, `justify-self-${v}`, `place-self-${v}`);
  add("place-items-center", "place-content-center", "justify-items-center", "justify-items-start", "justify-items-end", "justify-items-stretch");
  for (let i = 1; i <= 12; i++) add(`grid-cols-${i}`, `col-span-${i}`, `grid-rows-${i}`, `row-span-${i}`, `order-${i}`, `col-start-${i}`, `col-end-${i}`);
  add("grid-cols-none", "grid-cols-subgrid", "col-span-full", "row-span-full", "col-auto", "auto-cols-auto", "auto-rows-auto", "grid-flow-row", "grid-flow-col", "grid-flow-dense", "order-first", "order-last", "order-none");
  add("static", "fixed", "absolute", "relative", "sticky", "visible", "invisible", "collapse", "z-0", "z-10", "z-20", "z-30", "z-40", "z-50", "z-auto");
  add("overflow-auto", "overflow-hidden", "overflow-clip", "overflow-visible", "overflow-scroll", "overflow-x-auto", "overflow-y-auto", "overflow-x-hidden", "overflow-y-hidden", "overscroll-contain");
  for (const s of ["", "-t", "-r", "-b", "-l", "-x", "-y", "-s", "-e"]) {
    add(`border${s}`, `border${s}-0`, `border${s}-2`, `border${s}-4`, `border${s}-8`);
  }
  add("border-solid", "border-dashed", "border-dotted", "border-double", "border-none", "divide-x", "divide-y", "divide-x-2", "divide-y-2");
  for (const r of ["", "-sm", "-md", "-lg", "-xl", "-2xl", "-3xl", "-4xl", "-full", "-none"]) add(`rounded${r}`, `rounded-t${r}`, `rounded-b${r}`, `rounded-l${r}`, `rounded-r${r}`);
  add("ring", "ring-0", "ring-1", "ring-2", "ring-4", "ring-8", "ring-inset", "outline", "outline-none", "outline-1", "outline-2", "outline-offset-2");
  for (const s of ["xs", "sm", "md", "lg", "xl", "2xl", "none", "inner"]) add(`shadow-${s}`);
  add("shadow");
  for (const o of ["0", "5", "10", "15", "20", "25", "30", "40", "50", "60", "70", "75", "80", "90", "95", "100"]) add(`opacity-${o}`);
  for (const o of ["0", "50", "75", "90", "95", "100", "105", "110", "125", "150"]) add(`scale-${o}`);
  for (const o of ["0", "1", "2", "3", "6", "12", "45", "90", "180"]) add(`rotate-${o}`, `-rotate-${o}`);
  for (const s of ["", "-sm", "-md", "-lg", "-xl", "-2xl", "-3xl", "-none"]) add(`blur${s}`, `backdrop-blur${s}`);
  add("transition", "transition-all", "transition-colors", "transition-opacity", "transition-shadow", "transition-transform", "transition-none", "ease-in", "ease-out", "ease-in-out", "ease-linear", "animate-spin", "animate-ping", "animate-pulse", "animate-bounce", "animate-none");
  for (const d of ["75", "100", "150", "200", "300", "500", "700", "1000"]) add(`duration-${d}`, `delay-${d}`);
  add("cursor-pointer", "cursor-default", "cursor-not-allowed", "cursor-wait", "cursor-text", "cursor-move", "select-none", "select-text", "select-all", "pointer-events-none", "pointer-events-auto", "resize", "resize-none", "resize-y", "appearance-none", "touch-none");
  add("object-contain", "object-cover", "object-fill", "object-none", "object-center", "aspect-auto", "aspect-square", "aspect-video", "container", "mx-auto", "list-disc", "list-decimal", "list-none", "list-inside", "list-outside", "table-auto", "table-fixed", "border-collapse", "border-separate");
  add("bg-cover", "bg-contain", "bg-center", "bg-no-repeat", "bg-fixed", "bg-gradient-to-r", "bg-gradient-to-l", "bg-gradient-to-t", "bg-gradient-to-b", "bg-gradient-to-br", "bg-linear-to-r", "bg-linear-to-b", "bg-radial", "bg-clip-text", "text-transparent", "mix-blend-multiply", "backdrop-blur", "scroll-smooth", "snap-x", "snap-y", "snap-mandatory", "snap-center", "snap-start", "prose", "line-clamp-1", "line-clamp-2", "line-clamp-3");
  cached = [...out].sort();
  return cached;
}

/** Tailwind variant prefixes offered after a typed prefix (`md:`, `hover:` …). */
export const TAILWIND_VARIANTS = ["sm:", "md:", "lg:", "xl:", "2xl:", "hover:", "focus:", "focus-visible:", "active:", "disabled:", "dark:", "group-hover:", "peer-checked:", "first:", "last:", "odd:", "even:", "focus-within:", "placeholder:", "motion-safe:", "motion-reduce:", "print:", "aria-expanded:", "data-[state=open]:", "max-md:", "max-sm:"];

/**
 * Class completion for the text typed in a class attribute: returns { prefix, options } where `prefix` is the variant
 * part that stays in front (`md:hover:`) and options are class names (without the prefix).
 * @param {string} token the class token under the caret
 * @param {string[]} classes candidate names
 */
export function splitVariant(token) {
  const i = token.lastIndexOf(":");
  return i < 0 ? { prefix: "", rest: token } : { prefix: token.slice(0, i + 1), rest: token.slice(i + 1) };
}

// ------------------------------------------------------------------------------------------------ Bootstrap 5

const BS_SPACING = ["0", "1", "2", "3", "4", "5", "auto"];
/** Bootstrap 5.3 class names for completion. */
export const BOOTSTRAP_CLASSES = (() => {
  const out = new Set(
    `container container-fluid container-sm container-md container-lg container-xl container-xxl row g-0 g-1 g-2 g-3 g-4 g-5 gx-3 gy-3
    btn btn-primary btn-secondary btn-success btn-danger btn-warning btn-info btn-light btn-dark btn-link btn-outline-primary btn-outline-secondary btn-outline-success
    btn-outline-danger btn-outline-warning btn-outline-info btn-outline-light btn-outline-dark btn-sm btn-lg btn-close btn-group btn-group-sm btn-group-lg btn-toolbar
    navbar navbar-expand navbar-expand-sm navbar-expand-md navbar-expand-lg navbar-expand-xl navbar-brand navbar-nav navbar-toggler navbar-toggler-icon navbar-text navbar-collapse
    nav nav-item nav-link nav-tabs nav-pills nav-fill nav-justified tab-content tab-pane fade show active disabled collapse collapsing collapsed
    card card-body card-title card-subtitle card-text card-header card-footer card-img card-img-top card-img-bottom card-group card-link card-img-overlay
    alert alert-primary alert-secondary alert-success alert-danger alert-warning alert-info alert-light alert-dark alert-dismissible alert-link alert-heading
    badge rounded-pill bg-primary bg-secondary bg-success bg-danger bg-warning bg-info bg-light bg-dark bg-body bg-body-secondary bg-body-tertiary bg-transparent bg-opacity-50
    text-primary text-secondary text-success text-danger text-warning text-info text-light text-dark text-body text-body-secondary text-muted text-white text-black text-bg-primary text-bg-dark
    text-start text-center text-end text-wrap text-nowrap text-truncate text-uppercase text-lowercase text-capitalize text-decoration-none text-decoration-underline fw-light fw-normal fw-medium fw-semibold fw-bold fst-italic lh-1 lh-sm lh-base lh-lg
    fs-1 fs-2 fs-3 fs-4 fs-5 fs-6 display-1 display-2 display-3 display-4 display-5 display-6 lead small mark h1 h2 h3 h4 h5 h6 blockquote list-unstyled list-inline list-inline-item
    form-control form-control-sm form-control-lg form-control-plaintext form-label form-text form-select form-check form-check-input form-check-label form-switch form-range form-floating
    input-group input-group-text input-group-sm input-group-lg is-valid is-invalid valid-feedback invalid-feedback needs-validation was-validated
    dropdown dropdown-toggle dropdown-menu dropdown-item dropdown-divider dropdown-header dropdown-menu-end dropup dropend dropstart
    modal modal-dialog modal-dialog-centered modal-dialog-scrollable modal-content modal-header modal-title modal-body modal-footer modal-lg modal-sm modal-xl modal-fullscreen modal-backdrop
    accordion accordion-item accordion-header accordion-button accordion-collapse accordion-body accordion-flush
    list-group list-group-item list-group-item-action list-group-flush list-group-numbered breadcrumb breadcrumb-item pagination page-item page-link pagination-sm pagination-lg
    table table-striped table-hover table-bordered table-sm table-responsive table-dark table-light table-active caption-top
    progress progress-bar progress-bar-striped progress-bar-animated spinner-border spinner-grow spinner-border-sm toast toast-container toast-header toast-body
    carousel carousel-inner carousel-item carousel-control-prev carousel-control-next carousel-indicators carousel-caption offcanvas offcanvas-start offcanvas-end offcanvas-top offcanvas-bottom offcanvas-header offcanvas-title offcanvas-body
    tooltip popover placeholder placeholder-glow ratio ratio-16x9 ratio-4x3 ratio-1x1 sticky-top sticky-bottom fixed-top fixed-bottom position-relative position-absolute position-fixed position-sticky top-0 bottom-0 start-0 end-0 top-50 start-50 translate-middle
    d-none d-block d-inline d-inline-block d-flex d-inline-flex d-grid d-sm-none d-md-none d-lg-none d-md-block d-lg-block d-lg-flex d-print-none
    flex-row flex-column flex-wrap flex-nowrap flex-fill flex-grow-1 flex-shrink-0 justify-content-start justify-content-center justify-content-end justify-content-between justify-content-around
    align-items-start align-items-center align-items-end align-items-stretch align-self-center align-self-end align-content-center order-first order-last gap-1 gap-2 gap-3 gap-4 gap-5
    border border-0 border-top border-bottom border-start border-end border-primary border-secondary border-success border-danger border-light border-dark border-1 border-2 border-3 rounded rounded-0 rounded-1 rounded-2 rounded-3 rounded-4 rounded-5 rounded-circle rounded-pill rounded-top rounded-bottom
    shadow shadow-sm shadow-lg shadow-none opacity-0 opacity-25 opacity-50 opacity-75 opacity-100 w-25 w-50 w-75 w-100 w-auto h-25 h-50 h-75 h-100 h-auto mw-100 mh-100 vw-100 vh-100 min-vh-100
    overflow-auto overflow-hidden overflow-scroll visible invisible visually-hidden visually-hidden-focusable stretched-link clearfix float-start float-end float-none link-primary link-secondary link-dark link-body-emphasis link-underline link-underline-opacity-0 object-fit-cover object-fit-contain
    img-fluid img-thumbnail figure figure-img figure-caption embed-responsive user-select-none pe-none pe-auto`
      .split(/\s+/)
      .filter(Boolean),
  );
  for (const side of ["", "t", "b", "s", "e", "x", "y"]) for (const n of BS_SPACING) {
    out.add(`m${side}-${n}`);
    if (n !== "auto") out.add(`p${side}-${n}`);
  }
  for (let i = 1; i <= 12; i++) out.add(`col-${i}`);
  for (const bp of ["sm", "md", "lg", "xl", "xxl"]) {
    out.add(`col-${bp}`);
    for (let i = 1; i <= 12; i++) out.add(`col-${bp}-${i}`);
    for (const n of [1, 2, 3, 4, 5, 6]) out.add(`row-cols-${bp}-${n}`);
  }
  for (const n of [1, 2, 3, 4, 5, 6]) out.add(`row-cols-${n}`);
  return [...out].sort();
})();

// ------------------------------------------------------------------------------------------------ Alpine.js and htmx attributes

/** Alpine.js directives with a short description. `{ label, detail, apply?: snippet }`. */
export const ALPINE_ATTRIBUTES = [
  { label: "x-data", detail: "Declares a component (name of an Alpine.data() component in the CSP build)" },
  { label: "x-init", detail: "Runs code when the element is initialized" },
  { label: "x-show", detail: "Toggles display" },
  { label: "x-text", detail: "Sets the text content" },
  { label: "x-html", detail: "Sets inner HTML (never use with untrusted input)" },
  { label: "x-model", detail: "Two-way binding for inputs" },
  { label: "x-for", detail: "Loops over an array (x-for=\"item in items\")" },
  { label: "x-if", detail: "Conditionally renders a <template>" },
  { label: "x-bind", detail: "Binds attributes (shorthand :attr)" },
  { label: "x-on", detail: "Listens to events (shorthand @event)" },
  { label: "x-transition", detail: "Applies enter/leave transitions" },
  { label: "x-effect", detail: "Re-runs when its dependencies change" },
  { label: "x-ref", detail: "Names an element for $refs" },
  { label: "x-cloak", detail: "Hidden until Alpine has initialized (add [x-cloak]{display:none})" },
  { label: "x-ignore", detail: "Skips initialization of a subtree" },
  { label: "x-id", detail: "Scopes generated ids" },
  { label: "@click", detail: "Click handler" },
  { label: "@click.outside", detail: "Click outside the element" },
  { label: "@click.prevent", detail: "Click, preventing the default action" },
  { label: "@submit.prevent", detail: "Form submit without reloading" },
  { label: "@keydown.escape", detail: "Escape key" },
  { label: "@input", detail: "Input event" },
  { label: ":class", detail: "Binds the class attribute" },
  { label: ":aria-expanded", detail: "Binds aria-expanded" },
  { label: ":disabled", detail: "Binds disabled" },
  { label: ":hidden", detail: "Binds hidden" },
];

/** htmx attributes (`values` lists common values). */
export const HTMX_ATTRIBUTES = [
  { label: "hx-get", detail: "GET request on the default event" },
  { label: "hx-post", detail: "POST request" },
  { label: "hx-put", detail: "PUT request" },
  { label: "hx-patch", detail: "PATCH request" },
  { label: "hx-delete", detail: "DELETE request" },
  { label: "hx-trigger", detail: "Which event triggers the request", values: ["click", "change", "submit", "load", "revealed", "intersect once", "keyup changed delay:300ms", "input changed delay:300ms", "every 5s", "mouseenter"] },
  { label: "hx-target", detail: "Where the response goes (CSS selector, this, closest …)", values: ["this", "closest tr", "closest li", "#result", "next .output", "body"] },
  { label: "hx-swap", detail: "How the response is inserted", values: ["innerHTML", "outerHTML", "beforebegin", "afterbegin", "beforeend", "afterend", "delete", "none", "outerHTML swap:300ms", "innerHTML transition:true"] },
  { label: "hx-select", detail: "Pick part of the response" },
  { label: "hx-select-oob", detail: "Pick out-of-band parts of the response" },
  { label: "hx-swap-oob", detail: "Mark an out-of-band swap in a response", values: ["true", "outerHTML", "beforeend"] },
  { label: "hx-indicator", detail: "Element that shows while the request runs" },
  { label: "hx-push-url", detail: "Push the URL to the history", values: ["true", "false"] },
  { label: "hx-confirm", detail: "Ask before the request" },
  { label: "hx-vals", detail: "Extra values (JSON)" },
  { label: "hx-include", detail: "Include other inputs in the request" },
  { label: "hx-params", detail: "Filter parameters" },
  { label: "hx-boost", detail: "Turn links and forms into AJAX requests", values: ["true"] },
  { label: "hx-on:click", detail: "Inline event handler (needs eval; disabled by default here)" },
  { label: "hx-disabled-elt", detail: "Disable elements while the request runs", values: ["this"] },
  { label: "hx-sync", detail: "Coordinate concurrent requests" },
  { label: "hx-ext", detail: "Enable an extension" },
  { label: "hx-headers", detail: "Extra request headers (JSON)" },
];

// ------------------------------------------------------------------------------------------------ Add panel snippets

/**
 * @typedef {{ id: string, label: string, icon: string, description: string, html: string, css?: string }} FrameworkElement
 * @type {{ id: string, label: string, framework: string, items: FrameworkElement[] }[]}
 */
export const FRAMEWORK_ELEMENT_CATEGORIES = [
  {
    id: "bootstrap",
    label: "Bootstrap 5",
    framework: "bootstrap",
    items: [
      { id: "bs-navbar", label: "Navbar", icon: "list", description: "Responsive navbar with a collapse toggle.", html: `<nav class="navbar navbar-expand-lg bg-body-tertiary">
  <div class="container">
    <a class="navbar-brand" href="#">Brand</a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarMain" aria-controls="navbarMain" aria-expanded="false" aria-label="Toggle navigation">
      <span class="navbar-toggler-icon"></span>
    </button>
    <div class="collapse navbar-collapse" id="navbarMain">
      <ul class="navbar-nav ms-auto">
        <li class="nav-item"><a class="nav-link active" aria-current="page" href="#">Home</a></li>
        <li class="nav-item"><a class="nav-link" href="#">Features</a></li>
        <li class="nav-item"><a class="nav-link" href="#">Pricing</a></li>
      </ul>
    </div>
  </div>
</nav>` },
      { id: "bs-card", label: "Card", icon: "card-text", description: "Card with image, title, text and button.", html: `<div class="card" style="width: 18rem;">
  <img src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='288' height='160'%3E%3Crect width='100%25' height='100%25' fill='%23dee2e6'/%3E%3C/svg%3E" class="card-img-top" alt="Placeholder">
  <div class="card-body">
    <h5 class="card-title">Card title</h5>
    <p class="card-text">Some quick example text to build on the card title.</p>
    <a href="#" class="btn btn-primary">Go somewhere</a>
  </div>
</div>` },
      { id: "bs-grid", label: "Grid row (3 columns)", icon: "columns-gap", description: "Responsive three-column row.", html: `<div class="row g-4">
  <div class="col-12 col-md-4"><div class="p-3 border bg-body-tertiary rounded">Column</div></div>
  <div class="col-12 col-md-4"><div class="p-3 border bg-body-tertiary rounded">Column</div></div>
  <div class="col-12 col-md-4"><div class="p-3 border bg-body-tertiary rounded">Column</div></div>
</div>` },
      { id: "bs-alert", label: "Alert", icon: "exclamation-triangle", description: "Dismissible alert.", html: `<div class="alert alert-primary alert-dismissible fade show" role="alert">
  <strong>Heads up!</strong> This is an important message.
  <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
</div>` },
      { id: "bs-accordion", label: "Accordion", icon: "chevron-expand", description: "Collapsible panels.", html: `<div class="accordion" id="accordionExample">
  <div class="accordion-item">
    <h2 class="accordion-header"><button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#collapseOne" aria-expanded="true" aria-controls="collapseOne">First item</button></h2>
    <div id="collapseOne" class="accordion-collapse collapse show" data-bs-parent="#accordionExample"><div class="accordion-body">Content of the first item.</div></div>
  </div>
  <div class="accordion-item">
    <h2 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseTwo" aria-expanded="false" aria-controls="collapseTwo">Second item</button></h2>
    <div id="collapseTwo" class="accordion-collapse collapse" data-bs-parent="#accordionExample"><div class="accordion-body">Content of the second item.</div></div>
  </div>
</div>` },
      { id: "bs-modal", label: "Modal with button", icon: "window-stack", description: "A button that opens a modal dialog.", html: `<div>
  <button type="button" class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#exampleModal">Open modal</button>
  <div class="modal fade" id="exampleModal" tabindex="-1" aria-labelledby="exampleModalLabel" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header"><h1 class="modal-title fs-5" id="exampleModalLabel">Modal title</h1><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
        <div class="modal-body">Modal body text.</div>
        <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button><button type="button" class="btn btn-primary">Save changes</button></div>
      </div>
    </div>
  </div>
</div>` },
      { id: "bs-form", label: "Form group", icon: "input-cursor-text", description: "Labelled input with help text.", html: `<div class="mb-3">
  <label for="emailInput" class="form-label">Email address</label>
  <input type="email" class="form-control" id="emailInput" aria-describedby="emailHelp" placeholder="name@example.com">
  <div id="emailHelp" class="form-text">We will never share your email.</div>
</div>` },
      { id: "bs-tabs", label: "Tabs", icon: "folder2", description: "Tab navigation with panes.", html: `<div>
  <ul class="nav nav-tabs" id="exampleTabs" role="tablist">
    <li class="nav-item" role="presentation"><button class="nav-link active" id="tab-a" data-bs-toggle="tab" data-bs-target="#pane-a" type="button" role="tab" aria-controls="pane-a" aria-selected="true">First</button></li>
    <li class="nav-item" role="presentation"><button class="nav-link" id="tab-b" data-bs-toggle="tab" data-bs-target="#pane-b" type="button" role="tab" aria-controls="pane-b" aria-selected="false">Second</button></li>
  </ul>
  <div class="tab-content p-3">
    <div class="tab-pane fade show active" id="pane-a" role="tabpanel" aria-labelledby="tab-a" tabindex="0">First pane.</div>
    <div class="tab-pane fade" id="pane-b" role="tabpanel" aria-labelledby="tab-b" tabindex="0">Second pane.</div>
  </div>
</div>` },
      { id: "bs-list-group", label: "List group", icon: "list-ul", description: "Linked list items.", html: `<div class="list-group">
  <a href="#" class="list-group-item list-group-item-action active" aria-current="true">First item</a>
  <a href="#" class="list-group-item list-group-item-action">Second item</a>
  <a href="#" class="list-group-item list-group-item-action">Third item</a>
</div>` },
    ],
  },
  {
    id: "tailwind",
    label: "Tailwind CSS",
    framework: "tailwind",
    items: [
      { id: "tw-button", label: "Button", icon: "hand-index", description: "Primary button.", html: `<button type="button" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">Button</button>` },
      { id: "tw-card", label: "Card", icon: "card-text", description: "Card with title and text.", html: `<article class="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
  <h3 class="text-lg font-semibold text-slate-900 dark:text-white">Card title</h3>
  <p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">A short description that explains what this card is about.</p>
  <a href="#" class="mt-4 inline-flex text-sm font-semibold text-indigo-600 hover:text-indigo-500">Learn more</a>
</article>` },
      { id: "tw-hero", label: "Hero", icon: "layout-text-window", description: "Centered hero with two buttons.", html: `<section class="px-6 py-24 text-center sm:py-32">
  <h2 class="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl dark:text-white">Build something people love</h2>
  <p class="mx-auto mt-6 max-w-xl text-lg leading-8 text-slate-600 dark:text-slate-400">A short supporting sentence that says what you offer and who it is for.</p>
  <div class="mt-10 flex items-center justify-center gap-x-4">
    <a href="#" class="rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-500">Get started</a>
    <a href="#" class="text-sm font-semibold text-slate-900 dark:text-white">Learn more <span aria-hidden="true">&rarr;</span></a>
  </div>
</section>` },
      { id: "tw-grid", label: "Feature grid", icon: "grid-3x3-gap", description: "Three features in a responsive grid.", html: `<section class="mx-auto grid max-w-5xl gap-8 px-6 py-16 sm:grid-cols-2 lg:grid-cols-3">
  <div><h3 class="font-semibold text-slate-900 dark:text-white">Fast</h3><p class="mt-2 text-sm text-slate-600 dark:text-slate-400">Short description of the first feature.</p></div>
  <div><h3 class="font-semibold text-slate-900 dark:text-white">Simple</h3><p class="mt-2 text-sm text-slate-600 dark:text-slate-400">Short description of the second feature.</p></div>
  <div><h3 class="font-semibold text-slate-900 dark:text-white">Flexible</h3><p class="mt-2 text-sm text-slate-600 dark:text-slate-400">Short description of the third feature.</p></div>
</section>` },
      { id: "tw-badge", label: "Badge", icon: "tag", description: "Small status badge.", html: `<span class="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">New</span>` },
      { id: "tw-input", label: "Input", icon: "input-cursor-text", description: "Labelled text input.", html: `<label class="block text-sm font-medium text-slate-700 dark:text-slate-300">Email
  <input type="email" class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900" placeholder="name@example.com">
</label>` },
    ],
  },
  {
    id: "htmx",
    label: "htmx",
    framework: "htmx",
    items: [
      { id: "hx-load", label: "Load on click", icon: "cloud-download", description: "Button that loads HTML into a target (point hx-get at your server).", html: `<div><button type="button" class="btn" hx-get="/api/example" hx-target="#hx-result" hx-swap="innerHTML">Load</button><div id="hx-result" aria-live="polite"></div></div>` },
      { id: "hx-search", label: "Search as you type", icon: "search", description: "Input that requests results after a short pause.", html: `<div><input type="search" name="q" placeholder="Search" aria-label="Search" hx-get="/api/search" hx-trigger="input changed delay:300ms" hx-target="#hx-results"><ul id="hx-results" aria-live="polite"></ul></div>` },
      { id: "hx-form", label: "Inline form", icon: "send", description: "Form that posts without reloading the page.", html: `<form hx-post="/api/items" hx-target="#hx-list" hx-swap="beforeend"><label>Name <input type="text" name="name" required></label><button type="submit">Add</button></form>` },
    ],
  },
];

/**
 * Completion options for attributes of a tag being typed.
 * @param {Set<string>} frameworks from detectFrameworks
 * @returns {{ label: string, detail: string }[]}
 */
export function attributeOptions(frameworks) {
  const out = [];
  if (frameworks.has("alpine")) out.push(...ALPINE_ATTRIBUTES.map((a) => ({ ...a, type: "property", section: "Alpine.js" })));
  if (frameworks.has("htmx")) out.push(...HTMX_ATTRIBUTES.map((a) => ({ label: a.label, detail: a.detail, type: "property", section: "htmx" })));
  return out;
}

/** Common values for an htmx attribute (or []). */
export function htmxValues(attr) {
  return HTMX_ATTRIBUTES.find((a) => a.label === attr)?.values || [];
}
