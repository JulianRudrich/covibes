# 49 Loading and layout

## Goal and current owner decision

Keep the productive **Covibes Studio** design. The owner reinstated it on
2026-11-24; the unintegrated Signal Atlas experiment is preserved on
`spec/55-new-product-design` at `fab6a2d` and is not an implementation input.
The production design is the Studio palette, fonts, overlapping-circle logo,
agent marks, pill controls, chat left / canvas center / overview right, and the
existing phone areas. This spec changes loading boundaries and the missing
intermediate-width behavior, not that identity or the established project flows.

## Contracts

- Split login, project list, workspace, invitation, public share and development
  mailbox at route boundaries. Login must not request workspace, React Flow,
  Tiptap, ELK or PDF code. Infrequent project dialogs load when opened; existing
  data and permission checks stay in their owning components. Dynamic import
  failures use the existing retry page. A translated loading card uses existing
  Studio primitives and reserves space while a chunk is fetched.
- Below 768 px, retain the existing phone header, areas and read-only canvas/plan.
  From 768 to 1279 px, retain chat left and editable canvas center; the overview
  folds into a labeled, keyboard-accessible right-side panel. The normal project
  header wraps without clipping. At 1280 px and above, retain the three columns.
- Chat and overview widths can be changed with pointer drags or a vertical
  separator's Left/Right keys (10 px; Shift 40 px), Home/End to limits. Keep a
  useful canvas width; clamp malformed or obsolete device preferences. Remember
  panel widths and overview visibility locally, without storing project content.
  A labeled focus-canvas control temporarily hides the side panels; restoring it
  preserves drafts and prior panel preferences. Escape closes a folded overview
  and restores its opener. No global single-letter keyboard shortcut.
- The document has a favicon derived from the existing two-circle mark,
  application description, theme colors, and a generic 1280×640 share preview.
  Shared metadata must not contain private project names, messages or tokens.
  Use local, original assets; no tracking or third-party fetch for metadata.
- German/English labels, visible focus, reduced motion, readable loading/error
  states, and existing authorization semantics remain. No new runtime sample data.

## Acceptance

1. A production cold login loads no workspace/editor chunks. Record the initial
   JavaScript gzip size and compare it with the pre-split build. Do not hide
   unconditional preloads behind manual vendor chunks.
2. Existing route/authentication and project-flow tests pass. Focused coverage
   verifies splitter limits, persisted invalid preferences, keyboard resizing,
   folded overview and focus-mode restoration without losing an unsent draft.
3. At 390, 768, 1024, 1280 and 1440 px, including long German labels, dark mode
   and 200% zoom, essential controls remain reachable and the document does not
   require horizontal scrolling. Inspect the actual app, not the archived prototype.
4. Local favicon and preview are served, HTML includes description/preview tags,
   and generic metadata exposes no private project data. Production builds,
   TypeScript, lint, formatting, token checks and relevant tests pass.
