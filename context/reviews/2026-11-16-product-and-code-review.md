# Covibes: product and engineering review

Date: 2026-11-16. Reviewed application commit: 7e4a12c859f29f896dfa3e5e38a3b4cc44e52a2a.

## Assessment

Covibes has a credible foundation for a serious product: a clear planning-before-coding position, structured collaborative data, explicit approval boundaries, a coherent Studio design, and substantial automated coverage. The next step should be a focused release-hardening and product-validation cycle. Keep the React, PostgreSQL, Hono and Yjs architecture. A rewrite would consume effort without addressing the most important findings.

The strongest product opportunity is to make a team's reasoning usable throughout implementation: constraints lead to decisions, decisions lead to architecture and tasks, and implementation changes reveal which assumptions need revisiting. Chat, canvas and multiple agents are ways to deliver that outcome. They should be judged by whether they help a team reach a better, reviewable plan.

This is a broad repository review, not a claim that every line, browser interaction, deployment, or attack surface was exhaustively tested. Findings below distinguish observed behavior, static failure paths, and proposals.

## What was done and verified

- Created and verified the private repository [JulianRudrich/covibes](https://github.com/JulianRudrich/covibes).
- Pushed the existing main history and configured origin/main tracking. Local backup branches were not published.
- Scanned 2,719 blobs reachable from main for common credential formats and private key headers. No pattern matches were found. The history path scan found no tracked environment secrets, database directories or backups. This is a limited pattern scan, not proof that arbitrary sensitive content cannot exist.
- Preserved the pre-existing modified .claude/launch.json and untracked AGENTS.md. They were not included in the upload.
- Read the required project context, key application boundaries, configuration, deployment documentation, and representative implementation and tests across auth, API, collaboration, AI execution, storage, usage, and the workspace.
- Inventory: 785 tracked files at the reviewed commit; 431 production TypeScript, TSX and SQL files; 217 test files. Approximately 65,923 production lines include generated schema, migrations and fixtures; this is not a complexity score.
- Local lint, type checks, database type verification and production build passed.
- Local tests: shared 348, database 322, server 913, web 837: **2,420 passing tests across 217 test files**.
- Local formatting failed only on the existing uncommitted .claude/launch.json. GitHub formatting passed for the committed source.
- The first [Linux CI run](https://github.com/JulianRudrich/covibes/actions/runs/43885368436) passed lint, type checks, formatting and database type verification. Its test job failed at realtime.test.ts:313, expecting one remaining connection and observing three.
- The production dependency audit reported **54 entries: 1 critical, 15 high, 31 moderate, 7 low**. Counts include optional and transitive dependency paths; they are not counts of demonstrated exploitable application flaws.
- No real GitLab integration session, live paid model evaluation, deployment load test, browser accessibility audit or visual regression suite was executed during this review. The tracker still records the real GitLab check as pending.

## Priorities

P0 means resolve before exposing an affected deployment to users. P1 means address before a dependable team beta. P2 means a planned product or engineering improvement. These are recommendations for subsequent numbered specs, not new approved product decisions.

| ID | Priority | Finding | Evidence status |
| --- | --- | --- | --- |
| R01 | P0 for dual-login deployments | Installed auth version has a critical advisory relevant to magic link plus GitLab sign-in | Version and configuration verified; no exploit attempted |
| R02 | P1 | Other production dependency advisories need updates and reachability triage | Registry audit observed |
| R03 | P1 | Linux CI fails on asynchronous realtime cleanup | Failure observed; race explanation inferred from code |
| R04 | P1 | AI budget checks do not reserve money for simultaneous runs | Static implementation finding |
| R05 | P1 | Failed AI attempts can lose usage and cost information | Static failure-path finding |
| R06 | P1 | Retried canvas mutations lack a durable operation identity | Static failure-path risk; crash test needed |
| R07 | P1 | Worker startup assumes no other worker is alive | Explicit code invariant |
| R08 | P1 | AI credential failure prevents non-AI worker tasks from starting | Startup path verified |
| R09 | P1 | Health endpoint does not establish service readiness | Endpoint verified |
| R10 | P1 | No complete browser release gate or real GitLab acceptance run | Repository search and tracker evidence |
| R11 | P1 | New chat loads cannot retrieve messages beyond the latest 100 | API and client verified |
| R12 | P2 | Initial JavaScript is large and routes load eagerly | Production build and imports verified |
| R13 | P2 | Tablet widths fall between mobile and desktop constraints | CSS and breakpoint verified |
| R14 | P1 before stronger durability promises | Collaboration sync and durable persistence are different states | Persistence path verified; crash behavior untested |
| R15 | P2 | Board history attribution is not a tamper-resistant audit identity | Static attribution logic finding |
| R16 | P2 | File cleanup is request-driven and can orphan stored bytes | Static lifecycle finding |
| R17 | P2 | Large orchestration modules concentrate unrelated responsibilities | Code inventory and implementation review |
| R18 | P2 | Documentation promises exceed some implemented capabilities | Context-to-code comparison |

## Findings and concrete acceptance criteria

### R01. Patch authentication before exposing the affected configuration

The server pins Better Auth 1.7.6. [authOptions](../../apps/server/src/auth/auth.ts) uses a PostgreSQL database, enables magic links when a mailer exists, and optionally enables GitLab social login. It does not override the magic-link token storage or OAuth state storage defaults.

The maintainer's [critical advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm) covers this combination and identifies 1.7.7 as the fix. Registry lookup confirmed that version is available. A deployment enabling both login methods matches the documented configuration conditions; this review did not inspect a live deployment's secrets or attempt account takeover.

Upgrade the server and client packages coherently, regenerate the lockfile, and test magic links, GitLab login, account linking, expiry and replay prevention. Follow the maintainer's cutover guidance for pending sign-ins. Until patched, avoid enabling both methods on an exposed instance.

Acceptance: an integration test rejects cross-purpose verification tokens; legitimate login paths work; affected dependency versions are absent. Keep this as its own security change with a clear spec and review.

### R02. Establish dependency maintenance, with reachability rather than alarm counts

The audit is a point-in-time result for the pinned lockfile. Group updates by boundary and test them. Do not use an indiscriminate forced audit fix.

| Package/group | Installed | Audit-listed minimum resolving the listed group | Application relevance |
| --- | --- | --- | --- |
| better-auth and accompanying adapter | 1.7.6 | 1.7.7 | Auth is directly used; OAuth Proxy and Drizzle-specific entries need separate applicability checks |
| hono | 4.13.9 | 4.13.16 | Direct HTTP framework; route/middleware behavior merits regression tests |
| @hono/node-server | 2.1.1 | 2.1.6 | Direct server adapter; static paths and WebSocket handling matter |
| @modelcontextprotocol/sdk | 1.30.1 | 1.32.0 | Present directly and via Claude SDK; Covibes uses an in-process SDK MCP server, so HTTP/OAuth advisories are not automatically reachable |
| zod | 4.6.5 | 4.6.6 | Direct input validation; retain body-size limits |
| nodemailer | 10.0.10 | 10.1.4 | Production mail path; test addresses and SMTP failures |
| undici | 8.11.2 | 8.12.2 | Transitive; map actual fetch, redirect and TLS use |
| seroval | 1.6.7 | 1.6.11 | Transitive; establish whether affected serialization paths are used |
| body-parser | 2.3.0 | 2.4.0 | Transitive through SDK; inspect transport reachability |
| qs | 6.16.0 | 6.16.1 | Transitive; inspect affected stringify usage |
| fast-uri | 3.1.8 | 3.1.9 | Transitive parsing; test consumers |
| ip-address | 10.7.2 | 10.7.4 | Transitive parsing; test consumers |
| source-map-js | 1.2.1 | 1.2.2 | Optional/tooling paths also appear in production audit |
| vite | 8.3.1 | 8.3.3 | Primarily dev server; optional paths appear through auth tooling |
| @vitest/mocker | 5.0.2 | 5.0.3 | Test tooling; optional paths appear in production audit |
| esbuild | 0.27.7 | 0.28.1 | Tooling/dev-server exposure requires separate assessment |

Only the Better Auth, Hono and Node adapter fix versions were independently checked for registry availability. Other targets above come from audit metadata and need resolution/compatibility verification during implementation. For Hono, the [maintainer advisory linked by GitHub](https://github.com/advisories/GHSA-h7mg-cq63-vhpq) describes wildcard middleware matching cases; presence of the version alone does not prove a Covibes auth bypass.

Add a dependency update cadence, lockfile review, production image audit and documented exceptions with owners and expiry. Remove unused direct dependencies only after usage and packaging checks.

Acceptance: every critical/high result is fixed or has a documented non-reachable path; release CI detects new results; the production artifact is assessed separately from dev dependencies.

### R03. Make realtime tests wait for the state they assert

[realtime.test.ts](../../apps/server/src/realtime/realtime.test.ts#L313) waits for client close events, then immediately counts server-side sockets. [realtime.ts](../../apps/server/src/realtime/realtime.ts#L70) removes sockets in a server-side close handler. Client closure does not establish that this handler has already run.

The Linux failure is consistent with this timing race. It is not evidence that removed members retained readable access: both client close codes passed before the count assertion failed.

Use a bounded condition wait or an explicit server cleanup signal. Preserve the assertions for access revocation, other members remaining connected, and re-entry rejection. Avoid arbitrary sleeps or retrying the whole suite until it happens to pass.

Acceptance: repeat the targeted lifecycle test on Linux under contention and pass the full suite; record any remaining intermittent failures.

### R04. Make AI budgets concurrency-safe

[usageGuard](../../apps/server/src/usage/limits.ts) sums already-recorded usage, checks thresholds and returns. It does not reserve budget. The worker allows five concurrent runs. Near a limit, several runs can all pass the same check; even one run can exceed the remaining allowance.

Introduce an atomic reservation in PostgreSQL, keyed by run/attempt, with a clear allowance per run. Reconcile actual cost on completion and release unused reservations. Add whole-run duration, model-turn and tool-call limits. Distinguish an estimated spending guard from a guaranteed provider billing cap.

Acceptance: simultaneous starts cannot each consume the same remaining allowance; expired reservations recover after a crash; users see why a run waits and when budget resets.

### R05. Account for failed and cancelled model attempts

[streamAgentReply](../../apps/server/src/ai-gateway/claude.ts#L132) throws for unsuccessful SDK results before extracting usage. [finishRun](../../apps/server/src/tasks/agent-turn.ts#L1359) writes success cost, while failure handling does not preserve the same accounting. A paid attempt that fails, is retried, or loses its final result can therefore be absent from displayed totals.

Store an attempt ledger independently of the successful chat response. Record provider request identifiers and any reported usage on error; represent unknown usage honestly. Reconcile retries and cancellation without counting an attempt twice. Keep classifier costs and background jobs in the same accounting model.

Acceptance: a fixture with billed usage plus an error still increases recorded spend; retries retain both attempts; cancelled runs settle reservations; unknown costs are visible rather than silently zero.

### R06. Make mutation retries safe

The run handler reuses the reply message on a retry, which is useful. However, [add_block](../../apps/server/src/tools/add-block.ts#L133) creates a new random identifier and [writeCanvas](../../apps/server/src/tools/canvas-writer.ts) can apply the operation immediately. If the process stops after the board change and before run completion, re-execution can produce another block.

Introduce a durable command identity and store its result before considering the tool complete. Bind tool calls to a run attempt and replay policy. Where database state and a Yjs operation cannot share a transaction, use a durable operation record plus reconciliation. Recheck the existing Git action idempotency separately; do not assume its behavior from the canvas implementation.

Acceptance: deliberately terminate the worker after an applied mutation; resume the job; the intended block or action exists once, and the user sees a consistent run state.

### R07. Enforce the single-worker invariant

[releaseAbandonedJobs](../../apps/server/src/tasks/abandoned-jobs.ts) unlocks every worker ID found holding jobs at startup. Its comment explicitly assumes exactly one worker. A second instance or overlapping restart can unlock live work.

For the initial release, enforce one active worker with a database advisory lock and document the constraint. Before scaling, use ownership, leases and liveness checks so only abandoned work is recovered. Test rolling restarts and stale ownership. The collaboration server also has a single in-memory document owner; additional app replicas need a deliberate coordination strategy.

Acceptance: a second worker refuses to start safely, or multiple workers demonstrably coexist without taking each other's jobs.

### R08. Decouple AI availability from unrelated background work

[worker.ts](../../apps/server/src/worker.ts#L59) checks Claude access before starting the runner. The same runner handles notification mail, Git requests and Git synchronization. Invalid model credentials therefore stop unrelated tasks too.

Keep the current deployable structure if desired, but separate task readiness and concurrency pools. Surface the AI provider as degraded while allowing mail and Git work to proceed. Add retry backoff and a circuit breaker for repeated provider failures.

Acceptance: with an invalid AI credential, non-AI jobs still complete and the UI accurately explains why agents cannot run.

### R09. Distinguish process health from readiness

[/health](../../apps/server/src/app.ts#L122) always returns success. It establishes that an HTTP process is answering, not that PostgreSQL, migrations, collaboration or the worker are usable.

Keep a lightweight liveness endpoint. Add a bounded readiness endpoint for essential dependencies and a worker heartbeat with queue age. Instrument request errors, run latency, first-token latency, provider failures, collaboration reconnects, failed stores and queue depth. Use correlation IDs and redact credentials, cookies and sensitive content by default.

Backups already exist in the local tools and deployment guide. The missing evidence is a production-like restore exercise covering the database and file volume together.

Acceptance: database unavailability fails readiness without needlessly failing liveness; operators can distinguish a stopped worker from a slow model; a documented restore drill meets agreed recovery objectives.

### R10. Add a real release gate

[CI](../../.github/workflows/ci.yml#L20) runs lint, type checks, formatting, tests and database type verification. It does not run the production build. Add the build and a clean production startup smoke test.

Implement the planned dry run as a small browser suite: login, create project, invite a collaborator, chat, create a proposal, approve it, verify the canvas, record a decision, generate a plan and export. Include two browser contexts for collaboration, member removal, reconnect and viewer permissions. Test real GitLab OAuth, webhook delivery and approved actions in a disposable repository.

Use semantic, auto-retrying assertions where appropriate, as described in the [Playwright documentation](https://playwright.dev/docs/test-assertions). Pin Actions to verified commit SHAs and set explicit minimal workflow permissions according to [GitHub's guidance](https://docs.github.com/en/actions/reference/security/secure-use).

Acceptance: a clean Linux checkout builds, tests and runs the complete acceptance scenario; release checks do not depend on a developer's local accounts or database.

### R11. Make older discussions reachable

[MESSAGE_PAGE_SIZE](../../packages/shared/src/messages.ts#L14) is 100. The [messages endpoint](../../apps/server/src/api/messages.ts#L50) returns only the latest page and accepts no pagination cursor; [messagesQuery](../../apps/web/src/features/chat/queries.ts) has no older-history loader.

Older rows are not necessarily deleted, but a fresh client cannot retrieve them through this route. That is a significant limitation for a product whose value includes retaining project reasoning.

Add a stable cursor based on timestamp plus ID, older-page loading that preserves scroll position, and jump-to-message retrieval for decision references. Add project search across chat, decisions, blocks and plan sections. Virtualize long lists only after preserving accessibility and scroll semantics.

Acceptance: a 1,000-message project can reach its first message without duplicates or gaps while new messages arrive; a citation opens the correct message even when it is outside the loaded page.

### R12. Split the frontend around user journeys

The production main chunk is **1,908.14 kB minified / 583.72 kB gzip**. CSS is 100.46 kB / 21.35 kB gzip. Other emitted chunks include ELK, PDF generation and PDF fonts. Their sizes do not mean every one is downloaded at login.

[router.ts](../../apps/web/src/router.ts#L13) eagerly imports login, workspace and share pages. Split at route boundaries, then lazy-load infrequent dialogs, editors and export capabilities. Measure the network and execution cost before introducing arbitrary vendor chunks. Preserve predictable loading placeholders and prefetch when intent is clear.

Acceptance: login does not load the collaborative editor/workspace tree; record cold-load timings on a constrained device and enforce an initial-JavaScript budget based on that baseline. A provisional goal is to at least halve current main-chunk gzip size without moving the same bytes into unconditional preloads.

### R13. Finish the layout between phone and desktop

[usePhone](../../apps/web/src/lib/use-media-query.ts#L4) switches below 48rem, while [workspace-shell](../../apps/web/src/features/workspace/workspace-shell.tsx#L116) requires at least 1100px on desktop. At standard root sizing, widths from 768 to 1099px fall between these assumptions and force the wider layout.

Preserve chat left, canvas center and overview right on wide screens. Add a tablet mode with a collapsible overview and resizable panels, with minimum widths and persisted preferences. Provide keyboard-accessible splitters and a focus-canvas command.

Acceptance: check 390, 768, 1024, 1280 and 1440px plus browser zoom; no essential control is clipped. Phone canvas/plan editing is currently intentionally out of scope, not an accidentally missing desktop feature.

### R14. Make persistence guarantees explicit

[collab.ts](../../apps/server/src/collab/collab.ts#L95) debounces persistence for 2 seconds, with a 10-second maximum. A client can be synchronized with the live server before the state is durable in PostgreSQL. History is written after board storage; its failure is logged separately.

Decide the required recovery point. If recent acknowledged edits must survive a process crash, persist updates or a write-ahead record before issuing a durable acknowledgement. Otherwise distinguish syncing, synced-to-server and saved states accurately. Add a retry/reconciliation path for failed history writes.

Acceptance: kill the process at controlled points, restart and measure recovered content. A network sync indicator must not promise a durable save that has not occurred.

### R15. Treat current history authorship as a convenience, not a security audit

[actorOf](../../packages/shared/src/canvas/history.ts#L139) reads lastChangedBy from document content and reconciles it with authors seen during a batching window. It trusts the document author when that user was active, when the service was active, or when there is no unique human fallback.

This can misattribute edits during concurrent activity or with manipulated editable metadata. No live forgery was attempted, and this is not evidence of a project-permission bypass.

Keep editable provenance labels distinct from authenticated event authorship. Capture the authenticated sender at the operation boundary for audit-sensitive actions. Define undo behavior without trusting restored author metadata as a new action's identity.

Acceptance: two editors changing the same board cannot assign each other's audit identity by changing document fields; service mutations retain their authenticated command identity.

### R16. Add reliable file retention and garbage collection

[files.ts](../../apps/server/src/api/files.ts) removes old unattached rows when that user uploads another file. An abandoned upload can remain indefinitely if there is no subsequent upload. A storage write happens inside a database transaction, but the filesystem cannot roll back if the transaction later fails. Deleting a database row before a failed storage deletion can also leave unreachable bytes.

Introduce periodic cleanup, an explicit deletion queue and a safe orphan sweep with a grace period. Add total storage quotas and align attachment/agent-knowledge retention with account and project deletion. Avoid holding a database transaction open during unnecessary large file I/O.

Acceptance: abandoned uploads expire without a future request; injected storage/DB failures are retried; referenced files are never removed by cleanup; backup/restore preserves their references.

### R17. Refactor around responsibility, not file length alone

Important concentration points are agent-turn.ts (1,436 lines), canvas-panel.tsx (900), workspace-page.tsx (753), git-requests.ts (703) and share-dialog.tsx (701). Generated schema and large test fixtures should not be counted as refactoring targets merely because they are long.

Suggested boundaries:

- AI orchestration: context assembly, execution policy, attempt lifecycle, tool registry, persistence and usage accounting.
- Workspace: route data, realtime subscriptions, selected-object navigation, panel state and modal coordination.
- Canvas: interaction state, selection commands, projection of proposals, rendering and layout.
- Git requests: input validation, authorization, request creation, approval policy and execution.
- Shared package: explicit domain entry points instead of expanding a single 706-line export barrel indefinitely.

Refactor one behavior boundary per spec and retain tests that verify outcomes. Introduce typed outcomes for operational failures instead of catch-all defaults where cancellation, configuration errors and model uncertainty need different treatment.

Acceptance: critical workflows can be tested without constructing the entire application; dependencies point toward domain contracts; behavior and approval boundaries remain unchanged.

### R18. Keep documentation and operational capabilities aligned

The README previously described no outside connections despite model calls and optional GitLab/SMTP. That wording is corrected with this review. The repository's earlier local-only publication rule is updated to reflect the owner's explicit private GitHub request.

The architecture mentions two-factor authentication, but authOptions does not configure a TOTP plugin. Self-service account deletion/export and a complete profile flow were not found in the reviewed routes. Decide which are launch requirements and describe the actual capability accurately. This review makes no legal-compliance certification.

Keep current status separate from historical decisions. The tracker correctly records completion of specs 36a-e; old chat failures do not mean the Studio implementation is still unfinished.

## Product improvements with the highest leverage

### 1. Define one demonstrable promise

Proposed promise: “Turn a messy project discussion into an agreed, implementation-ready plan with traceable decisions.”

Validate this with five to eight target users from small development teams. Give them their own project, not a scripted toy. Observe where they hesitate, how often they correct the moderator, and whether the exported result saves work for a coding agent. Do not treat number of chat messages or generated tokens as product success.

Suggested measurements: time to first accepted decision, time to an accepted handoff, proportion of decisions linked to evidence, rework after handoff, and whether a team returns to resolve a changed requirement. Set numeric targets only after a baseline.

### 2. Make the first session produce something useful

Existing empty-state prompts are implemented; the missing opportunity is a stronger guided path. Offer a short optional brief: outcome, intended user, constraints and biggest uncertainty. Produce a small initial canvas and one explicit decision to review. Allow a blank project and never send a paid prompt without a deliberate action.

Add a realistic sample project and a small set of outcome-based templates, such as a SaaS MVP, internal tool and integration project. These require new product decisions/specs, since spec 33 explicitly deferred templates and guided onboarding.

### 3. Connect decisions to their consequences

Extend existing decisions, chat-to-canvas references, history and plan versions into consistent links:

- Decision: context, alternatives, criteria, rationale, owner, status and source messages.
- Architecture element: decisions and constraints that justify it.
- Task/spec: decision references, acceptance criteria, dependencies and intended verification.
- Changed requirement: affected decisions, blocks, plan sections and tasks.

Make “Why did we choose this?” and “What changes if this assumption is wrong?” first-class actions. Ask for review instead of silently rewriting approved decisions.

### 4. Make specialists useful without creating more noise

Start with the moderator and only the specialists needed for the current decision. Keep raised-hand behavior and explicit approvals. Show a concise reason for an intervention and a suggested next action.

Evaluate specialists by distinct evidence and useful disagreement. A debate should end in alternatives, tradeoffs and an unresolved question or decision proposal; it should not become several personas repeating the same answer.

### 5. Turn the coding package into a product-quality output

Existing exports and GitLab handoff are valuable. Add a deterministic readiness check: unresolved blocking decisions, missing acceptance criteria, contradictory constraints, unavailable dependencies and oversized tasks.

Each generated spec should identify inputs, expected behavior, exclusions, acceptance checks, dependencies and decision references. Include a version/manifest so a recipient can tell what changed. Measure implementation rework rather than how many pages are generated.

GitHub product integration is worth prioritizing after the release foundation if target users request it. Publishing Covibes's own source to GitHub does not implement GitHub support inside Covibes.

### 6. Define the return experience

Build on the existing “Since you were away” summary. Lead with what needs the returning person's judgment, then changed decisions, affected work and a way to inspect evidence. Keep notification preferences and explain why an item is relevant.

### 7. Validate a sustainable commercial model

The tracker says selling Covibes is intended but pricing remains undecided. Measure model cost per accepted outcome, not only per user. Explore workspace pricing with a transparent allowance and explicit overage behavior after observing real usage. Preserve clear separation between a software subscription and any provider credentials a self-hosted operator supplies.

Avoid committing to unlimited AI usage before concurrency-safe budgets and actual usage data exist.

## Design refinement plan

This review uses code and the approved design context; it is not a new visual inspection of every screen.

Preserve the Studio identity: rounded surfaces, distinct typographic roles, segmented phase progress, restrained neutral chrome, agent marks, chat on the left, canvas in the center and overview on the right. The glyph system is already implemented; do not reintroduce initial-letter avatars or arbitrary colored squares.

| Area | Refinement | How to assess it |
| --- | --- | --- |
| Overview | Prioritize the next decision and pending approvals; let secondary sections collapse | Can a returning user find their next action within seconds? |
| Phase progress | Keep the dark-to-light segments; add plain-language expectations and unresolved blockers | Can users explain why they are in phase 3 and what remains? |
| Chat | Retain bubbles; improve scanning of agent name, role, source and action | Long discussions remain readable without excess colored chrome |
| Reading comfort | Offer comfortable density; review small metadata and long text on laptop screens | Test zoom, dark mode and sustained reading |
| Canvas | Maintain selection, hover, proposal and remote-change hierarchy | Users can distinguish tentative from accepted content without color alone |
| Context continuity | Selecting a decision highlights related messages and blocks | Users do not lose the reason behind an element |
| Loading | Reserve geometry; show useful progress and a working cancel control | No layout jumps or ambiguous infinite activity |
| Errors | Place recovery beside the failed action; preserve drafts | Retry does not duplicate messages, operations or spend |
| Motion | Use short, purposeful transitions and honor reduced motion | Animation explains state and does not delay input |
| Navigation | Add a command palette and discoverable shortcuts | Frequent actions are possible without repeated modal navigation |
| Accessibility | Audit keyboard paths, focus restoration, contrast and screen-reader names | Complete the principal workflow without a mouse |
| Internationalization | Review German/English wrapping, pluralization, dates and numeric formats | Layouts stay coherent with longer German labels |
| Sharing | Explain exactly what a link exposes; make revocation visible | A user can predict the shared view before copying a link |
| Export | Preserve typography and hierarchy in PDF, SVG and Markdown | Exported work is presentable without manual cleanup |

Use a small component gallery and visual regression baselines for light/dark, empty/populated, error/loading and narrow/wide states. A new design skill or animation library is optional; a consistent component system and observed usability problems should determine whether it is needed.

## AI quality and trust program

Build a versioned evaluation set before changing models or adding more personas. Start with realistic German and English cases covering ambiguous instructions, contradictory criteria, unsupported claims, irrelevant specialists, incomplete plans and long conversations.

Evaluate:

1. Intent classification and safe fallback: questions should not authorize mutations.
2. Tool correctness: typed arguments, project scope, role permissions and bounded work.
3. Grounding: claims point to source messages, repository files, retrieved content or explicit assumptions.
4. Decision quality: alternatives and tradeoffs reflect the team's criteria.
5. Handoff quality: specs are coherent, testable and dependency-aware.
6. Recovery: disconnects, provider quotas, cancellation, timeout and retries preserve consistent state.
7. Cost/latency: track per stage, including classifier, observer and summaries.
8. Adversarial content: repository text, websites and uploaded files cannot grant tool permissions or approval.

The existing isolated SDK configuration, approval logic, typed tools and project permissions are strengths. Keep authority enforcement in deterministic application code. Retrieved text remains evidence, not authorization; this follows the boundary highlighted by [OWASP's prompt-injection guidance](https://genai.owasp.org/llmrisk/llm01-prompt-injection/).

Use offline deterministic fixtures for normal CI, and a smaller budgeted live evaluation set for model/prompt releases. Log prompt/template version, model, tool policy and source identifiers. Do not log entire private conversations by default. Avoid putting privileged credentials into model-visible context.

## Additional engineering backlog

These are targeted follow-ups, not all release blockers.

- Query performance: profile real project-list and usage queries; batch custom-agent lookups, avoid repeated full-array filtering, and add pagination where lists grow.
- Database: verify indexes against measured query plans; test migration from an earlier release, not only an empty database; review pool budgets across app and worker.
- Realtime: bounded outbound buffers, reconnect backoff, reconnection snapshots and load tests with slow clients.
- Collaboration: document size/node-count budgets, compaction policy, concurrent undo tests, corruption recovery and offline behavior.
- Storage: upload cancellation, failed-download recovery, quota visibility and safe media serving. Existing content sniffing and restrictive file headers should remain.
- Security: maintain the current RLS boundary and role tests; add cross-project negative cases for every new endpoint/tool.
- Sharing: review link expiry and access logging with user expectations; the current no-expiry decision is intentional and should be reconsidered explicitly, not silently changed.
- Secrets: rotation procedures for session, internal and integration keys; redact logs and keep backups access-controlled.
- Git integrations: stale approvals, changed branch heads, duplicated webhook deliveries, revoked credentials, rate limits and partial external failures.
- Delivery: reproducible image build, vulnerability scan, version labels, rollback steps and a clean staging smoke test.
- Observability: separate provider, database, queue and client failures; establish a minimal incident playbook.
- Testing: remove jsdom scrollTo warning noise with an intentional test stub; do not disable isolation just to follow a generic performance hint.
- Documentation: concise setup/troubleshooting, actual supported deployment topology, demo instructions and a maintained release checklist.
- Repository: dependency update configuration, security reporting instructions and contribution guidance sized to a small team; branch protection after CI is reliable.
- Product telemetry: collect minimal event data needed for activation and outcomes, with transparent configuration and retention.
- Scope: add external agents, enterprise workspaces and complex billing only after the core workflow earns repeat use.

## Recommended delivery sequence

Create numbered specs for implementation; IDs here are review references only. No application changes were made by this review.

| Stage | Scope | Exit condition |
| --- | --- | --- |
| A: safe baseline | R01-R03, dependency triage, CI build, credential/deployment documentation | Relevant auth advisory fixed; repeatable green Linux checks; reviewed lockfile |
| B: reliable execution | R04-R09, R14, mutation retries, cleanup | Cost and recovery fault scenarios pass; worker readiness is observable; restore drill recorded |
| C: complete user journey | R10-R13, real GitLab acceptance, chat history, tablet layout, initial bundle split | Two users complete the dry run on a clean instance with acceptable responsiveness |
| D: product distinction | Guided brief, linked decisions, readiness-checked handoff, evaluation set | Target users reach useful decisions and export implementable plans with less rework |

Start a small user-validation track alongside A and B; its observations should shape C and D. Do not promise calendar estimates before scoping each unit. Avoid simultaneously replacing the framework, splitting into microservices, adding providers and redesigning the visual identity.

The first implementation spec should address authentication dependency hardening. The first product experiment should observe a small team moving from an ambiguous brief to an approved decision and coding handoff.
