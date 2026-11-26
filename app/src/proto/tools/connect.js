// Prototype mode on the Proto canvas (docs/concepts/proto-studio.md §5.1, §5.2, task T9): the connections drawn as
// arrows ("noodles") from a layer to the frame it opens, flow starting points as badges above their frames, and the
// Connect tool: drag the round handle at the right edge of the selected layer onto a frame to add a click → navigate
// interaction (one undo step); drag an existing connection's handle onto empty canvas to remove it. Everything else is
// the Move tool, so selecting, moving and resizing keep working in Prototype mode.
//
//   createConnectTool(ws, move) → tool (id "connect")
//   drawConnections(ctx, ws, { drag }) draws the arrows of the page (used by the tool's overlay layer)
import { t } from "../../i18n/index.js";
import { connections, topOf } from "../../engine/proto/interactions.js";
import { indexOf, pageKey } from "../../engine/proto/tree.js";

const HANDLE_R = 6;
const HANDLE_GAP = 16;

/** The connection handle of a layer in stage pixels. */
function handleOf(ws, id) {
  const b = ws.box(id);
  if (!b) return null;
  const p = ws.toStage(b.x + b.w, b.y + b.h / 2);
  return { x: p.x + HANDLE_GAP, y: p.y };
}

/** The top-level frame under a world point (the topmost), excluding `except`. */
function frameAt(ws, wx, wy, except) {
  const m = ws.model();
  const tops = indexOf(m).get(pageKey(ws.page)) || [];
  for (let i = tops.length - 1; i >= 0; i--) {
    const id = tops[i];
    const n = m.nodes[id];
    if (!n || id === except || n.visible === false) continue;
    const b = ws.box(id);
    if (b && wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return id;
  }
  return null;
}

const css = (name, fallback) => {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
};

function arrow(ctx, a, b, color, width = 1.5) {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  const back = b.x < a.x;
  const c1 = { x: a.x + dx, y: a.y };
  const c2 = { x: back ? b.x + dx : b.x - dx, y: b.y };
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
  ctx.stroke();
  // arrow head along the last tangent
  const ang = Math.atan2(b.y - c2.y, b.x - c2.x);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - 8 * Math.cos(ang - 0.45), b.y - 8 * Math.sin(ang - 0.45));
  ctx.lineTo(b.x - 8 * Math.cos(ang + 0.45), b.y - 8 * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
  ctx.fill();
}

/** Draws the connections, flow badges and the selection's handle (stage pixels). */
export function drawConnections(ctx, ws, { drag = null } = {}) {
  const m = ws.model();
  const accent = css("--of-accent", "#0d99ff");
  const muted = "rgba(13,153,255,0.45)";
  const sel = new Set(ws.selection);
  const selTops = new Set(ws.selection.map((id) => topOf(m, id)));
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  for (const c of connections(m, ws.page)) {
    if (drag && drag.from === c.from && c.act === "navigate") continue;
    const sb = ws.box(c.from);
    if (!sb) continue;
    const hot = sel.has(c.from) || (!ws.selection.length) || selTops.has(c.from) || (c.to && sel.has(c.to));
    const color = hot ? accent : muted;
    const a = ws.toStage(sb.x + sb.w, sb.y + sb.h / 2);
    if (!c.to) {
      // back and close overlay: a short arrow pointing left with a label
      const label = c.act === "back" ? t("Back") : t("Close");
      arrow(ctx, { x: a.x, y: a.y }, { x: a.x + 28, y: a.y - 14 }, color);
      ctx.fillStyle = color;
      ctx.fillText(label, a.x + 32, a.y - 14);
      continue;
    }
    if (c.act === "scrollTo") {
      const tb = ws.box(c.to);
      if (!tb) continue;
      ctx.setLineDash([4, 3]);
      arrow(ctx, a, ws.toStage(tb.x, tb.y + Math.min(tb.h, 24) / 2), color, 1);
      ctx.setLineDash([]);
      continue;
    }
    const tb = ws.box(c.to);
    if (!tb) continue;
    const back = tb.x + tb.w / 2 < sb.x;
    const b = back ? ws.toStage(tb.x + tb.w, tb.y + Math.min(40, tb.h / 2)) : ws.toStage(tb.x, tb.y + Math.min(40, tb.h / 2));
    if (c.act !== "navigate") ctx.setLineDash([6, 4]);
    arrow(ctx, a, b, color, hot ? 2 : 1.5);
    ctx.setLineDash([]);
  }
  // flow starting points
  const flows = Array.isArray(m.pages[ws.page]?.flows) ? m.pages[ws.page].flows : [];
  for (const f of flows) {
    const b = ws.box(f.start);
    if (!b) continue;
    const p = ws.toStage(b.x, b.y);
    const label = `▶ ${f.name || t("Flow")}`;
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect?.(p.x, p.y - 40, w, 18, 9);
    if (!ctx.roundRect) ctx.rect(p.x, p.y - 40, w, 18);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, p.x + 6, p.y - 31);
  }
  // the handle of a single selected layer
  if (ws.selection.length === 1 && !ws.readOnly) {
    const hp = handleOf(ws, ws.selection[0]);
    if (hp) {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, HANDLE_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (drag) {
    const target = drag.target ? ws.box(drag.target) : null;
    if (target) {
      const r0 = ws.toStage(target.x, target.y);
      const r1 = ws.toStage(target.x + target.w, target.y + target.h);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(r0.x, r0.y, r1.x - r0.x, r1.y - r0.y);
    }
    arrow(ctx, drag.start, target ? ws.toStage(target.x, target.y + Math.min(40, target.h / 2)) : drag.cur, accent, 2);
  }
}

export function createConnectTool(ws, move) {
  let drag = null;
  const near = (p) => {
    if (ws.readOnly || ws.selection.length !== 1) return null;
    const id = ws.selection[0];
    const hp = handleOf(ws, id);
    return hp && Math.hypot(p.x - hp.x, p.y - hp.y) <= HANDLE_R + 4 ? { id, hp } : null;
  };
  const off = ws.view.overlay.addLayer((ctx) => {
    if (ws.mode === "prototype") drawConnections(ctx, ws, { drag });
  });
  return {
    id: "connect",
    cursor: "",
    down(c) {
      const h = near(c.stage);
      if (!h) return move.down(c);
      drag = { from: h.id, start: h.hp, cur: c.stage, target: null };
      ws.requestDraw();
      return true;
    },
    move(c) {
      if (!drag) return move.move?.(c);
      drag.cur = c.stage;
      drag.target = frameAt(ws, c.world.x, c.world.y, topOf(ws.model(), drag.from));
      ws.requestDraw();
    },
    up(c) {
      if (!drag) return move.up?.(c);
      const d = drag;
      drag = null;
      const m = ws.model();
      const hasNav = (m.nodes[d.from]?.proto || []).some((it) => it?.on?.type === "click" && (it.do || []).some((a) => a?.act === "navigate"));
      if (d.target) ws.apply({ op: "interaction.connect", from: d.from, to: d.target }, t("Connect to frame"));
      else if (hasNav && Math.hypot(c.stage.x - d.start.x, c.stage.y - d.start.y) > 24) ws.apply({ op: "interaction.connect", from: d.from, to: null }, t("Remove connection"));
      ws.requestDraw();
    },
    hover(c) {
      if (near(c.stage)) {
        ws.setCursor("crosshair");
        return;
      }
      ws.setCursor("");
      move.hover?.(c);
    },
    key(e, api) {
      if (drag && e.type === "keydown" && e.key === "Escape") {
        drag = null;
        ws.requestDraw();
        return true;
      }
      return move.key?.(e, api);
    },
    draw: (ctx, s) => move.draw?.(ctx, s),
    cancel() {
      drag = null;
      move.cancel?.();
    },
    deactivate() {
      drag = null;
      move.deactivate?.();
    },
    destroy: off,
  };
}
