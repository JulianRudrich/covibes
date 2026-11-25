import { z } from 'zod';

/**
 * The gateway's own interface (spec 07). Everything outside `ai-gateway/` talks to models only
 * through it (invariant 3), so the SDK behind it can change without touching agents or tasks.
 */

/** A tool an agent may call. The gateway exposes it to the model and runs `run` for each call. */
export type AgentTool = {
  /** Lowercase with underscores, e.g. `add_block`. */
  name: string;
  /** What the tool does and when to use it, written for the model. */
  description: string;
  /** Zod shape of the input; the model sees it as the tool's schema. */
  input: z.ZodRawShape;
  /** Runs the tool; the returned text goes back to the model as the tool result. */
  run: (input: Record<string, unknown>) => Promise<string>;
  /**
   * For a tool whose result can show the model an image (spec 20a): the gateway calls it instead
   * of `run`. The input is unchecked model output, so the tool validates it itself.
   */
  runWithImage?: (input: Record<string, unknown>) => Promise<ToolResult>;
};

/** A tool result with an optional image, as base64 with its media type. */
export type ToolResult = { text: string; image?: { mediaType: string; data: string } };

/**
 * Defines a tool with a typed `run`. The input is validated against the shape again before `run`
 * sees it, so a tool never works with unchecked model output.
 */
export function defineTool<Shape extends z.ZodRawShape>(tool: {
  name: string;
  description: string;
  input: Shape;
  run: (input: z.infer<z.ZodObject<Shape>>) => Promise<string>;
}): AgentTool {
  const schema = z.object(tool.input);
  return {
    ...tool,
    // Async, so invalid input rejects like every other failure of the tool.
    run: async (input) => {
      const parsed = schema.parse(input);
      return await tool.run(parsed);
    },
  };
}

export type BillingContext = { runId: string; purpose?: string };

export type CompleteRequest = {
  model: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  billing?: BillingContext;
  /** Conservative reservation; the SDK only provides a soft execution cap. */
  maxCostUsd?: number;
};

export type AgentReplyRequest = CompleteRequest & {
  /** Model id from the registry, e.g. `claude-opus-5-5`. */
  model: string;
  /** Stable instructions (agent prompt); kept first so prompt caching applies. */
  system: string;
  /** How much the model thinks, for models that take an effort level; medium by default. */
  effort?: 'low' | 'medium' | 'high';
  /** The conversation and context for this turn, as one text. */
  prompt: string;
  tools: readonly AgentTool[];
  /**
   * The run may search the web (spec 20b). The search is a capability of the gateway and not one
   * of the request's tools, so whichever search stands behind it can change.
   */
  webSearch?: boolean;
  /** Called with each piece of reply text as it arrives. */
  onText: (delta: string) => void;
  signal?: AbortSignal;
};

export type AgentReplyUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type AgentReplyResult = {
  /** The complete reply text (everything passed to `onText`). */
  text: string;
  provider: 'anthropic';
  model: string;
  usage: AgentReplyUsage;
  /** Cost of the whole turn in USD as reported or computed; an estimate, not a bill. */
  costUsd: number;
  /** How many web searches the run made. */
  webSearches: number;
};

/** Thrown for configuration problems (unknown model, no credentials); never retried. */
export class GatewayConfigError extends Error {
  override name = 'GatewayConfigError';
}

/**
 * The provider's quota is used up, e.g. the session limit of the Claude subscription. Retrying
 * within seconds does not help; `resetsAt` says when it is free again, if the provider tells.
 */
export class GatewayLimitError extends Error {
  override name = 'GatewayLimitError';
  readonly resetsAt: Date | null;

  constructor(message: string, resetsAt: Date | null) {
    super(message);
    this.resetsAt = resetsAt;
  }
}

/** Accounting metadata remains attached to the original error class for job retry decisions. */
export type GatewayAttemptUsage = Omit<AgentReplyResult, 'text'> & { complete: boolean };
const attemptUsage = new WeakMap<Error, GatewayAttemptUsage>();
export function withGatewayAttemptUsage(error: unknown, usage: GatewayAttemptUsage): Error {
  const failure = error instanceof Error ? error : new Error(String(error));
  attemptUsage.set(failure, usage);
  return failure;
}
export function readGatewayAttemptUsage(error: unknown): GatewayAttemptUsage | undefined {
  return error instanceof Error ? attemptUsage.get(error) : undefined;
}
