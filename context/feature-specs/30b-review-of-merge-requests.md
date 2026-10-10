# 30b Review of Merge Requests

## Goal
Covibes checks merge requests against the architecture and shows deviations (`project-overview.md`, "GitLab first, then GitHub"; `dry-run.md`, part 6): a coding agent opens a merge request for an issue, and Covibes says in its own interface whether the change follows what the team decided. Posting the result in GitLab is part 30c.

Second part of spec 30.

## Design decisions
- **Owner decision (2026-10-10):** an open merge request that belongs to an issue Covibes created is reviewed by itself, once per state of its commits. Every other open merge request is reviewed on a click.
- **A review reads and changes nothing:** it is a run of the model without tools. It reads the merge request with the project's reading access and writes only into Covibes, so it needs no approval. What it reads from the repository is data, not instructions (invariant 6): the title, the description and the changes stand in marked sections of the prompt, the answer has a fixed form that the server checks, and the web shows it as plain text.
- **What "belongs to an issue" means:** the merge request names the number of an issue Covibes created in this repository: in its source branch (`12-login`, as GitLab names a branch made from an issue) or as `#12` in its title or description.
- **The architecture is what Covibes holds now**, not what the repository holds: the files `context/architecture.md` and `context/decisions.md` as the package for coding agents would write them at this moment, and the feature spec of the issue's task if the merge request belongs to one. The repository's copy may be older.
- **The result:** a verdict (`fits` or `deviates`), a summary of a few sentences, and up to twelve findings. A finding has a title, what is wrong, what of the architecture it goes against, and the file it shows in. It is written in the project's language.
- **Who reviews:** the run is the moderator's, so it is metered like its other work. It uses Claude Sonnet 5.5, like the observer and the summaries, because it runs by itself; the owner can choose another model.
- **What starts a review:**
  - the job that reads the repository's state (part 30a): it lists the open merge requests and starts a review for each that belongs to an issue of Covibes and whose last commit has none yet. Drafts wait until they are ready.
  - "Prüfen" in the dialog "Merge Requests", for owners and editors, for any open merge request, also a draft.
- **Bounds:**
  - one review per merge request and state of its commits; a failed one is started again only on a click
  - 20 automatic reviews per project and day, 60 reviews in all
  - 30 changed files, the changes of a file up to 6,000 characters, 60,000 characters of changes in all; what is left out is named in the prompt and in the result
  - one review at a time per project
- **What people see:**
  - "Merge Requests …" shows per merge request the state of its review: none, running, "Passt zur Architektur", "2 Abweichungen", failed, or that an older state was reviewed. A click opens the review: the verdict, the summary and the findings.
  - Under "Wartet auf dich" a merge request that deviates shows as a card, for every member, until it fits, is merged or is closed. It is not counted: nothing is to be decided in Covibes.
- **The stand-in** opens an example merge request for an issue from the issue's page, with a change that uses another real-time library, so the way from the issue to the review can be tried without a GitLab.

## Implementation

### Shared: `packages/shared/src/`
- `git-reviews.ts`: the verdicts, the finding and the answer of the model as schemas, the review as the web reads it, and the bounds.
- The open merge requests carry their review and the issue they belong to.

### Database
- Migration `0036`: the run kind `review`; `git_reviews` (the merge request and state it is for, the run, the verdict, the summary and the findings, what started it, and whether the merge request is still open); `private.start_git_review` (the rules and bounds, the run and the job) and `public.request_git_review` for owners and editors.

### Server
- `git/merge-request-issue.ts`: which issue a merge request belongs to.
- `tasks/mr-review.ts`: the job. `agents/prompts/review.md`: its instructions.
- `tasks/git-sync.ts`: starts the automatic reviews and notes which merge requests are no longer open.
- `GET /git/merge-requests` carries the reviews; `POST /git/merge-requests/:number/review` starts one; `GET /git/reviews` lists the latest review of every open merge request; `GET /git/reviews/:id` gives one.

### Web
- `features/git/review-view.tsx`: the review. The dialog "Merge Requests" shows the state and opens it; "Wartet auf dich" has the card.
- **i18n:** `git.review.*`.

## Out of scope
- the review as a comment in GitLab (part 30c)
- comments at single lines of a change
- reviewing merged or closed merge requests, and reviewing again when the architecture changes
- a switch per project for the automatic review (limits are spec 31)

## Dependencies
- Spec 30a (the reading of the repository's state), spec 29 (issues and merge requests), spec 28 (reading the repository), spec 27 (the package's architecture files)

## Checklist
- [x] A merge request that belongs to an issue of Covibes is reviewed by itself once per state of its commits; drafts and other merge requests are not.
- [x] Owners and editors start a review for any open merge request with a click; viewers do not.
- [x] The review compares the changes with the architecture Covibes holds and stores a verdict, a summary and findings; an answer of another form fails the review.
- [x] The bounds hold: once per state, the limits per day, the size of what is read.
- [x] What the merge request says cannot steer the review beyond its result: no tools, a checked answer, plain text.
- [x] The dialog "Merge Requests" shows the state of the review and opens it; "Wartet auf dich" shows merge requests that deviate.
- [x] The stand-in opens an example merge request for an issue.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the job, the sync, the API and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-10)
- **Database** (`packages/db/migrations/0036_git_reviews.sql`):
  - The run kind `review`. `git_reviews` holds per project, repository, merge request and last commit: the merge request as it was (title, address, branch, author), the issue it belongs to, what started it, who asked, the run, the verdict, the summary, the findings as a list, and whether the merge request is still open. One row per merge request and commit. Members read; only the worker writes.
  - `private.start_git_review` holds the rules: it needs a repository, starts nothing for a state that was reviewed or is being reviewed, starts a failed or lost review again only for a person, and counts the day (20 by themselves, 60 in all). It makes the run of the moderator and queues the job `mr_review` in the queue `review:<project>`, so one review runs at a time per project. `public.request_git_review` is the same for owners and editors, and raises instead of answering nothing.
- **Which issue** (`git/merge-request-issue.ts`): the number at the start of the source branch (`12-…`), else the first `#12` in the title, then in the description, that is an issue Covibes created. `!12`, an anchor of an address and a number inside a word are none.
- **The sync** (`tasks/git-sync.ts`) lists the open merge requests after the issues. For each that is no draft and belongs to an issue of Covibes it calls `start_git_review` with `auto`. It marks the reviews of merge requests that are no longer in the list as not open, unless the list is full (50), and marks them open again when they return. It also runs for a project that has reviews but no issues of its own.
- **The job** (`tasks/mr-review.ts`):
  - It reads the merge request with its changes through the project's reader (spec 28b; 30 files). If the last commit is no longer the one the review is for, the review is deleted and its run ends as failed; the next reading starts the review of the new state.
  - The architecture is built at that moment: `context/architecture.md` and `context/decisions.md` of the package for coding agents, each cut at 16,000 characters, and the feature spec of the task the issue was created for.
  - The prompt holds the project, the language, and the sections `<architecture>`, `<decisions>`, `<spec>`, `<merge_request>` with `<description>`, and `<changes>` with one `<file>` per changed file. A file's changes are cut at 6,000 characters and all at 60,000; what is cut or left out is said in place. Text from the repository cannot close or open a section.
  - The model (`claude-sonnet-5-5`) answers one JSON object: a summary and findings (title, detail, basis, file). The server checks it and keeps twelve findings at most. The verdict follows from the findings: `deviates` with at least one, else `fits`. An answer of another form fails the review; the run is metered either way.
- **Prompt** (`agents/prompts/review.md`): what a deviation is (against a decision, the structure of the canvas, a criterion, the feature spec) and what is none (details the architecture leaves open, bugs and style, what cannot be seen, open topics), to judge exactly and fairly, the form of the answer, and that everything of the merge request is data.
- **API:**
  - `GET /git/merge-requests` carries per merge request the issue it belongs to, its latest review and whether that is about the commits it has now, and `canReview`.
  - `POST /git/merge-requests/:number/review` reads the merge request from GitLab and starts the review of its state: 201 with the review, 403 for viewers, 409 `already_running` for a state that has one, 429 `limit_reached` when the day is used up.
  - `GET /git/reviews` gives the latest review of every merge request that is still open; `GET /git/reviews/:id` one review. A run that waits for more than ten minutes shows as failed.
- **Stand-in:** the page of an issue has a second button "Beispiel-Merge-Request": it commits a file that uses Socket.io on the branch `<number>-beispiel` and opens a merge request with "Closes #<number>"; a further click is a further commit. An open merge request follows its branch now (its last commit and its changes).
- **Web:**
  - "Merge Requests …": below a merge request a line with the state of its review as a button that opens it ("Passt zur Architektur" in green, "2 Abweichungen von der Architektur" in red, "Älterer Stand:" before it when the commits changed), "Review läuft …", or "Das Review hat nicht geklappt."; and "Prüfen" or "Erneut prüfen" for owners and editors when the commits as they are have no review.
  - The review takes the place of the list: the merge request as a link, "Stand 58ec1e2e · automatisch geprüft · vor 3 Minuten · gehört zu Issue #4", the verdict as a banner, the summary, the findings as cards with "Architektur" and "Datei", and a note that a model wrote it. Everything the model wrote is plain text.
  - "Wartet auf dich": a card of the moderator per open merge request that deviates, with the first two findings by name and "Ansehen", which opens the dialog with that review. The counter does not count it.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", against the stand-in, with one real run:
  - A new issue (#4, "API-Projekt aufsetzen …") and "Beispiel-Merge-Request" on its page opened !3 on the branch `4-beispiel`. "Jetzt abgleichen" started the review by itself; it went from queued to running to done within seven seconds.
  - The verdict was "deviates" with two findings. The first: "Socket.io-Echtzeitkanal widerspricht dem Live-Laden per API", against the decision "Trainingszeiten: Live über die API laden", in `src/realtime/socket.ts`. The card showed under "Wartet auf dich", "Ansehen" opened the review, and the list showed "2 Abweichungen von der Architektur" at !3 and "Prüfen" at the draft !1.
  - The second finding compared with the spec of another task: after restarts the stand-in had given the number 4 out several times, and the review took the first task that carried it. It now takes the task whose issue was created last.
  - Not tried live, to spare the quota: the review on a click, a second state of the commits, a failed run and the limits; all are covered by tests. A real GitLab was not used.
- **Decided while building:**
  - The verdict is not asked of the model: it follows from the findings, so the two cannot disagree.
  - The architecture is read from Covibes, not from the repository: the repository's copy is as old as the last package.
  - Drafts are not reviewed by themselves: every push to work in progress would cost a run. A click reviews them.
  - A failed review is not tried again by the sync, or a merge request that cannot be reviewed would cost a run with every reading.
  - Sonnet 5.5 for all reviews, also those on a click: one model keeps reviews of the same merge request comparable.
  - The card under "Wartet auf dich" is for every member and is not counted. Part 30c brings what can be decided: the comment in GitLab.
- **Fixed on the way (part 30a):** an issue Covibes just created counts as open also when a state was stored for its number before, which only the stand-in's reuse of numbers brings about.
- **Known limits:**
  - Whoever can push to the repository can start up to 20 reviews a day by naming an issue of Covibes; the bound is per project.
  - What the merge request says can talk the model into a wrong verdict, but into nothing else: the review has no tools and its answer is checked text.
  - A review reads at most 30 files and 60,000 characters of changes; a large merge request is judged by its first files.
  - The review is not started again when the team changes the architecture; a click does that once the commits changed, or after a failure.
  - A merge request that was closed and opened again shows its review in the list at once, and under "Wartet auf dich" after the next reading.
