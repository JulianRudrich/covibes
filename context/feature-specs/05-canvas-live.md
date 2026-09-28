# 05 Live Canvas

## Goal
A project's main canvas is a shared Y.Doc. Two browsers see new blocks, moves and each other's cursors live. After a server restart everything is still there.

## Design decisions
- **Architecture:** `architecture.md`, sections "Canvas" and "Canvas model (Y.Doc)". The Y.Doc is always the source of truth, never a copy in React.
- **Hocuspocus** runs in the Covibes server on the same HTTP server as Hono: WebSocket upgrade on `/api/collab`. The exact integration (upgrade handling with `ws` or the current Hocuspocus API) is checked against the current documentation.
- **Authentication via the session cookie:** the web app connects to its own origin. The Vite proxy forwards `/api` including WebSockets to the server, so the browser sends the session cookie with the handshake. The web app never sees a token (`architecture.md`, "Auth and permissions"). If Hocuspocus requires a token for its auth hook, the client sends a fixed placeholder; only the cookie is checked.
- **Document name:** `board:{boardId}`
- **The Y.Doc model** lives in `packages/shared/src/canvas/`, so that web and server (agents in spec 07) use the same functions.
- **Rendering:** the canvas surface and the cursors look like the handoff. Blocks stay simple in this spec (white card with a title). The complete block design with the four states comes with spec 08.

## Implementation

### Shared: `packages/shared/src/canvas/`
- **Zod schemas and types:**
  - `CanvasNode` with `id`, `type`, `blockType`, `position`, `size`, `label`, `subtitle`, `frameId`, `createdBy`, `lastChangedBy`, `lastChangedAt`
  - `CanvasEdge`
  - `Author`: `{ kind: 'human', userId } | { kind: 'agent', agentKey }`
- **Functions on the Y.Doc:**
  - `getNodesMap(doc)` and `getEdgesMap(doc)`
  - `addBlock(doc, input, author)`
  - `moveNode(doc, id, position, author)`
  - `readNodes(doc)` and `readEdges(doc)`: snapshots for the UI and the agents
- Every change runs in a `doc.transact(...)` with an origin, so that undo (spec 10) can later attribute it per person.
- **Tests:** create, move, snapshot, validation of invalid input

### Server: `apps/server/src/collab/`
- **Hocuspocus** with three hooks:
  - **`onAuthenticate`:**
    1. Hocuspocus checks the session with Better Auth, using the session cookie from the connection's handshake (the same way as the API).
    2. The board id is read from the document name.
    3. Board and membership are checked in Postgres.
    4. Not a member → reject the connection. `viewer` → `connection.readOnly = true`.
  - **Persistence** through the database extension with the table `yjs_documents`. Stores are debounced.
  - On connect, the user is stored in the context: id, name, role.
- **Database connection:** the board and membership check runs through `withUser` with the app role. Persistence uses the admin role, because `yjs_documents` belongs to the server alone.
- **New environment variable** (Zod): `COLLAB_PATH` (default `/api/collab`)

### Migration
- **Table `yjs_documents`:** `name` (PK), `state` (`bytea`), `updated_at`
- **RLS:** enabled, **without** policies for clients. Only the server accesses it.

### Web: `apps/web/src/features/canvas/`
- **`useBoardDoc(boardId)`:**
  - `HocuspocusProvider` with the web app's own address (`ws://` or `wss://` plus `/api/collab`) and `name`
  - If the server rejects the connection, the app reloads the session. If it has expired, the user goes to the sign-in and then back to the project.
  - connection status: connected, connecting or disconnected
- **`useYjsFlow(doc)`:**
  - observes the maps via `observeDeep` and derives `nodes` and `edges` for React Flow
  - `onNodesChange` on position changes: writes through `moveNode`, at most once per frame while dragging
- **`<CanvasBoard>`:**
  - React Flow (`@xyflow/react`)
  - background as a dot grid (20 px, color `canvas-dot`) on `bg-canvas`
  - a simple node type `block`
  - Until the toolbar in spec 10, a button "Block" in the canvas header calls `addBlock` at a free spot.
- **Live cursors via awareness:**
  - `{ user: { id, name }, cursor: { x, y } }` is transmitted in flow coordinates, via `screenToFlowPosition` and throttled to about 30 Hz.
  - The rendering follows the handoff: graphite arrow with a name pill.
  - The app does not show one's own cursor.
- **Connection loss indicator:** a discreet pill "Reconnecting …"
- **Viewers:** cannot drag and cannot create. The button is hidden.

## Out of scope
- block design, states, author line (spec 08)
- edges, frames, sticky notes (spec 09)
- toolbar, zoom controls, auto-layout, undo (spec 10)
- locks while editing (spec 08)

## Dependencies
- Spec 04
- Packages: `yjs`, `@hocuspocus/server`, `@hocuspocus/extension-database`, `@hocuspocus/provider`, `@xyflow/react`, `ws` (current versions, respecting pnpm's minimum release age). `pg` and Better Auth are already there.

## Checklist
- [ ] Two browsers with two users in the same project: a created block appears for the other one in under a second; moving follows smoothly.
- [ ] Both see the other's cursor with a name.
- [ ] After a server restart all blocks are still there.
- [ ] A non-member is rejected on connect. A viewer sees everything but cannot change anything. There are tests for the auth hook.
- [ ] After a short interruption the app reconnects by itself, without data loss.
- [ ] The tests for the shared model pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
