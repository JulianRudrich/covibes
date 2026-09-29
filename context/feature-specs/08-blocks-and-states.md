# 08 Blocks and Their States

## Goal
Blocks look like the handoff: icon, title, subtitle and an author line. They show three states: normal, just changed by AI and locked while a human edits them. People select, edit, retype and delete blocks; the moderator can change blocks too, but never one that a human is editing.

## Design decisions
- **Look:** handoff README (`context/design/main-screen/`), sections "Block – base structure" and "The four block states", and `ui-context.md`, "The four block states". Exact values come from the handoff.
- **Proposal state:** moves to spec 13, together with the `proposals` table, "Apply" and "Reject" (owner decision, 2026-09-29). This spec builds normal, just changed by AI and locked.
- **Interactions the handoff does not show** are derived from the existing building blocks and tokens (owner decision, 2026-09-29). The owner accepts them from screenshots:
  - **Selection:** the focus outline (`2px solid ink`, offset 2 px) around the block.
  - **Editing:** double-click, or Enter on a selected block, turns title and subtitle into inputs in place, in the same typography. Enter or leaving the block saves, Escape cancels. An empty title is not saved.
  - **Block type:** a click on the icon tile of a selected block opens the dropdown menu (building block from spec 04) with the block types, each with icon and name.
  - **Delete:** Delete or Backspace removes the selected blocks.
- **Locks run through the Yjs awareness** (`architecture.md`, "Canvas"). Whoever edits a block holds its lock; everyone else sees the state "locked" with the name and cannot drag, edit or delete the block. A lock ends when the person stops editing or their connection ends.
- **Author line = creator** (`createdBy`). Human names come from the project's members; for a person who is no longer a member it reads "Former member". Agents show their localized name and letter.
- **Block types:** a base set with the icons of the handoff. Types that this version does not know (e.g. from a later version) are shown as a generic block. Spec 12 adds the types of the other diagram types.
- **Agents:** they get the tool `update_block` (owner decision, 2026-09-29: every canvas spec gives agents the matching tools). Until the rule engine (spec 13), a locked block is refused with a clear note instead of becoming a proposal. Agents cannot delete blocks before spec 13.

## Implementation

### Shared: `packages/shared/src/canvas/`
- **Block types:** `BLOCK_TYPES = ['app', 'server', 'service', 'database', 'repository', 'metric']`; `null` is the generic block.

  | Type | Lucide icon | German | English |
  |---|---|---|---|
  | generic (`null`) | `square` | Block | Block |
  | `app` | `app-window` | App | App |
  | `server` | `server` | Server | Server |
  | `service` | `network` | Dienst | Service |
  | `database` | `database` | Datenbank | Database |
  | `repository` | `git-branch` | Repository | Repository |
  | `metric` | `gauge` | Kennzahl | Metric |

  Stored nodes keep accepting any type string; new input (`addBlock`, `updateBlock`) only accepts the known types.
- **`updateBlock(doc, id, changes, author)`:** changes `label`, `subtitle` and `blockType`, validated like `addBlock`; sets `lastChangedBy` and `lastChangedAt`. Returns false if the block no longer exists.
- **`removeNodes(doc, ids, author)`:** removes the nodes and every edge that touches them, in one transaction with the author's origin.
- **Awareness and locks (`canvas/awareness.ts`, moved from the web app):**
  - schema of an awareness state: `{ user: { id, name }, cursor?, editing?: { nodeId, since } }`
  - `nodeLocks(states)` → the lock holder per node. If two people start editing the same node, the earlier `since` wins, then the lower client id; the other one leaves edit mode.
  - Invalid states are ignored, as before.
- **Tests:** update, removal including edges, type validation, lock resolution.

### Web: `apps/web/src/features/canvas/`
- **`BlockNode`** in the handoff's anatomy: 30 px icon tile, title, subtitle, author line with a 16 px avatar (human round with initials, agent square with letter) and name.
- **States:**
  - normal
  - just changed by AI (spec 07), now complete: icon tile in the agent tint and subtitle in the dark agent color
  - locked by someone else: border `1.5px human`, background and ring from the handoff, `cursor: not-allowed`, the pill "{name} bearbeitet" with a lock icon on the left above the block and a blinking caret in the title
  - selected (derived, see above)
- **Editing:** while editing, the own awareness carries `editing`. If an earlier lock of someone else shows up, the edit is cancelled and the block shows as locked. Drag is off while editing.
- **Locked blocks** are not draggable, editable or deletable for anyone but the lock holder.
- **Type menu** on the icon tile, see above. Viewers see no menu.
- **Delete** with Delete or Backspace (`deleteKeyCode`), leaving out blocks locked by someone else. Typing in an input never deletes.
- **Stacking order:** nodes are sorted by `lastChangedAt`, then by id, so every browser shows the same order and the last changed block lies on top (open point from spec 05).
- **Names:** the workspace passes the members from the project query; the canvas maps user ids to names.
- **i18n:** `canvas.isEditing` ("{{name}} bearbeitet" / "{{name}} is editing"), `canvas.formerMember`, `canvas.blockTypes.*`, `canvas.changeType` and labels for the inputs.

### Server: `apps/server/src/`
- **Board access** (`collab/board-client.ts`): `withBoard` also hands over the current locks, read from the awareness the collaboration server sends on connect.
- **Tool `update_block`** (`tools/update-block.ts`): input `{ id, title?, subtitle?, type? }`, at least one change.
  - Changes the block through `updateBlock` with the agent as author.
  - A locked block is not changed; the tool answers "{name} is editing this block right now" so the agent can tell the team. `// Rule engine: spec 13` marks the spot.
  - An unknown id is reported back to the model.
- **`add_block`** gets the optional `type`.
- **Agent context:** the canvas snapshot in the prompt lists each block with id, type, title, subtitle and, if locked, who is editing it. The moderator prompt explains `update_block` and the block types.

## Out of scope
- proposal state, "Apply" and "Reject" (spec 13)
- edges, frames and sticky notes (spec 09)
- toolbar, zoom and undo (spec 10); until then the "Block" button in the canvas header stays
- block types of the other diagram types (spec 12)
- canvas references in the chat, comments on blocks
- deleting blocks by agents (spec 13)

## Dependencies
- Spec 07
- Packages: none new (`lucide-react`, `@xyflow/react`, `yjs` are there)

## Checklist
- [ ] Blocks match the handoff at 100 % for human and agent authors: icon tile, title, subtitle, author line. Compared with the prototype.
- [ ] Two browsers: while A edits a block, B sees "A bearbeitet" with the lock look within a second and cannot drag, edit or delete the block. The lock ends when A finishes or closes the tab.
- [ ] `@Moderator` renames a block and changes its type on request. While a human edits the block, it does not change it and says so in the chat.
- [ ] Editing, type menu and deleting work; a viewer can do none of it.
- [ ] Both browsers show overlapping blocks in the same order.
- [ ] The owner accepted the derived interactions (selection, editing, type menu) from screenshots.
- [ ] Tests for the shared model, the lock resolution, the block node and `update_block` pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
