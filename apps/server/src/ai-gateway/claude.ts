import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createSdkMcpServer,
  query,
  tool,
  type AccountInfo,
  type Options,
  type SDKAssistantMessageError,
  type SDKResultMessage,
  type SDKUserMessage,
  type Settings,
} from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { estimateCostUsd, resolveModel, type ModelInfo } from '@server/ai-gateway/registry';
import {
  GatewayConfigError,
  GatewayLimitError,
  type AgentReplyRequest,
  type AgentReplyResult,
  type AgentReplyUsage,
  type AgentTool,
} from '@server/ai-gateway/types';

/** Name of the in-process MCP server; the model sees the tools as `mcp__covibes__<name>`. */
const TOOL_SERVER = 'covibes';

/**
 * Model round trips per reply. A diagram takes several in a row (its frame, then its blocks, then
 * the arrows, then arranging it; spec 12), a request for a few diagrams more; the limit only stops
 * a model that goes in circles. The first live test with 6 ran out while drawing three diagrams.
 */
const MAX_TURNS = 16;

/** A hanging tool would block the agent's queue; after this the model gets an error instead. */
const TOOL_TIMEOUT_MS = 60_000;

/** Upper limit for starting Claude Code and reading the account in `checkClaudeAccess`. */
const ACCESS_CHECK_TIMEOUT_MS = 30_000;

/**
 * `settingSources: []` skips the settings files, but these features hang on the account or the
 * home folder rather than on a settings file, so they are switched off explicitly.
 */
const ISOLATION_SETTINGS: Settings = {
  autoMemoryEnabled: false,
  disableAllHooks: true,
  disableClaudeAiConnectors: true,
  syncClaudeAiPlugins: false,
  syncClaudeAiSkills: false,
  disableWorkflows: true,
};

/** Failures that a retry cannot fix: login, key, account or model. */
const CONFIG_ERRORS: ReadonlySet<SDKAssistantMessageError> = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'cloud_credential_error',
  'billing_error',
  'model_not_found',
]);

/**
 * Runs one agent turn on Claude through the Claude Agent SDK and streams the reply text. The model
 * only gets the request's tools: none of Claude Code's own tools, settings, skills or memory.
 * Authentication comes from the environment: `ANTHROPIC_API_KEY` if set, otherwise the local
 * Claude Code login.
 */
export async function streamAgentReply(request: AgentReplyRequest): Promise<AgentReplyResult> {
  const model = resolveModel(request.model);
  const { signal } = request;
  signal?.throwIfAborted();

  const abortController = new AbortController();
  const abort = () => {
    abortController.abort(signal?.reason);
  };
  signal?.addEventListener('abort', abort, { once: true });

  let text = '';
  let startsNewBlock = false;
  let result: SDKResultMessage | undefined;
  let configError: SDKAssistantMessageError | undefined;
  let limit: QuotaLimit | undefined;
  try {
    const options = await isolatedOptions(request, model, abortController);
    for await (const message of query({ prompt: request.prompt, options })) {
      if (message.type === 'result') {
        result = message;
      } else if (message.type === 'assistant') {
        if (message.error && CONFIG_ERRORS.has(message.error)) configError = message.error;
        // A rate limit that Claude Code could not wait out itself ends the run.
        if (message.error === 'rate_limit') limit ??= { resetsAt: null };
      } else if (message.type === 'rate_limit_event') {
        // The subscription's session or weekly limit: nothing runs until it resets.
        const info = message.rate_limit_info;
        if (info.status === 'rejected') limit = { resetsAt: resetDate(info.resetsAt) };
      } else if (message.type === 'stream_event' && message.parent_tool_use_id === null) {
        const { event } = message;
        // Text before and after a tool call arrives in separate blocks; keep them apart.
        if (event.type === 'content_block_start' && event.content_block.type === 'text') {
          startsNewBlock = text !== '';
        } else if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta' &&
          event.delta.text
        ) {
          const delta = startsNewBlock ? `\n\n${event.delta.text}` : event.delta.text;
          startsNewBlock = false;
          text += delta;
          request.onText(delta);
        }
      }
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (limit) throw failure(error instanceof Error ? error.message : String(error), { limit });
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  // An abort can also end the run with an error result instead of a thrown error.
  signal?.throwIfAborted();

  if (!result) throw failure('the run ended without a result', { configError, limit });
  if (result.subtype !== 'success' || result.is_error) {
    const details = result.subtype === 'success' ? [result.result] : result.errors;
    const detail = details.filter(Boolean).join('; ') || 'no details';
    throw failure(`${result.subtype}: ${detail}`, { configError, limit });
  }

  const usage = usageOf(result);
  return {
    text,
    provider: model.provider,
    model: model.id,
    usage,
    costUsd: costOf(result, usage, model),
  };
}

/**
 * A short text answer without tools, e.g. a classification (spec 13). The same isolated run as an
 * agent reply, only nothing streams and no tool is offered.
 */
export function completeText(request: {
  model: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<AgentReplyResult> {
  return streamAgentReply({
    ...request,
    tools: [],
    onText: () => undefined,
  });
}

export type ClaudeAccess = {
  provider: 'anthropic';
  model: string;
  /** How Claude authenticates, e.g. `subscription login (Claude Pro)`; never the account itself. */
  credentials: string;
};

/**
 * Checks at startup that the model is registered and Claude has credentials, without a model
 * call: it starts Claude Code, reads the account and stops again. A key that exists but is invalid
 * only shows on the first run, which then fails with `GatewayConfigError`.
 */
export async function checkClaudeAccess(modelId: string): Promise<ClaudeAccess> {
  const model = resolveModel(modelId);
  const abortController = new AbortController();
  // Streaming input that never sends a message: Claude Code starts, but the model is not called.
  const stopped = new Promise<void>((resolve) => {
    abortController.signal.addEventListener('abort', () => {
      resolve();
    });
  });
  async function* noMessages(): AsyncGenerator<SDKUserMessage> {
    await stopped;
    yield* [];
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const session = query({
    prompt: noMessages(),
    options: {
      model: model.id,
      abortController,
      tools: [],
      strictMcpConfig: true,
      permissionMode: 'dontAsk',
      settingSources: [],
      settings: ISOLATION_SETTINGS,
      persistSession: false,
      cwd: await emptyWorkingDirectory(),
    },
  });
  try {
    const account = await Promise.race([
      session.accountInfo(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`no answer within ${String(ACCESS_CHECK_TIMEOUT_MS / 1000)} s`));
        }, ACCESS_CHECK_TIMEOUT_MS);
      }),
    ]);
    const credentials = credentialsOf(account);
    if (!credentials) {
      throw new GatewayConfigError(
        'Claude has no credentials: log in to Claude Code with the subscription (run `claude`, then `/login`) or set ANTHROPIC_API_KEY.',
      );
    }
    return { provider: model.provider, model: model.id, credentials };
  } catch (error) {
    if (error instanceof GatewayConfigError) throw error;
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new GatewayConfigError(`Claude Code could not start: ${reason}`);
  } finally {
    clearTimeout(timer);
    abortController.abort();
    session.close();
  }
}

function credentialsOf(account: AccountInfo): string | undefined {
  if (account.apiProvider && account.apiProvider !== 'firstParty') {
    return `external provider (${account.apiProvider})`;
  }
  if (account.apiKeySource && account.apiKeySource !== 'none') {
    return `API key (${account.apiKeySource})`;
  }
  if (account.subscriptionType) return `subscription login (${account.subscriptionType})`;
  if (account.email) return 'Claude login';
  return undefined;
}

async function isolatedOptions(
  request: AgentReplyRequest,
  model: ModelInfo,
  abortController: AbortController,
): Promise<Options> {
  const tools = createSdkMcpServer({
    name: TOOL_SERVER,
    tools: request.tools.map(toSdkTool),
    // Tool search is one of the built-in tools that are off, so a deferred tool could never load.
    alwaysLoad: true,
    timeout: TOOL_TIMEOUT_MS,
  });
  return {
    model: model.id,
    systemPrompt: request.system,
    ...(model.effort ? { effort: 'medium' as const } : {}),
    maxTurns: MAX_TURNS,
    includePartialMessages: true,
    abortController,
    tools: [],
    mcpServers: { [TOOL_SERVER]: tools },
    strictMcpConfig: true,
    allowedTools: request.tools.map((definition) => `mcp__${TOOL_SERVER}__${definition.name}`),
    // Everything not allowed above is denied, and nobody is ever asked.
    permissionMode: 'dontAsk',
    permissionPrompts: 'none',
    settingSources: [],
    settings: ISOLATION_SETTINGS,
    skills: [],
    // The prompt carries chat text, which is data: no `@file` expansion, no slash commands.
    verbatimPrompts: true,
    persistSession: false,
    cwd: await emptyWorkingDirectory(),
  };
}

function toSdkTool(definition: AgentTool) {
  return tool(
    definition.name,
    definition.description,
    definition.input,
    async (input): Promise<CallToolResult> => {
      try {
        return { content: [{ type: 'text', text: await definition.run(input) }] };
      } catch (error) {
        // The model learns what went wrong and can correct the call or tell the team.
        const reason = error instanceof Error ? error.message : 'unknown error';
        return { content: [{ type: 'text', text: `The tool failed: ${reason}` }], isError: true };
      }
    },
  );
}

/** A folder without project files, so no CLAUDE.md or `.mcp.json` is anywhere near the model. */
async function emptyWorkingDirectory(): Promise<string> {
  const directory = join(tmpdir(), 'covibes-agent');
  await mkdir(directory, { recursive: true });
  return directory;
}

type QuotaLimit = { resetsAt: Date | null };

/** `resetsAt` of a rate limit event, in seconds or milliseconds since 1970. */
function resetDate(resetsAt: number | undefined): Date | null {
  if (resetsAt === undefined || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  return new Date(resetsAt < 1e12 ? resetsAt * 1000 : resetsAt);
}

function failure(
  detail: string,
  signals: { configError?: SDKAssistantMessageError | undefined; limit?: QuotaLimit | undefined },
): Error {
  if (signals.limit) {
    return new GatewayLimitError(`Claude quota used up: ${detail}`, signals.limit.resetsAt);
  }
  return signals.configError
    ? new GatewayConfigError(`Claude is not usable (${signals.configError}): ${detail}`)
    : new Error(`Claude run failed: ${detail}`);
}

/** Tokens of all model calls of the run; `usage` alone only covers the main loop. */
function usageOf(result: SDKResultMessage): AgentReplyUsage {
  const models = Object.values(result.modelUsage);
  if (models.length === 0) {
    return {
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      cacheReadTokens: result.usage.cache_read_input_tokens,
      cacheWriteTokens: result.usage.cache_creation_input_tokens,
    };
  }
  return models.reduce<AgentReplyUsage>(
    (sum, entry) => ({
      inputTokens: sum.inputTokens + entry.inputTokens,
      outputTokens: sum.outputTokens + entry.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + entry.cacheReadInputTokens,
      cacheWriteTokens: sum.cacheWriteTokens + entry.cacheCreationInputTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
}

/** The SDK's cost when it knew the price of every model it called, else the registry's prices. */
function costOf(result: SDKResultMessage, usage: AgentReplyUsage, model: ModelInfo): number {
  const priced = Object.values(result.modelUsage).every((entry) => entry.costBasis !== 'unknown');
  return result.total_cost_usd > 0 && priced
    ? result.total_cost_usd
    : estimateCostUsd(model.prices, usage);
}
