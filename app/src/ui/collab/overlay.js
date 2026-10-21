// Live presence and comment markers over the editors (lazy, part of the collaboration runtime).
//
//   * Vector / Pixel / Layout: other members' pointers (labeled colored arrows), their selection halos and the
//     activity "Show" flash are drawn on the canvas overlay (app event "overlay-extra"); comment markers are small DOM
//     buttons over the stage that follow their anchors (layer, region or page) and open the thread when clicked.
//   * Code studio and Office studio: other members' carets are absolutely positioned DOM marks placed with the editor's
//     own geometry (CodeMirror coordsAtPos, the Office editor's posToDom), refreshed a few times per second.
// Only members on the same document are shown. Cursors are hidden in low-power mode unless Settings ▸ Profile and
// collaboration ▸ "Show other members' cursors" is "On".
import { h } from "../../core/util.js";
import { t } from "../../i18n/index.js";
import { pageBounds } from "../../core/transform.js";
import { filterThreads, threadTitle } from "../../collab/comments.js";

export function installOverlay(app, c) {
  const showCursors = () => app.prefs.collabCursors === "on" || (app.prefs.collabCursors !== "off" && !app.perf.low);
  const others = () => (c.session ? c.session.members.filter((m) => m.presence && m.presence.doc && m.presence.doc === app.doc?.id) : []);

  // ---------------------------------------------------------------- canvas: cursors, halos, flash, markers
  let markers = null;
  const ensureMarkers = () => {
    const stage = app.cv?.stage;
    if (!stage) return null;
    if (!markers || markers.parentNode !== stage) {
      markers = h("div.of-cmarkers", { "aria-label": t("Comment markers") });
      stage.append(markers);
    }
    return markers;
  };

  const outline = (ctx, n) => {
    const b = pageBounds(n);
    const page = n._page;
    if (!b || !page) return null;
    const [x0, y0] = app.pageToScreen(b.x, b.y, page);
    const [x1, y1] = app.pageToScreen(b.x + b.w, b.y + b.h, page);
    ctx.strokeRect(Math.round(x0) - 2.5, Math.round(y0) - 2.5, Math.round(x1 - x0) + 5, Math.round(y1 - y0) + 5);
    return [x0, y0];
  };

  app.on("overlay-extra", (ctx) => {
    const doc = app.doc;
    if (!doc || !["vector", "pixel", "layout"].includes(app.studio)) {
      if (markers) markers.replaceChildren();
      return;
    }
    // activity "Show" flash
    if (c.flash && c.flash.until > Date.now()) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffb224";
      for (const id of c.flash.ids) {
        const n = doc.find(id);
        if (n && n._page === app.page) outline(ctx, n);
      }
      ctx.restore();
    }
    if (c.session && showCursors()) {
      for (const m of others()) {
        const p = m.presence;
        const color = m.profile?.color || "#888888";
        const nick = m.profile?.nick || "?";
        if (!["vector", "pixel", "layout"].includes(p.studio)) continue;
        const page = doc.pages.find((pg) => pg.id === p.page) || doc.masters.find((pg) => pg.id === p.page);
        if (!page) continue;
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        let labelAt = null;
        for (const id of p.sel || []) {
          const n = doc.find(id);
          if (n && n._page === app.page) labelAt = labelAt || outline(ctx, n);
        }
        if (labelAt && p.x === undefined) tag(ctx, labelAt[0], labelAt[1] - 18, nick, color);
        if (p.x !== undefined && page === app.page) {
          const [sx, sy] = app.pageToScreen(p.x, p.y, page);
          arrow(ctx, sx, sy, color);
          tag(ctx, sx + 12, sy + 14, p.tool ? `${nick} · ${p.tool}` : nick, color);
        }
        ctx.restore();
      }
    }
    placeMarkers(doc);
  });

  function placeMarkers(doc) {
    const host = ensureMarkers();
    if (!host) return;
    const threads = filterThreads(c.threads(doc), { status: "open" });
    const want = [];
    for (const th of threads) {
      const a = th.anchor;
      let page = null;
      let x = 0;
      let y = 0;
      if (a.kind === "node") {
        const n = doc.find(a.node);
        if (!n) continue;
        page = n._page;
        const b = pageBounds(n);
        if (!b) continue;
        x = b.x + b.w;
        y = b.y;
      } else if (a.kind === "region" || a.kind === "page") {
        page = doc.pages.find((p) => p.id === a.page) || doc.masters.find((p) => p.id === a.page);
        if (!page) continue;
        if (a.rect) {
          x = a.rect.x + a.rect.w;
          y = a.rect.y;
        } else {
          x = page.w;
          y = 0;
        }
      } else continue;
      if (page !== app.page) continue;
      const [sx, sy] = app.pageToScreen(x, y, page);
      want.push({ th, sx, sy });
    }
    // reuse buttons: this runs on every overlay frame
    const kids = [...host.children];
    want.forEach(({ th, sx, sy }, i) => {
      let b = kids[i];
      if (!b) {
        b = h("button.of-cmarker", { type: "button" });
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          import("./runtime.js").then((m) => m.openCollab(app, "comments")).then(() => c.events.dispatchEvent(new CustomEvent("focus-thread", { detail: b.dataset.thread })));
        });
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        host.append(b);
      }
      if (b.dataset.thread !== th.id) {
        b.dataset.thread = th.id;
        b.style.setProperty("--of-collab-color", th.color || "#888888");
        b.textContent = String(th.messages.filter((m) => !m.deleted).length);
        const label = t("Comment by {name}: {text}", { name: th.nick || "?", text: threadTitle(th) });
        b.setAttribute("aria-label", label);
        b.title = label;
      }
      b.style.transform = `translate(${Math.round(sx) - 4}px, ${Math.round(sy) - 26}px)`;
    });
    for (let i = want.length; i < kids.length; i++) kids[i].remove();
  }

  // ---------------------------------------------------------------- code and office carets (DOM)
  const carets = h("div.of-ccarets", { "aria-hidden": "true" });
  document.body.append(carets);
  const drawCarets = () => {
    const list = [];
    if (c.session && showCursors() && app.doc) {
      for (const m of others()) {
        const p = m.presence;
        if (!p.caret || p.studio !== app.studio) continue;
        const rect = caretRect(app, p);
        if (rect) list.push({ m, rect });
      }
    }
    const kids = [...carets.children];
    list.forEach(({ m, rect }, i) => {
      let el = kids[i];
      if (!el) {
        el = h("div.of-ccaret", h("span.of-ccaret__tag"));
        carets.append(el);
      }
      el.style.setProperty("--of-collab-color", m.profile?.color || "#888888");
      el.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
      el.style.height = `${Math.max(12, Math.round(rect.height))}px`;
      el.firstChild.textContent = m.profile?.nick || "?";
    });
    for (let i = list.length; i < kids.length; i++) kids[i].remove();
  };
  setInterval(drawCarets, 250);
}

/** Viewport rectangle of a remote caret in the Code or Office editor, or null when it is not visible. */
function caretRect(app, p) {
  try {
    if (p.studio === "code") {
      const ed = app.codeUI?.editors;
      const view = ed?.view;
      if (!view || ed.active !== p.caret.path || app.codeUI.doc?.id !== p.doc) return null;
      const line = view.state.doc.line(Math.min(p.caret.line || 1, view.state.doc.lines));
      const pos = Math.min(line.to, line.from + (p.caret.ch || 0));
      const r = view.coordsAtPos(pos);
      const box = view.scrollDOM.getBoundingClientRect();
      if (!r || r.top < box.top || r.bottom > box.bottom) return null;
      return { left: r.left, top: r.top, height: r.bottom - r.top };
    }
    if (p.studio === "office") {
      const ed = app.officeUI?.editor;
      if (!ed || app.officeUI.doc?.id !== p.doc) return null;
      const path = JSON.parse(p.caret.path || "null");
      if (!Array.isArray(path)) return null;
      const pt = ed.posToDom({ path, offset: p.caret.from || 0 });
      if (!pt) return null;
      const range = document.createRange();
      range.setStart(pt[0], Math.min(pt[1], pt[0].nodeType === 3 ? pt[0].data.length : pt[0].childNodes.length));
      const r = range.getClientRects()[0] || (pt[0].nodeType === 1 ? pt[0].getBoundingClientRect() : pt[0].parentElement?.getBoundingClientRect());
      if (!r || (!r.height && !r.width && !r.top)) return null;
      return { left: r.left, top: r.top, height: r.height || 16 };
    }
  } catch {
    return null;
  }
  return null;
}

function arrow(ctx, x, y, color) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16);
  ctx.lineTo(4.5, 12);
  ctx.lineTo(8, 19);
  ctx.lineTo(10.5, 18);
  ctx.lineTo(7, 11);
  ctx.lineTo(12.5, 11);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.25;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function tag(ctx, x, y, text, color) {
  ctx.save();
  ctx.font = "600 11px Inter, system-ui, sans-serif";
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(Math.round(x), Math.round(y), w, 17, 4) : ctx.rect(Math.round(x), Math.round(y), w, 17);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, Math.round(x) + 5, Math.round(y) + 9);
  ctx.restore();
}
