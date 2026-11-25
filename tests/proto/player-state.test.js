// The prototype player's state machine (proto/player/state.js, task T9): navigation with history and reversed back
// transitions, overlays, variant and variable state, while-hovering and while-pressing holds, conditions, variable
// change cascades, restart and flows, and the model the player renders with variant choices.
import test from "node:test";
import assert from "node:assert/strict";
import * as O from "../../app/src/engine/proto/ops.js";
import { createResolver } from "../../app/src/engine/proto/resolve.js";
import { seededRandom } from "../../app/src/engine/proto/ids.js";
import { initialState, dispatch, startOf, varValue, withVariants, canBack } from "../../app/src/proto/player/state.js";
import { flowModel } from "./flow-fixture.js";

const act = (actions, extra = {}) => ({ type: "actions", actions, ...extra });

test("a flow starts at its frame; without one the page's first frame (top to bottom, left to right)", () => {
  const m = flowModel();
  assert.equal(startOf(m, { flow: m.pages.p1.flows[0] }), "home");
  assert.equal(startOf(m, { start: "details" }), "details");
  assert.equal(startOf(m, { page: "p1" }), "home");
  const s = initialState(m, { flow: m.pages.p1.flows[0] });
  assert.deepEqual(s, { start: "home", flow: "f1", frame: "home", history: [], overlays: [], vars: {}, variants: {}, holds: [] });
  assert.equal(canBack(s), false);
});

test("navigate pushes the history; back returns with the transition reversed; restart and flows reset", () => {
  const m = flowModel();
  let s = initialState(m, { flow: m.pages.p1.flows[0] });
  let r = dispatch(m, s, act(m.nodes.go.proto[0].do));
  s = r.state;
  assert.equal(s.frame, "details");
  assert.deepEqual(r.effects, [{ kind: "screen", from: "home", to: "details", tr: { type: "smart", dur: 300, ease: "ease-out" }, reverse: false }]);
  r = dispatch(m, s, act(m.nodes["done-btn"].proto[0].do));
  s = r.state;
  assert.deepEqual(s.history.map((h) => h.frame), ["home", "details"]);
  r = dispatch(m, s, act([{ act: "back" }]));
  s = r.state;
  assert.equal(s.frame, "details");
  assert.deepEqual(r.effects[0], { kind: "screen", from: "done", to: "details", tr: { type: "push", dir: "left", dur: 250 }, reverse: true }, "back plays the transition that led here, reversed");
  r = dispatch(m, s, { type: "back" });
  assert.equal(r.state.frame, "home");
  assert.equal(r.state.history.length, 0);
  assert.deepEqual(dispatch(m, r.state, { type: "back" }).effects, [], "nothing to go back to");
  // navigating to the frame on screen does nothing
  assert.deepEqual(dispatch(m, r.state, act([{ act: "navigate", to: "home" }])).effects, []);
  r = dispatch(m, s, { type: "restart" });
  assert.equal(r.state.frame, "home");
  assert.equal(r.state.flow, "f1");
  assert.deepEqual(r.state.history, []);
  r = dispatch(m, s, { type: "flow", flow: { id: "fx", start: "done" } });
  assert.equal(r.state.frame, "done");
  assert.equal(r.state.flow, "fx");
});

test("overlays open, swap and close; back closes the top overlay first; navigating closes them all", () => {
  const m = flowModel();
  let s = initialState(m, { start: "home" });
  let r = dispatch(m, s, act(m.nodes.h1.proto[0].do));
  s = r.state;
  assert.deepEqual(s.overlays, [{ id: "menu", pos: "bottom", dim: "#00000066", closeOutside: true, tr: null }]);
  assert.deepEqual(r.effects, [{ kind: "overlay", op: "open", id: "menu", tr: null }]);
  assert.equal(canBack(s), true);
  r = dispatch(m, s, act([{ act: "swapOverlay", to: "done" }]));
  assert.equal(r.state.overlays[0].id, "done");
  assert.equal(r.effects[0].prev, "menu");
  r = dispatch(m, s, { type: "back" });
  assert.deepEqual(r.state.overlays, []);
  assert.equal(r.effects[0].op, "close");
  r = dispatch(m, s, act([{ act: "navigate", to: "details" }]));
  assert.deepEqual(r.state.overlays, []);
  assert.equal(r.state.frame, "details");
  // swap without an overlay opens one; close without one does nothing
  assert.equal(dispatch(m, initialState(m), act([{ act: "swapOverlay", to: "menu" }])).state.overlays.length, 1);
  assert.deepEqual(dispatch(m, initialState(m), act([{ act: "closeOverlay" }])).effects, []);
});

test("variables: set with expressions, conditions, variable change cascades with a limit", () => {
  const m = flowModel();
  let s = initialState(m);
  assert.equal(varValue(m, s, "v1"), false, "the design's value");
  let r = dispatch(m, s, act(m.nodes.card1.proto[0].do));
  s = r.state;
  assert.deepEqual(s.vars, { v1: true, v2: 1 });
  assert.equal(r.effects.filter((e) => e.kind === "update").length, 1, "one render for several changes");
  s = dispatch(m, s, act(m.nodes.card1.proto[0].do)).state;
  assert.deepEqual(s.vars, { v1: false, v2: 2 });
  const cond = { act: "if", cond: { var: "v2", op: ">=", value: 2 }, then: [{ act: "navigate", to: "done" }], else: [{ act: "navigate", to: "details" }] };
  assert.equal(dispatch(m, s, act([cond])).state.frame, "done");
  assert.equal(dispatch(m, initialState(m), act([cond])).state.frame, "details");
  // types are kept: a number variable gets a number, a bool a bool
  assert.equal(dispatch(m, s, act([{ act: "set", var: "v2", value: "7" }])).state.vars.v2, 7);
  assert.equal(dispatch(m, s, act([{ act: "set", var: "v1", value: "yes" }])).state.vars.v1, true);
  // a bad expression is an error effect, not an exception
  const bad = dispatch(m, s, act([{ act: "set", var: "v2", value: { op: "nope", args: [] } }]));
  assert.equal(bad.effects[0].kind, "error");
  assert.equal(bad.state, s);
  // variableChange listeners run after a set; a self-feeding cascade stops
  const listeners = (id) => (id === "v2" ? [{ actions: [{ act: "set", var: "v2", value: { op: "+", args: [{ var: "v2" }, 1] } }] }] : []);
  r = dispatch(m, initialState(m), act([{ act: "set", var: "v2", value: 10 }]), { listeners });
  assert.equal(r.state.vars.v2, 10 + 8, "eight levels of cascade");
  const nav = (id) => (id === "v1" ? [{ actions: [{ act: "if", cond: { var: "v1" }, then: [{ act: "navigate", to: "done" }] }] }] : []);
  assert.equal(dispatch(m, initialState(m), act([{ act: "set", var: "v1", value: true }]), { listeners: nav }).state.frame, "done");
});

test("variants of instances; while hovering and while pressing put things back on release", () => {
  const m = flowModel();
  const s0 = initialState(m);
  let r = dispatch(m, s0, act([{ act: "variant", set: { state: "hover" } }], { instance: "inst" }));
  assert.deepEqual(r.state.variants, { inst: { state: "hover" } });
  assert.equal(r.effects[0].kind, "update");
  assert.equal(dispatch(m, s0, act([{ act: "variant", set: { state: "x" } }])).effects[0].kind, "error", "no instance to change");
  // hold: hover changes a variant and opens an overlay; release restores both
  r = dispatch(m, s0, { type: "hold", kind: "hover", source: "inst", instance: "inst", actions: [{ act: "variant", set: { state: "hover" }, tr: { type: "smart", dur: 150 } }, { act: "openOverlay", to: "menu" }] });
  let s = r.state;
  assert.equal(s.holds.length, 1);
  assert.deepEqual(r.effects.find((e) => e.kind === "update").tr, { type: "smart", dur: 150 });
  assert.equal(dispatch(m, s, { type: "hold", kind: "hover", source: "inst", actions: [{ act: "back" }] }).state, s, "a hold does not stack");
  r = dispatch(m, s, { type: "release", source: "inst", kind: "hover" });
  assert.deepEqual(r.state.variants, {});
  assert.deepEqual(r.state.overlays, []);
  assert.deepEqual(r.state.holds, []);
  assert.deepEqual(r.effects.map((e) => `${e.kind}:${e.op || ""}`), ["overlay:close", "update:"]);
  // press holds a variable change; a release of something else does nothing
  r = dispatch(m, s0, { type: "hold", kind: "press", source: "card1", actions: [{ act: "set", var: "v1", value: true }] });
  s = r.state;
  assert.deepEqual(s.vars, { v1: true });
  assert.equal(dispatch(m, s, { type: "release", source: "other" }).state, s);
  assert.deepEqual(dispatch(m, s, { type: "release", source: "card1", kind: "press" }).state.vars, {});
  // a hold that navigates is not kept (the screen it was on is gone)
  r = dispatch(m, s0, { type: "hold", kind: "press", source: "go", actions: [{ act: "navigate", to: "details" }] });
  assert.deepEqual(r.state.holds, []);
});

test("links, scrolling and the action budget", () => {
  const m = flowModel();
  const s = initialState(m);
  assert.deepEqual(dispatch(m, s, act([{ act: "openUrl", url: "https://example.com" }])).effects, [{ kind: "url", url: "https://example.com", newTab: true }]);
  assert.deepEqual(dispatch(m, s, act([{ act: "openUrl", url: "javascript:alert(1)" }])).effects, [], "only http(s), mailto and tel");
  assert.deepEqual(dispatch(m, s, act([{ act: "scrollTo", to: "card1", smooth: false }])).effects, [{ kind: "scroll", to: "card1", smooth: false }]);
  const many = Array.from({ length: 300 }, (_, i) => ({ act: "set", var: "v2", value: i }));
  const r = dispatch(m, s, act(many));
  assert.ok(r.effects.some((e) => e.kind === "error" && /Too many actions/.test(e.message)));
  assert.equal(r.state.vars.v2, 255);
  assert.deepEqual(dispatch(m, s, act([null, 3, { act: "media" }, { act: "unknown" }])).effects, [], "malformed actions are skipped");
});

test("withVariants writes the player's choices into the instances it renders", () => {
  let m = flowModel();
  const run = (op) => (m = O.apply(m, op, { random: seededRandom(5) }).model);
  run({ op: "node.create", type: "component", page: "p1", id: "a", fields: { name: "state=default", x: 0, y: 1000, fills: [{ type: "solid", color: "#ffffff" }] } });
  run({ op: "node.create", type: "component", page: "p1", id: "b", fields: { name: "state=hover", x: 200, y: 1000, fills: [{ type: "solid", color: "#000000" }] } });
  run({ op: "component.combine", ids: ["a", "b"], id: "set1", name: "Button" });
  run({ op: "instance.create", of: "set1", parent: "home", id: "inst" });
  assert.equal(withVariants(m, {}), m);
  const pv = withVariants(m, { inst: { state: "hover" }, ghost: { x: "y" } });
  assert.deepEqual(pv.nodes.inst.variant, { state: "hover" });
  assert.equal(pv.nodes.home, m.nodes.home, "other layers keep their identity");
  const fill = (model) => createResolver(model).tree("inst").node.fills[0].color;
  assert.equal(fill(m), "#ffffff");
  assert.equal(fill(pv), "#000000");
  const nested = withVariants(m, { "inst/n1": { state: "hover" } });
  assert.deepEqual(nested.nodes.inst.over, { n1: { variant: { state: "hover" } } });
});
