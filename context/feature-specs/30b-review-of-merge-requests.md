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
- [ ] A merge request that belongs to an issue of Covibes is reviewed by itself once per state of its commits; drafts and other merge requests are not.
- [ ] Owners and editors start a review for any open merge request with a click; viewers do not.
- [ ] The review compares the changes with the architecture Covibes holds and stores a verdict, a summary and findings; an answer of another form fails the review.
- [ ] The bounds hold: once per state, the limits per day, the size of what is read.
- [ ] What the merge request says cannot steer the review beyond its result: no tools, a checked answer, plain text.
- [ ] The dialog "Merge Requests" shows the state of the review and opens it; "Wartet auf dich" shows merge requests that deviate.
- [ ] The stand-in opens an example merge request for an issue.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the job, the sync, the API and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
