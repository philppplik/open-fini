// Lazy skill pack: Proto Studio skills (`proto-*`, docs/concepts/proto-studio.md §7, task T11). Loaded by
// packs/index.js only when one is used. SKILL.md strings parsed with parseSkill(); keep each small. No backticks inside
// the markdown. "Prototype a flow" came with the interaction tools (T9).

const fm = (name, description, tools, when) => `---
name: proto-${name}
description: ${description}
version: 1.0.0
tags: [proto]
allowed-tools: ${tools}
when-to-use: ${when}
---`;

const READ = "proto_describe, proto_screenshot, proto_lint, proto_fix";

export const PROTO_SKILLS = [
  `${fm("screen-from-brief", "Design an app or web screen in the Proto Studio from a short brief, with auto layout, variables and a lint pass.", `${READ}, proto_new, proto_create, proto_update, proto_variables, proto_content, proto_rename, proto_responsive`, "design a screen, login screen, dashboard, landing page, settings page, onboarding, app ui")}
# Design a screen from a brief

1. proto_describe. Reuse what exists: components (instances instead of copies), variables (bind colors and spacing), styles. If there are no variables and the brief names brand colors, create a collection first (proto_variables action collection, then create).
2. Decide the frame: phone 390 wide, tablet 834, desktop 1440. One proto_create call builds the whole screen as one nested spec: a top-level frame with layout column and pad, sections as nested frames (rows and columns), text with real copy, buttons as rows with pad and justify center.
3. Sizing: sections w "fill"; text that should wrap w "fill"; buttons and inputs at least 44 px high; gaps and padding in 4 px steps (8, 12, 16, 24, 32).
4. Look: proto_screenshot of the frame. Fix what looks wrong with proto_update (dotted paths for single fields) instead of rebuilding.
5. proto_content for realistic names, prices and dates; proto_rename for semantic names and tags.
6. proto_responsive for the target widths; proto_lint, then proto_fix for the safe fixes; screenshot again.

Report the frame id, what you built and what you left open.`,

  `${fm("screen-from-screenshot", "Turn an attached screenshot or picture into an editable Proto design with auto layout, and compare it with the reference.", `${READ}, proto_from_screenshot, proto_create, proto_update, proto_move, proto_variables`, "screenshot to design, rebuild this screen, copy this ui, image to design, recreate from picture")}
# Screenshot to editable design

1. Look at the attached image yourself first: regions (header, content, list, tab bar), repeated items, font sizes, colors.
2. proto_from_screenshot (pass width, for example 390 for a 3x phone capture). It places a locked reference layer, an empty frame to build into, the dominant colors and recognized text.
3. Build inside that frame with proto_create (parent = the frame id): one nested spec, auto layout everywhere, real text (from the hints or what you read), the hint colors. Repeated items: build one, make it a component (proto_component create), then instances.
4. Compare: proto_screenshot with id = the frame and compare = the reference id. Correct sizes, gaps and colors with proto_update; repeat until the layout matches (the pixel difference is a hint, not a goal).
5. Delete the reference layer when the user is happy (proto_delete), proto_lint and proto_fix.

Never leave the design as one flat image; every text must be a text layer.`,

  `${fm("component-variants", "Build a reusable component with variants and properties in the Proto Studio (button, input, card, tab).", `${READ}, proto_create, proto_component, proto_update, proto_styles`, "component, variants, button states, design system component, reusable, instance")}
# Build a component with variants

1. Build the base once with proto_create: a row or column frame with auto layout, hug sizes, real text, bound colors.
2. proto_component action create (the frame becomes a component). Name the variants as "size=md, state=default".
3. For each other variant: proto_duplicate the component, change it with proto_update, rename it ("size=md, state=hover"), then proto_component action combine with all of them: the names become variant properties.
4. Properties: defineProp for text (label), bool (show icon), swap (icon) and slot (content); bindProp connects a property to a layer field (text, visible, of).
5. Use it: proto_component action instance with variant and props; set and swap change instances later.
6. proto_describe shows the set with its axes; proto_screenshot of the set to check every variant.`,

  `${fm("tokens-dark-mode", "Set up design tokens (variables and styles) with light and dark modes in the Proto Studio, bind the design to them and export them.", `${READ}, proto_variables, proto_styles, proto_tokens, proto_search, proto_update`, "design tokens, dark mode, theme, color variables, spacing scale, dtcg, brand themes")}
# Tokens and dark mode

1. proto_variables action collection name "Color" modes ["Light", "Dark"]; create items with values per mode: color/bg, color/surface, color/text, color/muted, color/primary, color/on-primary, color/border.
2. A second collection "Spacing" (one mode) with number items space/1 … space/8 (4, 8, 12, 16, 24, 32, 48, 64) and scopes gap and padding; radius/sm, radius/md.
3. Text styles with proto_styles create kind text (body, label, title, heading).
4. Bind: proto_search unbound color, then proto_update with bind, or proto_lint rules unbound-color and unbound-spacing followed by proto_fix (it binds values that equal a variable).
5. Dark mode: proto_variables action setMode on a frame (or the page) with coll Color and mode Dark; proto_screenshot both modes.
6. Export with proto_tokens action export (dtcg, css, tailwind or swift); import a DTCG file with proto_tokens action import.`,

  `${fm("handoff", "Prepare a Proto design for developer handoff: names, tags, tokens, components and a clean lint report.", `${READ}, proto_rename, proto_search, proto_update, proto_tokens, proto_responsive, proto_to_code`, "handoff, prepare for developers, clean up design, ready for code, spec, export code, react, swiftui")}
# Prepare for handoff

1. proto_lint for the whole design; proto_fix the safe issues; list what still needs a decision.
2. proto_rename for semantic names and tags (button, nav, header, h1, p) so code export reads well.
3. No literal colors where tokens exist: proto_search unbound color; bind them.
4. proto_responsive for each screen at the breakpoints; fix overflow with fill sizes and wrapping.
5. proto_tokens export (dtcg); proto_to_code in the format the team uses (html, react, react-tailwind, tailwind, swiftui) and read its notes.
6. Summarize: screens, components with their variants, tokens, open issues.`,

  `${fm("design-audit", "Audit a Proto design system: contrast, touch targets, token use, detached copies, unused tokens and naming, with a prioritized fix list.", `${READ}, proto_search, proto_get_node`, "audit, review design, design system audit, accessibility check, consistency check")}
# Design system audit

1. proto_describe for the structure; proto_lint (all rules) for the facts.
2. Group the findings: accessibility (contrast, touch-target, overflow-text), consistency (unbound-color, unbound-spacing, off-grid, detached-style), components (detached-instance, inactive-override), hygiene (naming, empty-frame, unused-token).
3. Look at the worst screens with proto_screenshot.
4. Report a prioritized list (errors first) with issue ids; apply fixes only after the user agrees, with proto_fix and the ids (structural fixes run only when named).`,

  `${fm("prototype-flow", "Prototype a flow in the Proto Studio: connect screens with clicks and transitions, overlays, interactive component states and variables, and a flow starting point to play.", `${READ}, proto_interaction, proto_create, proto_update, proto_component, proto_variables`, "prototype, clickable prototype, flow, user flow, connect screens, interactions, smart animate, overlay, onboarding flow, checkout flow")}
# Prototype a flow

1. proto_describe and proto_interaction action list: which frames exist, which interactions and flows are there already. Screens of a flow are top-level frames on one page.
2. Missing screens: build them first (proto-screen-from-brief). Give the layers that should match between screens the same names (a card, a header, a button), so smart animate can move them.
3. Connect: proto_interaction connect from = the button or row, to = the next frame, transition { type: "smart", dur: 300, ease: "ease-out" } for screens that share layers, push or moveIn with a dir for drill-down, dissolve otherwise. Back buttons: add with { on: { type: "click" }, do: [{ act: "back" }] }.
4. Overlays (menus, dialogs, sheets): openOverlay with pos (center, bottom for sheets) and dim; a close button gets closeOverlay; key Escape closes too.
5. States: hover and pressed looks as variants of a component (proto_component), then on the variant { on: { type: "hover" }, do: [{ act: "variant", set: { state: "hover" }, tr: { type: "smart", dur: 150 } }] } so every instance reacts. Toggles and counters: a variable (proto_variables) with set and if actions; bind the visible field or a text to it.
6. Timed screens (splash): { on: { type: "afterDelay", ms: 1500 }, do: [{ act: "navigate", to: "Home" }] } on the frame.
7. proto_interaction addFlow with start = the first screen and a name; list again and check that every screen of the flow is reached and no target is missing.

Tell the user to press Ctrl+Alt+Enter (Prototype ▸ Preview) to play it, and which flow to pick.`,
];
