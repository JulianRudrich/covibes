# 31b Usage Overview

## Goal
The owner sees the usage (`project-overview.md`, "AI limit reached" and "Costs"; `dry-run.md`, part 7): what the AI cost in the project, how close the project is to its limit, and which agents and people the costs come from.

Second and last part of spec 31.

## Design decisions
- **Owner decisions (2026-10-10):**
  - Owners see the usage in total, per agent, per person and per day. Other members only learn that a limit is reached (part 31a).
  - It shows as a share of the limit and as an estimated amount in USD.
- **One dialog, "Verbrauch", in the project's menu, for owners.** It shows one calendar month (UTC), the running one first; the month before can be looked at too.
- **What it shows, in this order:**
  - the share of the project's limit: the amount, the limit and the percentage, as one figure with a meter, and when the limit is free again; for a month that is over, the amount alone
  - runs and tokens of the month
  - per agent and per person: who the costs come from, the largest first, each with its amount and its runs. What ran by itself (the observer, automatic reviews) is listed as "Automatisch"; someone who is no longer in the project is listed without a name.
  - per day: one column per day of the month
- **Only this project's numbers.** A person's day counts across all projects (part 31a), but an owner sees what the person used in this project, not elsewhere. The dialog names the daily limit per person as a rule, without anyone's standing.
- **Amounts are estimates** at list prices, and the dialog says so.
- **Forms, not decoration:** a meter for the one ratio against a limit, ranked bars in one hue for agents and people, columns in one hue for the days. Color carries state only where there is one (the limit is reached), and never alone: the text says it. Every value is readable without hovering; a column names its day and amount on hover and on focus.
- **It follows the live channel:** a run that cost something loads it again.

## Implementation

### Shared: `packages/shared/src/`
- `usage.ts`: the overview of a month, and the month as a parameter.

### Server
- `GET /api/projects/:projectId/usage?month=2026-10` for owners, from the rows of `usage` that row level security lets them read.

### Web
- `features/usage/usage-dialog.tsx`, opened from the project's menu ("Verbrauch …", owners only).
- **i18n:** `usage.*`, `workspace.usage`.

## Out of scope
- usage across projects, per person or for the whole instance (whoever runs it reads the database)
- exporting the numbers, and older months than the one before the running one
- setting limits in the interface
- costs per model, and per kind of run

## Dependencies
- Spec 31a (the usage and the limits)

## Checklist
- [ ] Owners read the usage of a month: the total against the limit, per agent, per person and per day; nobody else does.
- [ ] The numbers are this project's only; what ran by itself and people who left are listed as such.
- [ ] The running month says when the limit is free again and marks a limit that is reached; a month that is over shows its amounts.
- [ ] The dialog opens from the project's menu for owners, shows amounts as estimates in USD and as a share, and follows the live channel.
- [ ] Every value is readable without hovering and with the keyboard.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the API and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
