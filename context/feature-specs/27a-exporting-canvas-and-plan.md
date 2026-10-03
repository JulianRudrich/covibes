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
- [ ] The open board downloads as PNG and SVG that show the whole board without selection, cursors and proposals.
- [ ] The open board downloads as Markdown with a Mermaid diagram per frame in the forms described above.
- [ ] The plan downloads as Markdown and as PDF with title, sections, lists, emphasis and assignees.
- [ ] Viewers can export; the texts of exports are in the project's language.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the shared code and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
