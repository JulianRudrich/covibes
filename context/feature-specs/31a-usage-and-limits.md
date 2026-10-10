# 31a Usage and Limits

## Goal
Covibes knows what the AI costs per project and per person, stops calling models when a limit is reached, and says so clearly (`project-overview.md`, "AI limit reached" and "Costs"; `dry-run.md`, part 7): only the AI pauses, everything else keeps working. The overview in which owners read the usage is part 31b.

First part of spec 31.

## Design decisions
- **Owner decisions (2026-10-10):**
  - The limit counts estimated costs in USD: every run already stores what it cost at list prices, one number for all models, and what an instance with an API key pays.
  - Two limits by default: 100 USD per project and calendar month, and 15 USD per person and day (across all projects). They are generous and meant against abuse; whoever runs the instance changes them by configuration.
  - Owners see the usage in total, per agent, per person and per day, as a share of the limit and as an amount in USD (part 31b). Other members only learn that a limit is reached.
- **Split (2026-10-10):** spec 31 is built in two parts:
  - 31a metering, the limits and the message (this part)
  - 31b the usage overview for owners
- **Usage is kept apart from the runs:** a table `usage` holds tokens and costs per day, project, person, agent, kind of run and model. It follows the runs by itself (a trigger adds whatever a run's costs change by), so no job can forget to meter. It outlives its project: deleting a project must not give a person their day back.
- **Who a run is for:** the person who caused it. A run that someone's request creates is theirs (a mention, an accepted offer, "Plan erzeugen", a suggestion, a review on a click). A run an agent causes while it works for someone is that person's too (an agent it mentions, a round of a debate). What runs by itself belongs to nobody and counts for the project only: the observer and an automatic review. The summary of an absence is the run of the person it is written for.
- **The check comes before every model call**, in the worker: is the project below its month, and the person below their day? A run that started below the limit ends even if it crosses it, so a limit can be exceeded by one run.
- **Days and months are those of UTC**, so a limit means the same for everyone on an instance. The message says when it is free again as a point in time, which every reader sees in their own time zone.
- **What happens at a limit:**
  - An agent that is mentioned answers with one sentence instead of calling its model: which limit is reached and when it is free again.
  - The observer does not look, and writes nothing. A summary of an absence comes without the moderator's text.
  - A generation of the plan, a suggestion, written-out feature specs and a review fail like they do when the provider's quota is used up, with the time the limit is free again.
  - The chat shows a note above the composer while a limit is reached, for everyone in the project: the project's limit, or the person's own.
  - Nothing else changes: the canvas, the plan, the chat between people, Git requests and their approval keep working.
- **A limit of 0 is no limit.** The values come from the environment of server and worker; both must be given the same.

## Implementation

### Shared: `packages/shared/src/`
- `usage.ts`: the state of the limits as members read it (which is reached, and until when).
- The live event `usage`.

### Database
- Migration `0038`: `ai_runs.user_id` and the trigger that fills it; `usage` with the triggers that follow the runs and that keep a deleted person's usage with the project; `usage_totals` for members.

### Server
- `usage/limits.ts`: the limits from the environment, the periods, the totals, the check and its error.
- Every job that calls a model checks first: the agent turn, the observer, the summary, the plan, the package's suggestion and specs, the review.
- `GET /api/projects/:projectId/usage/state`.

### Web
- The note above the composer; the time a limit is free again reads as a day when it is not today.
- **i18n:** `usage.*`.

## Out of scope
- the usage overview for owners (part 31b)
- limits per project that an owner sets, and limits per agent
- billing, plans and payment (spec 35, once decided)
- a limit on anything but model calls (files, boards, members have their own bounds)

## Dependencies
- Spec 07 (agent runs and the gateway), and every spec that calls a model (13, 15, 23, 25, 27, 30)

## Checklist
- [ ] Every run's tokens and costs reach `usage`, by day, project, person, agent, kind and model; nothing is counted twice, and a deleted project or person takes nothing away from the totals.
- [ ] A run is attributed to the person who caused it, also through an agent that works for them.
- [ ] Before every model call the worker checks the project's month and the person's day; at a limit no model is called.
- [ ] A mentioned agent answers with the limit and when it is free again; the plan, the package and the review fail with that time; the observer and the summary stay quiet.
- [ ] Members read whether a limit is reached and until when, and no numbers; the chat shows it above the composer and follows the live channel.
- [ ] The limits come from the environment; 0 means none.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the check, the jobs, the API and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
