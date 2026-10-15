import { FOUNDATION, MAIN_JS, MENU_ICON, compose, head } from "./shared.js";

const html = `<!doctype html>
<html lang="en-US">
<head>
  ${head({ title: "Untitled page", description: "A blank page that is ready for your first section." })}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="index.html">My site</a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-nav-toggle>
        <span class="sr-only">Menu</span>
        ${MENU_ICON}
      </button>
      <nav class="nav" id="site-nav" aria-label="Primary" data-nav>
        <ul class="nav-list">
          <li><a href="#start">Start</a></li>
          <li><a href="#about">About</a></li>
        </ul>
      </nav>
    </div>
  </header>

  <main id="main">
    <section class="intro container">
      <p class="eyebrow">Blank project</p>
      <h1>Start with a clean page</h1>
      <p class="lead">This page is plain HTML and CSS. Click an element in the preview to style it, add sections from the Add panel, or write the code yourself.</p>
      <a class="btn btn-primary" href="#start">Get started</a>
    </section>

    <section class="section container" id="start">
      <h2>Build it your way</h2>
      <div class="columns">
        <p>Every file in this project is a normal web file. Change the headings, swap the colors in <code>css/style.css</code>, and publish when you are ready.</p>
        <p>The layout adapts on its own: widths shrink at 991, 767 and 478 pixels, so the page stays readable on tablets and phones.</p>
      </div>
    </section>

    <section class="section container" id="about">
      <h2>About this page</h2>
      <p>Replace this text with a few sentences about you, your team or your project.</p>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container">
      <p>&copy; <span data-year>2026</span> My site. All rights reserved.</p>
    </div>
  </footer>

  <script src="js/main.js"></script>
</body>
</html>
`;

const own = {
  root: `:root {
  --bg: #ffffff;
  --surface: #f6f7f9;
  --text: #16181d;
  --muted: #565d6b;
  --border: #e3e6eb;
  --accent: #2f4fd8;
  --accent-ink: #ffffff;
  --radius: 10px;
  --shadow: 0 6px 20px rgba(22, 24, 29, 0.1);
  --header-bg: rgba(255, 255, 255, 0.92);
  --container: 1040px;
  --font-body: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-heading: var(--font-body);
}`,
  base: `.intro {
  padding-top: 120px;
  padding-bottom: 96px;
}

.intro h1 {
  max-width: 14ch;
}

.intro .lead {
  max-width: 36rem;
  margin-bottom: 2rem;
}

.columns {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 32px;
}

code {
  padding: 0.15em 0.4em;
  border-radius: 6px;
  background: var(--surface);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
}`,
  m991: `.intro {
    padding-top: 88px;
    padding-bottom: 64px;
  }`,
  m767: `.columns {
    grid-template-columns: 1fr;
    gap: 0;
  }`,
  m478: `.intro {
    padding-top: 56px;
    padding-bottom: 40px;
  }

  .intro .btn {
    width: 100%;
  }`,
};

export const blank = {
  id: "blank",
  name: "Blank",
  description: "A clean page with a header, a hero and two sections. Everything else is up to you.",
  category: "Starter",
  accent: "#2f4fd8",
  files: {
    "index.html": html,
    "css/style.css": compose(FOUNDATION, own),
    "js/main.js": MAIN_JS,
  },
};
