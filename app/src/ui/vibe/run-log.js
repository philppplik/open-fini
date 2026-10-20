// Feeds a Timeline from a VibeSession's public events. Created once per Vibe Studio (before the chat and the side
// panels) so the log keeps recording while the Activity tab is closed.
import { Timeline } from "./timeline.js";

const textOf = (m) => {
  if (typeof m.content === "string") return m.content;
  const t = (m.content || []).filter((b) => b.type === "text").map((b) => b.text).filter((x) => !/^\[Attached/.test(x));
  return t.join(" ") || "Attached files";
};

export function createRunLog(session) {
  const timeline = new Timeline();
  const known = new WeakSet();

  session.on("chat", () => timeline.clear());
  session.on("message", (m) => timeline.startRun(textOf(m)));
  session.on("event", (ev) => timeline.event(ev));
  session.on("plan", (steps) => timeline.setPlan(steps));
  session.on("approval", (req) => {
    timeline.approvalAsked(req);
    const resolve = req.resolve;
    // the chat's approval card resolves the request: observe the decision without changing the contract
    req.resolve = (ok) => {
      timeline.approvalDecided(req.id, !!ok);
      return resolve(ok);
    };
  });
  session.on("done", (res) => timeline.finish(res));
  session.on("error", (err) => timeline.fail(err));
  session.on("status", (s) => s === "idle" && timeline.settle());
  session.on("runs", (runs) => {
    const fresh = runs.filter((r) => !known.has(r));
    for (const r of fresh) known.add(r);
    if (fresh.length) timeline.attachUndo(fresh, fresh.reduce((n, r) => n + Math.max(0, r.doc.history.index - r.marker), 0));
  });

  return timeline;
}
