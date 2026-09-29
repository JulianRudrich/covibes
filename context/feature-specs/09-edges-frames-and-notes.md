# 09 Edges, Frames and Sticky Notes

## Goal
Blocks can be connected with labeled arrows, grouped in frames and supplemented by sticky notes for unfinished thoughts. Everything is live for everyone, and the moderator can draw all three.

## Design decisions
- **Look:** handoff README, sections "Arrows", "Frame 'Architecture'" and "Sticky note 'Offline mode?'", and `ui-context.md`, "Canvas".
- **Dashed proposal edges** come with the proposal state in spec 13 (owner decision, 2026-09-29).
- **Connections only between blocks** (glossary in `project-overview.md`: a connection is a real relationship between two blocks). No connection from a block to itself, at most one per direction between the same two blocks.
- **Anchoring as in the handoff:** an arrow leaves the bottom edge of the source and enters the top edge of the target as a cubic Bézier. Blocks side by side are connected straight from the right edge to the left edge (like "REST" in the handoff). Several arrows on the same edge of a block are spread evenly along it. The anchors are computed from the positions; `sourceHandle` and `targetHandle` stay empty.
- **Frames** are labeled areas that contain a diagram (glossary). A node belongs to the frame in which its center lies when it is dropped. Moving a frame moves its content along. Frames are not nested in V1.
- **Sticky notes** hold one text and show their creator in the footer ("Notiz · Alex").
- **Interactions the handoff does not show** are derived from the existing building blocks (owner decision, 2026-09-29) and accepted by the owner from screenshots:
  - Connection points appear on hover and on the selected block as small dots at the edge centers; dragging from one to another block creates the arrow.
  - Double-click on an arrow edits its label in the pill; double-click on a note or on a frame title edits the text in place.
  - Frames get resize handles at the corners when selected.
  - Arrows, notes and frames are selected and deleted like blocks.
  - Until the toolbar (spec 10), the canvas header gets the buttons "Notiz" and "Rahmen" next to "Block".
- **Locks** from spec 08 apply to notes and frames as well: the pill "{name} bearbeitet" appears above the element that someone edits.
- **Agents** get `connect_blocks`, `add_note` and `add_frame` (owner decision, 2026-09-29).

## Implementation

### Shared: `packages/shared/src/canvas/`
- **Edge schema** gets `lastChangedBy` and `lastChangedAt`, like nodes. The label has at most 40 characters.
- **Sizes:** sticky note 176 × 124; new frame 480 × 320, at least 240 × 160.
- **Functions** (each validated, in a transaction with the author's origin, setting `lastChangedBy` and `lastChangedAt`):
  - `addEdge(doc, { id, source, target, label }, author)`: both ends must be blocks, not the same block, and not already connected in this direction
  - `updateEdgeLabel(doc, id, label, author)` and `removeEdges(doc, ids, author)`
  - `addNote(doc, { id, position, text }, author)`
  - `addFrame(doc, { id, position, size, title }, author)` and `resizeFrame(doc, id, size, author)`
  - `updateNode(doc, id, changes, author)` replaces `updateBlock`: text fields per node type (title and subtitle for blocks, text for notes, title for frames), the type only for blocks
  - `moveNode` moves the members of a frame along; `placeNode(doc, id, author)` sets or clears `frameId` from the node's center after a drop
  - `removeNodes` of a frame keeps its members and clears their `frameId`
- `findFreeSpot` takes the size of the new element.
- **Tests:** edge rules, frame membership and moving with members, removal cases, note and frame validation.

### Web: `apps/web/src/features/canvas/`
- **Edge `CanvasArrow`:** anchors as described above, color `edge` at 1.5 px with a filled head. If the edge or its target was changed by an agent in the last 5 seconds, it is drawn in the agent color at 1.75 px, and the label pill takes the agent's tint, border and dark color.
- **Label pill:** 20 px high, Geist Mono 11 px, centered on the curve; hidden when the label is empty.
- **Creating connections:** React Flow's `onConnect` with the rules above (`isValidConnection`); the new arrow has no label yet.
- **Node `FrameNode`:** as in the handoff, header with frame icon, title and "{{count}} Blöcke"; always below all other nodes; resize with `NodeResizer`.
- **Node `NoteNode`:** as in the handoff (colors, radius, rotation, shadow, footer with avatar); the text wraps and is cut off after four lines.
- **New tokens** in `ui-context.md` and `theme.css` for the colors of the note footer and its avatar and for the note shadow, taken from the handoff.
- **Drop:** after a drag ends, `placeNode` runs for every moved node.
- **Viewers** cannot connect, edit, resize or delete.
- **i18n:** `canvas.addNote`, `canvas.addFrame`, `canvas.newNote`, `canvas.newFrame`, `canvas.noteBy` ("Notiz · {{name}}"), `canvas.blockCount` with plural forms, labels for the inputs.

### Server: `apps/server/src/tools/`
- **`connect_blocks`** `{ from, to, label? }` (block ids): the rules of `addEdge` apply; a violation is reported back to the model.
- **`add_note`** `{ text }`: a note at a free spot next to the existing elements.
- **`add_frame`** `{ title, blockIds? }`: without blocks at a free spot; with blocks, the frame encloses them with 40 px padding and they become its members.
- **Agent context:** the canvas snapshot lists frames with their members, blocks, notes and arrows ("API → Datenbank: SQL"), each with its id. The moderator prompt explains the new tools and that notes are for open thoughts.
- Locks from spec 08 apply: an agent does not change a note or frame that someone edits.

## Out of scope
- dashed proposal edges (spec 13)
- toolbar with the tools "Verbinden", "Notiz" and "Rahmen" (spec 10)
- nested frames, connections to notes or frames
- turning notes into blocks (the moderator does it with the existing tools; a dedicated action may follow)
- diagram types of frames (spec 12)

## Dependencies
- Spec 08
- Packages: none new

## Checklist
- [ ] Arrows, labels, notes and frames match the handoff at 100 %, compared with the prototype.
- [ ] Two browsers: arrows, notes and frames appear, change and disappear live for both.
- [ ] A block dropped into a frame belongs to it; moving the frame moves it along; the count "{{count}} Blöcke" is right.
- [ ] Deleting a block removes its arrows; deleting a frame keeps its content.
- [ ] `@Moderator` connects two blocks with a label, adds a note and puts blocks into a new frame on request.
- [ ] The owner accepted the derived interactions from screenshots.
- [ ] Tests for the shared model, the arrow anchoring and the three tools pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
