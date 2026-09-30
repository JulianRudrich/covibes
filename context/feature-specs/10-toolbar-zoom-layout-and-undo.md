# 10 Toolbar, Zoom, Auto-Layout and Undo

## Goal
The canvas gets the floating toolbar of the handoff: tools for block, note, frame and connection, auto-layout and zoom from 30 to 200 %. Everyone can undo and redo their own changes.

## Design decisions
- **Look:** handoff README, section "Toolbar", and `ui-context.md`, "Canvas".
- **How the tools behave** is not shown in the handoff and is derived (owner decision, 2026-09-29):
  - Block, Notiz, Rahmen and Verbinden are modes, only one at a time. By default none is active; selecting, moving and panning work as before.
  - In the modes Block and Notiz, a click on the empty canvas places the element there (snapped to the grid) and the mode ends. In the mode Rahmen, dragging draws the frame; a click places one in the default size.
  - In the mode Verbinden, dragging from one block to another (anywhere on the block) creates an arrow; the mode stays until Escape or another click on the tool.
  - Escape ends every mode. Auto-Layout is an action, not a mode.
  - The prototype shows "Block" as active by default; the app starts without an active tool so that a click on the canvas never creates something by accident.
- **Zoom:** "−" and "+" change in steps of 10 between 30 and 200 %, around the middle of the visible area; the display shows the current zoom rounded to whole percent, also after zooming with the mouse wheel or a trackpad.
- **Auto-layout with ELK** (`elkjs`, EPL-2.0 approved by the owner on 2026-09-29, see `code-standards.md`): algorithm `layered`, direction top to bottom as the arrows run, distances on the 20 px grid.
  - With a frame selected, only its content is arranged, and the frame grows to fit.
  - Without a selection, the whole board is arranged; frames move as a whole with their content.
  - The result is written in one transaction, so it is one undo step.
  - ELK is only loaded when auto-layout is used.
- **Undo applies to one's own changes** (owner decision, 2026-09-29): `Y.UndoManager` tracks only the origin of the signed-in person. Undoing changes of agents follows later with a history view that still has to be designed.

## Implementation

### Web: `apps/web/src/features/canvas/`
- **`CanvasToolbar`**, bottom center, 16 px from the edge: the four tools with icon and label, a divider, auto-layout, a divider and the zoom control, exactly as in the handoff (sizes, colors, active state). Hidden for viewers except for the zoom.
- **Modes** as described above; the cursor shows the mode (crosshair for placing and drawing).
- **The temporary buttons** "Block", "Notiz" and "Rahmen" in the canvas header are removed.
- **Auto-layout** (`auto-layout.ts`): turns the board or the selected frame into an ELK graph, runs the layout and writes the new positions (and frame sizes) with `moveNode` and `resizeFrame` in one transaction. Nodes that someone else is editing keep their position.
- **Undo and redo** (`use-undo.ts`): one `Y.UndoManager` per board over nodes and edges with the own origin; a drag, an edit or an auto-layout is one step each. Keys: Ctrl or Cmd + Z, Ctrl or Cmd + Shift + Z and Ctrl + Y; not while typing in an input. Viewers have no undo.
- **i18n:** labels and tooltips of the tools and the zoom (`canvas.tools.*`, `canvas.zoomIn`, `canvas.zoomOut`).

### Shared
- `moveNodes(doc, moves, author)` for many positions in one transaction (used by auto-layout).

## Out of scope
- layout presets per diagram type and auto-layout by agents (spec 12)
- undoing agent changes and the history view (needs design; not planned yet)
- further keyboard shortcuts, copy and paste

## Dependencies
- Spec 09
- Packages: `elkjs` (current version, respecting pnpm's minimum release age)

## Checklist
- [ ] The toolbar matches the handoff at 100 %, compared with the prototype; the active tool is highlighted.
- [ ] Block, note, frame and arrow can be created with the tools; Escape ends a mode.
- [ ] Zoom works with the buttons in steps of 10 from 30 to 200 %, the display follows the mouse wheel.
- [ ] Auto-layout arranges the whole board or a selected frame without overlaps, and one undo reverts it.
- [ ] Ctrl+Z and Ctrl+Shift+Z undo and redo one's own changes, never those of others or of agents; two browsers stay in sync.
- [ ] The derived tool behavior was checked from screenshots.
- [ ] Tests for the auto-layout conversion, the undo scope and the toolbar pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
