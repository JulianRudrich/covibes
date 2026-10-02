# 25c Plan Outdated, Updates and Versions

## Goal
The plan stays true while the project moves on: when decisions or criteria change, the plan says that it is outdated and offers an update. The update only touches what the change affects, shows what it would change, and never costs anyone the text they wrote by hand. Every state of the plan is kept as a version that can be compared.

Third part of spec 25; part 25a brought the plan as a shared document, part 25b its generation.

## Design decisions
- **Outdated:** a plan the moderator wrote is outdated once a decision was made or reopened, or a criterion changed, after the moderator last wrote or updated it. The plan then shows "Der Plan ist nicht mehr aktuell" with what changed and the button "Aktualisieren"; the button "Projektplan" carries a dot. A plan nobody generated has nothing to be outdated against.
- **An update is a smaller generation:** the moderator gets the plan as it stands, what changed since, and everything a generation reads. It suggests only the sections the change affects, each as the complete new text of that section with everything else in it left as it was. If nothing needs to change, the plan says so, and it counts as current again.
- **Text written by hand is kept:**
  - Nothing enters the plan without someone accepting it, as before.
  - The moderator is told which sections people changed by hand and keeps what they say unless a decision contradicts it.
  - A suggestion for such a section says so on its card.
  - Every suggestion shows what it would change: lines that go and lines that come, compared with the section as it stands.
  - Before the first suggestion of a generation or update is written into the plan, the plan as it stood is kept as a version.
- **Versions:**
  - A version is kept when the suggestions of a generation or update are all decided and at least one was accepted, and before that for the state with changes by hand.
  - "Versionen" in the plan lists them, newest first, with when and why each was kept. A version can be read and compared with the plan as it stands or with the version before it.
  - Versions are for reading; text is taken back by copying it.
- **"Seit du weg warst"** (spec 23) lists how many versions of the plan were kept in the meantime.

## Implementation

### Shared: `packages/shared/src/`
- Comparing two texts of the plan line by line; the outdated state, the kind of a suggestion and whether its section was changed by hand; `PlanVersion`.

### Database: migration `0024_plan_versions.sql`
- Table `plan_versions`: the number per project, the plan as nodes, why it was kept, when and by whom. RLS: members read.
- `plan_suggestions`: whether it comes from a generation or an update, and whether its section was changed by hand.
- Starting an update, next to starting a generation.

### Server
- **API** under `/api/projects/:projectId/plan`: the state says whether the plan is outdated and by what; `POST update` starts an update; `GET versions` and `GET versions/:versionId`.
- **Deciding** keeps the versions: the state before the first accepted suggestion, and the state once all are decided.
- **Worker:** the update with `prompts/plan-update.md`: what changed, which sections were changed by hand, only the affected sections back.
- **"Seit du weg warst":** counts the versions of the period.
- **Tests:** when a plan is outdated, what an update suggests and leaves alone, the sections changed by hand, when versions are kept and who reads them.

### Web
- **Plan:** the note that the plan is outdated with "Aktualisieren", the dot on "Projektplan", the note on a suggestion for a section changed by hand, what a suggestion changes, and the dialog "Versionen" with reading and comparing.
- **Overview:** the line about versions in "Seit du weg warst".
- **i18n:** `plan.*`, `away.*`.

## Out of scope
- restoring a version with one click, and naming versions
- changes on the canvas as a reason for an outdated plan
- comparing word by word inside a line
- updating a single section on request, and updates the moderator starts from the chat
- the roadmap and assignable tasks (spec 26), exports (spec 27)

## Dependencies
- Spec 25b, spec 16a (decision log), spec 23 ("Since you were away")
- Packages: none new

## Checklist
- [x] After a decision or a criterion changes, the plan says that it is outdated and by what, and "Projektplan" shows a dot.
- [x] "Aktualisieren" brings suggestions only for the affected sections; an update without anything to change says so, and the plan counts as current.
- [x] A suggestion shows what it would change and says when its section was changed by hand; the hand-written text survives an accepted update.
- [x] Versions are kept as described; "Versionen" lists them, shows one and compares it with the plan or the version before.
- [x] "Seit du weg warst" counts the new versions.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the shared code, the database, the API, the task and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-02)
- **Comparing texts** (`packages/shared/src/plan-diff.ts`):
  - A text of the plan is compared by line: its Markdown without the empty lines, so a paragraph, a heading or a list item is one line. `diffPlanLines` keeps as many lines unchanged as possible (longest common subsequence) and marks the rest as going or coming.
  - `samePlanText` compares what two texts say, whatever their nodes look like in detail. It decides whether an update changes a section at all and whether a section was changed by hand.
  - `foldPlanDiff` folds unchanged stretches of four or more lines and keeps two lines next to every change.
- **Database** (migration `0024_plan_versions.sql`):
  - `plan_versions` holds a number per project, the plan as nodes, why it was kept (`manual`, `generated`, `updated`), when and by whom. Members read; the app role writes through `keep_plan_version` only, which is for owners and editors and keeps nothing when the plan says the same as the latest version.
  - `plan_suggestions` got `kind` (`generate` or `update`) and `hand_edited`.
  - `start_plan_generation` takes the kind and passes it to the job; the rules of a generation apply to an update (owners and editors, one run at a time).
- **Server:**
  - **Outdated:** the state of the plan (`GET /api/projects/:projectId/plan`) reads the decision log since the latest finished run of the kind `plan`. Decisions made or reopened and changed criteria make the plan outdated; the state names up to five changes and counts the rest. Without a finished run there is nothing to be outdated against.
  - **`POST update`** starts an update. Without a finished run or with an empty plan it is a generation.
  - **The update** (`tasks/plan-generate.ts`, `prompts/plan-update.md`) gives the moderator everything a generation reads, what changed since the plan was last written, and which sections were changed by hand. It asks for the affected sections only, each as its complete new text. Sections that come back saying what they already say are dropped, so an answer without a real change leaves no suggestion; the plan then shows for ten minutes that it was checked, and it counts as current.
  - **Changed by hand** means: the section says something else than the suggestion last accepted for it, or it holds text and no suggestion was ever accepted for it.
  - An update replaces open suggestions only for the sections it suggests anew.
  - **Versions while deciding:** before the first suggestion of a run is written into the plan, the plan as it stood is kept (`manual`); once no suggestion of the run is open any more and at least one was accepted, the result is kept (`generated` or `updated`). Both happen in the transaction that writes the plan.
  - `GET versions` lists the versions, newest first; `GET versions/:versionId` gives one with its text.
  - "Seit du weg warst" counts the versions kept in the period (`planVersions`).
- **Web:**
  - Above the plan: the note "Der Plan ist nicht mehr aktuell" with what changed and "Aktualisieren" (viewers read it without the button), and the note that an update found nothing to change. The button "Projektplan" carries a dot while the plan is outdated, read out as ", nicht mehr aktuell".
  - A suggestion of an update is marked "Aktualisierung" and shows what it changes in its section; "Ganzen Text anzeigen" switches to the text. A suggestion of a generation shows its text first, with the changes one click away. A suggestion for a section changed by hand says so on its card.
  - "Versionen" sits in the plan's toolbar, for viewers in a row of its own. The dialog lists the versions and shows the chosen one compared with the plan as it stands, compared with the version before it, or as text.
  - The comparison follows the document as people type (`usePlanText`, settled for 200 ms).
  - "Seit du weg warst" has a row "2 neue Versionen des Projektplans" that opens the plan.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", whose plan came from the generation of part 25b. Before the test a line was written by hand into "Kosten und Zeit"; "Risiken" held only a hand-written line, because its suggestion had been rejected in part 25b:
  - Reopening the decision "Hosting" made the plan outdated: the note named the reopened decision, and "Projektplan" showed the dot.
  - "Aktualisieren" showed "Der Moderator schreibt den Plan …"; a little later four suggestions arrived without a reload, for milestones, tech, risks and costs. The scope, which the change does not touch, got none.
  - Each card showed the lines that go and the lines that come. The cards for risks and costs said that the section was changed by hand; both kept the hand-written lines word for word and only added a line about the open hosting question.
  - "Alle übernehmen" wrote the four sections. Both hand-written lines were still in the plan, the note and the dot were gone, and two versions existed: version 1 "Von Hand geändert" (the plan before) and version 2 "Nach der Aktualisierung".
  - "Versionen" listed both. Version 2 compared with the plan showed "Keine Unterschiede", compared with version 1 the ten changed lines of the update; version 1 offered the comparison with the plan and its text.
  - Checked from screenshots: the note of an outdated plan with the dot, the cards of an update with their changes, and the dialog "Versionen". The note on a card for a section changed by hand was checked in the page's content, not from a screenshot.
  - An update that finds nothing to change, viewers, and the row in "Seit du weg warst" are covered by the tests; they were not tried live.
- **Found while testing live:**
  - The plan did not learn that it was outdated until the page was loaded again: a changed decision is announced as `decisions` on the live channel, which did not load the state of the plan again. It does now.
  - Every start of a generation or an update showed "Das hat nicht geklappt" for a moment although it had started: the server answers 202 without a body, and the web's `api` helper tried to read one. It now takes an empty answer as nothing. The mistake came with part 25b; the test helper had answered 202 with a body, which it no longer does.
  - Comparing two versions of a long plan started with a screen of unchanged lines. Unchanged stretches are folded now ("… 17 unveränderte Zeilen anzeigen") and open on a click, in the dialog and on the cards.
- **Known limits:**
  - A plan counts as current once an update ran, also when its suggestions were rejected; the same change does not make it outdated again.
  - Changes on the canvas and in the conversation do not make the plan outdated; "Plan erzeugen" reads them at any time.
  - The comparison is by line: a changed word marks its whole line, and the signs of the Markdown (`-`, `**`) show in the lines.
  - A version cannot be restored with one click; text is copied from it.
  - Versions are kept around generations and updates only. A plan that is only ever written by hand keeps no version.
