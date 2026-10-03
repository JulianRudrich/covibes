# 27a Exporting Canvas and Plan

## Goal
What the team worked out leaves Covibes as files: a board as an image (PNG, SVG) and as diagram code (Mermaid), the plan as Markdown and as PDF. Everyone who can read a project can export it.

First part of spec 27; part 27b brings the package for coding agents.

## Design decisions
- **Where:** the exports sit where their content is. The toolbar of the canvas has "Exportieren" for the open board, the toolbar of the plan has it for the plan. Each opens a small menu with the formats; the file is downloaded at once. The dialog of the spec overview comes with the package (part 27b), which needs a conversation before it is built.
- **Who:** every member, also viewers; an export changes nothing. The read-only link offers none.
- **Language:** the texts an export adds (titles, "Notizen", "Seite 1 von 3") are in the project's language, like the plan.
- **A board as an image:**
  - PNG and SVG show the whole board, whatever is in view: all blocks, notes, frames and arrows on the canvas color, with some room around them. A PNG has twice the resolution of the screen.
  - They show the board itself: no selection, no cursors and locks of others, no proposals that nobody applied.
  - A very large board is scaled down so that the image stays within what browsers can draw.
  - The SVG is drawn by the browser from the canvas as it is (`html-to-image`). Browsers and everything that shows images display it; drawing programs may not open it for editing. Diagram code is what the Mermaid export is for.
- **A board as Mermaid:** one Markdown file with a diagram per frame, each under its title in a `mermaid` code block, so GitLab and GitHub show it as it is:
  - architecture, flow, sitemap and free frames become a `flowchart` (top down); the blocks of a flow keep their shapes (start and end rounded, a branch as a diamond), a database is a cylinder
  - a mind map becomes a `mindmap` when it is a tree from one topic, else a flowchart from left to right
  - a data model becomes an `erDiagram` with the fields of its entities; an arrow labeled "1:n", "n:1", "1:1" or "n:m" gets that cardinality
  - the roadmap becomes a `timeline` with a period and name per milestone
  - blocks outside of frames become one more flowchart; arrows between diagrams are listed below the diagrams; notes are listed as text
- **The plan as Markdown:** the plan as it stands, with a title that names the project. A task someone took names them in parentheses.
- **The plan as PDF:** made in the browser from the plan as it stands (`pdfmake`): A4, the title with the project's name and the date, the sections with their headings, lists and emphasis, assignees like in the Markdown, and page numbers. It is a document, not a picture of the editor: its font is the one the library brings (Roboto).
- **New packages:** `html-to-image` (MIT) and `pdfmake` (MIT, with the font Roboto under Apache 2.0). Both are loaded only when someone exports. This settles the open point "library for the PDF export" of `architecture.md`.

## Implementation

### Shared: `packages/shared/src/`
- `canvas/mermaid.ts`: `boardToMermaid` turns the nodes and arrows of a board (and the roadmap, if the board shows it) into the Markdown described above.
- `plan-export.ts`: `planExportMarkdown` gives the plan as Markdown with its title and assignees; the texts of exports in both languages; a file name from the project's name.

### Web
- `features/export/`: downloading a file; the board as PNG and SVG; the plan as PDF (`planPdfDefinition` builds the document from the plan's nodes).
- "Exportieren" in the canvas toolbar (PNG, SVG, Mermaid) and in the plan's toolbar (Markdown, PDF), also for viewers.
- What is no part of the board carries a mark that keeps it out of the image.
- **i18n:** `export.*`.

### Server
- Nothing: everything an export needs is in the browser.

## Out of scope
- the package for coding agents (part 27b)
- exporting a single frame or a selection, and choosing the size of an image
- an SVG of own shapes that drawing programs edit
- exports from the read-only link, and exports by agents
- bringing files into a repository (spec 29)

## Dependencies
- Spec 26 (both parts), spec 25 (all three parts), spec 12
- Packages: `html-to-image`, `pdfmake` (web)

## Checklist
- [x] The open board downloads as PNG and SVG that show the whole board without selection, cursors and proposals.
- [x] The open board downloads as Markdown with a Mermaid diagram per frame in the forms described above.
- [x] The plan downloads as Markdown and as PDF with title, sections, lists, emphasis and assignees.
- [x] Viewers can export; the texts of exports are in the project's language.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the shared code and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-03)
- **A board as Mermaid** (`packages/shared/src/canvas/mermaid.ts`, `boardToMermaid`):
  - The file starts with the board's title. Every frame with blocks follows in reading order (top to bottom, then left to right) under its own title, with one diagram in a `mermaid` code block.
  - `flowchart TD` for architecture, flow, sitemap and free frames: a block is `n1["Title<br/>Subtitle"]`, a database a cylinder, start and end rounded, a branch a diamond; an arrow carries its label.
  - `mindmap` for a mind map that is a tree (one block without an arrow to it, every other block reached by exactly one arrow); otherwise `flowchart LR`.
  - `erDiagram` for a data model: entities by an id with their name as alias, fields as `type name` (words only; a field without a type gets `_`). A label that starts with "1:n", "n:1", "1:1" or "n:m" sets the cardinality and the rest is the label; any other arrow is many-to-many.
  - `timeline` for the roadmap: a line per milestone with its weeks ("W1–3"), or "Meilenstein 1" and its time while the roadmap has no scale.
  - The blocks outside of frames are one more flowchart; arrows between diagrams and notes follow as lists. Texts are escaped for Mermaid labels and for Markdown.
- **The plan as Markdown** (`plan-export.ts`): `planExportMarkdown` writes "# Projektplan: Name" and the plan with its sections as headings. `withAssigneeNames` adds the assignee in italics after a task someone took; the PDF uses it too.
- **Texts and names** (`export-texts.ts`): what an export adds is written in the project's language; `exportFileName` builds a file name from the names of project and board (lowercase, umlauts written out, nothing a path could be built from).
- **A board as an image** (`apps/web/src/features/export/board-image.ts`):
  - The area of the board is read from where React Flow placed its elements, so it is the same at every zoom. The canvas is drawn into an image of that area plus 40 px around it; an area longer than 6000 px is scaled down.
  - PNG has twice the resolution of that area; the canvas color fills it. In the SVG the color is a rectangle of its own behind the canvas.
  - Before an image is made, the selection is cleared. What carries `data-no-export` stays out: the cursors of others, proposals, the marks "edits right now" and "just drawn", and the button to assign a task.
  - `html-to-image` 1.11.13 is loaded with the first image.
- **The plan as PDF** (`plan-pdf.ts`): `planPdfDefinition` builds the document for `pdfmake` 0.3.11 from the plan's nodes; a heading never stands alone at the end of a page. The library and its font (two files of about 0.9 MB each) are loaded with the first PDF. The colors come from the design tokens.
- **Menus:** `ExportMenu` is a button with a download icon that opens the formats and rests while a file is made. It sits at the end of the canvas toolbar (PNG, SVG, Mermaid) and in the plan's toolbar between "Roadmap" and "Plan erzeugen" (Markdown, PDF), for viewers too. An export that gives no file shows a note.
- **Server:** nothing changed.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App"; the files were caught in the page instead of saved:
  - Mermaid of the main canvas: the architecture as a flowchart with its three labeled arrows and the database as a cylinder, the roadmap as a timeline with "W1–3" to "W12–13", and the two free blocks. File name `vereins-app-haupt-canvas.md`.
  - PNG: 5072 × 1720 px for a board of 2536 × 860, 689 KB, with all blocks, arrows and the roadmap in the app's font on the canvas color.
  - SVG: 2536 × 860, loads as an image; 3.3 MB, since it carries the fonts.
  - Plan as Markdown: `vereins-app-projektplan.md` with the title and the five sections. Plan as PDF: four pages in well under a second.
  - Mermaid itself was asked whether it reads the output: a board with every kind of diagram and texts full of quotes, brackets, semicolons and "#" gave eight diagrams, and Mermaid 11 parsed all of them.
  - The look of the PDF was checked from page images of a document made with the same definition outside of the browser (the browser pane draws no PDF while it is hidden).
  - Not tried live: viewers, and a board large enough to be scaled down; both are covered by the tests.
- **Found while testing live:**
  - The buttons to assign tasks showed in the image; they are left out now.
  - The canvas color covered only a part of the SVG; it is a rectangle behind the canvas now.
  - In a tab that is not drawn, the image waits for the next frame (the library waits for one). A visible tab is not affected.
- **Known limits:**
  - The SVG is the canvas as the browser draws it, wrapped in an SVG. Browsers show it; drawing programs may not open it for editing, and it is large.
  - Texts that the canvas cuts with "…" end without it in an image.
  - An image always shows the whole board; a single frame or a selection cannot be exported.
  - The PDF is set in Roboto, not in the app's font, and covers the scripts Roboto covers.
  - In the Mermaid file notes are a list of texts without their place, and an arrow between two diagrams is a line of a list, not an arrow.
