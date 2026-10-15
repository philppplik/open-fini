import { FOUNDATION, MAIN_JS, MENU_ICON, compose, head, icon } from "./shared.js";

const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 560" fill="none">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd8c2"/><stop offset="1" stop-color="#f6b9a0"/></linearGradient>
  </defs>
  <rect width="480" height="560" rx="240" ry="240" fill="url(#sky)"/>
  <circle cx="240" cy="470" r="150" fill="#2b2522"/>
  <path d="M120 560c0-72 54-124 120-124s120 52 120 124z" fill="#c23b20"/>
  <rect x="212" y="348" width="56" height="64" rx="22" fill="#e0a587"/>
  <ellipse cx="240" cy="270" rx="92" ry="104" fill="#edb89b"/>
  <path d="M146 262c-8-92 52-136 106-130 62 6 90 62 82 130-14-44-52-70-96-66-46 4-76 30-92 66z" fill="#2b2522"/>
  <circle cx="204" cy="278" r="7" fill="#2b2522"/><circle cx="276" cy="278" r="7" fill="#2b2522"/>
  <path d="M214 322c14 14 38 14 52 0" stroke="#9a4a33" stroke-width="6" stroke-linecap="round"/>
  <circle cx="378" cy="120" r="26" fill="#fff" opacity="0.55"/>
  <circle cx="96" cy="196" r="14" fill="#fff" opacity="0.45"/>
</svg>
`;

const thumb = (a, b, c, shapes) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" fill="none">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="640" height="480" fill="url(#g)"/>
  ${shapes(c)}
</svg>
`;

const WORK = {
  "assets/work-1.svg": thumb("#fde7d9", "#f6b9a0", "#c23b20", (c) => `<rect x="200" y="56" width="240" height="368" rx="36" fill="#fff"/>
  <rect x="224" y="92" width="192" height="88" rx="18" fill="${c}"/>
  <rect x="240" y="112" width="72" height="10" rx="5" fill="#fff" opacity="0.9"/><rect x="240" y="136" width="128" height="22" rx="8" fill="#fff"/>
  <rect x="224" y="204" width="192" height="44" rx="12" fill="#f3ece6"/><rect x="224" y="260" width="192" height="44" rx="12" fill="#f3ece6"/><rect x="224" y="316" width="192" height="44" rx="12" fill="#f3ece6"/>
  <circle cx="246" cy="226" r="10" fill="${c}"/><circle cx="246" cy="282" r="10" fill="#2b2522"/><circle cx="246" cy="338" r="10" fill="#e0a587"/>`),
  "assets/work-2.svg": thumb("#d9efe6", "#9fd3bd", "#1f7a5c", (c) => `<rect x="120" y="96" width="400" height="288" rx="28" fill="#fff"/>
  <rect x="152" y="132" width="160" height="14" rx="7" fill="${c}"/>
  <rect x="152" y="172" width="22" height="22" rx="7" fill="${c}"/><rect x="190" y="177" width="200" height="12" rx="6" fill="#d9efe6"/>
  <rect x="152" y="212" width="22" height="22" rx="7" fill="#d9efe6"/><rect x="190" y="217" width="160" height="12" rx="6" fill="#d9efe6"/>
  <rect x="152" y="252" width="22" height="22" rx="7" fill="#d9efe6"/><rect x="190" y="257" width="224" height="12" rx="6" fill="#d9efe6"/>
  <circle cx="440" cy="168" r="34" fill="#fde7d9"/><circle cx="470" cy="190" r="24" fill="#c23b20" opacity="0.85"/>`),
  "assets/work-3.svg": thumb("#e4e0f7", "#b9b0ea", "#4b3bb0", (c) => `<rect x="96" y="80" width="200" height="140" rx="20" fill="#fff"/><rect x="344" y="80" width="200" height="140" rx="20" fill="${c}"/>
  <rect x="96" y="260" width="200" height="140" rx="20" fill="${c}" opacity="0.55"/><rect x="344" y="260" width="200" height="140" rx="20" fill="#fff"/>
  <circle cx="196" cy="150" r="32" fill="${c}"/><rect x="376" y="124" width="136" height="12" rx="6" fill="#fff"/><rect x="376" y="152" width="96" height="12" rx="6" fill="#fff" opacity="0.6"/>
  <rect x="376" y="304" width="136" height="14" rx="7" fill="${c}"/><rect x="376" y="334" width="100" height="12" rx="6" fill="#e4e0f7"/>`),
  "assets/work-4.svg": thumb("#fbefc9", "#f3d37a", "#8a5a00", (c) => `<path d="M80 360 C 180 120, 280 420, 380 200 S 520 120, 560 100" stroke="${c}" stroke-width="14" stroke-linecap="round"/>
  <circle cx="80" cy="360" r="22" fill="#fff" stroke="${c}" stroke-width="10"/><circle cx="560" cy="100" r="22" fill="${c}"/>
  <circle cx="330" cy="290" r="16" fill="#fff" stroke="${c}" stroke-width="8"/>
  <rect x="404" y="300" width="148" height="72" rx="16" fill="#fff"/><rect x="424" y="322" width="88" height="10" rx="5" fill="${c}"/><rect x="424" y="344" width="64" height="8" rx="4" fill="#f3d37a"/>`),
};

const workCard = (n, tag, title, text, alt) => `
        <li class="work-card">
          <a class="work-link" href="#contact">
            <img src="assets/work-${n}.svg" width="640" height="480" alt="${alt}" loading="lazy">
            <span class="work-body">
              <span class="work-tag">${tag}</span>
              <span class="work-title">${title}</span>
              <span class="work-text">${text}</span>
            </span>
          </a>
        </li>`;

const html = `<!doctype html>
<html lang="en-US">
<head>
  ${head({ title: "Maya Ortiz | Product designer", description: "Maya Ortiz is a product designer in Lisbon who designs calm, useful software. See selected work and get in touch." })}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="#top">Maya Ortiz</a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-nav-toggle>
        <span class="sr-only">Menu</span>
        ${MENU_ICON}
      </button>
      <nav class="nav" id="site-nav" aria-label="Primary" data-nav>
        <ul class="nav-list">
          <li><a href="#work">Work</a></li>
          <li><a href="#about">About</a></li>
          <li><a href="#process">Process</a></li>
          <li><a class="btn btn-primary btn-small" href="#contact">Get in touch</a></li>
        </ul>
      </nav>
    </div>
  </header>

  <main id="main">
    <section class="hero" id="top">
      <div class="container hero-grid">
        <div>
          <p class="eyebrow">Product designer in Lisbon</p>
          <h1>I design calm, useful software for people with better things to do.</h1>
          <p class="lead">For nine years I have helped small teams turn fuzzy problems into products that feel obvious to use. Currently booking projects for the autumn.</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="#work">See selected work</a>
            <a class="btn btn-secondary" href="#contact">Say hello</a>
          </div>
        </div>
        <div class="hero-portrait">
          <img src="assets/avatar.svg" width="480" height="560" alt="Portrait illustration of Maya Ortiz with dark hair and a red jacket.">
        </div>
      </div>
    </section>

    <section class="section" id="work" aria-labelledby="work-title">
      <div class="container">
        <div class="section-head">
          <p class="eyebrow">Selected work</p>
          <h2 id="work-title">Four projects I am proud of</h2>
        </div>
        <ul class="work-grid">${workCard(1, "Mobile app", "Tidewater", "A banking app that helps freelancers set money aside for taxes without thinking about it.", "Phone screen of a banking app with a balance card and three transactions.")}${workCard(2, "Web app", "Pantry", "Shared grocery lists that households actually keep using, built around one-tap check-offs.", "Shopping list with checked and unchecked items and two small avatars.")}${workCard(3, "Design system", "Northlight", "A system of 60 components that cut design-to-code handoff from two weeks to two days.", "Grid of four interface cards in purple and white.")}${workCard(4, "Maps and wayfinding", "Wayfinder", "Transit maps with step-free routes first, designed with riders who use wheelchairs.", "Winding route on a yellow map with a start marker, a destination and a legend card.")}
        </ul>
      </div>
    </section>

    <section class="section about" id="about" aria-labelledby="about-title">
      <div class="container about-grid">
        <div>
          <p class="eyebrow">About</p>
          <h2 id="about-title">Small teams, clear thinking</h2>
        </div>
        <div>
          <p>I started as a graphic designer and fell for interfaces the first time I watched someone use something I made. Since then I have worked with startups, studios and one very patient city transit agency.</p>
          <p>I like research that fits in a week, prototypes that can be tested on Friday and design files that developers do not dread opening.</p>
          <ul class="chips" aria-label="Skills">
            <li>User research</li>
            <li>Interaction design</li>
            <li>Design systems</li>
            <li>Prototyping</li>
            <li>Accessibility</li>
            <li>Workshops</li>
          </ul>
          <dl class="facts">
            <div><dt>Years of experience</dt><dd>9</dd></div>
            <div><dt>Products shipped</dt><dd>30+</dd></div>
            <div><dt>Time zone</dt><dd>WET (UTC+0)</dd></div>
          </dl>
        </div>
      </div>
    </section>

    <section class="section" id="process" aria-labelledby="process-title">
      <div class="container">
        <div class="section-head">
          <p class="eyebrow">Process</p>
          <h2 id="process-title">How we could work together</h2>
        </div>
        <ol class="process">
          <li>
            <span class="process-icon">${icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}</span>
            <h3>Discover</h3>
            <p>We talk to your users, read your data and agree on the one problem worth solving first.</p>
          </li>
          <li>
            <span class="process-icon">${icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>')}</span>
            <h3>Design</h3>
            <p>Sketches, flows and a clickable prototype you can put in front of people within two weeks.</p>
          </li>
          <li>
            <span class="process-icon">${icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>')}</span>
            <h3>Hand off</h3>
            <p>Tidy files, written notes and a standing call with your developers until it is live.</p>
          </li>
        </ol>
      </div>
    </section>

    <section class="contact" id="contact" aria-labelledby="contact-title">
      <div class="container contact-inner">
        <h2 id="contact-title">Have something in mind?</h2>
        <p class="lead">Tell me about the project, the timeline and the people who will use it. I answer every message within two working days.</p>
        <a class="btn btn-light" href="mailto:hello@mayaortiz.example">hello@mayaortiz.example</a>
        <ul class="social" aria-label="Elsewhere">
          <li><a href="#top">LinkedIn</a></li>
          <li><a href="#top">Dribbble</a></li>
          <li><a href="#top">Read.cv</a></li>
        </ul>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <p>&copy; <span data-year>2026</span> Maya Ortiz</p>
      <p><a href="#top">Back to top</a></p>
    </div>
  </footer>

  <script src="js/main.js"></script>
</body>
</html>
`;

const own = {
  root: `:root {
  --bg: #fbf7f2;
  --surface: #ffffff;
  --text: #231f1c;
  --muted: #655c55;
  --border: #e8dfd5;
  --accent: #c23b20;
  --accent-ink: #ffffff;
  --radius: 999px;
  --shadow: 0 14px 34px rgba(60, 36, 20, 0.16);
  --header-bg: rgba(251, 247, 242, 0.92);
  --container: 1120px;
  --font-body: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-heading: Georgia, Cambria, "Times New Roman", Times, serif;
}`,
  base: `h1,
h2 {
  font-weight: 700;
  letter-spacing: -0.015em;
}

.btn-small {
  padding: 0.5rem 1.1rem;
  font-size: 0.9375rem;
}

.btn-light {
  background: #ffffff;
  color: var(--text);
}

.hero {
  padding: 88px 0 72px;
}

.hero-grid {
  display: grid;
  grid-template-columns: 1.3fr 0.7fr;
  align-items: center;
  gap: 64px;
}

.hero h1 {
  max-width: 18ch;
}

.hero .lead {
  max-width: 34rem;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 2rem;
}

.hero-portrait img {
  width: 100%;
  max-width: 340px;
  margin-left: auto;
  filter: drop-shadow(0 22px 34px rgba(194, 59, 32, 0.22));
}

.section-head {
  max-width: 40rem;
  margin-bottom: 2.5rem;
}

.work-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 32px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.work-link {
  display: block;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--surface);
  color: inherit;
  text-decoration: none;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.work-link:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow);
}

.work-link img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
}

.work-body {
  display: block;
  padding: 24px 28px 28px;
}

.work-tag {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
}

.work-title {
  display: block;
  margin-bottom: 0.4rem;
  font-family: var(--font-heading);
  font-size: 1.625rem;
  font-weight: 700;
}

.work-text {
  display: block;
  color: var(--muted);
}

.about {
  background: #f3ebe1;
}

.about-grid {
  display: grid;
  grid-template-columns: 0.8fr 1.2fr;
  gap: 64px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 1.5rem 0;
  padding: 0;
  list-style: none;
}

.chips li {
  padding: 0.35rem 0.9rem;
  border: 1px solid #d9cbbb;
  border-radius: 999px;
  background: var(--surface);
  font-size: 0.9375rem;
}

.facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin: 2rem 0 0;
}

.facts dt {
  font-size: 0.875rem;
  color: var(--muted);
}

.facts dd {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 1.75rem;
  font-weight: 700;
}

.process {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.process li {
  padding: 28px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--surface);
}

.process p {
  margin: 0;
  color: var(--muted);
}

.process-icon {
  display: inline-grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 1rem;
  border-radius: 50%;
  background: #fde7d9;
  color: var(--accent);
}

.contact {
  padding: 96px 0;
  background: #2b2522;
  color: #fbf7f2;
  text-align: center;
}

.contact .lead {
  max-width: 36rem;
  margin: 0 auto 2rem;
  color: #d8cfc6;
}

.social {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 24px;
  margin: 2.5rem 0 0;
  padding: 0;
  list-style: none;
}

.social a {
  color: #fbf7f2;
}

.footer-inner {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.footer-inner p {
  margin: 0;
}`,
  m991: `.hero {
    padding: 56px 0 48px;
  }

  .hero-grid {
    grid-template-columns: 1fr 0.6fr;
    gap: 32px;
  }

  .about-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .process {
    grid-template-columns: 1fr;
  }

  .nav-list .btn {
    margin-top: 8px;
  }`,
  m767: `.hero-grid {
    grid-template-columns: 1fr;
  }

  .hero-portrait {
    order: -1;
  }

  .hero-portrait img {
    max-width: 220px;
    margin-left: 0;
  }

  .work-grid {
    grid-template-columns: 1fr;
  }

  .contact {
    padding: 64px 0;
  }`,
  m478: `.hero-actions .btn {
    width: 100%;
  }

  .facts {
    grid-template-columns: 1fr;
  }

  .work-body {
    padding: 20px;
  }

  .footer-inner {
    flex-direction: column;
  }`,
};

export const portfolio = {
  id: "portfolio",
  name: "Portfolio",
  description: "A personal portfolio with an intro, a project grid, an about section, your process and a contact call to action.",
  category: "Personal",
  accent: "#c23b20",
  files: {
    "index.html": html,
    "css/style.css": compose(FOUNDATION, own),
    "js/main.js": MAIN_JS,
    "assets/avatar.svg": AVATAR_SVG,
    ...WORK,
  },
};
