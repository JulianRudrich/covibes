# 40 Trustworthy AI Budgets

## Goal
Every model attempt reserves its budget before the provider starts. Concurrent work shares the
same remaining project, person and instance allowance, and failed or cancelled attempts retain
their known usage and costs. The instance defaults to 20 USD per calendar month and warns its
operator once when 80 percent is committed. This implements review findings R04 and R05.

## Design decisions
- This unit has no visual design. Existing project owners keep their usage API; members learn
  whether AI is paused without seeing another project's or the instance's amounts.
- Amounts are integer millionths of a USD in application accounting. UTC calendar months and
  days retain spec 31's meaning. Project/month and person/day limits remain; the instance/month
  limit is additional. Zero explicitly disables an individual limit.
- Every gateway invocation has its parent run and a purpose, including intent classification,
  observer, away summary, plan, package and review calls. A retry is a new attempt, never an
  overwrite of an earlier attempt.
- A database transaction locks the budget scopes in a fixed order, adds settled spending and
  active reservations, and creates an attempt only when its entire configured bound fits all
  enabled limits. The reservation remains attributed to its original UTC period over midnight.
- The operator configures `AI_MAX_CALL_USD`, a conservative per-invocation reservation. Production
  refuses model calls when that bound is absent or zero; local development defaults to 1 USD.
  The same value is passed to the Claude SDK as `maxBudgetUsd`. Its budget option is a soft
  loop cap: the current SDK cannot guarantee that actual provider billing stays below a bound.
  Overspend is recorded honestly and blocks further calls; no strict provider spend guarantee
  is claimed. Spec 44 may supply stronger bounds through direct provider APIs.
- Final provider results are accounted even when unsuccessful. Caught failures and cancellations
  also record known partial usage. A hard process termination can leave no durable usage report;
  its reservation remains held until the operator reconciles it. Unaccounted work is never
  silently treated as free or released after an arbitrary timeout.
- An operator may reconcile uncertain attempts against provider records before explicitly
  releasing a reservation. No automatic release on worker restart is part of this unit.
- Settlement is idempotent. Legacy runs continue to meter through the existing trigger; runs
  with attempt records meter through the attempt ledger to avoid counting successful usage twice.
- An instance warning is durably deduplicated per UTC month and emitted as a structured operator
  log without prompts, tokens or user identifiers. It includes committed and permitted USD.

## Implementation
### Database and accounting
- Migration 0044 adds the protected attempt ledger and deduplicated operator-warning records,
  including RLS and explicit grants. Only the admin worker writes or reads attempts.
- Budget transactions serialize admission across all workers and reconcile attempts, usage and
  cumulative run accounting together. Project/user status includes pending reservations.
- Existing usage rows survive the migration and remain part of each relevant total.

### Gateway and jobs
- Provider requests accept `billing: { runId, purpose }` and `maxCostUsd` without coupling the
  provider to PostgreSQL. A worker-owned gateway wrapper reserves, invokes and settles.
- Provider errors retain accounting metadata while preserving quota/configuration error types.
- All model-calling jobs supply the parent run; intent classification gets its own attempt.
- Failed, aborted and retried attempts remain visible in usage, with no double accounting.

### Configuration and documentation
- The server and worker validate the instance limit and reservation configuration consistently.
- The example environment and deployment guide explain warning logs, soft-cap limitations,
  uncertain reservations and manual reconciliation.

## Out of scope
- Provider API rewrites and workspace-owned keys (spec 44).
- Recovery of canvas mutations and worker ownership (spec 41).
- A new usage screen, billing or a strict guarantee about the provider's eventual invoice.

## Dependencies
- Specs 07 and 31; no new package.

## Checklist
- [x] Concurrent independent database clients cannot reserve the same remaining allowance.
- [x] Project, person and instance limits include active reservations and reset at UTC boundaries.
- [x] Failed, cancelled, retried and successful attempts are recorded without duplicate costs.
- [x] A missing production bound prevents a provider call; the local route accepts its default.
- [x] An uncertain attempt retains its unaccounted reservation, including after a restart.
- [x] The operator warning is persisted and emitted once before the instance reaches its limit.
- [x] All model-calling jobs, including intent classification, pass billing context.
- [x] Database permissions, API privacy, environment validation and gateway behavior are tested.
- [x] Lint, typecheck, formatting, tests, generated database types and build pass.
- [x] The progress tracker and deployment instructions describe the result and its limits.


## Implementation notes (2026-11-18)
- Migration 0044 adds `ai_attempts` and `ai_budget_warnings`, with RLS and no application-role
  access. Admission and settlement share advisory transaction lock `400044`, so independent
  workers cannot reserve the same remaining allowance. Existing usage remains chargeable.
- Each gateway invocation carries its parent run and purpose. The observer and away summary
  now create their parent run before starting the provider. Intent classification is its own
  attempt; a retry creates another attempt instead of overwriting earlier spending.
- Settlement atomically records reported usage, the attempt's outcome, remaining hold and
  cumulative run costs. Legacy runs still meter through their trigger; attempts meter once
  through the ledger. A later job result cannot lower the aggregate of its earlier attempts.
- SDK errors preserve their original quota/configuration/abort classification and carry final
  or partial accounting metadata. Streamed message-start and reported output usage are retained
  on caught cancellation without counting a repeated message twice.
- `AI_LIMIT_INSTANCE_MONTH_USD` defaults to 20. `AI_MAX_CALL_USD` is required for production
  invocations and defaults to 1 locally. The SDK receives the same soft cap. The 80-percent
  committed-budget warning is persisted once per UTC month and emitted without user data.
- Unknown provider work retains its hold after a restart. The admin-only `ai:reconcile` command
  requires a verified nonnegative cost and explanatory note, records any additional spending,
  and releases the hold atomically. A repeated reconciliation or a reduction of already
  accounted spending is rejected. Operators must first stop the work and verify provider costs.
- Validation: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm db:types:check` and
  `pnpm build` pass. The complete server suite passes **933 tests in 82 files** with two workers;
  the database usage and migration suites pass **17 tests in two files**. Tests cover concurrent
  admission, shared scopes, UTC rollover, cancellation, replay-safe settlement, cumulative
  retries, warning deduplication, application-role denial, provider errors and real magic-link
  sessions against a temporary PostgreSQL. No paid model, real SMTP or Git host call was used.
- The existing Vite large-chunk warning remains; loading/layout is planned in spec 49. These
  checks validate this branch locally; integration and remote CI are a separate delivery step.
- The SDK still cannot guarantee the final provider invoice. Abrupt process death can leave no
  durable partial usage report, so the reservation remains rather than being silently refunded.
  Workspace-owned keys and stronger direct-API bounds belong to spec 44.
