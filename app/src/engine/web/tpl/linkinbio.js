import { CORE, MAIN_JS, compose, head, icon } from "./shared.js";

const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbcfe8"/><stop offset="1" stop-color="#c4b5fd"/></linearGradient>
  </defs>
  <circle cx="160" cy="160" r="160" fill="url(#bg)"/>
  <path d="M40 260c10-62 62-92 120-92s110 30 120 92a160 160 0 0 1-240 0z" fill="#312e81"/>
  <rect x="140" y="140" width="40" height="44" rx="16" fill="#e8b49b"/>
  <ellipse cx="160" cy="112" rx="52" ry="58" fill="#f1c3a9"/>
  <path d="M104 106c-6-54 28-80 62-76 38 4 54 36 48 76-10-26-32-42-58-38-24 4-42 18-52 38z" fill="#1e1b4b"/>
  <circle cx="141" cy="118" r="5" fill="#1e1b4b"/><circle cx="179" cy="118" r="5" fill="#1e1b4b"/>
  <path d="M146 140c8 8 20 8 28 0" stroke="#a14b3a" stroke-width="5" stroke-linecap="round"/>
  <path d="M216 150l8 14 16-2-8 14 12 12-16 2-4 16-12-12-14 6 4-16-12-10 16-4z" fill="#fff" opacity="0.7"/>
</svg>
`;

const link = (ic, label, hint, href, primary) => `
        <li>
          <a class="link-card${primary ? " link-card-primary" : ""}" href="${href}">
            <span class="link-icon">${icon(ic)}</span>
            <span class="link-text"><strong>${label}</strong><span>${hint}</span></span>
            <svg class="link-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
          </a>
        </li>`;

const social = (label, ic) => `
          <li><a href="#links" aria-label="${label}">${icon(ic)}</a></li>`;

const html = `<!doctype html>
<html lang="en-US">
<head>
  ${head({ title: "Jules Park | Photographer and writer", description: "Everything Jules Park is making right now: the latest photo essay, the newsletter, prints and booking." })}
</head>
<body>
  <a class="skip-link" href="#links">Skip to links</a>
  <main class="page">
    <section class="profile" aria-labelledby="name">
      <img class="profile-photo" src="assets/avatar.svg" width="112" height="112" alt="Illustration of Jules Park with dark hair and an indigo jacket.">
      <h1 id="name">Jules Park</h1>
      <p class="handle">Photographer &amp; writer</p>
      <p class="bio">Quiet streets, late trains and the stories behind them. New photo essay every month.</p>
    </section>

    <nav class="links" id="links" aria-label="Links">
      <ul>${link('<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>', "Monthly newsletter", "One photo essay in your inbox", "mailto:hello@julespark.example", true)}${link('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3.5"/>', "Latest photo essay", "Night trains of the northern line", "#links")}${link('<path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>', "Print shop", "Signed prints, shipped worldwide", "#links")}${link('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10h8M8 14h5"/>', "Field notes", "Short writing about looking closely", "#links")}${link('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/>', "Book a session", "Portraits and small events, spring openings", "mailto:bookings@julespark.example")}
      </ul>
    </nav>

    <footer class="page-footer">
      <ul class="social" aria-label="Social profiles">${social("Instagram", '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.5"/><circle cx="17" cy="7" r="0.6"/>')}${social("Video channel", '<rect x="3" y="6" width="18" height="12" rx="4"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>')}${social("RSS feed", '<path d="M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8"/><circle cx="6" cy="18" r="1.4"/>')}${social("Email", '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>')}
      </ul>
      <p>&copy; <span data-year>2026</span> Jules Park</p>
    </footer>
  </main>

  <script src="js/main.js"></script>
</body>
</html>
`;

const own = {
  root: `:root {
  --bg: #f5f0ff;
  --surface: #ffffff;
  --text: #1e1b4b;
  --muted: #4f4a7a;
  --border: #e4dcf8;
  --accent: #b4236d;
  --accent-ink: #ffffff;
  --radius: 16px;
  --shadow: 0 12px 28px rgba(76, 29, 149, 0.18);
  --header-bg: transparent;
  --container: 560px;
  --font-body: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-heading: var(--font-body);
}`,
  base: `body {
  min-height: 100vh;
  background: radial-gradient(50rem 30rem at 100% -10%, #fbcfe8, transparent 60%), radial-gradient(44rem 28rem at -10% 10%, #ddd6fe, transparent 60%), var(--bg);
  background-attachment: fixed;
}

.page {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: var(--container);
  min-height: 100vh;
  margin: 0 auto;
  padding: 56px 24px 32px;
}

.profile {
  text-align: center;
}

.profile-photo {
  width: 112px;
  height: 112px;
  margin: 0 auto 1rem;
  border: 4px solid #ffffff;
  border-radius: 50%;
  box-shadow: var(--shadow);
}

.profile h1 {
  margin-bottom: 0.15rem;
  font-size: 2rem;
}

.handle {
  margin-bottom: 0.75rem;
  font-weight: 600;
  color: var(--accent);
}

.bio {
  max-width: 24rem;
  margin: 0 auto 2rem;
  color: var(--muted);
}

.links {
  width: 100%;
}

.links ul {
  display: grid;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.link-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}

.link-card:hover {
  transform: translateY(-2px);
  border-color: var(--accent);
  box-shadow: var(--shadow);
}

.link-card-primary {
  border-color: transparent;
  background: linear-gradient(135deg, #be185d, #6d28d9);
  color: #ffffff;
}

.link-card-primary:hover {
  border-color: transparent;
}

.link-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #f3e8ff;
  color: #6d28d9;
}

.link-card-primary .link-icon {
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.link-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: 1.35;
}

.link-text span {
  font-size: 0.875rem;
  color: var(--muted);
}

.link-card-primary .link-text span {
  color: rgba(255, 255, 255, 0.85);
}

.link-arrow {
  flex: none;
  opacity: 0.6;
}

.page-footer {
  margin-top: auto;
  padding-top: 40px;
  text-align: center;
  font-size: 0.875rem;
  color: var(--muted);
}

.social {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin: 0 0 1rem;
  padding: 0;
  list-style: none;
}

.social a {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: var(--text);
  transition: background-color 0.15s ease;
}

.social a:hover {
  background: #ffffff;
  color: var(--accent);
}`,
  m991: `.page {
    padding-top: 40px;
  }`,
  m767: `.page {
    padding: 32px 20px 24px;
  }

  .profile h1 {
    font-size: 1.75rem;
  }`,
  m478: `.page {
    padding: 24px 16px 20px;
  }

  .link-card {
    padding: 12px 14px;
    gap: 12px;
  }

  .link-icon {
    width: 40px;
    height: 40px;
  }`,
};

export const linkinbio = {
  id: "link-in-bio",
  name: "Link in bio",
  description: "A single-column profile with a photo, a short bio and a stack of link buttons for social profiles.",
  category: "Personal",
  accent: "#b4236d",
  files: {
    "index.html": html,
    "css/style.css": compose(CORE, own),
    "js/main.js": MAIN_JS,
    "assets/avatar.svg": AVATAR_SVG,
  },
};
