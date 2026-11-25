# 50 Linked Decisions

## Goal
A block and a plan task retain the decisions that justify them. A member can ask
“What changes if this decision falls?” and navigate from an explicit impact list
to the affected block or task. Reopening a decision makes its existing links
reviewable; it never silently edits or deletes the connected work.

## Design decisions
- The owner's 2026-11-24 direction restores the existing design. New controls
  use the main branch's shared components, tokens and panel/dialog layout.
  Signal Atlas slots and visual dependencies are not part of this feature.
- Links are explicit human-authored relationships, not label matches or model
  guesses. Owners and editors add/remove them; viewers read and navigate.
- A canvas target is a block identified by project, board UUID and node UUID.
  A task target is identified by project and its existing plan task UUID.
  Renaming a block or task preserves the relationship. Plan rewrites keep links
  when the existing task-ID preservation contract keeps that task.
- Links are relational rows outside the collaborative document. They survive
  decision reopening and removed targets. A missing target keeps the label recorded when linked and is clearly unavailable; the app does not navigate to another item
  with the same text. Restoring the same identity restores navigation.
- A project's members alone can read its relationships and target catalog.
  Every request uses `withUser`; the new table has RLS and explicit grants.
  Database constraints prevent linking a decision from a different project.
  Current targets are resolved only after project authorization.
- Add is idempotent for the same decision and target; deletion is safe to retry.
  A project has at most 1,000 links, checked under a per-project transaction advisory lock.
- Impact is the concrete set of directly linked blocks and tasks. The review
  view distinguishes available and removed targets, states that these require
  review rather than predicting breakage, and offers real navigation callbacks.
  No inferred transitive dependency graph or automatic cascade is introduced.

## Implementation
### Shared and database
- Validated discriminated target schemas and the input/response contracts.
- Migration `0052_decision_links.sql`: rows, unique target relationship,
  project/decision consistency, RLS, and realtime invalidation on add/remove.
- Snapshot labels provide a useful explanation if a target is later removed.

### Server
- `GET /api/projects/:projectId/decision-links`: current project links, decision
  metadata, current target labels, and explicit availability flags.
- `GET /api/projects/:projectId/decision-links/targets?q=...`: a bounded catalog
  of current blocks and roadmap tasks for an explicit target picker.
- `POST /api/projects/:projectId/decision-links`: validate the decision and
  current target in that project before inserting the relationship.
- `DELETE /api/projects/:projectId/decision-links/:linkId`: owners/editors
  remove only a relationship in that project.
- Existing `decisions` live invalidation refreshes the relationship cache;
  relevant board/roadmap changes and reconnects refresh resolved availability.

### Web and navigation
- A decision detail offers a review section, its linked targets and a searchable
  target picker for editors. Opening a target closes the detail and activates
  the correct Canvas/Plan panel through callbacks.
- The selected block exposes its linked decisions and link management. A plan
  task exposes the same relationship control outside the document text.
- A task destination opens the plan, scrolls to the task with that exact UUID
  and focuses it. Task focus is applied only while the plan is open.
- German and English labels, native keyboard controls, explicit loading/error/
  empty states, and safe text rendering. A deleted target's control is disabled.

## Out of scope
- Agent-created links or paid semantic matching.
- Automatic changes to blocks/tasks when a decision is reopened.
- Public share links exposing relationships or member identities.
- Inferring dependencies between decisions, tasks or repository files.

## Dependencies
- Specs 16, 25, 26b and project membership; existing shared UI components.
- No new packages. Source work is authorized before the closed-beta rollout.

## Checklist
- [ ] Link a decision to a block and task, rename them and retain both links.
- [ ] Reopen the decision and navigate from its impact list to both identities.
- [ ] A removed target is clearly unavailable; restoring its identity works.
- [ ] Viewers can read/navigate and cannot mutate; other projects disclose none.
- [ ] Database access rules reject cross-project decisions and foreign boards.
- [ ] Concurrent duplicate adds are idempotent; limits and validation are covered.
- [ ] Task navigation targets the exact task without editing its document.
- [ ] Focused shared, database, server and component tests and quality checks pass.
