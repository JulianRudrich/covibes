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
- [ ] After a decision or a criterion changes, the plan says that it is outdated and by what, and "Projektplan" shows a dot.
- [ ] "Aktualisieren" brings suggestions only for the affected sections; an update without anything to change says so, and the plan counts as current.
- [ ] A suggestion shows what it would change and says when its section was changed by hand; the hand-written text survives an accepted update.
- [ ] Versions are kept as described; "Versionen" lists them, shows one and compares it with the plan or the version before.
- [ ] "Seit du weg warst" counts the new versions.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the shared code, the database, the API, the task and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
