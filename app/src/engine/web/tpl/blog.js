import { FOUNDATION, MAIN_JS, MENU_ICON, compose, head } from "./shared.js";

const cover = (sky1, sky2, sun, h1, h2, h3, extra = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" fill="none">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky1}"/><stop offset="1" stop-color="${sky2}"/></linearGradient></defs>
  <rect width="800" height="450" fill="url(#sky)"/>
  <circle cx="610" cy="130" r="54" fill="${sun}"/>
  <path d="M0 300c90-70 170-90 260-50s150 50 240-10 190-70 300-10v220H0z" fill="${h1}"/>
  <path d="M0 360c120-60 210-50 310-10s200 40 290-10 140-30 200-10v130H0z" fill="${h2}"/>
  <path d="M0 410c140-30 260-20 380 0s280 20 420-10v60H0z" fill="${h3}"/>
  ${extra}
</svg>
`;

const COVERS = {
  "assets/cover-1.svg": cover("#fde9d4", "#fbc8a4", "#fff6e8", "#7fb08f", "#4f8a6b", "#2f6650", `<path d="M470 392l14-26 14 26z M520 396l11-21 11 21z" fill="#1f4a3a"/><path d="M300 380c18-18 34-14 48 4" stroke="#fff6e8" stroke-width="5" stroke-linecap="round" opacity="0.7"/>`),
  "assets/cover-2.svg": cover("#d9ecf7", "#b3d6ee", "#ffffff", "#8cb9a5", "#5f9a83", "#3b7461", `<circle cx="200" cy="95" r="8" fill="#fff" opacity="0.8"/><circle cx="240" cy="70" r="5" fill="#fff" opacity="0.7"/><path d="M110 120c18-16 40-16 60 0" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity="0.8"/>`),
  "assets/cover-3.svg": cover("#2b3a55", "#6c6a9c", "#f7e7b4", "#42506e", "#2e3a56", "#1f2940", `<circle cx="120" cy="80" r="3" fill="#fff"/><circle cx="260" cy="50" r="2" fill="#fff"/><circle cx="400" cy="100" r="3" fill="#fff"/><circle cx="520" cy="60" r="2" fill="#fff"/><circle cx="700" cy="220" r="2" fill="#fff"/>`),
};

const NAV = (prefix, current) => `<header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="${prefix}index.html">The Slow Mile</a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-nav-toggle>
        <span class="sr-only">Menu</span>
        ${MENU_ICON}
      </button>
      <nav class="nav" id="site-nav" aria-label="Primary" data-nav>
        <ul class="nav-list">
          <li><a href="${prefix}index.html"${current === "home" ? ' aria-current="page"' : ""}>Home</a></li>
          <li><a href="${prefix}index.html#latest">Latest</a></li>
          <li><a href="${prefix}index.html#about">About</a></li>
          <li><a class="btn btn-primary btn-small" href="${prefix}index.html#subscribe">Subscribe</a></li>
        </ul>
      </nav>
    </div>
  </header>`;

const FOOT = `<footer class="site-footer">
    <div class="container footer-inner">
      <p>&copy; <span data-year>2026</span> The Slow Mile. Written by Jonas Reyes.</p>
      <p>Run easy. Stay curious.</p>
    </div>
  </footer>`;

const card = (n, tag, title, text, date, mins) => `
          <article class="post-card">
            <a class="post-cover" href="#" tabindex="-1" aria-hidden="true"><img src="assets/cover-${n}.svg" width="800" height="450" alt="" loading="lazy"></a>
            <div class="post-body">
              <p class="post-tag">${tag}</p>
              <h3><a href="#">${title}</a></h3>
              <p>${text}</p>
              <p class="post-meta"><time datetime="${date.iso}">${date.text}</time> &middot; ${mins} min read</p>
            </div>
          </article>`;

const INDEX = `<!doctype html>
<html lang="en-US">
<head>
  ${head({ title: "The Slow Mile | A running journal", description: "The Slow Mile is a journal about easy running, trail routes and the small habits that keep you moving for decades." })}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${NAV("", "home")}

  <main id="main">
    <section class="intro container">
      <p class="eyebrow">A running journal</p>
      <h1>Run easy. Stay curious.</h1>
      <p class="lead">Honest notes on slow running, trail routes and the small habits that keep you moving for decades.</p>
    </section>

    <section class="container featured" aria-labelledby="featured-title">
      <article class="feature-post">
        <a class="feature-cover" href="posts/finding-your-pace.html" tabindex="-1" aria-hidden="true"><img src="assets/cover-1.svg" width="800" height="450" alt=""></a>
        <div class="feature-body">
          <p class="post-tag">Featured &middot; Training</p>
          <h2 id="featured-title"><a href="posts/finding-your-pace.html">Finding your pace: why slower runs make you faster</a></h2>
          <p>Most of us run our easy days too hard. Here is how to slow down, what it feels like, and why your race times will thank you.</p>
          <p class="post-meta"><time datetime="2026-03-14">March 14, 2026</time> &middot; 6 min read</p>
          <a class="btn btn-primary" href="posts/finding-your-pace.html">Read the article</a>
        </div>
      </article>
    </section>

    <div class="container layout">
      <section id="latest" aria-labelledby="latest-title">
        <h2 id="latest-title" class="list-title">Latest posts</h2>
        <div class="post-grid">${card(2, "Gear", "A beginner's guide to trail shoes", "Lugs, rock plates and drop explained in plain language, with three pairs worth trying first.", { iso: "2026-03-02", text: "March 2, 2026" }, 7)}${card(3, "Routes", "Five Sunday long runs within an hour of any city", "Loops and out-and-backs that start from a train station and end at a good bakery.", { iso: "2026-02-18", text: "February 18, 2026" }, 5)}${card(1, "Fuel", "Fueling a long run without the sticky mess", "What to eat, when to eat it and how to carry it, from real food to the occasional gel.", { iso: "2026-02-03", text: "February 3, 2026" }, 6)}${card(2, "Racing", "What I learned from my first 50K", "Walking the hills, eating early and the one mistake I will not repeat.", { iso: "2026-01-21", text: "January 21, 2026" }, 9)}
        </div>
      </section>

      <aside class="sidebar" aria-label="Sidebar">
        <section class="widget" id="about" aria-labelledby="about-title">
          <h2 id="about-title" class="widget-title">About</h2>
          <div class="author">
            <span class="avatar" aria-hidden="true">JR</span>
            <p><strong>Jonas Reyes</strong><br>Runner, writer, slow learner.</p>
          </div>
          <p>I have been running for sixteen years and still get lost on familiar trails. This journal is where I write down what works.</p>
        </section>
        <section class="widget widget-accent" id="subscribe" aria-labelledby="subscribe-title">
          <h2 id="subscribe-title" class="widget-title">Get one email a month</h2>
          <p>New articles and a route worth running. No spam, unsubscribe any time.</p>
          <form class="newsletter" action="#" method="post">
            <label for="email">Email address</label>
            <input id="email" name="email" type="email" placeholder="you@example.com" autocomplete="email" required>
            <button class="btn btn-primary" type="submit">Subscribe</button>
          </form>
        </section>
      </aside>
    </div>
  </main>

  ${FOOT}

  <script src="js/main.js"></script>
</body>
</html>
`;

const ARTICLE = `<!doctype html>
<html lang="en-US">
<head>
  ${head({ title: "Finding your pace: why slower runs make you faster | The Slow Mile", description: "Most of us run easy days too hard. Learn how to slow down and why it makes you faster.", css: "../css/style.css" })}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${NAV("../", "")}

  <main id="main">
    <article class="article">
      <header class="container article-head">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li><a href="../index.html">Home</a></li>
            <li><a href="../index.html#latest">Training</a></li>
            <li aria-current="page">Finding your pace</li>
          </ol>
        </nav>
        <p class="post-tag">Training</p>
        <h1>Finding your pace: why slower runs make you faster</h1>
        <p class="lead">Most of us run our easy days too hard. Here is how to slow down, what it feels like, and why your race times will thank you.</p>
        <p class="post-meta">
          <span class="avatar avatar-small" aria-hidden="true">JR</span>
          By Jonas Reyes &middot; <time datetime="2026-03-14">March 14, 2026</time> &middot; 6 min read
        </p>
      </header>

      <figure class="container article-cover">
        <img src="../assets/cover-1.svg" width="800" height="450" alt="Rolling green hills at sunrise with a pale sun above the ridge.">
        <figcaption>The first light of an easy run, when nobody is racing anybody.</figcaption>
      </figure>

      <div class="container prose">
        <p>For years I finished every run feeling a little proud and a little wrecked. I thought that was the point. Then a coach looked at my training log, smiled, and said: &ldquo;You only have one speed.&rdquo;</p>

        <h2>The one-speed problem</h2>
        <p>Running at a steady, medium-hard effort every day feels productive, but it sits in an awkward middle: too hard to recover from, too easy to improve your top speed. Over a few months it shows up as plateaus, nagging aches and a motivation dip around week six.</p>

        <blockquote>
          <p>Easy runs are not wasted miles. They are the base that makes the hard days possible.</p>
        </blockquote>

        <h2>What easy actually feels like</h2>
        <p>Forget the watch for a moment. A good easy pace has three signs:</p>
        <ol>
          <li><strong>You can talk in full sentences</strong> without gasping between words.</li>
          <li><strong>You could keep going</strong> for another hour if someone asked.</li>
          <li><strong>You finish fresher</strong> than you started, with energy left for the rest of your day.</li>
        </ol>
        <p>If that sounds embarrassingly slow, you are probably doing it right. Many runners need to drop 60 to 90 seconds per mile before it feels like this.</p>

        <aside class="callout" aria-label="Key takeaways">
          <h2>Key takeaways</h2>
          <ul>
            <li>Run most of your miles at a conversational effort.</li>
            <li>Keep two days a week for harder work, and make them count.</li>
            <li>Judge a run by how you feel an hour afterward, not by the pace.</li>
          </ul>
        </aside>

        <h2>A simple way to start this week</h2>
        <p>Pick your next three easy runs and leave the watch face on the time of day instead of pace. Walk when the hills ask you to. Notice how you feel on day two. Most people report their legs feeling lighter within ten days.</p>
        <p>Speed is a side effect of being able to train consistently. Slow down, and you get to keep training.</p>
      </div>

      <footer class="container author-box">
        <span class="avatar" aria-hidden="true">JR</span>
        <p><strong>Jonas Reyes</strong> writes The Slow Mile from a small apartment with too many running shoes. <a href="../index.html#subscribe">Get the monthly email</a>.</p>
      </footer>
    </article>

    <section class="container related" aria-labelledby="related-title">
      <h2 id="related-title" class="list-title">Keep reading</h2>
      <div class="post-grid post-grid-two">${card(2, "Gear", "A beginner's guide to trail shoes", "Lugs, rock plates and drop explained in plain language, with three pairs worth trying first.", { iso: "2026-03-02", text: "March 2, 2026" }, 7).replaceAll("assets/", "../assets/")}${card(3, "Routes", "Five Sunday long runs within an hour of any city", "Loops and out-and-backs that start from a train station and end at a good bakery.", { iso: "2026-02-18", text: "February 18, 2026" }, 5).replaceAll("assets/", "../assets/")}
      </div>
    </section>
  </main>

  ${FOOT}

  <script src="../js/main.js"></script>
</body>
</html>
`;

const own = {
  root: `:root {
  --bg: #fbfaf6;
  --surface: #ffffff;
  --text: #1f2a24;
  --muted: #56645b;
  --border: #e3e5dc;
  --accent: #2a6b4d;
  --accent-ink: #ffffff;
  --radius: 10px;
  --shadow: 0 12px 28px rgba(31, 42, 36, 0.14);
  --header-bg: rgba(251, 250, 246, 0.92);
  --container: 1100px;
  --font-body: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-heading: Georgia, Cambria, "Times New Roman", Times, serif;
}`,
  base: `.btn-small {
  padding: 0.5rem 1.1rem;
  font-size: 0.9375rem;
}

.intro {
  padding-top: 72px;
  padding-bottom: 40px;
}

.intro .lead {
  max-width: 36rem;
}

.post-tag {
  margin: 0 0 0.5rem;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
}

.post-meta {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--muted);
}

.feature-post {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--surface);
}

.feature-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.feature-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 40px;
}

.feature-body h2 {
  font-size: 2rem;
}

.feature-body h2 a,
.post-body h3 a {
  color: var(--text);
  text-decoration: none;
}

.feature-body h2 a:hover,
.post-body h3 a:hover {
  color: var(--accent);
}

.feature-body .btn {
  margin-top: 1.25rem;
}

.layout {
  display: grid;
  grid-template-columns: 1fr 320px;
  align-items: start;
  gap: 56px;
  padding-top: 72px;
  padding-bottom: 96px;
}

.list-title {
  margin-bottom: 1.5rem;
  font-size: 1.5rem;
}

.post-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 28px;
}

.post-card {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.post-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow);
}

.post-cover img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
}

.post-body {
  padding: 20px 22px 24px;
}

.post-body h3 {
  margin-bottom: 0.5rem;
  font-size: 1.25rem;
}

.post-body p {
  color: var(--muted);
}

.post-body .post-meta {
  margin: 0;
}

.sidebar {
  position: sticky;
  top: 96px;
  display: grid;
  gap: 24px;
}

.widget {
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
}

.widget-accent {
  border-color: transparent;
  background: #e5f1ea;
}

.widget-title {
  margin-bottom: 0.75rem;
  font-size: 1.125rem;
}

.widget p:last-child {
  margin-bottom: 0;
}

.author {
  display: flex;
  align-items: center;
  gap: 14px;
}

.author p {
  margin: 0;
}

.avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 1rem;
  font-weight: 700;
}

.avatar-small {
  display: inline-grid;
  width: 32px;
  height: 32px;
  margin-right: 6px;
  font-size: 0.75rem;
  vertical-align: middle;
}

.newsletter {
  display: grid;
  gap: 10px;
}

.newsletter label {
  font-size: 0.875rem;
  font-weight: 600;
}

.newsletter input {
  width: 100%;
  padding: 0.7rem 0.9rem;
  border: 1px solid #b9c9bf;
  border-radius: var(--radius);
  background: #ffffff;
  font: inherit;
}

.article-head {
  max-width: 800px;
  padding-top: 56px;
  text-align: center;
}

.article-head h1 {
  font-size: 3rem;
}

.article-head .post-meta {
  margin-top: 1.5rem;
}

.breadcrumbs ol {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin: 0 0 2rem;
  padding: 0;
  font-size: 0.875rem;
  list-style: none;
}

.breadcrumbs li + li::before {
  content: "/";
  margin-right: 8px;
  color: var(--muted);
}

.article-cover {
  max-width: 960px;
  margin-top: 40px;
  margin-bottom: 0;
}

.article-cover img {
  width: 100%;
  border-radius: 20px;
}

.article-cover figcaption {
  margin-top: 0.75rem;
  text-align: center;
  font-size: 0.875rem;
  color: var(--muted);
}

.prose {
  max-width: 720px;
  padding-top: 48px;
  font-size: 1.125rem;
  line-height: 1.75;
}

.prose h2 {
  margin-top: 2.5rem;
  font-size: 1.75rem;
}

.prose blockquote {
  margin: 2rem 0;
  padding: 0.25rem 0 0.25rem 1.5rem;
  border-left: 4px solid var(--accent);
  font-family: var(--font-heading);
  font-size: 1.5rem;
  line-height: 1.4;
}

.prose blockquote p {
  margin: 0;
}

.callout {
  margin: 2.5rem 0;
  padding: 24px 28px;
  border-radius: 16px;
  background: #e5f1ea;
  font-size: 1rem;
}

.callout h2 {
  margin: 0 0 0.5rem;
  font-size: 1.125rem;
}

.callout ul {
  margin: 0;
  padding-left: 1.25rem;
}

.author-box {
  display: flex;
  align-items: center;
  gap: 18px;
  max-width: 720px;
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 1px solid var(--border);
}

.author-box p {
  margin: 0;
}

.related {
  padding-top: 72px;
  padding-bottom: 96px;
}

.post-grid-two {
  grid-template-columns: repeat(2, 1fr);
}

.footer-inner {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.footer-inner p {
  margin: 0;
}`,
  m991: `.feature-post {
    grid-template-columns: 1fr;
  }

  .feature-body {
    padding: 28px;
  }

  .layout {
    grid-template-columns: 1fr;
    gap: 40px;
  }

  .sidebar {
    position: static;
    grid-template-columns: repeat(2, 1fr);
  }

  .widget-accent {
    grid-column: 1 / -1;
  }

  .article-head h1 {
    font-size: 2.5rem;
  }

  .nav-list .btn {
    margin-top: 8px;
  }`,
  m767: `.intro {
    padding-top: 48px;
  }

  .post-grid,
  .post-grid-two {
    grid-template-columns: 1fr;
  }

  .sidebar {
    grid-template-columns: 1fr;
  }

  .article-head h1 {
    font-size: 2.125rem;
  }

  .prose {
    font-size: 1.0625rem;
  }

  .prose blockquote {
    font-size: 1.25rem;
  }

  .footer-inner {
    flex-direction: column;
  }`,
  m478: `.feature-body {
    padding: 20px;
  }

  .feature-body h2 {
    font-size: 1.5rem;
  }

  .article-head {
    padding-top: 32px;
  }

  .author-box {
    align-items: flex-start;
  }`,
};

export const blog = {
  id: "blog",
  name: "Blog",
  description: "A journal with a featured post, a post grid, a sidebar and a long-form article page.",
  category: "Content",
  accent: "#2a6b4d",
  files: {
    "index.html": INDEX,
    "posts/finding-your-pace.html": ARTICLE,
    "css/style.css": compose(FOUNDATION, own),
    "js/main.js": MAIN_JS,
    ...COVERS,
  },
};
