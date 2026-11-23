---
title: Office Studio
name: Office
description: Documents, spreadsheets, presentations and a whiteboard that open and save Word, Excel, PowerPoint, OpenDocument, Excalidraw and tldraw files. Everything runs locally.
for: Documents, spreadsheets, slides and whiteboards
output: DOCX, XLSX, PPTX, ODF, PDF, PNG, SVG
lead: >
  Four apps in one studio: a page-based word processor, a spreadsheet, presentations and an infinite whiteboard.
  They open the files you already have and save them back in their own format.
alt: The Office studio with a report template open in the word processor, its outline on the left and the formatting toolbar above the page.
coming_from: |
  Word, Excel and PowerPoint files open and save as `.docx`, `.xlsx` and `.pptx`, and OpenDocument files work the same
  way. From Google Docs, Sheets and Slides, download a copy in one of those formats first; there is no Google account
  connection. Excalidraw and tldraw boards open in the Whiteboard.
limits: |
  Spreadsheet pivot tables are written to XLSX and ODS as values, and spill references, LET, LAMBDA, INDIRECT and
  OFFSET are missing. Round trips with files made by Excel, PowerPoint and LibreOffice are tested in code, not yet
  in those applications.
---

## Document {document}

Pages with styles, lists, tables, images, footnotes and page layout. Templates for letters, reports, invoices, memos,
meeting notes and resumes. Opens DOCX, ODT, RTF, HTML and Markdown; exports Word, OpenDocument and PDF.

## Spreadsheet {sheet}

Budgets, lists and calculations with formulas. Opens Excel workbooks, OpenDocument spreadsheets and CSV or TSV;
exports PDF and PNG as well.

## Presentation {slides}

Slide decks with layouts, shapes, pictures, tables, themes and transitions, a slide sorter and full-screen
presenting. Opens and saves `.pptx` and `.odp`.

## Whiteboard {board}

An infinite canvas for sketches, sticky notes, flowcharts and handwritten notebooks, with a pressure-aware pen,
connectors that follow shapes, frames, a laser pointer and comments.
