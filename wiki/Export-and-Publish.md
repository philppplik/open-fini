# Export and Publish

Export is a popup available from every studio, not a studio of its own: images, PDF, slices and, for documents with a website project, the website. Publishing deploys a website to a hosting target from the Code studio. This page covers both, with the limits of each target.

## The Export popup

Press the **Export** button in the header or `Mod+Shift+E` (*File ▸ Export…*). *File ▸ Quick Export* exports the current page with default settings.

| Tab | What it does |
| --- | --- |
| Image and PDF | PNG, JPEG, WebP, SVG or PDF of the current page, all pages or the selection; scale, quality, transparency, bleed and crop marks |
| Slices | Draw slices with the Slice tool (`S`, in the Vector and Layout toolboxes) or create them from the selection or layers; format and scale per slice; one file or a ZIP |
| Website | Appears when the document has a Code project: ZIP archive, single-file pages, or a folder, with minify and sitemap options |
| Publish | One-click deployment (see below) |

Limits: image export is capped at 16,384 px per side and 140 megapixels. PDF output is DeviceRGB with standard or embedded fonts ([[Layout Studio]]); CMYK documents and the PDF/X-1a and PDF/X-4 options write DeviceCMYK with an output intent and a preflight report, not validated by a certified PDF/X validator ([[Color Management]]). There is no tagged PDF. SVG and PDF contain real paths and text for charts and tables ([[Tables and Charts]]).

## Website export

| Option | Result |
| --- | --- |
| ZIP archive | Upload to any static host |
| Single-file pages | CSS, JavaScript and images inlined into each HTML file |
| Folder | Writes into a folder you choose (browsers with the File System Access API, desktop app) |

Options: minify HTML and CSS; generate `sitemap.xml` and `robots.txt` from a site address. The export contains only your project files, no OpenFini code or preview bridge, and warnings list broken links and missing files. JavaScript is not minified. Design pages can become assets (*Assets ▸ Add a design page as SVG or PNG*).

## Publish

The *Publish* button in the Code toolbar (or Export's Publish tab) uses a saved **target** (type, settings, include and exclude patterns; the secret is stored only on this device).

1. **Check and list files:** a dry run lists exactly what would upload and runs the pre-publish checks.
2. **Publish…:** a confirmation names the destination host, file count and size.
3. Progress with Cancel, then the address with Copy and Open. Every deploy is added to the deploy history.

Pre-publish checks cover broken links and missing files, dead `#anchors`, images without alt text, missing title, description, viewport or `lang`, `http://` resources on https sites, files over 10 MB and a missing entry page. Errors do not block publishing but the confirmation says so.

| Target | How | Needs |
| --- | --- | --- |
| Netlify | Creates a site, then a ZIP deploy polled until ready | Personal access token |
| Vercel | Uploads files, then creates a deployment | Access token (optional team id) |
| GitHub Pages | One commit with the whole site to a branch (default `gh-pages`), then enables Pages | Token with Contents and Pages access |
| WebDAV / HTTP PUT | `MKCOL` and `PUT` per file | Password or token; the server must send CORS headers |
| FTP, FTPS, SFTP, rsync, SMTP | Through the **publish helper** (`npm run publish:helper`), a small local Node program | Helper token; server credentials per upload |
| Cloudflare Pages | Not available (its direct upload cannot be called from web pages) | Use GitHub Pages or Netlify |

The helper listens on `127.0.0.1` only, checks the browser origin, requires a bearer token, accepts one upload at a time (256 MB limit) and never writes passwords to disk. SFTP and rsync use your system `ssh` tools with key authentication only.

## Honest verification status

Request shapes of the HTTP targets are unit tested against mock servers; live calls to the vendors and their current cross-origin policy were not verified in CI. FTPS handshakes against real servers, real SFTP and rsync, and real mail servers are untested. If a request is blocked the dialog says so and suggests the helper or another target.

## Security

Tokens and passwords never go into documents; they live in this device's storage, encrypted when the app lock is on. Every upload, push and clone asks for confirmation naming the destination, and offline mode blocks them ([[Security and Privacy]]). The Vibe assistant never receives a token: `add_publish_target` stores settings only, and `publish_site` always asks.

## See also

- [[Code Studio]]
- [[Git in the Code Studio]]
- [[Frameworks and Libraries]]
- [[Security and Privacy]]
