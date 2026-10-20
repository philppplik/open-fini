import { CDN, page } from "./fw-shared.js";

const tailwindHtml = page({
  title: "Tailwind starter",
  description: "A landing page built with Tailwind CSS utility classes, running without a build step.",
  head: `  <script src="${CDN.tailwind}"></script>
  <style type="text/tailwindcss">
    @custom-variant dark (&:where(.dark, .dark *));
    @theme {
      --color-brand-500: #6366f1;
      --color-brand-600: #4f46e5;
    }
  </style>
`,
  bodyAttrs: ' class="bg-white text-slate-800 antialiased dark:bg-slate-950 dark:text-slate-200"',
  body: `  <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white">Skip to content</a>
  <header class="border-b border-slate-200 dark:border-slate-800">
    <div class="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
      <a href="index.html" class="text-lg font-bold tracking-tight">Northwind</a>
      <nav aria-label="Primary" class="flex items-center gap-6 text-sm font-medium">
        <a href="#features" class="hover:text-brand-600">Features</a>
        <a href="#pricing" class="hover:text-brand-600">Pricing</a>
        <button type="button" data-theme-toggle aria-pressed="false" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Dark mode</button>
      </nav>
    </div>
  </header>
  <main id="main">
    <section class="mx-auto max-w-3xl px-6 py-24 text-center sm:py-32">
      <p class="text-sm font-semibold uppercase tracking-widest text-brand-600">Utility-first CSS</p>
      <h1 class="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">Design directly in your markup</h1>
      <p class="mx-auto mt-6 max-w-xl text-lg leading-8 text-slate-600 dark:text-slate-400">Every style on this page is a Tailwind class. Click an element, change its classes in the code, and the page updates instantly.</p>
      <div class="mt-10 flex items-center justify-center gap-4">
        <a href="#pricing" class="rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">Get started</a>
        <a href="#features" class="text-sm font-semibold">Learn more <span aria-hidden="true">&rarr;</span></a>
      </div>
    </section>
    <section id="features" class="mx-auto max-w-5xl px-6 py-16">
      <h2 class="text-center text-2xl font-bold">Everything you need</h2>
      <div class="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <article class="rounded-2xl border border-slate-200 p-6 dark:border-slate-800"><h3 class="font-semibold">Responsive by default</h3><p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">Prefix a class with sm:, md: or lg: to change it at a breakpoint.</p></article>
        <article class="rounded-2xl border border-slate-200 p-6 dark:border-slate-800"><h3 class="font-semibold">Dark mode</h3><p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">The toggle in the header adds a dark class; dark: variants do the rest.</p></article>
        <article class="rounded-2xl border border-slate-200 p-6 dark:border-slate-800"><h3 class="font-semibold">Your own theme</h3><p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">Colors such as brand-600 come from the @theme block in the head.</p></article>
      </div>
    </section>
    <section id="pricing" class="mx-auto max-w-5xl px-6 py-16">
      <h2 class="text-center text-2xl font-bold">Simple pricing</h2>
      <div class="mx-auto mt-10 grid max-w-3xl gap-6 sm:grid-cols-2">
        <div class="rounded-2xl border border-slate-200 p-8 dark:border-slate-800"><h3 class="font-semibold">Hobby</h3><p class="mt-4 text-4xl font-bold">$0</p><p class="mt-2 text-sm text-slate-600 dark:text-slate-400">For side projects.</p></div>
        <div class="rounded-2xl border-2 border-brand-600 p-8"><h3 class="font-semibold">Team</h3><p class="mt-4 text-4xl font-bold">$12</p><p class="mt-2 text-sm text-slate-600 dark:text-slate-400">Per person, per month.</p></div>
      </div>
    </section>
  </main>
  <footer class="border-t border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-slate-800">&copy; <span data-year>2026</span> Northwind. Built with Tailwind CSS.</footer>
  <script src="js/main.js"></script>`,
});

const tailwindJs = `// Dark mode: toggles the "dark" class on <html>. Storage is wrapped in try/catch because it can be unavailable
// (for example in a sandboxed preview).
(function () {
  var root = document.documentElement;
  var button = document.querySelector("[data-theme-toggle]");
  function read() {
    try { return localStorage.getItem("theme"); } catch (e) { return null; }
  }
  function write(value) {
    try { localStorage.setItem("theme", value); } catch (e) { /* ignore */ }
  }
  function apply(dark) {
    root.classList.toggle("dark", dark);
    if (button) button.setAttribute("aria-pressed", String(dark));
  }
  var saved = read();
  apply(saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (button) button.addEventListener("click", function () {
    var dark = !root.classList.contains("dark");
    apply(dark);
    write(dark ? "dark" : "light");
  });
  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
})();
`;

export const tailwind = {
  id: "tailwind",
  name: "Tailwind CSS",
  description: "Utility-first landing page with dark mode, using the Tailwind browser build from a CDN.",
  category: "Framework",
  accent: "#06b6d4",
  framework: true,
  libs: ["Tailwind CSS 4 (CDN)"],
  files: { "index.html": tailwindHtml, "js/main.js": tailwindJs },
};

const bootstrapHtml = page({
  title: "Bootstrap starter",
  description: "A responsive page built with Bootstrap 5 components: navbar, cards, accordion, modal and a validated form.",
  head: `  <link rel="stylesheet" href="${CDN.bootstrapCss}">
  <link rel="stylesheet" href="css/style.css">
  <script src="${CDN.bootstrapJs}" defer></script>
  <script src="js/main.js" defer></script>
`,
  body: `  <a class="visually-hidden-focusable" href="#main">Skip to content</a>
  <nav class="navbar navbar-expand-lg bg-body-tertiary border-bottom">
    <div class="container">
      <a class="navbar-brand fw-bold" href="index.html">Contoso</a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navMain" aria-controls="navMain" aria-expanded="false" aria-label="Toggle navigation"><span class="navbar-toggler-icon"></span></button>
      <div class="collapse navbar-collapse" id="navMain">
        <ul class="navbar-nav ms-auto">
          <li class="nav-item"><a class="nav-link active" aria-current="page" href="#top">Home</a></li>
          <li class="nav-item"><a class="nav-link" href="#cards">Services</a></li>
          <li class="nav-item"><a class="nav-link" href="#faq">FAQ</a></li>
          <li class="nav-item"><a class="nav-link" href="#contact">Contact</a></li>
        </ul>
      </div>
    </div>
  </nav>
  <main id="main">
    <header class="hero py-5" id="top">
      <div class="container py-5 text-center">
        <h1 class="display-4 fw-bold">Ship a good-looking site today</h1>
        <p class="lead mx-auto mb-4" style="max-width: 36rem;">Bootstrap 5 gives you a grid, components and sensible defaults. Edit the HTML, or tweak the look in css/style.css.</p>
        <a class="btn btn-primary btn-lg me-2" href="#contact">Get in touch</a>
        <button type="button" class="btn btn-outline-secondary btn-lg" data-bs-toggle="modal" data-bs-target="#aboutModal">About us</button>
      </div>
    </header>
    <section class="container py-5" id="cards">
      <h2 class="mb-4">Services</h2>
      <div class="row g-4">
        <div class="col-12 col-md-4"><div class="card h-100"><div class="card-body"><h3 class="card-title h5">Design</h3><p class="card-text">Interfaces that are clear, accessible and fast.</p></div></div></div>
        <div class="col-12 col-md-4"><div class="card h-100"><div class="card-body"><h3 class="card-title h5">Development</h3><p class="card-text">Clean HTML, CSS and JavaScript without heavy tooling.</p></div></div></div>
        <div class="col-12 col-md-4"><div class="card h-100"><div class="card-body"><h3 class="card-title h5">Support</h3><p class="card-text">Friendly help when you need it, in plain language.</p></div></div></div>
      </div>
    </section>
    <section class="container py-5" id="faq">
      <h2 class="mb-4">Questions</h2>
      <div class="accordion" id="faqList">
        <div class="accordion-item">
          <h3 class="accordion-header"><button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#faq1" aria-expanded="true" aria-controls="faq1">Do I need to install anything?</button></h3>
          <div id="faq1" class="accordion-collapse collapse show" data-bs-parent="#faqList"><div class="accordion-body">No. Bootstrap is loaded from a CDN. Use Libraries to download it into the project for offline use.</div></div>
        </div>
        <div class="accordion-item">
          <h3 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#faq2" aria-expanded="false" aria-controls="faq2">Can I change the colors?</button></h3>
          <div id="faq2" class="accordion-collapse collapse" data-bs-parent="#faqList"><div class="accordion-body">Yes. Override the CSS variables in css/style.css, for example --bs-primary.</div></div>
        </div>
      </div>
    </section>
    <section class="container py-5" id="contact">
      <h2 class="mb-4">Contact</h2>
      <form class="needs-validation row g-3" novalidate style="max-width: 36rem;">
        <div class="col-12"><label for="name" class="form-label">Name</label><input type="text" class="form-control" id="name" required><div class="invalid-feedback">Please enter your name.</div></div>
        <div class="col-12"><label for="email" class="form-label">Email</label><input type="email" class="form-control" id="email" required><div class="invalid-feedback">Please enter a valid email address.</div></div>
        <div class="col-12"><button class="btn btn-primary" type="submit">Send</button> <span class="text-success ms-2" id="sent" role="status"></span></div>
      </form>
    </section>
  </main>
  <footer class="border-top py-4 text-center text-body-secondary">&copy; <span data-year>2026</span> Contoso</footer>
  <div class="modal fade" id="aboutModal" tabindex="-1" aria-labelledby="aboutTitle" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered"><div class="modal-content">
      <div class="modal-header"><h2 class="modal-title fs-5" id="aboutTitle">About us</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
      <div class="modal-body">We are a small team that likes simple tools and clear pages.</div>
      <div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button></div>
    </div></div>
  </div>`,
});

const bootstrapCss = `/* Overrides for Bootstrap 5. Bootstrap's own styles come from the CDN link in index.html. */
:root {
  --bs-primary: #0d6efd;
  --bs-primary-rgb: 13, 110, 253;
}

.hero {
  background: linear-gradient(180deg, var(--bs-tertiary-bg) 0%, var(--bs-body-bg) 100%);
}

.card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
.card:hover { transform: translateY(-2px); box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.1); }

@media (prefers-reduced-motion: reduce) {
  .card { transition: none; }
  .card:hover { transform: none; }
}
`;

const bootstrapJs = `// Bootstrap form validation and the current year. Components (navbar, modal, accordion) need no extra code.
(function () {
  var form = document.querySelector(".needs-validation");
  var sent = document.getElementById("sent");
  if (form) form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!form.checkValidity()) {
      event.stopPropagation();
      form.classList.add("was-validated");
      return;
    }
    form.classList.remove("was-validated");
    form.reset();
    if (sent) sent.textContent = "Thanks! This demo does not send the form anywhere.";
  });
  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
})();
`;

export const bootstrap = {
  id: "bootstrap",
  name: "Bootstrap 5",
  description: "Responsive page with navbar, cards, accordion, modal and a validated form. Bootstrap loads from a CDN.",
  category: "Framework",
  accent: "#7952b3",
  framework: true,
  libs: ["Bootstrap 5.3 (CDN)"],
  files: { "index.html": bootstrapHtml, "css/style.css": bootstrapCss, "js/main.js": bootstrapJs },
};
