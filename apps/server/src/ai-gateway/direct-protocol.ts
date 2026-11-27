import type { ReadableStreamDefaultReader } from 'node:stream/web';

import { z } from 'zod';

import type {
  AgentReplyRequest,
  AgentReplyUsage,
  AgentTool,
  ToolResult,
} from '@server/ai-gateway/types';

export type JsonObject = Record<string, unknown>;
export const object = z.record(z.string(), z.unknown());
export const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export type ToolCall = { id: string; name: string; input: unknown };
export type ToolOutput = ToolResult & { failed?: boolean };

export function toolSchema(tool: AgentTool) {
  return z.toJSONSchema(z.object(tool.input), { io: 'input', target: 'draft-7' });
}

export type DirectRound = {
  usage: AgentReplyUsage;
  searches: number;
  /** A terminal packet with final usage is required to release the outstanding reservation. */
  accounted: boolean;
  done: boolean;
  more: boolean;
  calls: ToolCall[];
  output: JsonObject[];
};

export const emptyUsage = (): AgentReplyUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export type DirectProtocol = {
  url: string;
  headers: (apiKey: string) => Record<string, string>;
  payload: (request: AgentReplyRequest, history: JsonObject[]) => JsonObject;
  tokenField: string;
  receive: (
    data: JsonObject,
    round: DirectRound,
    emit: (text: string, newBlock?: boolean) => void,
  ) => void;
  nextInput: (round: DirectRound, results: ToolOutput[]) => JsonObject[];
};

export function decodeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // JSON.parse can include private input in the exception message.
    throw new Error('Invalid provider JSON');
  }
}

/** SSE uses blank lines to delimit events. Fetch chunks can split both delimiters and UTF-8. */
export async function* readEvents(response: Response) {
  if (!response.body) throw new Error('The provider returned no stream');
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const entry = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = entry
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data && data !== '[DONE]') yield object.parse(decodeJson(data));
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
