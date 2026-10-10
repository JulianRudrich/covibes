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
- [x] Every run's tokens and costs reach `usage`, by day, project, person, agent, kind and model; nothing is counted twice, and a deleted project or person takes nothing away from the totals.
- [x] A run is attributed to the person who caused it, also through an agent that works for them.
- [x] Before every model call the worker checks the project's month and the person's day; at a limit no model is called.
- [x] A mentioned agent answers with the limit and when it is free again; the plan, the package and the review fail with that time; the observer and the summary stay quiet.
- [x] Members read whether a limit is reached and until when, and no numbers; the chat shows it above the composer and follows the live channel.
- [x] The limits come from the environment; 0 means none.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the check, the jobs, the API and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-10)
- **Database** (`packages/db/migrations/0038_usage.sql`):
  - `ai_runs.user_id`: the person a run is for. A trigger fills it when a run is created: the person whose request creates it (the user of the transaction: a mention, an accepted offer, a click), else the person of the run whose answer is the occasion (an agent mentions an agent), else the person of the debate's first run. Runs from before got the author of their triggering message.
  - `usage`: tokens, costs and the number of runs per day (UTC), project, person, agent, kind of run and model. It has no reference to the project, so it stays when a project is deleted. Owners read the rows of their project; nobody else reads the table.
  - A trigger on `ai_runs` adds whatever a run's tokens and costs grow by, on the day that happens, and counts the run once it ended. A run that is written again with less takes nothing back. It announces `usage` on the live channel when a run cost something. The runs from before were added up once.
  - A person who is deleted leaves their usage with the projects as nobody's.
  - `usage_totals(project)` gives a member the project's month and their own day across all projects.
- **Limits** (`usage/limits.ts`): `AI_LIMIT_PROJECT_MONTH_USD` (default 100) and `AI_LIMIT_USER_DAY_USD` (default 15) in the environment of server and worker; 0 is no limit, an empty value is the default. `usageGuard` reads the totals and throws `UsageLimitError`, the project's limit first. The error is a kind of the provider's quota error with the time the next month or day begins (UTC), so every job treats it the same way.
- **Jobs:** each checks right before its model call.
  - Agent turn: before the intent is read and the agent's model is called. The reply is one sentence in the project's language: which limit, how long it lasts (minutes, hours, or days from two days on), that everything else goes on, and for the project's limit that owners find the usage in the project's menu. The run ends as failed without costs, on the first attempt.
  - Plan, suggestion for a text of the package, feature specs, review: the run fails with the stored failure "quota" and the time the limit is free again; the dialogs show it as they show the provider's quota.
  - Observer: it returns without a look and stores nothing. Summary of an absence: no text, no run. The summary's run is stored for the person it is written for.
- **API:** `GET /api/projects/:projectId/usage/state` gives members `{ project, user }`, each with `reached` and `resetsAt`, and no number.
- **Web:**
  - `UsageLimitNote` above the composer, for everyone including viewers: "Das KI-Limit dieses Projekts für diesen Monat ist erreicht. Die Agents antworten wieder ab 1. November; alles andere geht weiter.", or the person's own day. The project's limit is named when both are reached. It follows the live event `usage`.
  - `formatUntil` says when something is free again: the time today, the day with the time within a day and a half, the day alone after that. The plan and the package use it for a used-up quota, which only named a time before.
- **Configuration:** the two variables are in `apps/server/.env.example`, `deploy/.env.example`, `deploy/compose.yaml` (app and worker) and `deploy/README.md`.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", without a model run:
  - The migration added up the runs from before: the project had used 6.17 USD this month.
  - With 100 USD added to the project's usage by hand and the event sent, the note appeared above the composer without a reload: "… Die Agents antworten wieder ab 1. November; alles andere geht weiter."
  - "@Moderator Was fehlt im Plan noch? Bitte kurz." was answered within seconds with "Das KI-Limit dieses Projekts für diesen Monat ist erreicht. In etwa 21 Tagen ist es wieder frei; …", without a model call and without costs.
  - With the 100 USD taken back, the note disappeared by itself.
  - Not tried live: the person's own day, and the plan, the package and the review at a limit; tests cover them.
- **Decided while building:**
  - The check is one small module that every job calls, not a wrapper around the gateway: the gateway knows neither the project nor the person of a call.
  - A limit is an error of the same kind as the provider's used-up quota. So the jobs, the stored failures and the dialogs needed no second path.
  - The reply to a mention names a duration, like the note for the provider's quota: it is stored once and read in any time zone. The note above the composer names the point in time in the reader's own time zone.
  - Members get no numbers, not even their own: the state says only whether a limit is reached. Numbers are for owners (part 31b).
  - Runs that end without costs are counted as runs too, so the overview shows failed tries.
- **Known limits:**
  - A limit can be exceeded by the runs that are on their way when it is reached.
  - A person who deletes their account and signs up again starts a new day; the project's limit still holds.
  - The costs are estimates at list prices; the provider's bill decides, and the spending limit there stays the last guard.
  - A run that an agent causes in a way the database cannot follow counts for the project and for no person.
  - The chat marks the reply at a limit as failed ("Die Antwort ist fehlgeschlagen."), like the reply at a used-up quota.
