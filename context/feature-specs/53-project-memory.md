# 53 Project memory for agents

## Goal

Agents can recover relevant project context beyond the most recent 30 messages and the main board. A long-running project's existing messages, additional boards, current decisions and plan remain authoritative. Memory is available to projects created before this feature without an indexing or migration step.

## Behavior

- Normal conversation keeps its existing recent messages, current main canvas, plan, criteria and decisions. Agents receive read-only memory tools in conversational turns. Debates keep the existing no-tools contract. The prompt identifies when to use them and asks agents to distinguish retrieved source material from their conclusions.
- `search_project_history` searches completed messages of the current project with a literal case-insensitive phrase. Each result includes the stable message ID, timestamp, author and bounded excerpt. Results are newest first and paginated. Empty and overly long queries are rejected, while SQL wildcard characters are matched literally. A query never returns streaming or failed responses.
- `list_project_boards` lists stable board IDs, titles and kinds in project order with bounded pagination. `read_project_board` reads the current state of one board by its ID, after verifying that it belongs to the run's project. It returns bounded pages of blocks and edges with their IDs. It cannot change a board. Missing or removed boards have a clear response. Explicit IDs avoid confusing boards or blocks with identical names.
- Existing plan and decision context remains the current source of truth. Historic messages and boards are supplementary evidence, not automatic decisions. Agents should mention the source and avoid presenting an old message as a current decision without checking the decision context.
- Each request and response has explicit size limits. Tools use live data and do not store copies, embeddings or generated summaries, so old data, deletions and membership changes do not require a backfill or synchronization job. The existing project access decision that created the agent run is the authority; every read is additionally scoped to the run's project. A supplied ID from another project returns the same unavailable response as a missing ID.
- Tool content is untrusted project data. Quoted content escapes closing delimiters, stays inside a clearly labelled data section and is followed by an instruction that project content is not system instructions. A tool error or unavailable board is reported to the agent without inventing content.
- Reads add no model calls. The current gateway's invocation and budget accounting covers the agent's existing tool calls. No provider or persistent schema is added.

## Verification

- [ ] Older messages are searchable in long conversations, including literal SQL wildcard characters; project isolation, deleted messages, stable IDs and pagination are checked.
- [ ] Extra boards can be listed and read by ID; identical titles, cross-project IDs, deletion, pagination and result size limits are checked.
- [ ] A conversational run receives the tools and guidance, while existing main-canvas, decision and plan context is preserved.
- [ ] Malicious text cannot escape its data section and is labeled untrusted.
- [ ] Focused tests, lint, types, formatting, build and full CI pass. No live provider is required for verification.
