# Remaining implementation

The owner authorized parallel implementation on 2026-11-17 and restored the Covibes Studio design on 2026-11-24.

## Delivery rules

- Write each detailed feature spec before its application changes.
- Keep data/permission boundaries and meaningful verification for every feature.
- Integrate dependencies in order; isolated worktrees may progress independently.
- Preserve one implementation commit per numbered spec on main through squash
  integration. Planning/research documentation can be committed separately.
- Use the Studio palette, components and layout documented in `ui-context.md`.
- Popular repositories, launch rankings and observed UI quality are different
  evidence. Research records dates, ranking windows, sources and limitations.
- Do not claim a live integration, public deployment or legal readiness merely
  because configuration, code or a fixture test exists.

## Scope and sequence

| Spec | Deliverable | Current state / dependency |
| --- | --- | --- |
| 39 | Dependency security and green CI | Completed on main, PR 1 |
| 40 | Atomic budgets and all-attempt accounting | Detailed spec; isolated implementation |
| 41 | Idempotent recovery, worker ownership, readiness | Isolated implementation; integrate after 40 |
| 42 | Mail code/link, passkeys, OAuth, account controls, invite-only beta | Detailed spec and implementation next |
| 43 | Personal/team workspaces, membership, project ownership/deletion | After 42; storage cleanup included |
| 44 | Direct provider APIs, workspace keys, instance fallback, model selection | After 40 and 43 |
| 45a–c | Scoped MCP connector, permitted writes and local companion | After 42 and stable project contracts |
| 46 | GitHub App integration and GitLab compatibility | Existing Git-host abstraction; real app configuration needed |
| 47 | History pagination, old-message links, project search, formatted answers | Detailed spec; independent worktree |
| 48 | Initial fit/navigation, incremental board updates, efficient dragging | Detailed spec; independent worktree after 47 |
| 49 | Route loading, responsive tablet layouts, metadata | Preserve the Studio interface |
| 50 | Decision links and consequence/impact navigation | After stable project/plan/board contracts |
| 51 | Repository-to-architecture onboarding | After 46 and provider gateway |
| 52 | Guided first session and sample project | After 50/51, using Studio |
| 53 | Durable project memory for agents | After gateway and shared read contracts |
| 54 | Evaluation fixtures for grounding, dissent, tools, cost/time | After agent contracts; distinguish fixtures from live evaluation |
| 55 | Entirely new product design | Closed by owner on 2026-11-24; prototype archived |
| 35 | Operations, staging, backups/restore, monitoring and launch configuration | Source can proceed; external launch facts required |
| 34 | Multi-user end-to-end acceptance | After behavior/design and staging contracts |

Specs 50–54 may be implemented from the authorized product outline before real
beta feedback exists. Their initial implementation must not be described as
validated by beta participants. Later user research remains a separate input.

## Parallel team

- Repository design research: dated GitHub signals, primary product demos and UI.
- Webapp/UX research: dated launch sources plus established product benchmarks.
- Design direction: Studio, including responsive layouts, keyboard interaction and accessibility.
- Engineering 40: attempt ledger and atomic budget reservations.
- Engineering 41: crash recovery, persistence truth and worker lifecycle.
- Engineering 47/48: long conversations and large boards.
- Lead integration: accounts/workspaces, downstream features and full delivery.

## External release facts still required

The source implementation does not supply domain ownership, OAuth application
registration, real provider credentials/funding, production mail/DNS
configuration, an EU host, or the operator's legal facts. The owner was asked for
the target domain and legal operator details. Keep production release blocked
until actual configuration and the relevant real-service checks are verified.

## Verification record

Each individual spec records focused tests and integration limits. Before a
source feature is integrated: lint, types, formatting, meaningful feature tests,
database type verification where relevant and production build. Release
acceptance adds multi-user browser flows, real-service checks where configured,
backup restore and staging readiness.
