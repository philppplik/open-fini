---
title: Proto Studio
name: Proto
description: Proto is a planned studio for designing, prototyping and handing interfaces to code, by people and agents together. It is targeted at the 1.3.x releases.
for: Interface design and prototyping
output: HTML and CSS, React, Tailwind, SwiftUI (planned)
lead: >
  Proto is where application interfaces will be designed, prototyped and handed to code, by people and agents
  together, in a document whose meaning is CSS. It is not built yet; this page describes the plan.
alt: The OpenFini release artwork, shown in place of a screenshot because Proto Studio is not built yet.
coming_from: |
  The plan covers the feature set of a modern interface design tool, not an illustration tool: frames, auto layout,
  components with variants and variables with modes. Planned imports are SVG, HTML and CSS, Sketch, Penpot and design
  tokens; Figma `.fig` files will not open, because the format has no public specification.
limits: |
  Nothing on this page ships today. The design is recorded in a decision record and a concept with a build plan;
  details can still change before 1.3.
---

## Design {design}

Frames on an infinite canvas, auto layout (flex) and grid layout, constraints, components with variants and
properties, instances with overrides, and variables with modes for light and dark, brands and densities.

## Prototype {prototype}

Interactions on any layer, flows, overlays, scrolling and fixed layers, variables and conditions for state, and a
player in its own window that can be exported as a single HTML file.

## Agent-native {agents}

The Vibe assistant creates and checks frames and components from a prompt, a screenshot or a URL. External agents
reach the same document through an MCP server.

## Code-native {code}

What the canvas shows is what the browser does, because the canvas is the browser's own layout engine. Export to
HTML and CSS, React, Tailwind and SwiftUI, and share tokens and components with the Code studio.
