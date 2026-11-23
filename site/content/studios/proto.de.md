---
title: Proto Studio
name: Proto
description: Proto ist ein geplantes Studio, um Oberflächen gemeinsam mit Agenten zu gestalten, als Prototyp auszuprobieren und an Code zu übergeben. Ziel sind die Versionen 1.3.x.
for: Oberflächendesign und Prototypen
output: HTML und CSS, React, Tailwind, SwiftUI (geplant)
lead: >
  In Proto sollen Oberflächen von Anwendungen gestaltet, als Prototyp erprobt und an Code übergeben werden, von
  Menschen und Agenten gemeinsam, in einem Dokument, dessen Bedeutung CSS ist. Es ist noch nicht gebaut; diese Seite
  beschreibt den Plan.
alt: Das Release-Artwork von OpenFini anstelle eines Bildschirmfotos, weil das Proto-Studio noch nicht gebaut ist.
coming_from: |
  Geplant ist der Funktionsumfang eines modernen Werkzeugs für Oberflächendesign, nicht für Illustration: Frames,
  automatisches Layout, Komponenten mit Varianten und Variablen mit Modi. Geplante Importe sind SVG, HTML und CSS,
  Sketch, Penpot und Design-Tokens; Figma-Dateien (`.fig`) werden sich nicht öffnen lassen, weil es keine öffentliche
  Spezifikation des Formats gibt.
limits: |
  Nichts auf dieser Seite gibt es heute schon. Der Entwurf steht in einem Entscheidungsdokument und einem Konzept mit
  Bauplan; Details können sich bis 1.3 noch ändern.
---

## Gestalten {design}

Frames auf einer unendlichen Fläche, automatisches Layout (Flex) und Grid-Layout, Bedingungen, Komponenten mit
Varianten und Eigenschaften, Instanzen mit Überschreibungen und Variablen mit Modi für hell und dunkel, Marken und
Dichten.

## Prototypen {prototype}

Interaktionen auf jeder Ebene, Abläufe, Überlagerungen, scrollende und fixierte Ebenen, Variablen und Bedingungen für
Zustände und ein Player in eigenem Fenster, der sich als einzelne HTML-Datei exportieren lässt.

## Für Agenten gebaut {agents}

Der Vibe-Assistent erstellt und prüft Frames und Komponenten aus einer Beschreibung, einem Bildschirmfoto oder einer
URL. Externe Agenten erreichen dasselbe Dokument über einen MCP-Server.

## Für Code gebaut {code}

Was die Fläche zeigt, tut auch der Browser, denn die Fläche ist die Layout-Engine des Browsers. Export nach HTML und
CSS, React, Tailwind und SwiftUI, und Tokens und Komponenten werden mit dem Code-Studio geteilt.
