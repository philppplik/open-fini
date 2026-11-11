// Scene Studio timeline (docs/scene-studio.md ▸ Timeline): track headers (DOM) plus one canvas with the ruler, the
// clips (thumbnails, waveforms, keyframes, transitions), markers, the In / Out range and the playhead.
//
//   createTimeline(ui) → { el, draw(), fit(), reveal(t), destroy() }
// `ui` is the workspace (scene/view.js): seqModel() (the sequence on the timeline: the root or an opened
// composition), commitSeq(label, next), state { t, sel, tool, snap, zoom, scrollX }, select(ids, { add }), seek(t),
// store, requestDraw(), placeComp(id, { start, track }).
// Gestures (select tool): drag a clip to move the selection (other tracks of the same kind included), drag an edge
// to trim (Alt = ripple), drag empty space for a marquee, drag the ruler to scrub. Razor: click to cut (Shift = all
// tracks). Slip: drag a clip to move its source. Wheel = scroll, Ctrl / Alt + wheel = zoom around the pointer.
// Invariants: a gesture edits a draft model and commits ONE undo step on release; nothing is committed when the
// draft equals the model.
import { h } from "../core/util.js";
import { t } from "../i18n/index.js";
import * as M from "./model.js";
import { isTrack } from "./keyframes.js";

const RULER = 26;
const ROW = { video: 56, audio: 46 };
const EDGE = 7;
const COLORS = { video: "#3b6fd4", image: "#0f8f8a", text: "#8a5cd6", shape: "#c2701c", solid: "#5b6472", adjustment: "#c0457e", comp: "#2f8f4e", audio: "#2e8b6a" };
export const HEADER_W = 138;

export function createTimeline(ui) {
  const canvas = h("canvas.of-scene-tl__canvas", { tabindex: "-1", "aria-hidden": "true" });
  const heads = h("div.of-scene-tl__heads");
  const body = h("div.of-scene-tl__body", canvas);
  const el = h("div.of-scene-tl", heads, body);
  const ctx = canvas.getContext("2d");
  const S = ui.state;
  let draft = null; // model shown while a gesture is in progress
  let guide = null; // snapping guide (time)
  let marquee = null;
  let hover = null;
  let W = 0;
  let H = 0;
  let dpr = 1;

  const model = () => draft || ui.seqModel();
  const x2t = (x) => (x + S.scrollX) / S.zoom;
  const t2x = (time) => time * S.zoom - S.scrollX;

  function rows(m) {
    let y = RULER - (S.scrollY || 0);
    return m.tracks.map((tk) => {
      const r = { tk, y, h: ROW[tk.kind] };
      y += r.h;
      return r;
    });
  }
  const contentH = (m) => RULER + m.tracks.reduce((n, tk) => n + ROW[tk.kind], 0);

  // ------------------------------------------------------------------------------------------- headers
  let headKey = "";
  function drawHeads(m) {
    const key = m.tracks.map((k) => `${k.id}${k.name}${+k.muted}${+k.hidden}${+k.locked}`).join("|") + (S.scrollY || 0);
    if (key === headKey) return;
    headKey = key;
    const btn = (icon, label, on, fn) => {
      const b = h("button.of-scene-tl__hbtn", { type: "button", title: label, "aria-label": label, "aria-pressed": String(!!on) }, h("sl-icon", { name: icon }));
      b.addEventListener("click", fn);
      return b;
    };
    heads.replaceChildren(
      h("div.of-scene-tl__corner", { style: `height:${RULER}px` }),
      ...m.tracks.map((tk) => {
        const set = (patch, label) => ui.commitSeq(label, M.updateTrack(ui.seqModel(), tk.id, patch));
        const name = h("span.of-scene-tl__hname", { title: t("Double-click to rename") }, tk.name);
        name.addEventListener("dblclick", async () => {
          const v = await ui.prompt(t("Track name"), tk.name);
          if (v) set({ name: v }, "Rename Track");
        });
        return h("div.of-scene-tl__head", { style: `height:${ROW[tk.kind]}px`, "data-kind": tk.kind },
          name,
          tk.kind === "video" ? btn(tk.hidden ? "eye-slash" : "eye", t("Hide track"), tk.hidden, () => set({ hidden: !tk.hidden }, "Toggle Track")) : btn(tk.muted ? "slash-circle" : "volume-up", t("Mute track"), tk.muted, () => set({ muted: !tk.muted }, "Mute Track")),
          btn(tk.locked ? "lock-fill" : "unlock", t("Lock track"), tk.locked, () => set({ locked: !tk.locked }, "Lock Track")));
      }));
    heads.style.transform = `translateY(${-(S.scrollY || 0)}px)`;
  }

  // ------------------------------------------------------------------------------------------- drawing
  const css = (name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;

  function rulerStep() {
    const fps = model().fps;
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    return steps.find((s) => s * S.zoom >= 70) || 3600;
  }

  function drawClip(m, c, r, colors) {
    const x = t2x(c.start);
    const w = c.dur * S.zoom;
    if (x > W || x + w < 0) return;
    const y = r.y + 3;
    const hh = r.h - 6;
    const sel = S.sel.has(c.id);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x + 0.5, y, Math.max(2, w - 1), hh, 5) : ctx.rect(x + 0.5, y, Math.max(2, w - 1), hh);
    ctx.fillStyle = COLORS[c.type] || "#666";
    ctx.globalAlpha = r.tk.locked ? 0.45 : c.muted ? 0.5 : 1;
    ctx.fill();
    ctx.clip();
    ctx.globalAlpha = 1;
    // thumbnails
    if ((c.type === "video" || c.type === "image") && w > 30) {
      const md = m.media[c.media];
      const th = hh - 16;
      const tw = Math.max(8, Math.round((th * (md?.w || 16)) / (md?.h || 9)));
      for (let tx = Math.max(x, Math.floor((0 - x) / tw) * tw + x); tx < Math.min(x + w, W); tx += tw) {
        const src = ui.store.thumb(c.media, c.in !== undefined ? c.in + ((tx - x) / S.zoom) * c.speed : 0, 40);
        if (src) ctx.drawImage(src, tx, y + 16, tw, th);
      }
    }
    // waveform
    if (c.type === "audio") {
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
    // title strip
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(x, y, w, 15);
    ctx.fillStyle = "#fff";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const label = c.type === "text" ? c.text.text.replace(/\n/g, " ") : c.name;
    const speed = c.remap !== undefined ? `  ${t("Remap")}` : c.speed && c.speed !== 1 ? `  ${Math.round(c.speed * 100)} %` : "";
    ctx.fillText(`${c.type === "comp" ? "▣ " : ""}${label}${speed}${c.collapse ? "  ✲" : ""}${c.effects.length ? "  fx" : ""}`, Math.max(x, 0) + 6, y + 8);
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
    // keyframes
    const times = new Set();
    for (const k of M.ANIMATABLE) if (isTrack(c[k])) for (const f of c[k].kf) times.add(f.t);
    for (const e of c.effects) for (const v of Object.values(e.p)) if (isTrack(v)) for (const f of v.kf) times.add(f.t);
    ctx.fillStyle = "#ffd84d";
    for (const kt of times) {
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

  function draw() {
    const m = model();
    const rect = body.getBoundingClientRect();
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
    drawHeads(m);
    const colors = { bg: css("--of-bg-panel", "#1d1f23"), row: css("--of-bg-app", "#16181b"), line: css("--of-border-soft", "#2c2f36"), text: css("--of-text-muted", "#9aa3b2"), sel: css("--of-accent", "#f59e0b"), head: "#ff4d4f" };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);
    const rs = rows(m);
    // rows
    for (const r of rs) {
      ctx.fillStyle = colors.row;
      ctx.fillRect(0, r.y + 1, W, r.h - 1);
      ctx.fillStyle = colors.line;
      ctx.fillRect(0, r.y + r.h, W, 1);
    }
    // In / Out range
    if (m.range) {
      ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
      ctx.fillRect(t2x(m.range.in), 0, (m.range.out - m.range.in) * S.zoom, H);
    }
    // clips
    for (const r of rs) for (const c of M.trackClips(m, r.tk.id)) drawClip(m, c, r, colors);
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
    const r = rows(m).find((q) => y >= q.y && y < q.y + q.h);
    if (!r) return { zone: "empty" };
    const tm = x2t(x);
    const c = M.trackClips(m, r.tk.id).find((k) => tm >= k.start && tm < M.clipEnd(k));
    if (!c) return { zone: "track", row: r };
    const cx = t2x(c.start);
    const cw = c.dur * S.zoom;
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
        if (ev.type === "pointerup" && d && d !== m0) ui.commitSeq(label, d);
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
    if (start.zone === "clip" && S.tool === "razor") {
      const at = snapped(m0, x2t(x0), null);
      const r = e.shiftKey ? M.splitAll(m0, at) : M.splitClip(m0, start.clip.id, at);
      if (r.model !== m0) ui.commitSeq("Split Clip", r.model);
      return finish();
    }
    if (start.zone === "clip") {
      const c = start.clip;
      if (start.row.tk.locked) return finish();
      if (e.shiftKey || e.ctrlKey || e.metaKey) ui.select([c.id], { add: true });
      else if (!S.sel.has(c.id)) ui.select([c.id]);
      const ids = [...S.sel].filter((id) => m0.clips[id]);
      const skip = new Set(ids);
      if (S.tool === "slip" && !start.edge) {
        label = "Slip Clip";
        move = (x) => (draft = M.slipClip(m0, c.id, -((x - x0) / S.zoom) * (c.speed || 1)));
      } else if (start.edge) {
        label = e.altKey ? "Ripple Trim" : "Trim Clip";
        move = (x, _y, ev) => {
          const to = snapped(m0, x2t(x), skip);
          draft = M.trimClip(m0, c.id, start.edge, to, { ripple: ev.altKey });
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
        // a plain click on an already selected clip of a multi-selection selects just it
        if (!draft && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey && Math.abs(point(ev)[0] - x0) < 3) ui.select([c.id]);
      });
    }
    // empty space: marquee selection
    const keep = e.shiftKey ? new Set(S.sel) : new Set();
    if (!e.shiftKey) ui.select([]);
    move = (x, y) => {
      marquee = [x0, y0, x, y];
      const ta = x2t(Math.min(x0, x));
      const tb = x2t(Math.max(x0, x));
      const ya = Math.min(y0, y);
      const yb = Math.max(y0, y);
      const ids = new Set(keep);
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
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [x] = point(e);
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const tm = x2t(x);
      S.zoom = Math.max(2, Math.min(2000, S.zoom * Math.pow(1.0015, -e.deltaY)));
      S.scrollX = Math.max(0, tm * S.zoom - x);
    } else if (e.shiftKey) S.scrollY = Math.max(0, (S.scrollY || 0) + e.deltaY);
    else S.scrollX = Math.max(0, S.scrollX + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY));
    ui.requestDraw();
  }, { passive: false });

  // media dragged from the bin
  canvas.addEventListener("dragover", (e) => {
    const types = [...e.dataTransfer.types];
    if (types.includes("application/x-ofini-scene-media") || types.includes("application/x-ofini-scene-comp")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  canvas.addEventListener("drop", (e) => {
    const [x, y] = point(e);
    const comp = e.dataTransfer.getData("application/x-ofini-scene-comp");
    if (comp) {
      // a composition from the bin (refused with a message when it would contain itself)
      e.preventDefault();
      const hh = hit(x, y);
      const m = ui.seqModel();
      guide = null;
      ui.placeComp(comp, { start: snapped(m, x2t(x), null), track: hh.row && hh.row.tk.kind === "video" && !hh.row.tk.locked ? hh.row.tk.id : null });
      return;
    }
    const id = e.dataTransfer.getData("application/x-ofini-scene-media");
    if (!id) return;
    e.preventDefault();
    const m = ui.seqModel();
    const hh = hit(x, y);
    const md = m.media[id];
    const row = hh.row && hh.row.tk.kind === (md?.kind === "audio" ? "audio" : "video") && !hh.row.tk.locked ? hh.row.tk.id : null;
    try {
      const r = M.placeMedia(m, id, { start: snapped(m, x2t(x), null), track: row });
      guide = null;
      ui.commitSeq("Add Clip", r.model);
      ui.select(r.ids);
    } catch (err) {
      ui.toast(err.message);
    }
  });

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
    timeAt: (clientX) => x2t(clientX - canvas.getBoundingClientRect().left),
    destroy() {
      ro.disconnect();
    },
  };
}
