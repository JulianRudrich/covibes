# Progress Tracker

## Current phase
**M0/M1: foundation and vertical slice.** Planning is complete (2026-09-27); the product is built spec by spec.

## Current goal
Build the product, starting with the vertical slice (specs 04 to 07). Covibes is developed locally; the public launch comes at the end.

## In progress
- (none)

## Done
- [x] Reference evaluated: the video "How Senior Engineers Actually Build With AI in 2026". We adopted the method, not the product.
- [x] Product planning in 8 rounds of questions. The result is in `project-overview.md`.
- [x] Project folder and Git repository created
- [x] Context files for the product: `CLAUDE.md`, `project-overview.md`, `ai-workflow-rules.md`, `progress-tracker.md`
- [x] Custom agents added to V1, following the owner's feedback
- [x] Dry run with Covibes as the project: 21 gaps found and closed. The scenario is in `dry-run.md`, the rules in `project-overview.md` under "Detailed rules".

## Next
1. Tech stack round in plan mode → `architecture.md`, `code-standards.md`
2. Design direction based on 2–3 visual drafts → `ui-context.md`
3. Split V1 into numbered feature specs (`context/feature-specs/`)

## Open decisions
- **Dark mode:** not decided yet.
- **Hosting for the public launch:** decided at the end (spec 35). A private instance can be self-hosted with Docker (spec 02b).
- **Sign-in on a self-hosted instance:** email link via SMTP, GitLab or both. Both are built in; the operator chooses when setting it up.
- **Monetization:** the owner plans to sell Covibes once it is open to other users. Open: from when users pay and how (subscription, pricing, payment provider). `project-overview.md` currently says: V1 free, subscription later.

## Decisions
Product decisions are in `project-overview.md`, technical ones in `architecture.md`. The most important at a glance:
- **Positioning:** Covibes steers, coding agents build. Covibes agents write no application code.
- **Moderator:** it offers help but never starts unasked. Stance and decision process are configurable per project.
- **Custom agents:** V1 includes custom agents that are created in Covibes and shared personally or in a project. External agents (A2A/webhook) and company agents come right after V1, together with team workspaces.
- **Canvas:** structured, with sticky notes. How agents draw depends on the situation:
  - When asked, an agent changes the canvas directly.
  - When acting on its own, it makes a proposal.
  - For alternatives, it creates variants.
- **Git in the product:** GitLab first, GitHub afterwards. Reading is free; everything that changes something needs approval.
- **Covibes code repository:** on GitHub, CI with GitHub Actions. The owner chose this on 2026-09-28; it is independent of the GitLab integration in the product.
- **Repository language:** everything in the repository is English, and commits follow Conventional Commits. The owner decided this on 2026-09-28.
- **Tech stack:**
  - React app and the Covibes server (Hono, Better Auth, Hocuspocus, Graphile Worker) with PostgreSQL and RLS
  - local via `pnpm dev`, PostgreSQL without Docker; Docker image for self-hosting; fully self-hostable at any time (invariant 10)
  - AI SDK with EU endpoints only, several providers per agent
- **Frame:**
  - V1 is free with generous limits, subject to "Monetization" under open decisions.
  - Quality over cost.
  - GDPR-compliant, hosted in the EU where possible.
  - Languages: German and English.

## Session notes
- **2026-09-27:** planning conversation completed. The tech stack was deliberately left open because the owner wanted to plan the whole product first. Look & feel is decided based on visual drafts, not by text questions.
- **2026-09-27, addendum:** following the owner's feedback, custom agents were added to V1. External agents and company agents come right after V1.
- **2026-09-27, dry run:** Covibes was played through as a test project, revealing 21 gaps.
  - The owner decided 4 of them: who approves Git actions, under which name Covibes acts in GitLab, reopening decisions and manual edits to the plan.
  - 17 were added as default rules.

  The scenario doubles as the acceptance test for V1.
