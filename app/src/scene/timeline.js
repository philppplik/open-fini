// Scene Studio timeline (docs/scene-studio.md ▸ Timeline): track headers (DOM) plus one canvas with the ruler, the
// clips (thumbnails, waveforms, keyframes, transitions), markers, the In / Out range and the playhead; keyframe rows
// under twirled-down clips; native scroll bars for both directions.
//
//   createTimeline(ui) → { el, draw(), fit(), reveal(t), timeAt(clientX), toggleTwirl(ids), destroy() }
// `ui` is the workspace (scene/view.js): seqModel() (the sequence on the timeline: the root or an opened
// composition), commitSeq(label, next), state { t, sel, tool, snap, zoom, scrollX, scrollY, heights, twirl, keys },
// select(ids, { add }), selectKeys(keys), seek(t), store, requestDraw(), placeComp(id, { start, track }).
// Gestures (select tool): drag a clip to move the selection (linked clips follow; other tracks of the same kind
// included), drag an edge to trim (Alt = ripple), drag empty space for a marquee, drag the ruler to scrub. Keyframe
// rows: click / Shift-click selects keyframes, drag moves them (snapped to frames), Alt-drag scales the selection in
// time, a marquee in the rows selects keyframes. Razor: click to cut (Shift = all tracks). Slip: drag a clip to move
// its source. Wheel = vertical scroll (horizontal when everything fits), Shift + wheel = horizontal, Ctrl / Alt +
// wheel = zoom around the pointer. Track headers: drag the bottom edge to change the height.
// Invariants: a gesture edits a draft model and commits ONE undo step on release; nothing is committed when the
// draft equals the model. Track heights, twirls and the keyframe selection are view state (never saved).
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import * as M from "./model.js";
import * as KO from "./keyops.js";
import { isTrack, valueAt } from "./keyframes.js";
import { linkedIds } from "./edit-ops.js";
import { propLabel } from "./props.js";
import { markContext } from "../ui/context-menu/index.js";

const RULER = 26;
const ROW = { video: 56, audio: 46 };
const PROP_ROW = 22;
const EDGE = 7;
const BAR = 12; // scroll bar thickness
const COLORS = { video: "#3b6fd4", image: "#0f8f8a", text: "#8a5cd6", shape: "#c2701c", solid: "#5b6472", adjustment: "#c0457e", comp: "#2f8f4e", audio: "#2e8b6a" };
export const HEADER_W = 150;
export const ROW_HEIGHTS = { small: 32, medium: null, large: 96, huge: 140 };
const keyId = (k) => `${k.id}|${k.path}|${Math.round(k.t * 1e4)}`;

export function createTimeline(ui) {
  const canvas = h("canvas.of-scene-tl__canvas", { tabindex: "-1", "aria-hidden": "true" });
  const headList = h("div.of-scene-tl__hlist");
  const heads = h("div.of-scene-tl__heads", h("div.of-scene-tl__corner", { style: `height:${RULER}px` }), h("div.of-scene-tl__hclip", headList));
  const vspace = h("div");
  const hspace = h("div", { style: "height:1px" });
  const vbar = h("div.of-scene-tl__vbar", { "aria-hidden": "true" }, vspace);
  const hbar = h("div.of-scene-tl__hbar", { "aria-hidden": "true" }, hspace);
  const body = h("div.of-scene-tl__body", canvas, vbar);
  const el = h("div.of-scene-tl", heads, body, h("div.of-scene-tl__hcorner"), hbar);
  const ctx = canvas.getContext("2d");
  const S = ui.state;
  S.heights ||= {};
  S.twirl ||= new Set();
  S.keys ||= [];
  let draft = null; // model shown while a gesture is in progress
  let guide = null; // snapping guide (time)
  let marquee = null;
  let hover = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let syncing = false;

  const model = () => draft || ui.seqModel();
  const x2t = (x) => (x + S.scrollX) / S.zoom;
  const t2x = (time) => time * S.zoom - S.scrollX;
  const rowH = (tk) => S.heights[tk.id] || ROW[tk.kind];
  const keySet = () => new Set(S.keys.map(keyId));

  /** Rows top to bottom: tracks, and under a track the keyframe rows of its twirled-down clips. */
  function layout(m) {
    const out = [];
    let y = RULER - (S.scrollY || 0);
    for (const tk of m.tracks) {
      const r = { kind: "track", tk, y, h: rowH(tk) };
      out.push(r);
      y += r.h;
      for (const c of M.trackClips(m, tk.id)) {
        if (!S.twirl.has(c.id)) continue;
        const paths = M.animatedPaths(c);
        if (!paths.length) {
          out.push({ kind: "prop", tk, clip: c, path: null, y, h: PROP_ROW });
          y += PROP_ROW;
        }
        for (const path of paths) {
          out.push({ kind: "prop", tk, clip: c, path, y, h: PROP_ROW });
          y += PROP_ROW;
        }
      }
    }
    return out;
  }
  const rows = (m) => layout(m).filter((r) => r.kind === "track");
  const contentH = (m) => {
    const L = layout(m);
    const last = L[L.length - 1];
    return last ? last.y + last.h + (S.scrollY || 0) + 24 : RULER;
  };

  // ------------------------------------------------------------------------------------------- headers
  let headKey = "";
  function drawHeads(m, L) {
    const onKey = (r) => {
      const v = r.path ? M.propValue(r.clip, r.path) : null;
      return isTrack(v) && v.kf.some((k) => Math.abs(k.t - (S.t - r.clip.start)) < 0.5 / m.fps) ? 1 : 0;
    };
    const key = L.map((r) => (r.kind === "track" ? `${r.tk.id}${r.tk.name}${+r.tk.muted}${+r.tk.hidden}${+r.tk.locked}${+!!r.tk.solo}${r.h}` : `${r.clip.id}${r.path}${r.clip.name}${onKey(r)}`)).join("|");
    if (key !== headKey) {
      headKey = key;
      const hbtn = (icon, label, on, fn) => {
        const b = h("button.of-scene-tl__hbtn", { type: "button", title: label, "aria-label": label, "aria-pressed": String(!!on) }, h("sl-icon", icon.startsWith("of:") ? { library: "of", name: icon.slice(3) } : { name: icon }));
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          fn();
        });
        return b;
      };
      headList.replaceChildren(...L.map((r) => (r.kind === "track" ? trackHead(m, r, hbtn) : propHead(m, r, hbtn))));
    }
    headList.style.transform = `translateY(${-(S.scrollY || 0)}px)`;
  }

  function trackHead(m, r, hbtn) {
    const tk = r.tk;
    const set = (patch, label) => ui.commitSeq(label, M.updateTrack(ui.seqModel(), tk.id, patch));
    const name = h("span.of-scene-tl__hname", { title: t("Double-click to rename") }, tk.name);
    name.addEventListener("dblclick", () => ui.renameTrack(tk.id));
    const grip = h("div.of-scene-tl__grip", { title: t("Drag to change the track height") });
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const y0 = e.clientY;
      const h0 = rowH(tk);
      grip.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        S.heights[tk.id] = Math.max(28, Math.min(240, Math.round(h0 + ev.clientY - y0)));
        ui.requestDraw();
      };
      const up = () => {
        grip.removeEventListener("pointermove", mv);
        grip.removeEventListener("pointerup", up);
      };
      grip.addEventListener("pointermove", mv);
      grip.addEventListener("pointerup", up);
    });
    const twirled = M.trackClips(m, tk.id).some((c) => S.twirl.has(c.id));
    const el2 = h("div.of-scene-tl__head", { style: `height:${r.h}px`, "data-kind": tk.kind },
      name,
      tk.kind === "video" ? hbtn(tk.hidden ? "eye-slash" : "eye", t("Hide track"), tk.hidden, () => set({ hidden: !tk.hidden }, "Toggle Track")) : hbtn(tk.muted ? "slash-circle" : "volume-up", t("Mute track"), tk.muted, () => set({ muted: !tk.muted }, "Mute Track")),
      hbtn("of:solo", t("Solo track"), tk.solo, () => set({ solo: !tk.solo }, "Solo Track")),
      hbtn(tk.locked ? "lock-fill" : "unlock", t("Lock track"), tk.locked, () => set({ locked: !tk.locked }, "Lock Track")),
      grip);
    if (twirled) el2.dataset.open = "true";
    return markContext(el2, "scene-track", { ui, track: tk.id });
  }

  function propHead(m, r, hbtn) {
    const c = r.clip;
    if (!r.path) return h("div.of-scene-tl__prop", { style: `height:${r.h}px` }, h("span.of-scene-tl__plabel", { title: t("Use the stopwatch in Properties to animate a property.") }, t("No keyframes")));
    const v = M.propValue(c, r.path);
    const local = ui.state.t - c.start;
    const on = isTrack(v) && v.kf.some((k) => Math.abs(k.t - local) < 0.5 / m.fps);
    const label = propLabel(c, r.path);
    const nav = (dir) => () => ui.goKeyframe(dir, { id: c.id, path: r.path });
    const key = h("button.of-scene-insp__key", { type: "button", title: t("Add or remove a keyframe at the playhead"), "aria-label": t("Keyframe"), "data-state": on ? "key" : "anim" }, h("span"));
    key.addEventListener("click", (e) => {
      e.stopPropagation();
      ui.toggleKeyAt(c.id, r.path);
    });
    const el2 = h("div.of-scene-tl__prop", { style: `height:${r.h}px`, title: `${c.name} › ${label}` },
      h("span.of-scene-tl__plabel", label),
      hbtn("chevron-left", t("Previous keyframe"), false, nav(-1)),
      key,
      hbtn("chevron-right", t("Next keyframe"), false, nav(1)),
      hbtn("bezier2", t("Open in the graph editor"), false, () => ui.openGraph(c.id, r.path)));
    return markContext(el2, "scene-prop", { ui, clip: c.id, path: r.path });
  }

  // ------------------------------------------------------------------------------------------- drawing
  const css = (name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;

  function rulerStep() {
    const fps = model().fps;
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    return steps.find((s) => s * S.zoom >= 70) || 3600;
  }

  // keyframe glyph: diamond (linear), rounded (eased), square (hold)
  function glyph(kx, ky, k, size, fill, stroke) {
    ctx.save();
    ctx.translate(kx, ky);
    ctx.beginPath();
    if (k.e === "hold") ctx.rect(-size * 0.8, -size * 0.8, size * 1.6, size * 1.6);
    else if (k.i || k.o || (k.e && k.e !== "linear")) {
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size, -size, size, 0);
      ctx.quadraticCurveTo(size, size, 0, size);
      ctx.quadraticCurveTo(-size, size, -size, 0);
      ctx.quadraticCurveTo(-size, -size, 0, -size);
    } else {
      ctx.moveTo(0, -size);
      ctx.lineTo(size, 0);
      ctx.lineTo(0, size);
      ctx.lineTo(-size, 0);
      ctx.closePath();
    }
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawClip(m, c, r, colors) {
    const x = t2x(c.start);
    const w = c.dur * S.zoom;
    if (x > W || x + w < 0) return;
    const y = r.y + 3;
    const hh = r.h - 6;
    if (y > H || y + hh < RULER) return;
    const sel = S.sel.has(c.id);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x + 0.5, y, Math.max(2, w - 1), hh, 5) : ctx.rect(x + 0.5, y, Math.max(2, w - 1), hh);
    ctx.fillStyle = c.label || COLORS[c.type] || "#666";
    ctx.globalAlpha = r.tk.locked ? 0.45 : c.off ? 0.3 : c.muted ? 0.5 : 1;
    ctx.fill();
    ctx.clip();
    ctx.globalAlpha = c.off ? 0.4 : 1;
    // thumbnails
    if ((c.type === "video" || c.type === "image") && w > 30 && hh > 26) {
      const md = m.media[c.media];
      const th = hh - 16;
      const tw = Math.max(8, Math.round((th * (md?.w || 16)) / (md?.h || 9)));
      for (let tx = Math.max(x, Math.floor((0 - x) / tw) * tw + x); tx < Math.min(x + w, W); tx += tw) {
        const src = ui.store.thumb(c.media, c.in !== undefined ? c.in + ((tx - x) / S.zoom) * c.speed : 0, 40);
        if (src) ctx.drawImage(src, tx, y + 16, tw, th);
      }
    }
    // waveform
    if (c.type === "audio" && hh > 20) {
      const pk = ui.peaksOf(c.media);
      if (pk) {
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        const mid = y + 14 + (hh - 14) / 2;
        const amp = (hh - 18) / 2;
        const x0 = Math.max(0, Math.floor(x));
        const x1 = Math.min(W, Math.ceil(x + w));
        for (let px = x0; px < x1; px++) {
          const st = c.in + ((px - x) / S.zoom) * c.speed;
          const i0 = Math.floor(st * pk.rate);
          const i1 = Math.max(i0 + 1, Math.floor((st + c.speed / S.zoom) * pk.rate));
          let v = 0;
          for (let i = i0; i < i1 && i < pk.data.length; i++) if (pk.data[i] > v) v = pk.data[i];
          const a = Math.max(0.5, v * amp);
          ctx.fillRect(px, mid - a, 1, a * 2);
        }
      }
    }
    // title strip with the twirl triangle
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(x, y, w, 15);
    ctx.fillStyle = "#fff";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const tx0 = Math.max(x, 0);
    if (w > 24) {
      ctx.beginPath();
      if (S.twirl.has(c.id)) {
        ctx.moveTo(tx0 + 4, y + 5);
        ctx.lineTo(tx0 + 12, y + 5);
        ctx.lineTo(tx0 + 8, y + 11);
      } else {
        ctx.moveTo(tx0 + 5, y + 4);
        ctx.lineTo(tx0 + 11, y + 8);
        ctx.lineTo(tx0 + 5, y + 12);
      }
      ctx.fill();
    }
    const label = c.type === "text" ? c.text.text.replace(/\n/g, " ") : c.name;
    const speed = c.remap !== undefined ? `  ${t("Remap")}` : c.speed && c.speed !== 1 ? `  ${Math.round(c.speed * 100)} %` : "";
    ctx.fillText(`${c.link ? "⛓ " : ""}${c.type === "comp" ? "▣ " : ""}${label}${speed}${c.collapse ? "  ✲" : ""}${c.effects.length ? "  fx" : ""}`, tx0 + (w > 24 ? 16 : 4), y + 8);
    // transitions and fades
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    const wedge = (dur, atStart) => {
      const ww = dur * S.zoom;
      ctx.beginPath();
      if (atStart) {
        ctx.moveTo(x, y + hh);
        ctx.lineTo(x + ww, y);
        ctx.lineTo(x, y);
      } else {
        ctx.moveTo(x + w, y + hh);
        ctx.lineTo(x + w - ww, y);
        ctx.lineTo(x + w, y);
      }
      ctx.fill();
    };
    if (c.tin) wedge(c.tin.dur, true);
    if (c.tout) wedge(c.tout.dur, false);
    if (c.fadeIn) wedge(c.fadeIn, true);
    if (c.fadeOut) wedge(c.fadeOut, false);
    // keyframes (summary of all properties)
    const times = new Set();
    for (const p of M.animatedPaths(c)) for (const f of M.propValue(c, p).kf) times.add(f.t);
    ctx.fillStyle = "#ffd84d";
    if (hh > 20) for (const kt of times) {
      const kx = x + kt * S.zoom;
      ctx.save();
      ctx.translate(kx, y + hh - 6);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }
    ctx.restore();
    if (sel) {
      ctx.strokeStyle = colors.sel;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x + 1, y + 0.5, Math.max(2, w - 2), hh - 1, 5) : ctx.rect(x + 1, y + 0.5, Math.max(2, w - 2), hh - 1);
      ctx.stroke();
    }
  }

  function drawPropRow(m, r, colors, ks) {
    const c = r.clip;
    ctx.fillStyle = colors.prop;
    ctx.fillRect(0, r.y, W, r.h);
    const x = t2x(c.start);
    const w = c.dur * S.zoom;
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(x, r.y + 2, w, r.h - 4);
    ctx.fillStyle = colors.line;
    ctx.fillRect(0, r.y + r.h - 1, W, 1);
    if (!r.path) return;
    const v = M.propValue(c, r.path);
    if (!isTrack(v)) return;
    // the value curve as a faint line (numbers only)
    const nums = v.kf.every((k) => typeof k.v === "number");
    if (nums && v.kf.length > 1) {
      const lo = Math.min(...v.kf.map((k) => k.v));
      const hi = Math.max(...v.kf.map((k) => k.v));
      if (hi > lo) {
        ctx.strokeStyle = "rgba(255, 216, 77, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const steps = Math.min(200, Math.max(8, Math.round(w / 4)));
        for (let i = 0; i <= steps; i++) {
          const lt = (c.dur * i) / steps;
          const val = valueAt(v, lt);
          const yy = r.y + r.h - 4 - ((val - lo) / (hi - lo)) * (r.h - 8);
          if (i) ctx.lineTo(x + lt * S.zoom, yy);
          else ctx.moveTo(x + lt * S.zoom, yy);
        }
        ctx.stroke();
      }
    }
    for (const k of v.kf) {
      const kx = x + k.t * S.zoom;
      if (kx < -8 || kx > W + 8) continue;
      const on = ks.has(keyId({ id: c.id, path: r.path, t: k.t }));
      glyph(kx, r.y + r.h / 2, k, 5, on ? "#ffffff" : "#ffd84d", on ? colors.sel : "rgba(0,0,0,0.5)");
    }
  }

  function syncBars(m) {
    if (syncing) return;
    syncing = true;
    const full = contentH(m);
    vspace.style.height = `${Math.max(H, full + RULER)}px`;
    const wpx = Math.max(W, (M.duration(m) + 30) * S.zoom + W * 0.4);
    hspace.style.width = `${Math.round(wpx)}px`;
    if (Math.abs(vbar.scrollTop - (S.scrollY || 0)) > 1) vbar.scrollTop = S.scrollY || 0;
    if (Math.abs(hbar.scrollLeft - S.scrollX) > 1) hbar.scrollLeft = S.scrollX;
    syncing = false;
  }

  function draw() {
    const m = model();
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (rect.width < 2 || rect.height < 2) return;
    if (W !== Math.round(rect.width) || H !== Math.round(rect.height) || canvas.width !== Math.round(rect.width * dpr)) {
      W = Math.round(rect.width);
      H = Math.round(rect.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const maxScroll = Math.max(0, (M.duration(m) + 30) * S.zoom - W * 0.6);
    S.scrollX = Math.max(0, Math.min(S.scrollX, maxScroll));
    S.scrollY = Math.max(0, Math.min(S.scrollY || 0, Math.max(0, contentH(m) - H)));
    const L = layout(m);
    drawHeads(m, L);
    syncBars(m);
    const colors = { bg: css("--of-bg-panel", "#1d1f23"), row: css("--of-bg-app", "#16181b"), prop: css("--of-bg-bar", "#202328"), line: css("--of-border-soft", "#2c2f36"), text: css("--of-text-muted", "#9aa3b2"), sel: css("--of-accent", "#f59e0b"), head: "#ff4d4f" };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);
    const ks = keySet();
    // rows
    for (const r of L) {
      if (r.y > H || r.y + r.h < RULER) continue;
      if (r.kind === "prop") drawPropRow(m, r, colors, ks);
      else {
        ctx.fillStyle = colors.row;
        ctx.fillRect(0, r.y + 1, W, r.h - 1);
        ctx.fillStyle = colors.line;
        ctx.fillRect(0, r.y + r.h, W, 1);
      }
    }
    // In / Out range
    if (m.range) {
      ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
      ctx.fillRect(t2x(m.range.in), 0, (m.range.out - m.range.in) * S.zoom, H);
    }
    // clips
    for (const r of L) if (r.kind === "track") for (const c of M.trackClips(m, r.tk.id)) drawClip(m, c, r, colors);
    // ruler
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, RULER);
    ctx.fillStyle = colors.line;
    ctx.fillRect(0, RULER - 1, W, 1);
    const step = rulerStep();
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let tm = Math.floor(x2t(0) / step) * step; tm < x2t(W); tm += step) {
      if (tm < 0) continue;
      const x = Math.round(t2x(tm)) + 0.5;
      ctx.fillStyle = colors.line;
      ctx.fillRect(x, RULER - 9, 1, 9);
      ctx.fillStyle = colors.text;
      ctx.fillText(step < 1 ? M.timecode(m, tm) : M.timecode(m, tm).slice(0, 8), x + 4, 10);
      for (let i = 1; i < 5; i++) {
        ctx.fillStyle = colors.line;
        ctx.fillRect(Math.round(t2x(tm + (step * i) / 5)) + 0.5, RULER - 4, 1, 4);
      }
    }
    if (m.range) {
      ctx.fillStyle = colors.sel;
      ctx.fillRect(t2x(m.range.in), RULER - 4, (m.range.out - m.range.in) * S.zoom, 3);
    }
    // markers
    for (const k of m.markers) {
      const x = t2x(k.t);
      ctx.fillStyle = k.color;
      ctx.beginPath();
      ctx.moveTo(x - 5, 13);
      ctx.lineTo(x + 5, 13);
      ctx.lineTo(x + 5, 20);
      ctx.lineTo(x, 25);
      ctx.lineTo(x - 5, 20);
      ctx.fill();
      ctx.globalAlpha = 0.4;
      ctx.fillRect(x - 0.5, RULER, 1, H);
      ctx.globalAlpha = 1;
    }
    // snapping guide, marquee, playhead
    if (guide !== null) {
      ctx.fillStyle = colors.sel;
      ctx.fillRect(Math.round(t2x(guide)), 0, 1, H);
    }
    if (marquee) {
      ctx.fillStyle = "rgba(120, 160, 255, 0.18)";
      ctx.strokeStyle = "rgba(120, 160, 255, 0.9)";
      ctx.lineWidth = 1;
      const [x0, y0, x1, y1] = marquee;
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    const px = Math.round(t2x(S.t));
    ctx.fillStyle = colors.head;
    ctx.fillRect(px, 0, 1, H);
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 7, 0);
    ctx.lineTo(px + 7, 8);
    ctx.lineTo(px + 0.5, 15);
    ctx.lineTo(px - 6, 8);
    ctx.fill();
  }

  // ------------------------------------------------------------------------------------------- hit testing
  function hit(x, y) {
    const m = model();
    if (y < RULER) return { zone: "ruler" };
    const r = layout(m).find((q) => y >= q.y && y < q.y + q.h);
    if (!r) return { zone: "empty" };
    const tm = x2t(x);
    if (r.kind === "prop") {
      const c = r.clip;
      const v = r.path ? M.propValue(c, r.path) : null;
      if (isTrack(v)) {
        let best = null;
        let bd = 7;
        for (const k of v.kf) {
          const d = Math.abs(t2x(c.start + k.t) - x);
          if (d <= bd) {
            bd = d;
            best = k;
          }
        }
        if (best) return { zone: "key", row: r, key: { id: c.id, path: r.path, t: best.t } };
      }
      return { zone: "prop", row: r };
    }
    const c = M.trackClips(m, r.tk.id).find((k) => tm >= k.start && tm < M.clipEnd(k));
    if (!c) return { zone: "track", row: r };
    const cx = t2x(c.start);
    const cw = c.dur * S.zoom;
    if (cw > 24 && y < r.y + 18 && x - Math.max(cx, 0) < 15 && x >= Math.max(cx, 0)) return { zone: "twirl", clip: c, row: r };
    const edge = cw > EDGE * 3 ? (x - cx < EDGE ? "start" : cx + cw - x < EDGE ? "end" : null) : null;
    return { zone: "clip", clip: c, row: r, edge };
  }

  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  function snapped(m, time, skip) {
    guide = null;
    if (!S.snap) return M.snapT(m, time);
    const p = M.snapTo([...M.editPoints(m, skip), S.t], time, 8 / S.zoom);
    if (p === null) return M.snapT(m, time);
    guide = p;
    return p;
  }

  function cursor(hh) {
    if (S.tool === "razor") return "crosshair";
    if (S.tool === "hand") return "grab";
    if (hh.zone === "twirl" || hh.zone === "key") return "pointer";
    if (hh.zone === "clip") return hh.edge ? "ew-resize" : S.tool === "slip" ? "col-resize" : "default";
    return "default";
  }

  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons) return;
    const [x, y] = point(e);
    hover = hit(x, y);
    canvas.style.cursor = cursor(hover);
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    ui.focus();
    const [x0, y0] = point(e);
    const start = hit(x0, y0);
    const m0 = ui.seqModel();
    canvas.setPointerCapture(e.pointerId);
    let move = null;
    let label = "";
    let nextKeys = null;
    const finish = (fn) => {
      const up = (ev) => {
        canvas.releasePointerCapture(ev.pointerId);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", up);
        canvas.removeEventListener("pointercancel", up);
        const d = draft;
        draft = null;
        guide = null;
        marquee = null;
        if (ev.type === "pointerup" && d && d !== m0) {
          ui.commitSeq(label, d);
          if (nextKeys) S.keys = nextKeys;
        }
        fn?.(ev);
        ui.requestDraw();
      };
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
    };
    const onMove = (ev) => {
      const [x, y] = point(ev);
      move?.(x, y, ev);
      ui.requestDraw();
    };
    canvas.addEventListener("pointermove", onMove);

    if (e.button === 1 || S.tool === "hand") {
      const sx = S.scrollX;
      const sy = S.scrollY || 0;
      move = (x, y) => {
        S.scrollX = Math.max(0, sx - (x - x0));
        S.scrollY = Math.max(0, sy - (y - y0));
      };
      return finish();
    }
    if (start.zone === "ruler") {
      const scrub = (x) => ui.seek(Math.max(0, snapped(m0, x2t(x), null)), { scrub: true });
      scrub(x0);
      move = (x) => scrub(x);
      return finish(() => ui.seek(S.t));
    }
    if (start.zone === "twirl") {
      toggleTwirl([start.clip.id]);
      return finish();
    }
    if (start.zone === "key") {
      // keyframes: select, drag to move, Alt-drag to scale the selection in time
      const k = start.key;
      const id = keyId(k);
      const has = keySet().has(id);
      if (e.shiftKey || e.ctrlKey || e.metaKey) ui.selectKeys(has ? S.keys.filter((q) => keyId(q) !== id) : [...S.keys, k]);
      else if (!has) ui.selectKeys([k]);
      if (!S.sel.has(k.id)) ui.select([k.id], { keepKeys: true });
      const sel0 = S.keys.slice();
      const c = m0.clips[k.id];
      const grabT = c.start + k.t;
      const scale = e.altKey && sel0.length > 1;
      const pivot = scale ? sel0.map((q) => m0.clips[q.id].start + q.t).reduce((a, b) => (Math.abs(b - grabT) > Math.abs(a - grabT) ? b : a), grabT) : 0;
      label = scale ? "Scale Keyframes" : "Move Keyframes";
      move = (x) => {
        const nt = snapped(m0, x2t(x), null);
        if (Math.abs(x - x0) < 3 && !draft) return;
        const r = scale && Math.abs(grabT - pivot) > 1e-6 ? KO.retimeKeys(m0, sel0, { factor: Math.max(0.01, (nt - pivot) / (grabT - pivot)), pivot }) : KO.retimeKeys(m0, sel0, { dt: nt - grabT });
        draft = r.model === m0 ? null : r.model;
        nextKeys = r.sel;
      };
      return finish();
    }
    if (start.zone === "clip" && S.tool === "razor") {
      const at = snapped(m0, x2t(x0), null);
      const r = e.shiftKey ? M.splitAll(m0, at) : M.splitClip(m0, start.clip.id, at);
      if (r.model !== m0) ui.commitSeq("Split Clip", r.model);
      return finish();
    }
    if (start.zone === "clip") {
      const c = start.clip;
      if (start.row.tk.locked) return finish();
      // Alt-click selects one clip without its linked partners
      const group = e.altKey ? [c.id] : linkedIds(m0, [c.id]);
      if (e.shiftKey || e.ctrlKey || e.metaKey) ui.select(group, { add: true });
      else if (!S.sel.has(c.id)) ui.select(group);
      const ids = [...S.sel].filter((id) => m0.clips[id]);
      const skip = new Set(ids);
      if (S.tool === "slip" && !start.edge) {
        label = "Slip Clip";
        move = (x) => (draft = M.slipClip(m0, c.id, -((x - x0) / S.zoom) * (c.speed || 1)));
      } else if (start.edge) {
        label = e.altKey ? "Ripple Trim" : "Trim Clip";
        // linked partners with the same edge trim along (picture and sound stay in sync)
        const partners = e.altKey ? [c.id] : linkedIds(m0, [c.id]).filter((id) => {
          const o = m0.clips[id];
          return Math.abs(start.edge === "start" ? o.start - c.start : M.clipEnd(o) - M.clipEnd(c)) < 1e-6 && !M.trackOf(m0, o.track)?.locked;
        });
        move = (x, _y, ev) => {
          const to = snapped(m0, x2t(x), skip);
          let d = m0;
          for (const id of partners) d = M.trimClip(d, id, start.edge, to, { ripple: ev.altKey });
          draft = d;
        };
      } else {
        label = ids.length > 1 ? "Move Clips" : "Move Clip";
        const grab = x2t(x0) - c.start;
        const rowsNow = rows(m0);
        const rowIndex = (yy) => {
          const same = rowsNow.filter((r) => r.tk.kind === start.row.tk.kind);
          const i = same.findIndex((r) => yy >= r.y && yy < r.y + r.h);
          return i < 0 ? (yy < same[0].y ? 0 : same.length - 1) : i;
        };
        const fromRow = rowIndex(y0);
        move = (x, y) => {
          if (Math.abs(x - x0) < 3 && Math.abs(y - y0) < 3 && !draft) return;
          let ns = x2t(x) - grab;
          // snap the start or the end of the grabbed clip, whichever is closer to an edit point
          const a = snapped(m0, ns, skip);
          const ga = guide;
          const b = snapped(m0, ns + c.dur, skip);
          if (ga !== null && (guide === null || Math.abs(a - ns) <= Math.abs(b - (ns + c.dur)))) {
            ns = a;
            guide = ga;
          } else if (guide !== null) ns = b - c.dur;
          else ns = a;
          draft = M.moveClips(m0, ids, ns - c.start, rowIndex(y) - fromRow);
        };
      }
      return finish((ev) => {
        // a plain click on an already selected clip of a multi-selection selects just it (and its partners)
        if (!draft && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && Math.abs(point(ev)[0] - x0) < 3) ui.select(group);
      });
    }
    // empty space: marquee selection of clips, or of keyframes when it starts in a keyframe row
    const keysMode = start.zone === "prop";
    const keepClips = e.shiftKey ? new Set(S.sel) : new Set();
    const keepKeys = e.shiftKey ? S.keys.slice() : [];
    if (!e.shiftKey) {
      if (keysMode) ui.selectKeys([]);
      else ui.select([]);
    }
    move = (x, y) => {
      marquee = [x0, y0, x, y];
      const ta = x2t(Math.min(x0, x));
      const tb = x2t(Math.max(x0, x));
      const ya = Math.min(y0, y);
      const yb = Math.max(y0, y);
      if (keysMode) {
        const got = keepKeys.slice();
        const seen = new Set(got.map(keyId));
        for (const r of layout(m0)) {
          if (r.kind !== "prop" || !r.path || r.y + r.h < ya || r.y > yb) continue;
          for (const k of KO.keysOfClip(r.clip, r.path)) {
            const kt = r.clip.start + k.t;
            if (kt >= ta && kt <= tb && !seen.has(keyId(k))) {
              seen.add(keyId(k));
              got.push(k);
            }
          }
        }
        ui.selectKeys(got);
        return;
      }
      const ids = new Set(keepClips);
      for (const r of rows(m0)) {
        if (r.y + r.h < ya || r.y > yb) continue;
        for (const c of M.trackClips(m0, r.tk.id)) if (c.start < tb && M.clipEnd(c) > ta) ids.add(c.id);
      }
      ui.select([...ids]);
    };
    finish();
  });

  canvas.addEventListener("dblclick", (e) => {
    const [x, y] = point(e);
    const hh = hit(x, y);
    if (hh.zone === "clip") ui.editClip(hh.clip.id);
    else if (hh.zone === "key") ui.seek(model().clips[hh.key.id].start + hh.key.t);
    else if (hh.zone === "prop" && hh.row.path) ui.toggleKeyAt(hh.row.clip.id, hh.row.path, x2t(x));
  });

  // right-click: select what is under the pointer (like every editor), then let the context menu service ask the
  // providers of scene/menus.js for this kind of target
  canvas.addEventListener("contextmenu", (e) => {
    const [x, y] = point(e);
    const hh = hit(x, y);
    const m = model();
    const at = Math.max(0, M.snapT(m, x2t(x)));
    let kind = "scene-timeline";
    const data = { ui, t: at };
    if (hh.zone === "clip" || hh.zone === "twirl") {
      if (!S.sel.has(hh.clip.id)) ui.select(e.altKey ? [hh.clip.id] : linkedIds(m, [hh.clip.id]));
      kind = "scene-clip";
      data.clip = hh.clip.id;
    } else if (hh.zone === "key") {
      if (!keySet().has(keyId(hh.key))) ui.selectKeys([hh.key]);
      kind = "scene-key";
      Object.assign(data, { clip: hh.key.id, path: hh.key.path });
    } else if (hh.zone === "prop") {
      kind = "scene-prop";
      Object.assign(data, { clip: hh.row.clip.id, path: hh.row.path });
    } else if (hh.zone === "track") {
      kind = "scene-space";
      data.track = hh.row.tk.id;
    } else if (hh.zone === "ruler") kind = "scene-ruler";
    markContext(canvas, kind, data);
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [x] = point(e);
    const m = model();
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const tm = x2t(x);
      S.zoom = Math.max(2, Math.min(2000, S.zoom * Math.pow(1.0015, -e.deltaY)));
      S.scrollX = Math.max(0, tm * S.zoom - x);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || contentH(m) <= H) S.scrollX = Math.max(0, S.scrollX + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY));
    else S.scrollY = Math.max(0, (S.scrollY || 0) + e.deltaY);
    ui.requestDraw();
  }, { passive: false });
  heads.addEventListener("wheel", (e) => {
    e.preventDefault();
    S.scrollY = Math.max(0, (S.scrollY || 0) + e.deltaY);
    ui.requestDraw();
  }, { passive: false });
  vbar.addEventListener("scroll", () => {
    if (syncing) return;
    S.scrollY = vbar.scrollTop;
    ui.requestDraw();
  });
  hbar.addEventListener("scroll", () => {
    if (syncing) return;
    S.scrollX = hbar.scrollLeft;
    ui.requestDraw();
  });

  // media and effects dragged from the bin
  const DRAG_TYPES = ["application/x-ofini-scene-media", "application/x-ofini-scene-comp", "application/x-ofini-scene-effect", "application/x-ofini-scene-preset"];
  canvas.addEventListener("dragover", (e) => {
    const types = [...e.dataTransfer.types];
    if (DRAG_TYPES.some((x) => types.includes(x))) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  canvas.addEventListener("drop", (e) => {
    const [x, y] = point(e);
    const hh = hit(x, y);
    const fx = e.dataTransfer.getData("application/x-ofini-scene-effect") || e.dataTransfer.getData("application/x-ofini-scene-preset");
    if (fx) {
      e.preventDefault();
      if (hh.zone === "clip" || hh.zone === "twirl") ui.applyBrowserItem(fx, hh.clip.id);
      else ui.toast(t("Drop effects and presets onto a clip."));
      return;
    }
    const comp = e.dataTransfer.getData("application/x-ofini-scene-comp");
    if (comp) {
      // a composition from the bin (refused with a message when it would contain itself)
      e.preventDefault();
      const m = ui.seqModel();
      guide = null;
      ui.placeComp(comp, { start: snapped(m, x2t(x), null), track: hh.row && hh.row.kind === "track" && hh.row.tk.kind === "video" && !hh.row.tk.locked ? hh.row.tk.id : null });
      return;
    }
    const id = e.dataTransfer.getData("application/x-ofini-scene-media");
    if (!id) return;
    e.preventDefault();
    const m = ui.seqModel();
    const md = m.media[id];
    const row = hh.row && hh.row.kind === "track" && hh.row.tk.kind === (md?.kind === "audio" ? "audio" : "video") && !hh.row.tk.locked ? hh.row.tk.id : null;
    try {
      const r = M.placeMedia(m, id, { start: snapped(m, x2t(x), null), track: row });
      guide = null;
      ui.commitSeq("Add Clip", r.model);
      ui.select(r.ids);
    } catch (err) {
      ui.toast(err.message);
    }
  });

  function toggleTwirl(ids) {
    const open = ids.some((id) => !S.twirl.has(id));
    for (const id of ids) {
      if (open) S.twirl.add(id);
      else S.twirl.delete(id);
    }
    headKey = "";
    ui.requestDraw();
  }

  const ro = new ResizeObserver(() => ui.requestDraw());
  ro.observe(body);

  return {
    el,
    draw,
    /** Zooms so the whole sequence fits. */
    fit() {
      const d = Math.max(5, M.duration(ui.seqModel()));
      S.zoom = Math.max(2, Math.min(2000, (Math.max(200, W) - 40) / d));
      S.scrollX = 0;
      ui.requestDraw();
    },
    /** Scrolls so that time `time` is visible (playback follows the playhead). */
    reveal(time) {
      const x = t2x(time);
      if (x < 0) S.scrollX = Math.max(0, time * S.zoom - 40);
      else if (x > W - 30) S.scrollX = time * S.zoom - W * 0.15;
    },
    /** Shows or hides the keyframe rows of clips (U). */
    toggleTwirl,
    /** Zooms by `f` around timeline time `time` (default: the playhead). */
    zoomAround(f, time = S.t) {
      const center = t2x(time);
      S.zoom = Math.max(2, Math.min(2000, S.zoom * f));
      S.scrollX = Math.max(0, time * S.zoom - center);
      ui.requestDraw();
    },
    timeAt: (clientX) => x2t(clientX - canvas.getBoundingClientRect().left),
    get width() {
      return W;
    },
    destroy() {
      ro.disconnect();
    },
  };
}

