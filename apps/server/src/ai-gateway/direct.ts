import { z } from 'zod';

import { anthropicMessages } from '@server/ai-gateway/direct-anthropic';
import { openaiResponses } from '@server/ai-gateway/direct-openai';
import {
  emptyUsage,
  readEvents,
  type DirectRound,
  type JsonObject,
  type ToolCall,
  type ToolOutput,
} from '@server/ai-gateway/direct-protocol';
import { estimateCostUsd, resolveModel, type ModelInfo } from '@server/ai-gateway/registry';
import {
  GatewayConfigError,
  GatewayLimitError,
  withGatewayAttemptUsage,
  type AgentReplyRequest,
  type AgentReplyResult,
  type AgentTool,
  type CompleteRequest,
} from '@server/ai-gateway/types';

const MAX_ROUNDS = 16;
const MAX_TOOL_CALLS = 128;
const MAX_OUTPUT_TOKENS = 8192;
const SEARCH_FEE_USD = 0.01;

function totals(rounds: DirectRound[], model: ModelInfo) {
  const usage = emptyUsage();
  let webSearches = 0;
  for (const round of rounds) {
    usage.inputTokens += round.usage.inputTokens;
    usage.outputTokens += round.usage.outputTokens;
    usage.cacheReadTokens += round.usage.cacheReadTokens;
    usage.cacheWriteTokens += round.usage.cacheWriteTokens;
    webSearches += round.searches;
  }
  // OpenAI prices retrieved content on 4.1 mini as a separate fixed input block.
  const searchCost =
    SEARCH_FEE_USD + (model.id === 'gpt-4.1-mini' ? (8000 * model.prices.input) / 1e6 : 0);
  return {
    usage,
    webSearches,
    costUsd: estimateCostUsd(model.prices, usage) + webSearches * searchCost,
  };
}

function outputAllowance(
  payload: JsonObject,
  model: ModelInfo,
  remainingUsd: number,
  webSearch: boolean,
) {
  // Size the output allowance before sending context again. UTF-8 bytes conservatively cover
  // local text and base64 image inputs. Hosted searches insert extra provider-generated context.
  const inputTokens =
    Buffer.byteLength(JSON.stringify(payload), 'utf8') + 512 + (webSearch ? 32_000 : 0);
  const inputUsd = (inputTokens * model.prices.input) / 1e6 + (webSearch ? SEARCH_FEE_USD : 0);
  const tokens = Math.floor(((remainingUsd - inputUsd) * 1e6) / model.prices.output);
  if (Number.isNaN(tokens) || tokens < 16)
    throw new GatewayConfigError('Insufficient AI call budget for another provider request');
  return Math.min(tokens, MAX_OUTPUT_TOKENS);
}

function retryAt(value: string | null) {
  if (!value) return null;
  const at = /^\d+$/.test(value) ? Date.now() + Number(value) * 1000 : Date.parse(value);
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? date : null;
}

function httpFailure(response: Response) {
  if (response.status === 429)
    return new GatewayLimitError(
      'AI provider rate or quota limit reached',
      retryAt(response.headers.get('retry-after')),
    );
  if ([400, 401, 402, 403, 404, 413, 422].includes(response.status))
    return new GatewayConfigError(
      'AI provider rejected the request (HTTP ' + String(response.status) + ')',
    );
  return new Error('AI provider request failed (HTTP ' + String(response.status) + ')');
}

async function invokeTool(call: ToolCall, tools: readonly AgentTool[]): Promise<ToolOutput> {
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool) return { text: 'This tool is unavailable.', failed: true };
  const input = z.object(tool.input).safeParse(call.input);
  if (!input.success)
    return { text: 'Invalid tool arguments. Check the tool schema.', failed: true };
  try {
    return tool.runWithImage
      ? await tool.runWithImage(input.data)
      : { text: await tool.run(input.data) };
  } catch {
    return { text: 'The tool could not complete.', failed: true };
  }
}

export function createDirectGateway(
  provider: 'anthropic' | 'openai',
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
) {
  const protocol = provider === 'anthropic' ? anthropicMessages : openaiResponses;
  async function reply(request: AgentReplyRequest): Promise<AgentReplyResult> {
    const model = resolveModel(request.model);
    const rounds: DirectRound[] = [];
    const history: JsonObject[] = [{ role: 'user', content: request.prompt }];
    const usedCallIds = new Set<string>();
    let text = '';
    let awaitingUsage = false;
    try {
      if (model.provider !== provider || !apiKey.trim())
        throw new GatewayConfigError('Invalid provider or missing API key');
      for (let turn = 0; turn < MAX_ROUNDS; turn++) {
        request.signal?.throwIfAborted();
        const payload = protocol.payload(request, history);
        const remaining = (request.maxCostUsd ?? 1) - totals(rounds, model).costUsd;
        payload[protocol.tokenField] = outputAllowance(
          payload,
          model,
          remaining,
          request.webSearch === true,
        );
        const round: DirectRound = {
          usage: emptyUsage(),
          searches: 0,
          accounted: false,
          done: false,
          more: false,
          calls: [],
          output: [],
        };
        rounds.push(round);
        const timeout = AbortSignal.timeout(5 * 60_000);
        const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
        awaitingUsage = true;
        let response: Response;
        try {
          response = await fetchImpl(protocol.url, {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: {
              ...protocol.headers(apiKey),
              'content-type': 'application/json',
              accept: 'text/event-stream',
            },
            body: JSON.stringify(payload),
          });
        } catch {
          signal.throwIfAborted();
          throw new Error('Could not reach AI provider');
        }
        if (!response.ok) {
          const error = httpFailure(response);
          awaitingUsage = !(
            error instanceof GatewayConfigError || error instanceof GatewayLimitError
          );
          await response.body?.cancel().catch(() => undefined);
          throw error;
        }
        let startOfRound = true;
        for await (const event of readEvents(response)) {
          signal.throwIfAborted();
          protocol.receive(event, round, (piece, newBlock) => {
            if (!piece) return;
            const delta = (newBlock || startOfRound) && text ? '\n\n' + piece : piece;
            text += delta;
            startOfRound = false;
            request.onText(delta);
          });
          if (round.done) break;
        }
        if (!round.done || !round.accounted) throw new Error('Incomplete AI provider stream');
        awaitingUsage = false;
        request.signal?.throwIfAborted();
        if (!round.more) return { text, model: model.id, provider, ...totals(rounds, model) };
        if (turn + 1 === MAX_ROUNDS || usedCallIds.size + round.calls.length > MAX_TOOL_CALLS)
          throw new GatewayConfigError('AI provider reached the turn or tool limit');
        if (totals(rounds, model).costUsd >= (request.maxCostUsd ?? 1))
          throw new GatewayConfigError('AI provider reached the call budget');
        const results: ToolOutput[] = [];
        for (const call of round.calls) {
          request.signal?.throwIfAborted();
          if (usedCallIds.has(call.id)) throw new Error('AI provider repeated a tool call');
          usedCallIds.add(call.id);
          results.push(await invokeTool(call, request.tools));
        }
        history.push(...protocol.nextInput(round, results));
      }
      throw new GatewayConfigError('AI provider reached the turn limit');
    } catch (error) {
      // Stream parsers can throw exceptions containing the response. Only our status
      // classifications and cancellation leave this adapter.
      const safe =
        error instanceof GatewayConfigError || error instanceof GatewayLimitError
          ? error
          : request.signal?.aborted
            ? new DOMException('AI request cancelled', 'AbortError')
            : new Error('AI provider request could not complete');
      throw withGatewayAttemptUsage(safe, {
        model: model.id,
        provider,
        ...totals(rounds, model),
        complete: !awaitingUsage || rounds.at(-1)?.accounted === true,
      });
    }
  }
  return {
    reply,
    complete: (request: CompleteRequest) =>
      reply({ ...request, tools: [], webSearch: false, onText: () => undefined }),
  };
}
