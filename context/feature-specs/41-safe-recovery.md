# 41 Safe Recovery of Interrupted Work

## Goal
A restarted worker recovers completed canvas commands without repeating their changes, keeps
one reply message per run, and never unlocks work owned by a live worker. Mail and Git jobs
continue when model access is unavailable. Operators can distinguish liveness, readiness and
AI degradation; clients only call a document saved after a database acknowledgement.

## Design decisions
- The initial deployment has one worker. A dedicated PostgreSQL session advisory lock is
  acquired before abandoned jobs are recovered and held until the runner has stopped. A
  second worker refuses to start. Losing the lock connection ends the owner process.
- Mutating agent tools have a durable command identity scoped to the run and call position,
  with the tool name, input, result and prepared canvas operations. Canvas commands write a
  receipt into the same Yjs transaction as their changes, then explicitly flush the document
  to PostgreSQL before completing the command. Recovery replays the stored operations and
  result; an existing receipt prevents applying an operation twice.
- Before replaying a mutation absent from the document, recovery rechecks the current
  proposals-only setting and human editing locks. It does not override a newer human rule.
- A retry that has recorded mutations may replay those commands only. Changed inputs,
  additional mutations and interrupted non-canvas tools with an uncertain outcome fail
  closed with a recovery message, rather than guessing and duplicating side effects. A new
  instruction starts a new run. Existing Git request idempotency remains in force.
- Model configuration is a capability, not a prerequisite for the shared worker. Model
  failures open a bounded circuit breaker; non-AI jobs continue. Provider diagnostics are
  redacted from public readiness responses.
- `/health` remains a lightweight liveness check. `/ready` has a bounded timeout and checks
  the database, applied migration, worker heartbeat and collaboration store health. It
  reports queue age and AI degradation separately. No secrets or content are returned.
- Browser transport sync is not durable storage. An authenticated document flush checks
  membership, persists the current server document and returns a saved acknowledgement.
  Existing UI gets the state contract without adopting the old visual design.

## Implementation
- Migration `0045_safe_recovery.sql`: admin-only `tool_commands`, `worker_heartbeats` and
  `board_history_outbox`
  tables with RLS and explicit revocations.
- Worker ownership and heartbeat helpers, guarded startup recovery and model circuit breaker.
- Agent command journal, durable canvas receipts and explicit collaboration flush endpoints.
- Readiness API and save-state contract; deployment documentation for the single-worker
  invariant, recovery behavior and the meaning of each health endpoint.
- History delivery retries through an outbox. History and its completion receipt commit
  together; copied payloads are discarded after success. The app reconciles at startup,
  on load/store and every thirty seconds, without claiming authenticated security auditing.
  Board document storage and its history outbox staging commit in the same transaction.
  A rejected outbox insert rolls back the document store; the next store retries both.
  History delivery runs independently after commit and is retried from the durable outbox.

## Out of scope
- Scaling workers or collaboration owners horizontally.
- Exactly-once delivery to third-party APIs without a provider idempotency contract.
- The new visual design, which is developed independently in spec 55.
- Production restore drills and monitoring infrastructure (spec 35).

## Dependencies
- Existing queue, run, canvas, proposal and Git request implementations.
- Spec 40's budget and attempt ledger is integrated separately; recovery does not erase or
  recreate a model attempt or its reservation.
- Spec 44 must partition model circuits by provider and workspace/cost payer. A failed
  workspace-owned key must not open the instance's circuit; budget and abort errors are
  already excluded from the current instance circuit.

## Checklist
- [x] A second worker cannot acquire ownership or unlock the first worker's jobs.
- [x] Interrupted canvas commands recover once, without duplicating a block or reply message.
- [x] Divergent replay and uncertain non-canvas commands stop safely.
- [x] Non-AI jobs work without model credentials; model failures back off.
- [x] Database or stale worker failures fail readiness while liveness still succeeds.
- [x] A saved acknowledgement follows an actual PostgreSQL flush; store failures remain visible.
- [x] Targeted recovery, locking, readiness and persistence tests pass, as do lint, types,
  formatting, database type verification and build. Integration runs the full suite.

## Implementation notes (2026-11-18)
- The crash test kills a real child worker with `SIGKILL` after a canvas mutation and
  durable acknowledgement but before run completion. Retrying keeps one block, one reply
  identity and one finished run. Separate tests recover an unflushed prepared command with
  both a retained and a lost in-memory document, and reject divergent or uncertain work.
- A real production-mode worker without an AI key completes a notification job. A second
  worker exits without disturbing it; after the first worker is killed a successor takes
  ownership. Provider backoff tests use a controlled clock rather than sleeping.
- The full server suite passed with 939 tests in 88 files. After the final deletion-health
  correction, all 35 targeted persistence, collaboration, history and readiness tests passed.
  The deleted document's old or late storage failure cannot leave readiness permanently red.
- Full lint and token checks, workspace types, database type verification, formatting and
  build passed. Final delta lint and server types passed; all 322 database tests in 34 files
  passed as well.
- No paid provider, real SMTP/Git host, production restore or browser save-state flow was
  exercised. The new design integrates the shared persistence contract separately. The
  integration branch must combine spec 40's budget gateway under the provider circuit and
  rerun the full package suite before delivery.

## Packaging verification (2026-11-24)
- Readiness uses the validated `MIGRATIONS_DIR` setting supplied by the Docker image, rather
  than resolving source-package paths from a bundled module. Source development keeps the
  default package directory. An empty migration bundle fails readiness.
- All 23 focused readiness, environment and app tests passed, followed by delta lint, server
  types and the server build. A production-mode process running the actual built entry point
  against a fresh PostgreSQL returned HTTP 200 with all readiness checks true and AI degraded.
  This verifies the Node bundle and configured migration directory; no Docker image was built.
