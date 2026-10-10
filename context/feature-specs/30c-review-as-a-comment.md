# 30c The Review as a Comment

## Goal
A review of a merge request (part 30b) appears as a comment in GitLab, and only after approval (`project-overview.md`, "MR review"; `dry-run.md`, part 6). So the coding agent, or the person who opened the merge request, reads where the change leaves the architecture, at the place where the work happens.

Third and last part of spec 30.

## Design decisions
- **A comment is a Git action:** it changes something in the repository, so it is a Git request that waits for approval (spec 29b), runs with the approver's own access, carries the note "via Covibes" and goes into the log. There is no other way for a review into GitLab.
- **Who lays it before the approvers:**
  - the moderator, by itself, when a review that started by itself found deviations: the request names the moderator, like its other proposals (spec 29e)
  - owners and editors, with a click at any finished review, also one that fits
- **One comment per review:** a review is laid before the approvers once at a time, and posted once. When a newer review of the same merge request arrives, what still waits for the older one is taken back.
- **The comment is built by the server from the stored review**, not written by the model anew: the state of the commits, the summary and the findings, each with what it goes against and its file. It says that a model wrote the review and a person approved the comment.
- **What the model wrote is posted as plain text.** A review reads a merge request, which comes from outside; its text must not act in GitLab under the approver's name. The server makes every text of the model inert before it becomes part of the comment: no formatting, no links, no mentions of people, no references to issues or merge requests, and no quick actions (a line that starts with `/`). The approver sees the same text in Covibes before approving.
- **A retry does not post twice:** the comment carries a hidden mark; a request that is approved again after a failure finds the comment by its mark.
- **What people see:**
  - Under "Wartet auf dich" the request is a card like every Git request: "Review von !3: 2 Abweichungen als Kommentar in vereins-app posten"; its "Ansehen" opens the review. While it waits, runs or failed, the card of the review itself (part 30b) rests; afterwards it says that the review was commented.
  - The review shows whether its comment waits, was posted (with the link) or failed, and offers "In GitLab kommentieren" (or "Zur Freigabe vorlegen").
  - The log lists it like every request.
- **The stand-in** takes comments at merge requests and shows them on the merge request's page.

## Implementation

### Shared: `packages/shared/src/`
- The request kind `comment` and its action, with the merge request, the review and the text.
- `git-review-comment.ts`: the comment of a review as Markdown, and making a text inert.
- A review says what became of its comment.

### Database
- Migration `0037`: the kind `comment` for requests and actions; one request per review at a time; taking back what waits for an older review of the same merge request.

### Server
- The writer comments on a merge request and finds a comment by its mark; the job of a request runs the action.
- `POST /git/reviews/:id/comment` makes the request; the review job makes it for the moderator.
- The reviews carry their comment.

### Web
- The card and the log know the kind; the review offers the comment and shows its state.
- **i18n:** `git.requests.*`, `git.review.*`.

## Out of scope
- comments at single lines of a change, and answers to comments
- changing or deleting a comment that was posted
- approving or blocking the merge request in GitLab from the review

## Dependencies
- Spec 30b (the review), spec 29b (Git requests and their approval), spec 29e (requests of an agent)

## Checklist
- [x] A review is posted as a comment at its merge request only by an approved Git request, with the approver's access and the note "via Covibes".
- [x] The moderator lays the comment before the approvers when an automatic review deviates; owners and editors do it with a click for any finished review.
- [x] A review is posted once; what waits for an older review of the merge request is taken back; a retry finds the comment that is there.
- [x] What the model wrote arrives in GitLab as plain text: no formatting, links, mentions, references or quick actions.
- [x] The card, the review and the log show the comment and its state.
- [x] The stand-in takes and shows comments at merge requests.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the text of the comment, the job, the API and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-10)
- **Database** (`packages/db/migrations/0037_git_comments.sql`):
  - The kind `comment` for requests and for actions. `private.insert_git_request` takes it: the action names its merge request, its review and its text; the review must be one of this project's repository that is written, for that merge request; a review that waits, runs, failed or was posted gets no second request (after a rejection it can be asked for again).
  - `private.withdraw_older_review_comments` takes back what waits for approval for a merge request, except the comment of one review. What runs, failed or is posted stays.
- **The text** (`packages/shared/src/git-review-comment.ts`):
  - `buildReviewComment` builds the comment from the stored review in the project's language: a heading, the verdict with the first eight characters of the commit, the summary, the findings (title, detail, and a list with what each goes against and its file), a line that a model wrote the review and a person approved the comment, and "via Covibes" with the project's name. A review too long for 20,000 characters loses its last findings and says how many.
  - `inertText` makes every text of the model, and the project's name, inert:
    - control characters and invisible marks (zero-width, direction overrides) are dropped, lines are trimmed
    - the backslash, the backtick and `* _ [ ] < > | ~ $ & # ^ { }` are escaped wherever they stand
    - a line that starts with `- + = / :` or with a number and `.` or `)` gets a backslash there, so nothing becomes a list, a rule, a heading or a quick action
    - `@ # ! ~ % $ & ^` are followed by a zero-width space, and `://` and `www.` are broken by one: GitLab looks for mentions, references and addresses in the text after it read the Markdown, where a backslash no longer helps
    - the punctuation of plain sentences stays, so the comment also reads as plain text, e.g. in a mail
- **Writer** (`integrations/git-host.ts`, `integrations/gitlab/writer.ts`): `commentOnMergeRequest` posts a note and gives its address (the merge request's page at `#note_<id>`); `findMergeRequestComment` looks through the newest hundred notes for a mark.
- **Job** (`tasks/git-request.ts`): the action `comment` posts the text with the mark of its action at the end (`<!-- covibes-action:<id> -->`). A second try looks for the mark first. The result is the merge request's number and the comment's address.
- **Review job** (`tasks/mr-review.ts`): when a review is written, what waits for an older review of the merge request is taken back. If the review started by itself and deviates, the moderator's request for the comment is made (`insert_git_request` with the agent `moderator`); that it waits already, or that the repository is gone, is no failure.
- **API:** `POST /git/reviews/:id/comment` for owners and editors builds the comment and makes the request: 201 with the request, 403 for viewers, 400 for a review that is not written, 409 `already_running` for one that waits or was posted. A review carries `comment` (waiting, running, failed, or done with the address); `GET /git/reviews` says whether the person may ask (`canRequest`); an action of a request names its `reviewId`.
- **Stand-in:** takes `POST …/merge_requests/:iid/notes`, and the page of a merge request shows the comments as the text that was sent, so what would act in a GitLab can be looked at.
- **Web:**
  - The card of the request: "Moderator · Freigabe", "Review von !3: 2 Abweichungen als Kommentar in vereins-app posten", "Freigeben", "Ansehen" (which opens the review) and the X to reject. It is counted like every request.
  - The review: "In GitLab kommentieren" for who may approve and has an account (request and approval in one step), "Als Kommentar vorlegen" for other owners and editors, with a hint that it is posted only after approval; "Der Kommentar wartet auf Freigabe.", "… wird gepostet …", a red line when it failed, and "In GitLab kommentiert" as a link once it is posted.
  - The card of a review that deviates rests while its comment waits, runs or failed, and says "In GitLab kommentiert" afterwards. The log shows the request with "Kommentar" as the link to it.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", against the stand-in, with one real run:
  - A new issue and its example merge request (!3); "Jetzt abgleichen" started the review, which found two deviations. Right after it, the request "Review von !3: 2 Abweichungen als Kommentar in vereins-app posten" waited under "Wartet auf dich", named for the moderator; the review's own card did not show next to it.
  - "Review ansehen" opened the review with "Der Kommentar wartet auf Freigabe." "Freigeben" posted the comment: the stand-in's page of !3 showed it under "Olga Beispiel kommentiert:", the counter went to 0, the request became the line "Review von !3: 2 Abweichungen in vereins-app kommentiert", and the review's card came back with "In GitLab kommentiert".
  - The live test showed two things that were changed afterwards: the comment's source was full of backslashes, since every punctuation mark was escaped (now only what acts is), and "Review ansehen" pushed the X of the card to a second line (the button reads "Ansehen" now, with the long name for screen readers).
  - Not tried live: the comment on a click, a failed comment and its second try, and how a real GitLab renders the text; tests cover the first two. A real GitLab was not used.
- **Decided while building:**
  - The moderator proposes the comment only for reviews that started by itself and deviate. A review someone asked for is theirs to pass on, and "fits" as a comment by itself would be noise.
  - The comment is built from the stored review at the time of the request, and that text is what the approver approves; nothing is generated between approval and posting.
  - The comment names the commit it is about, so one that is approved after new commits came in is still true.
  - "Ansehen" at the request opens the review instead of the list of actions: the review is what will stand in the repository.
- **Known limits:**
  - How GitLab renders the comment was not seen yet; that the escapes show as plain text there is the rule of CommonMark, and is to be checked with the real GitLab (spec 35 at the latest).
  - Emoji names between colons (`:tada:`) may still turn into emoji, and a commit id of the repository may still become a link to that commit. Neither does anything.
  - A comment that was posted is not changed or deleted when the merge request changes; the next review brings a new one.
  - Whoever approves posts under their own name, like every Git action.
