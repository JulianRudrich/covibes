# 44 Direct AI providers and workspace funding

## User flows

A workspace owner opens AI settings from the Studio project list, chooses their personal or team workspace, and adds, replaces or removes a provider credential. Show only whether each provider has a key, the workspace and instance costs for the current UTC month, and the selected workspace name. Authorize every operation against current workspace membership. Other workspace roles, project-only owners and outsiders cannot inspect the credentials or manage funding. English and German labels use the existing Studio controls.

The owner of a project can choose a Claude or GPT model for each specialist using the existing team controls. Custom agents use the same catalog. Anthropic Haiku handles intent and the observer. A specialist using OpenAI can use its provider's small model for the accompanying intent call. Production uses fixed HTTPS provider endpoints, sends only the model context and explicitly permitted tools and never starts the Claude Code process. Local developers may continue to use the isolated Claude Agent SDK for Anthropic when there is no matching workspace key. OpenAI always uses its HTTP API.

## Credentials and accounting

Migration 0050 keeps AES-256-GCM ciphertext in an admin-only table keyed by workspace and provider, with a separate encryption purpose bound to both identifiers. Membership is locked while an owner changes credentials. There is no plaintext in public settings, HTTP responses, provider error messages or logs. A matching workspace credential takes precedence. If the workspace has a single provider, automatic tasks use its matching full or small model. An explicit specialist selection for another provider fails closed. A workspace with no keys uses instance credentials within instance credit. An invalid stored key or a rejected provider call fails without falling back to another payer. Worker startup requires no network credentials check for direct mode.

At reservation, bind the project workspace, credential source, provider and model to the invocation. Admission and accounting use the same immutable payer through retries, key rotation/removal, project transfers and deletion. Project and person caps still apply to both sources. Legacy usage and instance-funded attempts count against the instance, including uncertain holds. Workspace spend and its holds do not count against instance credit, warnings or historical totals. Workspace reporting shows costs by payer, with previous attempt costs retaining the original workspace on transfer. Provider adapters stream assistant text, validate tool arguments, return tool results, account for available token counts on success/error and bound rounds and spend. They retain request cancellation. Provider errors carry safe classifications; no live call is required for automated testing.

## Acceptance and verification

- [ ] A key can be installed, rotated and removed by the workspace owner only. Verify encrypted storage and deny direct SQL access under the application role.
- [ ] Mock provider HTTP streams for tool execution, results and usage. Exercise error/cancellation, cap handling and direct calls for both models. Preserve the local SDK tests.
- [ ] A workspace-funded run works with exhausted instance credit while project and person caps still apply. Changing the key leaves completed spending, active holds and warning attribution unchanged.
- [ ] Both supported provider families are selectable and the observer uses a small model.
- [ ] Validate database-generated types, affected test suites, formatting, lint, types and build. Record the scope of verification. A real production provider smoke test needs credentials and an approved paid environment.

## Protocol references

- [Anthropic Messages streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Anthropic tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
- [OpenAI GPT-4.1 model and prices](https://platform.openai.com/docs/models/gpt-4.1)
