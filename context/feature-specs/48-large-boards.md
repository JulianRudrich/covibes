# 48 Large Boards

## Goal
A populated board opens with its contents in view. Members can show everything
and navigate through a minimap. A change projects only affected document nodes,
and dragging writes position continuously but authorship only once at the end.

## Design decisions
- The owner's 2026-11-17 design reset supersedes the old Studio handoff. This
  spec adds behavior and accessible navigation only; spec 55 styles it.
- Initial fit occurs once per opened board, after React Flow measures nodes.
  It must not pull the viewport away while a person is navigating or editing.
- Keep the document as the source of truth, with local selection/drag state.
- Use Yjs changed-key events and cached node snapshots; unaffected projected
  React Flow node and edge objects retain identity.
- During a drag, coalesce position writes per animation frame. On the final
  drop (or leaving during a drag), stamp the human author and time once, then
  settle frame membership. Frame members retain their existing authorship
  when the frame carries them, as in the existing canvas contract.
- Do not promise a fixed frame rate across arbitrary machines. Verify object
  identity and bounded document growth on a 500-node representative board.

## Implementation
- Shared position-only move operation alongside final attributed moves.
- Incremental Yjs snapshot/projection updates and stable React Flow objects.
- Initial fit, an accessible show-all command and a pannable/zoomable minimap.
- Tests for unchanged node identity, final attribution, read-only and locked
  nodes, frame children, and repeated drag document-size growth.

## Out of scope
- New node appearances and desktop/tablet layout (spec 55).
- Replacing React Flow, Yjs or the existing collaboration transport.

## Dependencies
- Specs 05 and 08–10; no new packages.

## Checklist
- [x] A board opens with its existing content visible without disrupting later navigation.
- [x] Show-all and minimap navigation work for readers and editors.
- [x] Moving one element on a 500-node board preserves unrelated node identities.
- [x] Drag updates change position only; the final drop stamps provenance once.
- [x] Repeated drag updates have bounded encoded Yjs size growth.
- [x] Read-only, locked-node and frame behavior remain covered.
- [x] Focused tests, lint, type checks and formatting pass.

## Implementation notes

`observeBoardProjection` validates only the changed Y.Map entries, retaining
the other cached snapshots and projected React Flow objects. Context changes
such as locks, frame membership counts and diagram types still update their
dependent nodes; arrow geometry retains unrelated rendered edge identities.
Initial fit runs once for the opened board, yielding to an explicit element
focus. Show-all and the built-in pannable, zoomable minimap serve both readers
and editors. The fit policy allows 0.1% zoom, so a 500-block row fits as well
as a compact board. Below 1%, the zoom label states that range explicitly.

Live drag transactions write position without changing authorship. The final
drop stamps provenance once and resolves frame membership. Leaving the board
mid-drag finalizes the pending position before the connection is destroyed.
Frame members preserve their authorship when carried by a moving frame.

Validation covers 500 cached nodes with 499 untouched object identities, a
500-block row fitting the viewport, unrelated edge identity, read-only/locked
nodes and frame behavior, and 300 intermediate drag positions. The encoded
document grows by less than 1 KiB in that drag test, with over five times less
growth than repeatedly writing provenance. These are deterministic regression
checks; a browser frame-rate benchmark is not part of this verification.

Validation (2026-11-18): 39 focused shared tests and 59 focused web tests pass.
Changed-file ESLint, all workspace type checks, the repository format check and
`git diff --check` pass. The parent integration performs the broader merge
checks when combining the specs.
