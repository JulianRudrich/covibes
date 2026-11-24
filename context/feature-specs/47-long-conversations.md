# 47 Long Conversations

## Goal
Every message remains reachable as a conversation grows. Members can load older
history without losing their reading position, open an older message directly,
and search messages, decisions, canvas elements and plan sections. Agent replies
render code and lists without accepting HTML from a model.

## Design decisions
- The owner requested a completely new design on 2026-11-17. This spec defines
  behavior and accessible controls only; spec 55 supplies the visual treatment.
- Keep the existing latest-message array endpoint and realtime cache contract.
  Add an opt-in history endpoint using an exclusive timestamp-and-ID cursor.
  Preserve PostgreSQL timestamp precision in cursors.
- Fetch 100 messages per page, in chronological order, with an explicit next
  cursor. Concurrent arrivals cannot duplicate or skip the older page boundary.
- Opening a message loads its surrounding history even if the latest page does
  not contain it. Loaded messages merge by ID with live and pending messages.
- Search is scoped to one project and requires membership. Results are bounded
  and grouped by kind, with stable identifiers for opening their source.
- Code fences and ordered/unordered lists are semantic React elements. Inline
  mentions and references retain their existing behavior outside code. Raw HTML
  and model-provided executable URLs are never interpreted.

## Implementation
- Shared message-history cursor/page and project-search contracts.
- Server history and message-context routes alongside the unchanged latest
  messages route. All queries use `withUser` and the project membership check.
- A project search route reads relational messages/decisions through RLS and
  the authorized project's current board and plan snapshots.
- Chat history loading, scroll anchoring, direct message jumps and a keyboard
  accessible project search control, with German and English messages.
- Reply rendering supports fenced code and lists without adding a Markdown
  HTML interpreter or changing the meaning of stored message text.

## Out of scope
- Visual identity, panel architecture and spacing (spec 55).
- Public cross-project search and semantic/paid search.
- Deleting or editing stored messages; message virtualization until measured.

## Dependencies
- Specs 06, 16, 25 and 37; no new packages.

## Checklist
- [x] A 1,000-message fixture reaches the first message without gaps or
  duplicates while newer messages arrive; same-timestamp boundaries work.
- [x] A direct message jump loads and focuses a message outside the latest page.
- [x] Search finds all four source kinds and does not disclose another project.
- [x] Older-page loading preserves the visible reading anchor.
- [x] Code and lists render semantically while HTML stays inert.
- [x] Focused tests, lint, type checks and formatting pass.


## Implementation notes

Implemented opt-in `message-history` pages and context routes while keeping the latest-message array endpoint. History boundaries and server message timestamps preserve PostgreSQL microseconds, and cache ordering normalizes optimistic millisecond timestamps. Migration 0049 adds the timestamp/ID cursor index. Project search reads messages and decisions through RLS and only the authorized project's current board/plan documents. The context reader is separate from the live latest-message cache and offers an explicit return to latest messages.

Validation: 17 focused server tests and 77 focused web tests pass, including 1,000-message paging under concurrent arrivals, tied timestamps, source authorization, search across all four kinds, scroll anchoring, old-message focus and inert HTML/code. Type checks, changed-file ESLint and formatting pass. The parent integration runs the full merge checks after combining the dependent specs.

Reconnect follow-up (2026-11-18): a refreshed latest page can be disjoint from
the cached messages after a long disconnect. Such a gap now resets the history
cursor and replaces the obsolete confirmed prefix while preserving optimistic
sends and in-flight live arrivals. Overlapping pages retain already loaded
history. Cursor generations also discard an older-page response started before
that reset, preventing stale responses from reintroducing the gap. The cursor
is observable query state, so an exhausted history becomes loadable immediately.
Validation: 45 focused web tests, changed-file ESLint and the web type check pass,
including the disjoint refresh, overlapping refresh and stale-response cases.
