import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createDirectGateway } from '@server/ai-gateway/direct';
import {
  GatewayConfigError,
  GatewayLimitError,
  readGatewayAttemptUsage,
  type AgentReplyRequest,
} from '@server/ai-gateway/types';

// Split the CRLF-delimited SSE stream mid-field and inside a multibyte character.
function events(...values: unknown[]) {
  const bytes = new TextEncoder().encode(
    ': keepalive\r\n\r\n' +
      values.map((value) => 'data: ' + JSON.stringify(value) + '\r\n\r\n').join(''),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

const anthropicModel = 'claude-haiku-4-5-20251001';
const openaiModel = 'gpt-4.1';
function request(model = anthropicModel): AgentReplyRequest {
  return {
    model,
    system: 'Guide',
    prompt: 'Look at the plan.',
    tools: [],
    onText: vi.fn(),
    maxCostUsd: 1,
  };
}

const start = {
  type: 'message_start',
  message: {
    usage: {
      input_tokens: 10,
      output_tokens: 1,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 3,
    },
  },
};
const block = (content: unknown) => ({
  type: 'content_block_start',
  index: 0,
  content_block: content,
});
const delta = (value: unknown) => ({ type: 'content_block_delta', index: 0, delta: value });
const endBlock = { type: 'content_block_stop', index: 0 };
const stop = { type: 'message_stop' };
const finalUsage = (reason: string, web = 0) => ({
  type: 'message_delta',
  delta: { stop_reason: reason },
  usage: { output_tokens: 8, server_tool_use: { web_search_requests: web } },
});
const textReply = () =>
  events(
    start,
    block({ type: 'text', text: '' }),
    delta({ type: 'text_delta', text: 'Grüße' }),
    endBlock,
    finalUsage('end_turn'),
    stop,
  );
const call = {
  type: 'function_call',
  name: 'look',
  arguments: '{"id":"board"}',
  call_id: 'call1',
  id: 'fc_1',
};
const completed = (output: unknown[]) => ({
  type: 'response.completed',
  response: {
    status: 'completed',
    output,
    usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 40 } },
  },
});

function body(mock: ReturnType<typeof vi.fn<typeof fetch>>, n: number): Record<string, unknown> {
  const value = mock.mock.calls[n]?.[1]?.body;
  if (typeof value !== 'string') throw new Error('Expected a JSON request body');
  return JSON.parse(value) as Record<string, unknown>;
}

describe('direct provider streaming', () => {
  it('uses only the Anthropic endpoint, streams UTF-8 and totals each Messages round once', async () => {
    const network = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        events(
          start,
          block({ type: 'tool_use', id: 't1', name: 'look', input: {} }),
          delta({ type: 'input_json_delta', partial_json: '{"id":' }),
          delta({ type: 'input_json_delta', partial_json: '"board"}' }),
          endBlock,
          finalUsage('tool_use', 1),
          stop,
        ),
      )
      .mockResolvedValueOnce(textReply());
    const read = vi.fn(() =>
      Promise.resolve({ text: 'Board', image: { mediaType: 'image/png', data: 'AQI=' } }),
    );
    const req = request();
    const result = await createDirectGateway('anthropic', 'test-secret', network).reply({
      ...req,
      webSearch: true,
      tools: [
        {
          name: 'look',
          description: 'Read a board',
          input: { id: z.string() },
          run: vi.fn(),
          runWithImage: read,
        },
      ],
    });
    expect(network.mock.calls[0]?.[0]).toBe('https://api.anthropic.com/v1/messages');
    expect(new Headers(network.mock.calls[0]?.[1]?.headers).get('x-api-key')).toBe('test-secret');
    expect(network.mock.calls[0]?.[1]?.redirect).toBe('error');
    expect(body(network, 0)).toMatchObject({
      model: anthropicModel,
      system: 'Guide',
      stream: true,
    });
    const anthropicTools = z.array(z.record(z.string(), z.unknown())).parse(body(network, 0).tools);
    expect(anthropicTools).toContainEqual({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 1,
    });
    const lookTool = anthropicTools.find((tool) => tool.name === 'look');
    expect(lookTool?.input_schema).toHaveProperty('type', 'object');
    expect(read).toHaveBeenCalledExactlyOnceWith({ id: 'board' });
    expect(JSON.stringify(body(network, 1))).toContain('"media_type":"image/png"');
    expect(req.onText).toHaveBeenCalledExactlyOnceWith('Grüße');
    expect(result).toMatchObject({
      text: 'Grüße',
      provider: 'anthropic',
      model: anthropicModel,
      webSearches: 1,
      usage: { inputTokens: 20, outputTokens: 16, cacheReadTokens: 4, cacheWriteTokens: 6 },
    });
    expect(result.costUsd).toBeCloseTo(0.01 + (20 + 16 * 5 + 4 * 0.1 + 6 * 1.25) / 1e6, 9);
  });

  it('replays function outputs without provider-side storage and separates OpenAI cached usage', async () => {
    const network = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(events(completed([call])))
      .mockResolvedValueOnce(
        events(
          { type: 'response.output_text.delta', delta: 'Hallo' },
          completed([
            {
              type: 'web_search_call',
              id: 'ws_1',
              status: 'completed',
              action: { type: 'search', query: 'docs' },
            },
          ]),
        ),
      );
    const run = vi.fn(() => Promise.resolve('Found it.'));
    const req = request(openaiModel);
    const result = await createDirectGateway('openai', 'test-secret', network).reply({
      ...req,
      webSearch: true,
      tools: [{ name: 'look', description: 'Read', input: { id: z.string() }, run }],
    });
    expect(network.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/responses');
    expect(new Headers(network.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer test-secret',
    );
    expect(body(network, 0)).toMatchObject({
      model: openaiModel,
      stream: true,
      store: false,
      instructions: 'Guide',
    });
    const openaiTools = z.array(z.record(z.string(), z.unknown())).parse(body(network, 0).tools);
    expect(openaiTools.some((tool) => tool.type === 'web_search')).toBe(true);
    expect(
      openaiTools.some(
        (tool) => tool.type === 'function' && tool.name === 'look' && tool.strict === false,
      ),
    ).toBe(true);
    expect(body(network, 1).input).toEqual(
      expect.arrayContaining([
        call,
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call1',
          output: 'Found it.',
        }),
      ]),
    );
    expect(run).toHaveBeenCalledExactlyOnceWith({ id: 'board' });
    expect(req.onText).toHaveBeenCalledExactlyOnceWith('Hallo');
    expect(result).toMatchObject({
      text: 'Hallo',
      provider: 'openai',
      webSearches: 1,
      usage: { inputTokens: 120, cacheReadTokens: 80, cacheWriteTokens: 0, outputTokens: 20 },
    });
    expect(result.costUsd).toBeGreaterThan(0.01);
  });

  it('does not expose tools or web search in a short completion', async () => {
    const network = vi.fn<typeof fetch>().mockResolvedValueOnce(textReply());
    const result = await createDirectGateway('anthropic', 'key', network).complete(request());
    expect(result.text).toBe('Grüße');
    expect(body(network, 0).tools ?? []).toEqual([]);
  });

  it('refuses unknown tools and malformed arguments without invoking a local tool', async () => {
    const network = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        events(
          completed([
            { ...call, name: 'run_shell' },
            { ...call, call_id: 'call2', arguments: '{"id":123}' },
          ]),
        ),
      )
      .mockResolvedValueOnce(events(completed([])));
    const run = vi.fn();
    await createDirectGateway('openai', 'key', network).reply({
      ...request(openaiModel),
      tools: [{ name: 'look', description: 'Read', input: { id: z.string() }, run }],
    });
    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify(body(network, 1))).toContain('function_call_output');
  });

  it.each([
    [401, GatewayConfigError],
    [429, GatewayLimitError],
  ] as const)(
    'reports rejected requests (%s) as known zero and discards the raw error',
    async (status, kind) => {
      const network = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('test-secret', { status, headers: { 'retry-after': '60' } }),
        );
      const error: unknown = await createDirectGateway('anthropic', 'test-secret', network)
        .complete(request())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(kind);
      expect(String(error)).not.toContain('test-secret');
      expect(readGatewayAttemptUsage(error)).toMatchObject({ complete: true, costUsd: 0 });
    },
  );

  it('retains partial metrics on a disconnected stream, including prior complete rounds', async () => {
    const network = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(events(start, finalUsage('pause_turn'), stop))
      .mockResolvedValueOnce(events(start));
    const error: unknown = await createDirectGateway('anthropic', 'key', network)
      .complete(request())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(readGatewayAttemptUsage(error)).toMatchObject({
      complete: false,
      usage: { inputTokens: 20, outputTokens: 9 },
    });
  });

  it('keeps an unconfirmed provider request uncertain on a transport failure', async () => {
    const network = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('test-secret'));
    const error: unknown = await createDirectGateway('openai', 'test-secret', network)
      .complete(request(openaiModel))
      .catch((e: unknown) => e);
    expect(String(error)).not.toContain('test-secret');
    expect(readGatewayAttemptUsage(error)).toMatchObject({ complete: false, costUsd: 0 });
  });

  it('checks the bound, the model/provider match and cancellation before any HTTP request', async () => {
    const network = vi.fn<typeof fetch>();
    const provider = createDirectGateway('anthropic', 'key', network);
    await expect(provider.complete({ ...request(), maxCostUsd: 0.0000001 })).rejects.toThrow();
    await expect(provider.complete(request(openaiModel))).rejects.toBeInstanceOf(
      GatewayConfigError,
    );
    await expect(
      provider.complete({ ...request(), signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
});
