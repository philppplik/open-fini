import { FOUNDATION, MAIN_JS, MENU_ICON, compose, head, icon } from "./shared.js";

const HERO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 440" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#c084fc"/></linearGradient>
    <linearGradient id="tag" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient>
  </defs>
  <rect x="24" y="24" width="512" height="392" rx="32" fill="url(#bg)" opacity="0.16"/>
  <rect x="64" y="56" width="432" height="328" rx="20" fill="#fff" stroke="#e6e4f2" stroke-width="2"/>
  <path d="M64 76a20 20 0 0 1 20-20h392a20 20 0 0 1 20 20v28H64z" fill="#f4f3ff"/>
  <circle cx="90" cy="80" r="6" fill="#fca5a5"/><circle cx="110" cy="80" r="6" fill="#fcd34d"/><circle cx="130" cy="80" r="6" fill="#86efac"/>
  <rect x="318" y="70" width="156" height="20" rx="10" fill="#fff" stroke="#e6e4f2"/>
  <circle cx="334" cy="80" r="4" fill="#a5a3c4"/><rect x="346" y="77" width="64" height="6" rx="3" fill="#d6d4ea"/>
  <rect x="84" y="124" width="104" height="240" rx="12" fill="#f4f3ff"/>
  <rect x="98" y="142" width="64" height="10" rx="5" fill="#4f46e5"/>
  <rect x="98" y="168" width="76" height="8" rx="4" fill="#cfcce8"/><rect x="98" y="188" width="56" height="8" rx="4" fill="#cfcce8"/>
  <rect x="98" y="208" width="68" height="8" rx="4" fill="#cfcce8"/><rect x="98" y="228" width="48" height="8" rx="4" fill="#cfcce8"/>
  <rect x="208" y="124" width="264" height="104" rx="14" fill="#fff" stroke="#e6e4f2" stroke-width="2"/>
  <rect x="226" y="144" width="132" height="12" rx="6" fill="#1b1a2e"/>
  <rect x="226" y="170" width="224" height="8" rx="4" fill="#d6d4ea"/><rect x="226" y="188" width="196" height="8" rx="4" fill="#d6d4ea"/>
  <rect x="208" y="244" width="126" height="120" rx="14" fill="#fef3c7"/>
  <rect x="224" y="262" width="72" height="10" rx="5" fill="#92400e" opacity="0.8"/>
  <rect x="224" y="284" width="92" height="8" rx="4" fill="#92400e" opacity="0.35"/><rect x="224" y="302" width="76" height="8" rx="4" fill="#92400e" opacity="0.35"/>
  <rect x="346" y="244" width="126" height="120" rx="14" fill="#e0e7ff"/>
  <rect x="362" y="262" width="60" height="10" rx="5" fill="#3730a3" opacity="0.8"/>
  <rect x="362" y="284" width="92" height="8" rx="4" fill="#3730a3" opacity="0.35"/><rect x="362" y="302" width="64" height="8" rx="4" fill="#3730a3" opacity="0.35"/>
  <path d="M334 304h12" stroke="#7c3aed" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 6"/>
  <rect x="396" y="338" width="132" height="44" rx="22" fill="url(#tag)"/>
  <path d="m420 360 6 6 12-12" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="446" y="354" width="62" height="8" rx="4" fill="#fff" opacity="0.85"/>
</svg>
`;

const LOGO = `<svg class="logo" width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#4f46e5"/><path d="M10 22V10h8m-8 6h6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22.5" cy="21.5" r="2.5" fill="#c4b5fd"/></svg>`;

const feature = (ic, title, text) => `
        <li class="feature-card">
          <span class="icon-tile">${icon(ic)}</span>
          <h3>${title}</h3>
          <p>${text}</p>
        </li>`;

const check = `<svg class="tick" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
const plan = (name, price, per, blurb, items, cta, featured) => `
        <article class="plan${featured ? " plan-featured" : ""}">
          ${featured ? '<p class="plan-badge">Most popular</p>' : ""}
          <h3>${name}</h3>
          <p class="plan-blurb">${blurb}</p>
          <p class="price"><span class="amount">${price}</span> <span class="per">${per}</span></p>
          <ul class="check-list">${items.map((i) => `\n            <li>${check}${i}</li>`).join("")}
          </ul>
          <a class="btn ${featured ? "btn-primary" : "btn-secondary"}" href="#top">${cta}</a>
        </article>`;

const quote = (initials, tone, text, name, role) => `
        <figure class="quote">
          <blockquote><p>${text}</p></blockquote>
          <figcaption>
            <span class="avatar avatar-${tone}" aria-hidden="true">${initials}</span>
            <span><strong>${name}</strong><br><span class="role">${role}</span></span>
          </figcaption>
        </figure>`;

const html = `<!doctype html>
<html lang="en-US">
<head>
  ${head({ title: "Fieldnote: a calm notebook for the things you want to remember", description: "Fieldnote is a fast, private notebook with quick capture, linked notes and instant search." })}
</head>
<body id="top">
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="#top">${LOGO} Fieldnote</a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-nav-toggle>
        <span class="sr-only">Menu</span>
        ${MENU_ICON}
      </button>
      <nav class="nav" id="site-nav" aria-label="Primary" data-nav>
        <ul class="nav-list">
          <li><a href="#features">Features</a></li>
          <li><a href="#pricing">Pricing</a></li>
          <li><a href="#faq">FAQ</a></li>
          <li><a class="btn btn-primary btn-small" href="#pricing">Start free</a></li>
        </ul>
      </nav>
    </div>
  </header>

  <main id="main">
    <section class="hero">
      <div class="container hero-grid">
        <div class="hero-copy">
          <p class="eyebrow">Notes that think with you</p>
          <h1>Capture ideas before they slip away</h1>
          <p class="lead">Fieldnote is a calm, fast notebook for people who write things down. Quick capture, linked notes and a search that finds what you meant.</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="#pricing">Start for free</a>
            <a class="btn btn-secondary" href="#features">See the features</a>
          </div>
          <p class="hero-note">Free for personal use. No credit card required.</p>
        </div>
        <div class="hero-art">
          <img src="assets/hero.svg" width="560" height="440" alt="The Fieldnote app showing a notebook sidebar, two linked notes and a search field.">
        </div>
      </div>
    </section>

    <section class="section" id="features">
      <div class="container">
        <div class="section-head">
          <p class="eyebrow">Features</p>
          <h2>Everything you need, nothing you have to tidy</h2>
          <p class="lead">Fieldnote stays out of the way while you write and does the organizing in the background.</p>
        </div>
        <ul class="features-grid">${feature('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', "Quick capture", "Press one shortcut anywhere on your computer and jot a thought down in under a second.")}${feature('<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/>', "Linked notes", "Connect related ideas with simple links and explore how your thinking fits together.")}${feature('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', "Instant search", "Find a note by a word, a date or a tag. Results appear while you are still typing.")}${feature('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>', "Offline first", "Everything is stored on your device first and syncs quietly when you are back online.")}${feature('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', "Private by design", "End-to-end encryption keeps your notes readable only by you, on every device.")}${feature('<path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/>', "Export anywhere", "Take your notes with you as plain Markdown files whenever you like. No lock-in.")}
        </ul>
      </div>
    </section>

    <section class="section section-tint" id="stories" aria-labelledby="stories-title">
      <div class="container">
        <div class="section-head">
          <p class="eyebrow">Stories</p>
          <h2 id="stories-title">Loved by writers, researchers and students</h2>
        </div>
        <div class="quote-grid">${quote("PN", "violet", "I moved my whole dissertation into Fieldnote. Finding a source from two years ago takes seconds now.", "Priya Nair", "Doctoral researcher")}${quote("MH", "amber", "It is the first notes app that does not make me feel like I have homework. I just write.", "Marcus Hale", "Freelance writer")}${quote("AL", "teal", "Our team keeps meeting notes and decisions linked together. New hires get up to speed in a day.", "Ana Lima", "Product manager")}
        </div>
      </div>
    </section>

    <section class="section" id="pricing">
      <div class="container">
        <div class="section-head">
          <p class="eyebrow">Pricing</p>
          <h2>Simple plans that grow with you</h2>
          <p class="lead">Start free and upgrade when you need more. Cancel any time.</p>
        </div>
        <div class="pricing-grid">${plan("Free", "$0", "forever", "For personal notes and trying things out.", ["Unlimited notes on one device", "Quick capture and search", "Markdown export"], "Start for free", false)}${plan("Plus", "$6", "per month", "For people who write every day.", ["Sync across all your devices", "Linked notes and graph view", "Weekly review emails", "Priority support"], "Start 14-day trial", true)}${plan("Team", "$12", "per user, per month", "For teams that think together.", ["Everything in Plus", "Shared notebooks", "Roles and permissions", "Single sign-on"], "Contact sales", false)}
        </div>
      </div>
    </section>

    <section class="section" id="faq">
      <div class="container container-narrow">
        <div class="section-head">
          <p class="eyebrow">FAQ</p>
          <h2>Questions, answered</h2>
        </div>
        <div class="faq">
          <details>
            <summary>Does Fieldnote work without an internet connection?</summary>
            <p>Yes. Notes are saved on your device first, so you can read and write anywhere. Changes sync when you are back online.</p>
          </details>
          <details>
            <summary>Can I import notes from another app?</summary>
            <p>You can import Markdown and plain text files by dragging them into the window. Folders become notebooks.</p>
          </details>
          <details>
            <summary>How is my data protected?</summary>
            <p>Notes are encrypted on your device before they sync. Only you hold the key, so we cannot read your notes.</p>
          </details>
          <details>
            <summary>What happens if I cancel my plan?</summary>
            <p>You keep every note and can still read, search and export them. Sync and linked-note features pause until you upgrade again.</p>
          </details>
        </div>
      </div>
    </section>

    <section class="cta-band" aria-labelledby="cta-title">
      <div class="container cta-inner">
        <h2 id="cta-title">Ready to write things down?</h2>
        <p>Join thousands of people who keep their thinking in one calm place.</p>
        <a class="btn btn-light" href="#pricing">Start for free</a>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-grid">
      <div class="footer-about">
        <a class="brand" href="#top">${LOGO} Fieldnote</a>
        <p>A calm notebook for the things you want to remember.</p>
      </div>
      <nav aria-label="Product">
        <h2 class="footer-title">Product</h2>
        <ul>
          <li><a href="#features">Features</a></li>
          <li><a href="#pricing">Pricing</a></li>
          <li><a href="#faq">FAQ</a></li>
        </ul>
      </nav>
      <nav aria-label="Company">
        <h2 class="footer-title">Company</h2>
        <ul>
          <li><a href="#stories">Stories</a></li>
          <li><a href="mailto:hello@fieldnote.example">Contact</a></li>
        </ul>
      </nav>
      <p class="footer-legal">&copy; <span data-year>2026</span> Fieldnote. All rights reserved.</p>
    </div>
  </footer>

  <script src="js/main.js"></script>
</body>
</html>
`;

const own = {
  root: `:root {
  --bg: #ffffff;
  --surface: #ffffff;
  --tint: #f6f5ff;
  --text: #1b1a2e;
  --muted: #565471;
  --border: #e6e4f2;
  --accent: #4f46e5;
  --accent-ink: #ffffff;
  --radius: 12px;
  --shadow: 0 10px 30px rgba(52, 44, 140, 0.14);
  --header-bg: rgba(255, 255, 255, 0.9);
  --container: 1120px;
  --font-body: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-heading: var(--font-body);
}`,
  base: `.logo {
  flex: none;
}

.btn-small {
  padding: 0.55rem 1.1rem;
  font-size: 0.9375rem;
}

.btn-light {
  background: #ffffff;
  color: #3730a3;
}

.hero {
  padding: 80px 0 72px;
  background: radial-gradient(60rem 30rem at 85% -10%, rgba(99, 102, 241, 0.16), transparent 60%), radial-gradient(40rem 24rem at -10% 20%, rgba(192, 132, 252, 0.14), transparent 60%);
}

.hero-grid {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  align-items: center;
  gap: 56px;
}

.hero h1 {
  max-width: 14ch;
}

.hero .lead {
  max-width: 32rem;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 2rem 0 1rem;
}

.hero-note {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--muted);
}

.hero-art img {
  width: 100%;
  filter: drop-shadow(0 24px 40px rgba(79, 70, 229, 0.2));
}

.section-tint {
  background: var(--tint);
}

.section-head {
  max-width: 40rem;
  margin-bottom: 3rem;
}

.container-narrow {
  max-width: 800px;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.feature-card {
  padding: 28px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.feature-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow);
}

.feature-card p {
  margin: 0;
  color: var(--muted);
}

.icon-tile {
  display: inline-grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 1.25rem;
  border-radius: 12px;
  background: #eceafe;
  color: var(--accent);
}

.quote-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.quote {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 24px;
  margin: 0;
  padding: 28px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
}

.quote blockquote {
  margin: 0;
  font-size: 1.0625rem;
}

.quote blockquote p {
  margin: 0;
}

.quote figcaption {
  display: flex;
  align-items: center;
  gap: 12px;
}

.role {
  font-size: 0.875rem;
  color: var(--muted);
}

.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  font-size: 0.875rem;
  font-weight: 700;
}

.avatar-violet { background: #ede9fe; color: #5b21b6; }
.avatar-amber { background: #fef3c7; color: #92400e; }
.avatar-teal { background: #ccfbf1; color: #115e59; }

.pricing-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-items: start;
  gap: 24px;
}

.plan {
  position: relative;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--surface);
}

.plan-featured {
  border: 2px solid var(--accent);
  box-shadow: var(--shadow);
}

.plan-badge {
  position: absolute;
  top: -14px;
  left: 32px;
  margin: 0;
  padding: 0.2rem 0.8rem;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 0.8125rem;
  font-weight: 700;
}

.plan-blurb {
  color: var(--muted);
}

.price {
  margin: 1.25rem 0;
}

.amount {
  font-size: 3rem;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.per {
  color: var(--muted);
}

.check-list {
  margin: 0 0 2rem;
  padding: 0;
  list-style: none;
}

.check-list li {
  display: flex;
  gap: 10px;
  margin-bottom: 0.7rem;
}

.tick {
  flex: none;
  margin-top: 0.2em;
  color: #16a34a;
}

.plan .btn {
  width: 100%;
}

.faq details {
  border-bottom: 1px solid var(--border);
}

.faq summary {
  position: relative;
  padding: 1.25rem 2.5rem 1.25rem 0;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}

.faq summary::-webkit-details-marker {
  display: none;
}

.faq summary::after {
  content: "+";
  position: absolute;
  top: 50%;
  right: 0.25rem;
  transform: translateY(-50%);
  font-size: 1.5rem;
  color: var(--accent);
}

.faq details[open] summary::after {
  content: "\\2212";
}

.faq details p {
  margin: 0 0 1.25rem;
  color: var(--muted);
}

.cta-band {
  padding: 80px 0;
  background: linear-gradient(135deg, #4338ca, #7c3aed);
  color: #ffffff;
  text-align: center;
}

.cta-band p {
  margin-bottom: 2rem;
  color: rgba(255, 255, 255, 0.88);
}

.footer-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 32px;
}

.footer-about p {
  max-width: 22rem;
  margin: 0.75rem 0 0;
}

.footer-title {
  margin-bottom: 0.75rem;
  font-family: var(--font-body);
  font-size: 0.875rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text);
}

.site-footer ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.site-footer li {
  margin-bottom: 0.4rem;
}

.site-footer a:not(.brand) {
  color: var(--muted);
}

.footer-legal {
  grid-column: 1 / -1;
  margin: 0;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}`,
  m991: `.hero {
    padding: 56px 0;
  }

  .hero-grid {
    grid-template-columns: 1fr;
    gap: 40px;
  }

  .hero h1,
  .hero .lead {
    max-width: none;
  }

  .hero-art {
    max-width: 520px;
  }

  .features-grid,
  .quote-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .pricing-grid {
    grid-template-columns: 1fr;
    max-width: 480px;
    margin: 0 auto;
  }

  .nav-list .btn {
    margin-top: 8px;
  }`,
  m767: `.features-grid,
  .quote-grid {
    grid-template-columns: 1fr;
  }

  .section-head {
    margin-bottom: 2rem;
  }

  .footer-grid {
    grid-template-columns: 1fr 1fr;
  }

  .footer-about {
    grid-column: 1 / -1;
  }

  .cta-band {
    padding: 56px 0;
  }`,
  m478: `.hero-actions .btn {
    width: 100%;
  }

  .plan {
    padding: 24px;
  }

  .amount {
    font-size: 2.5rem;
  }

  .footer-grid {
    grid-template-columns: 1fr;
  }`,
};

export const landing = {
  id: "landing",
  name: "Landing page",
  description: "A product page with a hero, features, steps, testimonials, pricing, FAQ and a call to action.",
  category: "Business",
  accent: "#4f46e5",
  files: {
    "index.html": html,
    "css/style.css": compose(FOUNDATION, own),
    "js/main.js": MAIN_JS,
    "assets/hero.svg": HERO_SVG,
  },
};
