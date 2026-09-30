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
- [x] The toolbar matches the handoff at 100 %, compared with the prototype; the active tool is highlighted.
- [x] Block, note, frame and arrow can be created with the tools; Escape ends a mode.
- [x] Zoom works with the buttons in steps of 10 from 30 to 200 %, the display follows the mouse wheel.
- [x] Auto-layout arranges the whole board or a selected frame without overlaps, and one undo reverts it.
- [x] Ctrl+Z and Ctrl+Shift+Z undo and redo one's own changes, never those of others or of agents; two browsers stay in sync.
- [x] The derived tool behavior was checked from screenshots.
- [x] Tests for the auto-layout conversion, the undo scope and the toolbar pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-09-30)
- **Toolbar:** built from the handoff. The handoff has one divider, between auto-layout and the zoom; the divider before auto-layout that this spec named was left out. Auto-layout is a plain button, not a toggle, and is disabled with a waiting cursor while ELK runs.
- **Placing:** in the modes Block, Notiz and Rahmen a transparent layer over the canvas takes the pointer (crosshair). A click places the element centered on the pointer and snapped to the grid, then the mode ends.
  - A placed block or note joins the frame it lands in, like a dropped one, and opens for editing at once, so it can be named right away.
  - A drawn frame takes in the free elements under it; members of other frames stay where they are. The first live test showed a new frame taking blocks away from "Architektur".
  - Creating an element and joining the frame are one undo step.
- **Verbinden:** the whole block starts the arrow, and blocks do not move in this mode. The mode stays for further arrows until Escape or a click on the tool. React Flow only starts a connection from handles it has measured, and it measures a node again only when its size changes, so the block is measured again whenever its handles change (`useUpdateNodeInternals`). Without that, the mode did nothing in the first live test.
- **Auto-layout** (`auto-layout.ts`):
  - ELK graph with `layered`, top down, and frames as nested graphs (`INCLUDE_CHILDREN`), so a frame is arranged together with its content. The distances are those of spec 09: 40 px side by side, 100 px between layers.
  - The result is snapped to the 20 px grid, and frame sizes are rounded up, so the padding never shrinks. The arrangement starts at the previous top left corner, so the board does not jump. Empty frames are placed like blocks.
  - With one frame selected, only its content is arranged below the title, and the frame takes the size of its content.
  - Nodes that someone else is editing keep their position and size.
  - ELK is its own chunk of 1.4 MB (442 kB compressed), loaded on the first auto-layout.
- **Undo** (`use-undo.ts`): `Y.UndoManager` over nodes and edges, tracking only the own origin; changes of others and of agents arrive with another origin and stay untouched. Changes within 500 ms merge; a drag, a resize, a placement and an auto-layout each start a new step.
- **Focus:** a new node stays hidden until React Flow has measured it, and a hidden input cannot take the focus. The editor therefore tries again on the following frames, for at most 30.
- **Verified** with `pnpm dev`, the browser at 1440 × 900 and a second tab:
  - Block and note placed by click, both opened for editing; a frame drawn around two free blocks took only those two, "Architektur" kept its four.
  - Verbinden: dragging from one block onto another created an arrow; the same direction a second time was refused; Escape ended the mode.
  - Auto-layout of the whole board without overlaps. With "Architektur" selected, only its four blocks moved and the frame grew from 460 × 440 to 480 × 600. One Ctrl+Z restored every position each time, Ctrl+Shift+Z redid it.
  - Zoom with "−" and "+" in steps of 10 around the middle of the view; the display followed the mouse wheel (116 %).
  - Two tabs: a block placed in one appeared in the other. Ctrl+Z in the other tab left it alone; Ctrl+Z in the first removed it in both.
- **Known limits:** undo covers only one's own changes (agents follow with the history view). The main bundle is larger than the 500 kB Vite warns about; splitting it is left for later.
