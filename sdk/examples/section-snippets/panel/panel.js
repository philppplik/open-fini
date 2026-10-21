// The panel runs in its own sandboxed frame; `openfini` is the same API object extensions get.
const SECTIONS = [
  { name: "Hero", note: "Headline, text and a button", html: '<section class="hero" style="padding:64px 24px;text-align:center"><h1>Headline</h1><p>A short supporting sentence.</p><a class="button" href="#">Get started</a></section>' },
  { name: "Three features", note: "Cards in a responsive grid", html: '<section class="features" style="display:grid;gap:24px;padding:48px 24px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))"><article><h3>Fast</h3><p>Describe the first benefit.</p></article><article><h3>Simple</h3><p>Describe the second benefit.</p></article><article><h3>Open</h3><p>Describe the third benefit.</p></article></section>' },
  { name: "Call to action", note: "A closing banner", html: '<section class="cta" style="padding:48px 24px;text-align:center"><h2>Ready when you are</h2><a class="button" href="#">Contact us</a></section>' },
  { name: "Footer", note: "Copyright line", html: '<footer style="padding:24px;text-align:center;font-size:14px"><p>© Your name</p></footer>' },
];

const list = document.getElementById("list");
const status = document.getElementById("status");
for (const s of SECTIONS) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = s.name;
  const small = document.createElement("small");
  small.textContent = s.note;
  b.append(small);
  b.addEventListener("click", async () => {
    try {
      await openfini.document.callTool("insert_html", { html: s.html });
      status.textContent = `Inserted “${s.name}”.`;
    } catch (err) {
      status.textContent = err.message;
    }
  });
  list.append(b);
}
