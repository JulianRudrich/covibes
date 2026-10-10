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
  - Under "Wartet auf dich" the request is a card like every Git request: "Review als Kommentar an !3 in vereins-app posten", with "Review ansehen". While it waits, runs or failed, the card of the review itself (part 30b) rests; afterwards it says that the review was commented.
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
- [ ] A review is posted as a comment at its merge request only by an approved Git request, with the approver's access and the note "via Covibes".
- [ ] The moderator lays the comment before the approvers when an automatic review deviates; owners and editors do it with a click for any finished review.
- [ ] A review is posted once; what waits for an older review of the merge request is taken back; a retry finds the comment that is there.
- [ ] What the model wrote arrives in GitLab as plain text: no formatting, links, mentions, references or quick actions.
- [ ] The card, the review and the log show the comment and its state.
- [ ] The stand-in takes and shows comments at merge requests.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the text of the comment, the job, the API and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
