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
- **Forms, not decoration:** a meter for the one ratio against a limit, ranked bars in one hue for agents and people, columns in one hue for the days. Color carries state only where there is one (the limit is reached), and never alone: the text says it. The total and every row are written out; a column names its day and amount on hover and on focus, the keyboard walks through the days, and the day with the highest costs is always named.
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
- [x] Owners read the usage of a month: the total against the limit, per agent, per person and per day; nobody else does.
- [x] The numbers are this project's only; what ran by itself and people who left are listed as such.
- [x] The running month says when the limit is free again and marks a limit that is reached; a month that is over shows its amounts.
- [x] The dialog opens from the project's menu for owners, shows amounts as estimates in USD and as a share, and follows the live channel.
- [x] The total and every row are written out; every day is reachable with the keyboard, and the day with the highest costs is named without it.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the API and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-10)
- **Shared** (`packages/shared/src/usage.ts`): `UsageOverview` is one calendar month of UTC: the month, whether it is the running one, the two limits, when it ends, the total (`UsageAmount`: estimated costs, runs, input and output tokens), `byAgent`, `bySource` and `byDay`. `UsageSource` is a member with id and name, everyone who left the project (`left`, together) or nobody (`nobody`). `usageMonthSchema` is the month as a parameter, "2026-10".
- **Server:**
  - `GET /api/projects/:projectId/usage` gives owners the running month; `?month=2026-09` gives a month before it. Editors and viewers get 403, everyone else 404; a month that has not begun, or anything that is no month, is 400.
  - `usage/overview.ts` reads the rows of `usage` as the person who asks, so row level security decides what there is to see, and adds them up in millionths of a dollar, as the database keeps them: whole numbers add up without the rounding of fractions.
  - Agents and sources are ranked by costs, then runs, then name. `byDay` lists every day of the month, for the running month up to today, also the days without usage.
  - A name is that of a person who is in the project now. Whoever left is added to one row without name or id; what ran by itself and what a deleted account used is nobody's.
- **Web:**
  - "Verbrauch …" in the project's menu, for owners only; the dialog and its data are loaded when it opens.
  - `UsageDialog` (`features/usage/usage-dialog.tsx`): a switch between the running month and the one before, then
    - the amount as one figure with "von 100,00 $" and the share at the right, a meter below it, and "Der Monat zählt neu ab 1. November." At the limit the meter is full and red, and a line with an icon says "Limit erreicht. Die Agents antworten wieder ab 1. November." Without a limit, and for a month that is over, the amount stands alone.
    - runs, input tokens and output tokens of the month
    - "Je Agent" and "Je Person": a row each with the avatar, the name, a thin bar against the largest row, the amount and the runs. "Automatisch" and "Nicht mehr im Projekt" have an icon instead of an avatar.
    - "Je Tag": a column per day; days still to come stay empty. The line below names the day with the highest costs, and the day under the pointer or the keyboard. The columns are one stop for the Tab key; the arrow keys, Home and End walk through the days.
    - a note: the amounts are estimates at list prices, days and months count in UTC, the daily limit per person as a rule, and what "Automatisch" means when it is listed
  - `formatUsd`, `formatShare`, `formatCount`, `formatMonth` and `formatDayOfMonth` in `lib/format.ts`. An amount or a share that is there but rounds to nothing says so ("< 0,01 $").
  - The live event `usage` loads the running month again while its dialog is open; a month that is over does not change.
  - A new token `--color-chart` for the marks of a chart, a step lighter than ink.
- **Verified** with `pnpm dev` and the browser as olga (owner) in "Vereins-App", without a model run:
  - The dialog showed the project's real month: 6,19 $ of 100,00 $ (6,2 %), 81 runs, six agents, three sources (olga, "Automatisch", "Nicht mehr im Projekt") and the days of October up to today.
  - A run of 0.85 USD written into the database by hand showed in the open dialog within a second, without a reload: 7,04 $, "Automatisch" and today's column grew. It was removed again afterwards.
  - The month before was empty and said so.
  - Checked from screenshots with numbers changed in the browser only: a limit that is reached, and a whole month of 30 days with a day under the pointer.
  - Not tried live: the menu of an editor or a viewer, and the keyboard in the chart (the browser pane was in the background and took no focus); tests cover both.
- **Decided while building:**
  - Everyone who left the project is one row. Their names are no longer the owner's to see, and without names several rows could not be told apart.
  - The server answers any month that has begun; the dialog offers the running one and the one before, as the spec says.
  - The dialog asks for the running month without naming it: the server says which month runs, so a browser clock that is off cannot ask for a month that has not begun.
  - The meter is ink and the bars and columns a step lighter, so the one figure against the limit stays the loudest. The agents' colors stay with their avatars; the bars are one color because they compare one measure.
  - The share has one decimal under ten percent: a project that used little would otherwise read "0 %" for days.
  - A day's value shows on hover and on focus, not all at once: 31 numbers above 31 columns would be noise. The highest day is always named.
- **Known limits:**
  - The overview is a month; older months than the one before are reachable through the API only, and there is no export.
  - Days are days of UTC, so in other time zones a late run counts for the day before or after.
  - Runs of a custom agent that was deleted are listed as "Agent".
  - The dialog needs about 800 px of height to show a month without scrolling.
