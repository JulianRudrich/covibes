# 17 Variants A/B

## Goal
For an alternative, e.g. "monolith or a separate real-time service", the moderator shows variants A and B as two diagrams side by side on the canvas. The team adopts one; it becomes part of the canvas and is recorded as the decision, and the discarded variant stays in the decision log as a snapshot.

## Design decisions
- **Variants are a proposal** (`architecture.md`, "Canvas": "Proposals and variants live in Postgres as `proposals`"): one proposal of the kind `variants` holds two or three variants, each with a name, a one-sentence summary and the canvas operations of its diagram. Nothing is on the canvas until a variant is adopted, so creating variants needs no rule: it is a proposal by nature, also in the proposals-only mode.
- **Creating** (`project-overview.md`, "For alternatives it shows variants A/B side by side; one of them is adopted"):
  - The moderator creates variants with the tool `propose_variants`: per variant a name, a summary, the diagram type, its blocks and their connections. The server builds each diagram in its own frame, arranges it with the layout of its type and puts the frames next to each other at a free spot of the main canvas.
  - It does so on request or after an accepted offer (spec 15); the observer may offer variants when the team weighs two ways of building something.
  - A topic has at most one open set of variants; a decided topic has to be reopened first. The tool notes the topic as an open decision.
- **Comparison view on the canvas** (derived look): the variants lie side by side as dashed proposal diagrams in the moderator's colors. Each frame is headed "Variante A · Monolith" and carries "Übernehmen"; the blocks inside are marked "Variante A".
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
- [ ] On request the moderator shows two variants as dashed diagrams side by side on the canvas, arranged and labeled A and B.
- [ ] The variants wait under "Wartet auf dich" with previews; the topic reads "Vergleich A/B läuft".
- [ ] Adopting one draws it for everyone, removes the others and records the decision with the discarded variant; rejecting removes all.
- [ ] The decision's dialog and the log show the variants as a snapshot, with which one was adopted.
- [ ] Viewers see the variants but cannot decide; while the owner decides, only owners adopt.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the tool, the function, the API and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
