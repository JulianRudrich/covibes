import { tmpdir } from 'node:os';

import type {
  AccountInfo,
  ModelUsage,
  Options,
  Query,
  SDKMessage,
  SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { checkClaudeAccess, streamAgentReply } from '@server/ai-gateway/claude';
import {
  defineTool,
  GatewayConfigError,
  GatewayLimitError,
  type AgentReplyRequest,
  type AgentTool,
} from '@server/ai-gateway/types';

type QueryParams = { prompt: string | AsyncIterable<unknown>; options: Options };

const sdk = vi.hoisted(() => ({
  query: vi.fn<(params: QueryParams) => AsyncGenerator<SDKMessage> | Query>(),
}));

// The real SDK starts Claude Code; the tests never reach a model.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: sdk.query,
  tool: (name: string, description: string, inputSchema: unknown, handler: unknown) => ({
    name,
    description,
    inputSchema,
    handler,
  }),
  createSdkMcpServer: (options: { name: string }) => ({
    type: 'sdk',
    name: options.name,
    instance: options,
  }),
}));

const IDS = { uuid: '00000000-0000-4000-8000-000000000000', session_id: 'session' };

function streamEvent(event: unknown, parent: string | null = null): SDKMessage {
  return { type: 'stream_event', event, parent_tool_use_id: parent, ...IDS } as SDKMessage;
}

function textDelta(text: string, parent: string | null = null): SDKMessage {
  return streamEvent(
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    parent,
  );
}

function blockStart(type: 'text' | 'thinking' | 'tool_use'): SDKMessage {
  return streamEvent({ type: 'content_block_start', index: 0, content_block: { type } });
}

function modelUsage(tokens: Partial<ModelUsage>): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    ...tokens,
  };
}

function result(fields: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Done.',
    num_turns: 1,
    duration_ms: 10,
    duration_api_ms: 8,
    stop_reason: 'end_turn',
    total_cost_usd: 0.05,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    modelUsage: {
      'claude-opus-5-5': modelUsage({ inputTokens: 10, outputTokens: 5, costUSD: 0.05 }),
    },
    permission_denials: [],
    ...IDS,
    ...fields,
  } as unknown as SDKMessage;
}

/** Makes the next query yield these messages. */
function replyWith(...messages: SDKMessage[]) {
  sdk.query.mockImplementation(async function* () {
    await Promise.resolve();
    yield* messages;
  });
}

function passedOptions(): Options {
  const call = sdk.query.mock.calls[0];
  if (!call) throw new Error('query was not called');
  return call[0].options;
}

function toolHandler(options: Options, name: string) {
  const server = options.mcpServers?.covibes as unknown as {
    instance: { tools: SdkMcpToolDefinition[] };
  };
  const definition = server.instance.tools.find((entry) => entry.name === name);
  if (!definition) throw new Error(`tool ${name} is missing`);
  return definition.handler;
}

const runAddBlock = vi.fn((input: { title: string }) => Promise.resolve(`Added "${input.title}"`));
const addBlock: AgentTool = defineTool({
  name: 'add_block',
  description: 'Adds a block to the main board.',
  input: { title: z.string() },
  run: runAddBlock,
});

function request(fields: Partial<AgentReplyRequest> = {}): AgentReplyRequest {
  return {
    model: 'claude-opus-5-5',
    system: 'You are the moderator.',
    prompt: 'Olga: @Moderator draw a block "API"',
    tools: [addBlock],
    onText: vi.fn(),
    ...fields,
  };
}

beforeEach(() => {
  sdk.query.mockReset();
  runAddBlock.mockClear();
});

describe('streamAgentReply', () => {
  it('runs Claude isolated from Claude Code, with only the gateway tools allowed', async () => {
    replyWith(result());

    await streamAgentReply(request());

    const call = sdk.query.mock.calls[0]?.[0];
    expect(call?.prompt).toBe('Olga: @Moderator draw a block "API"');
    const options = passedOptions();
    expect(options).toMatchObject({
      model: 'claude-opus-5-5',
      systemPrompt: 'You are the moderator.',
      effort: 'medium',
      maxTurns: 6,
      includePartialMessages: true,
      tools: [],
      strictMcpConfig: true,
      allowedTools: ['mcp__covibes__add_block'],
      permissionMode: 'dontAsk',
      permissionPrompts: 'none',
      settingSources: [],
      skills: [],
      verbatimPrompts: true,
      persistSession: false,
      settings: {
        autoMemoryEnabled: false,
        disableAllHooks: true,
        disableClaudeAiConnectors: true,
        syncClaudeAiPlugins: false,
        syncClaudeAiSkills: false,
      },
    });
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['covibes']);
    expect(options.mcpServers?.covibes).toMatchObject({
      instance: { name: 'covibes', alwaysLoad: true, tools: [{ name: 'add_block' }] },
    });
    // Without `env` the SDK inherits the process environment: API key or local login.
    expect(options).not.toHaveProperty('env');
    expect(options.cwd?.startsWith(tmpdir())).toBe(true);
    expect(options.abortController).toBeInstanceOf(AbortController);
  });

  it('streams only the text of the main agent and returns all of it', async () => {
    replyWith(
      blockStart('thinking'),
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'The team wants a block.' },
      }),
      blockStart('text'),
      textDelta('I will'),
      textDelta(' draw it.'),
      textDelta('subagent text', 'toolu_1'),
      blockStart('tool_use'),
      streamEvent({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"title":"API"}' },
      }),
      blockStart('text'),
      textDelta('Done.'),
      result(),
    );
    const onText = vi.fn();

    const reply = await streamAgentReply(request({ onText }));

    expect(onText.mock.calls).toEqual([['I will'], [' draw it.'], ['\n\nDone.']]);
    expect(reply.text).toBe('I will draw it.\n\nDone.');
    expect(reply).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' });
  });

  it('sums the usage of all models and keeps the cost the SDK reports', async () => {
    replyWith(
      result({
        total_cost_usd: 0.42,
        modelUsage: {
          'claude-opus-5-5': modelUsage({
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 1000,
            cacheCreationInputTokens: 200,
          }),
          'claude-haiku-4-5': modelUsage({ inputTokens: 20, outputTokens: 4 }),
        },
      }),
    );

    const reply = await streamAgentReply(request());

    expect(reply.usage).toEqual({
      inputTokens: 120,
      outputTokens: 54,
      cacheReadTokens: 1000,
      cacheWriteTokens: 200,
    });
    expect(reply.costUsd).toBe(0.42);
  });

  it('computes the cost from the registry prices when the SDK reports none', async () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadInputTokens: 1_000_000,
      cacheCreationInputTokens: 200_000,
    };
    replyWith(result({ total_cost_usd: 0, modelUsage: { 'claude-opus-5-5': modelUsage(usage) } }));
    expect((await streamAgentReply(request())).costUsd).toBeCloseTo(7.2, 10);

    // A price the SDK only guessed does not count as reported.
    sdk.query.mockReset();
    replyWith(
      result({
        total_cost_usd: 99,
        modelUsage: { 'claude-opus-5-5': modelUsage({ ...usage, costBasis: 'unknown' }) },
      }),
    );
    expect((await streamAgentReply(request())).costUsd).toBeCloseTo(7.2, 10);
  });

  it('falls back to the main loop usage when there is no usage per model', async () => {
    replyWith(
      result({
        total_cost_usd: 0,
        modelUsage: {},
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    );

    const reply = await streamAgentReply(request());

    expect(reply.usage).toEqual({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(reply.costUsd).toBe(4);
  });

  it('throws on an error result', async () => {
    replyWith(
      result({
        subtype: 'error_max_turns',
        is_error: true,
        errors: ['Reached maximum number of turns (6)'],
      }),
    );
    const failed = streamAgentReply(request());
    await expect(failed).rejects.toThrow(
      'Claude run failed: error_max_turns: Reached maximum number of turns (6)',
    );
    await expect(failed).rejects.not.toBeInstanceOf(GatewayConfigError);

    sdk.query.mockReset();
    replyWith(result({ is_error: true, result: 'API Error: 529 overloaded' }));
    await expect(streamAgentReply(request())).rejects.toThrow('API Error: 529 overloaded');
  });

  it('throws a configuration error when the login or key does not work', async () => {
    replyWith(
      { type: 'assistant', error: 'authentication_failed', parent_tool_use_id: null } as SDKMessage,
      result({ is_error: true, result: 'Invalid API key · Please run /login' }),
    );

    const failed = streamAgentReply(request());

    await expect(failed).rejects.toBeInstanceOf(GatewayConfigError);
    await expect(failed).rejects.toThrow(/authentication_failed.*Invalid API key/);
  });

  describe('a used-up quota', () => {
    const SESSION_LIMIT = "You've hit your session limit · resets 10:30pm (Europe/Berlin)";

    function limitEvent(status: 'allowed' | 'allowed_warning' | 'rejected', resetsAt?: number) {
      return {
        type: 'rate_limit_event',
        rate_limit_info: { status, rateLimitType: 'five_hour', ...(resetsAt && { resetsAt }) },
        ...IDS,
      } as SDKMessage;
    }

    it('becomes a limit error with the time the subscription is free again', async () => {
      replyWith(
        limitEvent('rejected', 1_790_800_000),
        result({ is_error: true, result: SESSION_LIMIT }),
      );

      const failed = streamAgentReply(request());

      await expect(failed).rejects.toBeInstanceOf(GatewayLimitError);
      await expect(failed).rejects.toThrow(`Claude quota used up: success: ${SESSION_LIMIT}`);
      await expect(failed).rejects.toMatchObject({ resetsAt: new Date(1_790_800_000_000) });
    });

    it('is recognized when the SDK ends the run with a thrown error', async () => {
      sdk.query.mockImplementation(async function* () {
        await Promise.resolve();
        yield limitEvent('rejected', 1_790_800_000);
        yield result({ is_error: true, result: SESSION_LIMIT });
        throw new Error(`Claude Code returned an error result: ${SESSION_LIMIT}`);
      });

      await expect(streamAgentReply(request())).rejects.toMatchObject({
        name: 'GatewayLimitError',
        resetsAt: new Date(1_790_800_000_000),
      });
    });

    it('comes from a rate limit error of the model too, without a known reset', async () => {
      replyWith(
        { type: 'assistant', error: 'rate_limit', parent_tool_use_id: null } as SDKMessage,
        result({ is_error: true, result: 'API Error: 429 rate limited' }),
      );

      await expect(streamAgentReply(request())).rejects.toMatchObject({
        name: 'GatewayLimitError',
        resetsAt: null,
      });
    });

    it('does not matter while the run succeeds', async () => {
      replyWith(limitEvent('allowed_warning', 1_790_800_000), textDelta('Hallo'), result());

      await expect(streamAgentReply(request())).resolves.toMatchObject({ text: 'Hallo' });
    });
  });

  it('throws when the run ends without a result', async () => {
    replyWith(textDelta('Hello'));
    await expect(streamAgentReply(request())).rejects.toThrow('ended without a result');
  });

  it('rejects an unknown model before starting a run', async () => {
    await expect(streamAgentReply(request({ model: 'claude-opus-9' }))).rejects.toBeInstanceOf(
      GatewayConfigError,
    );
    expect(sdk.query).not.toHaveBeenCalled();
  });

  it('runs a tool for a tool call and returns its text to the model', async () => {
    replyWith(result());
    await streamAgentReply(request());

    const output = await toolHandler(passedOptions(), 'add_block')({ title: 'API' }, {});

    expect(runAddBlock).toHaveBeenCalledWith({ title: 'API' });
    expect(output).toEqual({ content: [{ type: 'text', text: 'Added "API"' }] });
  });

  it('returns a failing tool to the model as an error result', async () => {
    const broken: AgentTool = {
      ...addBlock,
      run: () => Promise.reject(new Error('The board is gone')),
    };
    replyWith(result());
    await streamAgentReply(request({ tools: [broken] }));

    const output = await toolHandler(passedOptions(), 'add_block')({ title: 'API' }, {});

    expect(output).toEqual({
      content: [{ type: 'text', text: 'The tool failed: The board is gone' }],
      isError: true,
    });
  });

  it('aborts the run when the signal fires', async () => {
    sdk.query.mockImplementation(async function* ({ options }) {
      yield textDelta('Hel');
      const signal = options.abortController?.signal;
      await new Promise<void>((resolve) => {
        if (!signal || signal.aborted) resolve();
        else
          signal.addEventListener('abort', () => {
            resolve();
          });
      });
      throw new Error('Claude Code process aborted by user');
    });
    const controller = new AbortController();

    const reply = streamAgentReply(
      request({
        signal: controller.signal,
        onText: () => {
          controller.abort();
        },
      }),
    );

    await expect(reply).rejects.toMatchObject({ name: 'AbortError' });
    expect(passedOptions().abortController?.signal.aborted).toBe(true);
  });

  it('does not start a run for a signal that has already fired', async () => {
    await expect(streamAgentReply(request({ signal: AbortSignal.abort() }))).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(sdk.query).not.toHaveBeenCalled();
  });
});

describe('checkClaudeAccess', () => {
  const close = vi.fn();

  /** Makes the next query a session that answers `accountInfo` like Claude Code. */
  function sessionWith(accountInfo: () => Promise<AccountInfo>) {
    sdk.query.mockImplementation(() => ({ accountInfo, close }) as unknown as Query);
  }

  beforeEach(() => {
    close.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the subscription login without calling the model', async () => {
    sessionWith(() =>
      Promise.resolve({ email: 'olga@example.com', subscriptionType: 'Claude Pro' }),
    );

    await expect(checkClaudeAccess('claude-opus-5-5')).resolves.toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      credentials: 'subscription login (Claude Pro)',
    });

    const call = sdk.query.mock.calls[0]?.[0];
    if (!call || typeof call.prompt === 'string') throw new Error('expected streaming input');
    // The input ends once the check is over, without a single message for the model.
    const messages: unknown[] = [];
    for await (const message of call.prompt) messages.push(message);
    expect(messages).toEqual([]);
    expect(call.options).toMatchObject({
      tools: [],
      strictMcpConfig: true,
      settingSources: [],
      persistSession: false,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports an API key', async () => {
    sessionWith(() =>
      Promise.resolve({
        tokenSource: 'none',
        apiKeySource: 'ANTHROPIC_API_KEY',
        apiProvider: 'firstParty',
      }),
    );

    await expect(checkClaudeAccess('claude-opus-5-5')).resolves.toMatchObject({
      credentials: 'API key (ANTHROPIC_API_KEY)',
    });
  });

  it('throws a configuration error without login and key', async () => {
    sessionWith(() => Promise.resolve({ tokenSource: 'none', apiProvider: 'firstParty' }));

    const check = checkClaudeAccess('claude-opus-5-5');
    await expect(check).rejects.toBeInstanceOf(GatewayConfigError);
    await expect(check).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(close).toHaveBeenCalledOnce();
  });

  it('throws a configuration error when Claude Code does not start', async () => {
    sessionWith(() => Promise.reject(new Error('spawn claude ENOENT')));

    const check = checkClaudeAccess('claude-opus-5-5');
    await expect(check).rejects.toBeInstanceOf(GatewayConfigError);
    await expect(check).rejects.toThrow(/could not start: spawn claude ENOENT/);
  });

  it('gives up when Claude Code does not answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    sessionWith(() => new Promise<AccountInfo>(() => undefined));

    const check = checkClaudeAccess('claude-opus-5-5');
    const failed = expect(check).rejects.toThrow(/no answer within 30 s/);
    await vi.waitFor(() => {
      expect(sdk.query).toHaveBeenCalled();
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects an unknown model before starting Claude Code', async () => {
    await expect(checkClaudeAccess('gpt-unknown')).rejects.toBeInstanceOf(GatewayConfigError);
    expect(sdk.query).not.toHaveBeenCalled();
  });
});
