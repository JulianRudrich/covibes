# 12 Diagram Types

## Goal
A frame can hold a diagram of a type: mind map, architecture, data model, flow or sitemap. Each type brings its block types and its own auto-layout. The moderator draws these diagrams on request and arranges them.

## Design decisions
- **Look from the prototype** (owner decision, 2026-09-30): there are no drafts for this spec. Every look is derived from the tokens in `ui-context.md` and the building blocks of the handoff, and listed in `ui-context.md` under "Derived looks" for the design pass at the end (spec 36).
- **Diagram types** from `project-overview.md` ("Diagram types in V1"); the roadmap follows in spec 26:
  - `mindmap` (Mindmap)
  - `architecture` (Architektur)
  - `datamodel` (Datenmodell)
  - `flow` (Ablauf), also for pipelines
  - `sitemap` (Sitemap)

  A frame without a type is a free area, as before.
- **Stored on the frame** as `diagramType`, not in the `meta` map of the first canvas model: it moves, disappears and is undone together with its frame. `architecture.md` is updated.
- **Block types per diagram.** Every type is the block card of spec 08 with its own Lucide icon; the generic block stays available everywhere.

  | Diagram | Block types (UI name, icon) | New blocks get |
  |---|---|---|
  | Mindmap | `topic` (Kernthema, circle-dot), `idea` (Idee, lightbulb) | `topic` for the first block, then `idea` |
  | Architektur | `app`, `server`, `service`, `database`, `repository`, `metric` (spec 08) | the generic block |
  | Datenmodell | `entity` (Entität, table) | `entity` |
  | Ablauf | `start` (Start, circle-play), `step` (Schritt, square-arrow-right), `decision` (Verzweigung, split), `end` (Ende, circle-stop) | `step` |
  | Sitemap | `page` (Seite, panel-top) | `page` |

- **Entities have fields**, since a data model is about attributes: a list of up to 20 fields, each with a name (1–40 characters) and an optional type (up to 40), e.g. `id uuid`. The card shows them between the header and the author line in Geist Mono (like the arrow labels), name left, type right in `text-3`. The block grows by 22 px per field; after 8 fields it shows "+ {{count}} weitere". While editing in place, a text field below the title holds one field per line ("name type").
- **The type of a frame** is shown and changed in its header: the frame icon becomes the icon of the diagram type, and the type name follows the title in `text-3` ("Nutzer und Projekte · Datenmodell · 4 Blöcke"). Clicking the icon of a selected frame opens a menu like the block type menu: "Freier Rahmen" and the five types. Changing the type leaves existing blocks as they are.
- **The block type menu** offers the generic block and the types of the diagram the block belongs to. A block outside a typed frame gets all types, grouped by diagram with the diagram names as headings.
- **New blocks in a typed frame** (placed with the tool "Block" or added by an agent) get the type from the table above.
- **Layout presets** (ELK, distances of spec 10):
  - Mindmap: `mrtree`, growing to the right from the central topic
  - Architektur, Ablauf and free frames: `layered`, top to bottom (as in spec 10)
  - Datenmodell: `layered`, left to right
  - Sitemap: `mrtree`, top to bottom

  Auto-layout of the whole board first arranges the content of every frame with its preset, then arranges frames and free elements as boxes with `layered`, top to bottom. ELK cannot mix algorithms in one pass, so these are separate passes.
- **Arrows in diagrams that read left to right** (mind map, data model) leave the right edge and enter the left edge whenever the target lies more beside than below the source. Everywhere else the anchoring of spec 09 stays.
- **Agents** get the tools for the new elements (owner decision, 2026-09-29) and auto-layout (moved here from spec 10):
  - `add_frame` takes a diagram type.
  - `add_block` takes all block types, the fields of an entity and the id of the frame the block belongs to.
  - `update_block` changes the fields of an entity.
  - `arrange_frame` arranges the content of a frame with its preset, like auto-layout in the web app.
- **Locks** apply as before: auto-layout leaves elements in place that someone edits, and agents do not change them.

## Implementation

### Shared: `packages/shared/src/canvas/`
- **`DIAGRAM_TYPES`** and the node field `diagramType` (frames only; missing in older documents means a free frame). Unknown values from a newer version count as a free frame, like unknown block types.
- **`BLOCK_TYPES`** gets the new types; `DIAGRAM_BLOCK_TYPES` lists the types per diagram, `newBlockType(diagramType, members)` gives the type of a new block.
- **Entity fields:** node field `fields` (`{ name, type }[]`, empty for older documents), validated as above. `blockSize(node)` gives 180 × 96 plus 22 px per shown field (at most 8, plus one row for "+ n weitere"), and `updateNode` keeps the stored size in line with the fields.
- **Functions:** `addFrame` takes `diagramType`, `updateNode` takes `diagramType` for frames and `fields` for blocks, `addBlock` takes `fields`.
- **Auto-layout** moves from the web app to `canvas/auto-layout.ts`, so the worker uses the same code. It still receives the ELK instance from its caller, so the web app keeps loading ELK only on first use. It gets the presets and the passes described above. `elkjs` becomes a dependency of `shared` (types) and of the server.
- **Tests:** schemas and defaults for older documents, `newBlockType`, entity sizes, presets per type, the whole-board passes (frames of different types keep their inner arrangement), locked nodes stay.

### Web: `apps/web/src/features/canvas/`
- **Block types:** icons and names of the new types; the type menu with the choices described above.
- **Entity card:** fields as described; editing in place with the extra text field; empty lines are dropped, a line without a name is ignored.
- **`FrameNode`:** icon and name of the diagram type in the header; the type menu on the icon of a selected frame for editors.
- **Placing a block** with the tool gives it the type of the frame it lands in.
- **Arrow anchoring** for left-to-right diagrams as described, from the diagram type of the frame both blocks belong to.
- **Auto-layout** uses the shared code.
- **i18n:** `canvas.diagramTypes.*` (including `none` for "Freier Rahmen"), the new `canvas.blockTypes.*`, `canvas.changeDiagramType`, `canvas.entityFields` (label of the text field), `canvas.moreFields` ("+ {{count}} weitere").

### Server: `apps/server/src/tools/`
- **`add_frame`** `{ title, diagramType?, blockIds? }`.
- **`add_block`** `{ title, subtitle?, type?, fields?, frameId?, x?, y? }`: with a frame, the block goes to a free spot inside it and becomes its member; the frame grows if there is no room. Without a type, a block in a typed frame gets the type from the table above.
- **`update_block`** takes `fields`.
- **`arrange_frame`** `{ frameId }`: the preset layout for that frame, written in one change; elements someone edits keep their place.
- **Agent context:** frames show their diagram type, entities their fields ("Nutzer (entity): id uuid, email text").
- **Moderator prompt:** a requested diagram gets a frame of the fitting type, blocks of the diagram's types inside it, arrows, and finally `arrange_frame`. Sticky notes stay for open thoughts.

## Out of scope
- the roadmap with a timeline (spec 26)
- export as PNG, SVG and Mermaid (spec 27)
- own shapes per type (e.g. diamonds for decisions, round mind map nodes), mind maps that grow to both sides, arrows without heads in mind maps: candidates for the design pass (spec 36)
- nested frames, variants (spec 17)

## Dependencies
- Spec 10
- Packages: none new (`elkjs` is already used by the web app)

## Checklist
- [ ] A frame gets a diagram type from the menu in its header; icon and name show in the header.
- [ ] Each diagram offers its block types; new blocks in a typed frame get the right type.
- [ ] Entities show and edit their fields; the block grows with them.
- [ ] Auto-layout arranges each diagram type with its preset, the whole board without breaking the diagrams inside frames, and one undo reverts it.
- [ ] `@Moderator` draws a mind map, a data model with fields and a flow on request, each in its own typed frame and arranged.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the shared model, the layout presets and the new tools pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
