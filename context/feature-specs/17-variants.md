# 17 Variants A/B

## Goal
For an alternative, e.g. "monolith or a separate real-time service", the moderator shows variants A and B as two diagrams side by side on the canvas. The team adopts one; it becomes part of the canvas and is recorded as the decision, and the discarded variant stays in the decision log as a snapshot.

## Design decisions
- **Variants are a proposal** (`architecture.md`, "Canvas": "Proposals and variants live in Postgres as `proposals`"): one proposal of the kind `variants` holds two or three variants, each with a name, a one-sentence summary and the canvas operations of its diagram. Nothing is on the canvas until a variant is adopted, so creating variants needs no rule: it is a proposal by nature, also in the proposals-only mode.
- **Creating** (`project-overview.md`, "For alternatives it shows variants A/B side by side; one of them is adopted"):
  - The moderator creates variants with the tool `propose_variants`: per variant a name, a summary, the diagram type, its blocks and their connections. The server builds each diagram in its own frame, arranges it with the layout of its type and puts the frames next to each other at a free spot of the main canvas.
  - It does so on request or after an accepted offer (spec 15); the observer may offer variants when the team weighs two ways of building something.
  - A topic has at most one open set of variants; a decided topic has to be reopened first. The tool notes the topic as an open decision.
- **Comparison view on the canvas** (derived look): the variants lie side by side as dashed proposal diagrams in the moderator's colors. Each frame is headed "Variante A · Monolith" above its border and carries "Übernehmen"; the blocks inside are marked "Variante A".
- **Waiting for you:** a card "Varianten" with the topic, a small preview and the summary of each variant, one button per variant ("A übernehmen") and "Verwerfen" for all. On another board the card opens the board first.
- **Overview:** while variants of a topic are open, its row under "Entscheidungen" reads "Vergleich A/B läuft" (handoff: "Comparison A/B in progress").
- **Adopting** (owners and editors; while the owner decides, only owners):
  - The chosen variant's diagram is drawn on the canvas with the moderator as author; the other variants disappear.
  - The choice is recorded as the decision of the topic: the variant's name as the value, its summary as the reasoning, the other variants as discarded alternatives. If the topic was decided another way in the meantime (e.g. by a vote), the diagram is still drawn and the decision stays as it is.
  - **Snapshot:** the proposal with all its variants stays with the decision. The decision's dialog and the log entry show every variant with a preview, and which one was adopted.
- **Rejecting** removes all variants; the topic stays open.
- **Voting on variants:** in a project that decides by vote, the team votes with a vote card (spec 16b) and then adopts the winner; adopting by the vote itself is out of scope.

## Implementation

### Database: migration `0011_variants.sql`
- `proposals`: the kind `variants` (with a board, like `canvas`), the reason `variants`, and `chosen` (the position of the adopted variant).
- `decisions.variants_id` refers to the proposal; `decide` and the log entry carry it; reopening lets go of it.
- Function `adopt_variant(proposal, position)` for the person who applies the proposal: it stores the choice and records the decision.

### Shared: `packages/shared/src/`
- `Variant`, the variants operation and the proposal kind `variants`; `Decision.variants` and `DecisionLogEntry.variants` with the adopted position.

### Server
- **Tool of the moderator:** `propose_variants` `{ topic, variants: [{ name, summary, diagramType, blocks, connections }] }`, which builds, arranges and places the diagrams and stores the proposal.
- **Agent turn and observer:** the context lists topics with open variants.
- **API:** `POST /api/projects/:projectId/proposals/:proposalId/apply` takes `{ variant }` for a `variants` proposal, records the choice and draws the diagram; decisions and log entries carry their variants.
- **Tests:** the tool (two diagrams side by side, limits, guards), adopting and rejecting through the API with roles and processes, the function, and the agent turn's context.

### Web
- **Canvas:** the variants of the open board as dashed diagrams with their headers and "Übernehmen".
- **Waiting for you:** the variants card with previews.
- **Decisions:** "Vergleich A/B läuft"; the variants with previews in the decision's dialog and in the log.
- **i18n:** `variants.*`.

## Out of scope
- more than three variants, and variants that change or remove existing elements
- adopting by a vote, and editing a variant before adopting it
- a separate full-screen comparison view; the design pass (spec 36) decides whether one is needed

## Dependencies
- Spec 16b
- Packages: none new

## Checklist
- [x] On request the moderator shows two variants as dashed diagrams side by side on the canvas, arranged and labeled A and B.
- [x] The variants wait under "Wartet auf dich" with previews; the topic reads "Vergleich A/B läuft".
- [x] Adopting one draws it for everyone, removes the others and records the decision with the discarded variant; rejecting removes all.
- [x] The decision's dialog and the log show the variants as a snapshot, with which one was adopted.
- [x] Viewers see the variants but cannot decide; while the owner decides, only owners adopt.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the tool, the function, the API and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-01)
- **One proposal, several diagrams:** a `variants` proposal holds one operation `{ op: 'variants', topic, variants }`; every variant carries its name, its summary and the canvas operations of its diagram (frame, blocks, arrows, arrangement). The reason is `variants`; the rule engine is not asked, since nothing changes until someone adopts.
- **Drawing (`propose_variants`):**
  - The model names blocks by short keys and connects them by key; the server creates the ids, the frame titled "Topic: Name", the block types by the diagram type, and arranges each diagram with the same layout code as auto-layout.
  - Every variant is drawn on its own. Once the sizes of all frames are known, the server looks for one free spot for the whole row and shifts the diagrams there: tops aligned, 80 px apart. The board itself is not touched.
  - The tool refuses a decided topic, a topic whose variants wait already, two variants with the same name and connections to unknown keys; it notes the topic as open.
- **Adopting in one transaction:** the apply route marks the proposal as applied and calls `adopt_variant`, which checks the caller (owner or editor; only owners while the owner decides), stores the chosen position and records the decision through `decide` with the other variants as discarded alternatives. Then the server writes the chosen diagram into the Y.Doc with the moderator as author. If the topic was decided another way in the meantime, the diagram is drawn and the decision stays.
- **Snapshot:** `decisions.variants_id` and the log entry (`variantsId`) point to the proposal, which keeps all variants and `chosen`. The API joins them, so the decision's dialog and the log show every variant with a preview and "übernommen" or "verworfen". Reopening lets go of the reference; the log keeps it.
- **Web:**
  - The overlay of proposals draws one set of dashed elements per variant; the frame is the anchor. It is headed above its border, where a long name wraps instead of being cut, and carries one button "Übernehmen". Rejecting all variants happens in the overview.
  - "Wartet auf dich" shows the topic, a thumbnail and the summary per variant, a button per variant and "Verwerfen". The thumbnail is a small SVG built from the same overlay and arrow geometry as the canvas.
  - The topic's row and dialog read "Vergleich A/B läuft" while its variants are open. The dialog of a decision made from variants shows the snapshot instead of the list of discarded alternatives; the log entry unfolds it under "Varianten ansehen".
  - While the owner decides, editors see "Der Owner entscheidet." on the card and no button on the canvas.
- **Verified** with `pnpm dev` in the project "Vereins-App":
  - "Zeig uns bitte zwei Varianten für die Architektur: einen Monolithen und eine Variante mit getrenntem Frontend und API" produced two dashed diagrams next to each other, headed "Variante A · Monolith" and "Variante B · Frontend und API", the card with two thumbnails under "Wartet auf dich", and "Architektur · Vergleich A/B läuft"; the moderator summed up the difference in a few sentences.
  - "Verwerfen" removed both diagrams and left the topic open. Asked again, the moderator proposed them anew.
  - "Übernehmen" on variant B drew its frame, four blocks and three arrows, removed variant A and recorded "Architektur: Frontend und API". The dialog showed both thumbnails with "übernommen" and "verworfen"; the log entry carried the snapshot.
  - Roles and the owner-decides process, three variants and a topic decided in the meantime are covered by the tests of the database, the tool, the API and the components; they were not tried live.
- **Known limits:** the canvas does not move to new variants; they may lie outside the visible part, and the card's thumbnails show them. Jumping to elements on the canvas comes with block references. The thumbnails of tall diagrams are small; the design pass (spec 36) decides on the comparison view.
