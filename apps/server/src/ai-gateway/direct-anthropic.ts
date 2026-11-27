import { z } from 'zod';

import {
  count,
  decodeJson,
  object,
  toolSchema,
  type DirectProtocol,
  type DirectRound,
  type JsonObject,
} from '@server/ai-gateway/direct-protocol';

function updateUsage(round: DirectRound, report: unknown) {
  const usage = object.parse(report);
  if (usage.input_tokens !== undefined) round.usage.inputTokens = count.parse(usage.input_tokens);
  if (usage.output_tokens !== undefined)
    round.usage.outputTokens = count.parse(usage.output_tokens);
  if (usage.cache_read_input_tokens !== undefined)
    round.usage.cacheReadTokens = count.parse(usage.cache_read_input_tokens);
  if (usage.cache_creation_input_tokens !== undefined)
    round.usage.cacheWriteTokens = count.parse(usage.cache_creation_input_tokens);
  const server = object.optional().parse(usage.server_tool_use);
  if (server?.web_search_requests !== undefined)
    round.searches = count.parse(server.web_search_requests);
}

function applyDelta(
  content: JsonObject,
  value: unknown,
  emit: (text: string, newBlock?: boolean) => void,
) {
  const delta = object.parse(value);
  switch (delta.type) {
    case 'text_delta': {
      const text = z.string().parse(delta.text);
      emit(text, !content.text);
      content.text = z.string().default('').parse(content.text) + text;
      break;
    }
    case 'input_json_delta':
      content.partialJson =
        z.string().default('').parse(content.partialJson) + z.string().parse(delta.partial_json);
      break;
    case 'thinking_delta':
      content.thinking =
        z.string().default('').parse(content.thinking) + z.string().parse(delta.thinking);
      break;
    case 'signature_delta':
      content.signature = z.string().parse(delta.signature);
      break;
    case 'citations_delta': {
      const citation = object.parse(delta.citation);
      content.citations = [...z.array(z.unknown()).default([]).parse(content.citations), citation];
      if (typeof citation.url === 'string' && /^https?:\/\//i.test(citation.url))
        emit(' ' + citation.url);
      break;
    }
  }
}

// https://platform.claude.com/docs/en/build-with-claude/streaming
export const anthropicMessages: DirectProtocol = {
  url: 'https://api.anthropic.com/v1/messages',
  headers: (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
  tokenField: 'max_tokens',
  payload(request, history) {
    const tools: JsonObject[] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: toolSchema(tool),
    }));
    if (request.webSearch)
      tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 1 });
    return {
      model: request.model,
      system: request.system,
      messages: history,
      stream: true,
      tools,
      ...(request.effort && !request.model.includes('haiku')
        ? { output_config: { effort: request.effort } }
        : {}),
    };
  },
  receive(event, round, emit) {
    switch (event.type) {
      case 'message_start': {
        const usage = object.parse(object.parse(event.message).usage);
        count.parse(usage.input_tokens);
        updateUsage(round, usage);
        break;
      }
      case 'content_block_start':
        round.output[count.parse(event.index)] = object.parse(event.content_block);
        break;
      case 'content_block_delta':
      case 'content_block_stop': {
        const block = round.output[count.parse(event.index)];
        if (!block) throw new Error('Invalid provider stream');
        if (event.type === 'content_block_delta') {
          applyDelta(block, event.delta, emit);
        } else {
          if (typeof block.partialJson === 'string' && block.partialJson)
            block.input = decodeJson(block.partialJson);
          delete block.partialJson;
          if (block.type === 'tool_use')
            round.calls.push({
              id: z.string().parse(block.id),
              name: z.string().parse(block.name),
              input: block.input,
            });
        }
        break;
      }
      case 'message_delta': {
        const usage = object.parse(event.usage);
        count.parse(usage.output_tokens);
        updateUsage(round, usage);
        const reason = object.parse(event.delta).stop_reason;
        if (!reason) break;
        round.accounted = true;
        round.more = reason === 'tool_use' || reason === 'pause_turn';
        if (reason === 'max_tokens' || reason === 'model_context_window_exceeded')
          throw new Error('The provider reached the token limit');
        break;
      }
      case 'message_stop':
        round.done = true;
        break;
      case 'error':
        throw new Error('The Anthropic stream failed');
    }
  },
  nextInput(round, results) {
    const messages: JsonObject[] = [{ role: 'assistant', content: round.output }];
    if (results.length)
      messages.push({
        role: 'user',
        content: results.map((result, i) => ({
          type: 'tool_result',
          tool_use_id: round.calls[i]?.id,
          ...(result.failed ? { is_error: true } : {}),
          content: result.image
            ? [
                { type: 'text', text: result.text },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: result.image.mediaType,
                    data: result.image.data,
                  },
                },
              ]
            : result.text,
        })),
      });
    return messages;
  },
};
