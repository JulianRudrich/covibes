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

function snapshot(round: DirectRound, output: JsonObject[]) {
  round.output = output;
  round.searches = output.filter(
    (item) => item.type === 'web_search_call' && item.status === 'completed',
  ).length;
  for (const item of output) {
    if (item.type !== 'function_call') continue;
    let input: unknown;
    try {
      input = decodeJson(z.string().parse(item.arguments));
    } catch {
      input = null; // Send an invalid-arguments result so the model can correct the call.
    }
    round.calls.push({
      id: z.string().parse(item.call_id),
      name: z.string().parse(item.name),
      input,
    });
  }
  round.more = round.calls.length > 0;
}

// https://developers.openai.com/api/docs/guides/function-calling
export const openaiResponses: DirectProtocol = {
  url: 'https://api.openai.com/v1/responses',
  headers: (apiKey) => ({ authorization: 'Bearer ' + apiKey }),
  tokenField: 'max_output_tokens',
  payload(request, history) {
    const tools: JsonObject[] = request.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: toolSchema(tool),
      strict: false,
    }));
    if (request.webSearch) tools.push({ type: 'web_search', search_context_size: 'low' });
    return {
      model: request.model,
      instructions: request.system,
      input: history,
      store: false,
      stream: true,
      tools,
      ...(request.webSearch ? { max_tool_calls: 1 } : {}),
    };
  },
  receive(event, round, emit) {
    switch (event.type) {
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        emit(z.string().parse(event.delta));
        break;
      case 'response.output_text.annotation.added': {
        const annotation = object.parse(event.annotation);
        if (
          annotation.type === 'url_citation' &&
          typeof annotation.url === 'string' &&
          /^https?:\/\//i.test(annotation.url)
        )
          emit(' ' + annotation.url);
        break;
      }
      case 'response.output_item.done': {
        const item = object.parse(event.item);
        if (item.type === 'web_search_call' && item.status === 'completed') round.searches++;
        break;
      }
      case 'response.completed':
      case 'response.incomplete':
      case 'response.failed': {
        const response = object.parse(event.response);
        snapshot(round, z.array(object).parse(response.output));
        if (response.usage) {
          const usage = object.parse(response.usage);
          const cached = count.parse(
            object.optional().parse(usage.input_tokens_details)?.cached_tokens ?? 0,
          );
          round.usage.inputTokens = count.parse(count.parse(usage.input_tokens) - cached);
          round.usage.cacheReadTokens = cached;
          round.usage.outputTokens = count.parse(usage.output_tokens);
          round.accounted = true;
        }
        if (event.type !== 'response.completed')
          throw new Error('The OpenAI response did not complete');
        round.done = true;
        break;
      }
      case 'error':
        throw new Error('The OpenAI stream failed');
    }
  },
  nextInput(round, results) {
    return [
      ...round.output,
      ...results.map((result, i) => ({
        type: 'function_call_output',
        call_id: round.calls[i]?.id,
        output: result.image
          ? [
              { type: 'input_text', text: result.text },
              {
                type: 'input_image',
                image_url: 'data:' + result.image.mediaType + ';base64,' + result.image.data,
                detail: 'auto',
              },
            ]
          : result.text,
      })),
    ];
  },
};
