import type { DB } from '@covibes/db';
import {
  projectSettingsSchema,
  readEdges,
  readNodes,
  type CanvasEdge,
  type CanvasNode,
  type CanvasOperation,
  type ChatMessage,
  type AgentKey,
  type NodeLock,
} from '@covibes/shared';
import type { Task } from 'graphile-worker';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import { CATALOG, describeName, findAgent, type AgentDefinition } from '@server/agents/catalog';
import {
  GatewayConfigError,
  GatewayLimitError,
  type AgentReplyRequest,
  type AgentReplyResult,
  type AgentTool,
} from '@server/ai-gateway';
import { loadMessage, selectMessages, toMessage } from '@server/chat/rows';
import type { BoardAccess } from '@server/collab/board-client';
import { MAX_DELTA_LENGTH, notifyLive } from '@server/realtime/notifications';
import type { Intent } from '@server/rules/decide';
import { classifyIntent } from '@server/rules/intent';
import { describeOperations, loadOpenProposals, openRunProposal } from '@server/tasks/run-proposal';
import { loadTeam, teamWriter, type TeamContext } from '@server/tasks/run-team';
import { addAgentsTool } from '@server/tools/add-agents';
import { addBlockTool } from '@server/tools/add-block';
import { addFrameTool } from '@server/tools/add-frame';
import { addNoteTool } from '@server/tools/add-note';
import { arrangeFrameTool } from '@server/tools/arrange-frame';
import { connectBlocksTool } from '@server/tools/connect-blocks';
import { describePosition, type CanvasToolOptions } from '@server/tools/placement';
import { updateBlockTool } from '@server/tools/update-block';

/** The canvas tools by the names agent definitions use. */
const CANVAS_TOOLS: Readonly<Record<string, (options: CanvasToolOptions) => AgentTool>> = {
  add_block: addBlockTool,
  update_block: updateBlockTool,
  connect_blocks: connectBlocksTool,
  add_note: addNoteTool,
  add_frame: addFrameTool,
  arrange_frame: arrangeFrameTool,
};

/** Name of the job the database trigger creates for every mention (migration 0005). */
export const AGENT_TURN_TASK = 'agent_turn';

/** Messages of the conversation the agent sees (spec 07). */
const CONTEXT_MESSAGES = 30;
/** Streamed text reaches the chat in batches, about this often. */
const FLUSH_MS = 50;
/** Longest message content (database constraint). */
const MAX_CONTENT_LENGTH = 8000;
const MAX_ERROR_LENGTH = 1000;

const payloadSchema = z.object({ runId: z.uuid() });

export type Language = 'de' | 'en';

/** What the agent says itself when it wrote no text or could not answer. */
const NOTES: Record<Language, Record<'done' | 'retry' | 'failed' | 'unavailable', string>> = {
  de: {
    done: 'Erledigt.',
    retry: 'Ich konnte gerade nicht antworten und versuche es gleich noch einmal.',
    failed: 'Ich konnte leider nicht antworten. Bitte versuche es später noch einmal.',
    unavailable:
      'Ich kann gerade nicht antworten, weil der Zugang zur KI nicht eingerichtet ist. Bitte gib der Person Bescheid, die Covibes betreibt.',
  },
  en: {
    done: 'Done.',
    retry: "I couldn't answer just now and will try again in a moment.",
    failed: "Sorry, I couldn't answer. Please try again later.",
    unavailable:
      "I can't answer right now because the access to the AI is not set up. Please tell the person who runs Covibes.",
  },
};

/**
 * The note for a used-up quota. It names a duration instead of a time of day, because the text
 * is stored once and read in any time zone.
 */
export function quotaNote(language: Language, resetsAt: Date | null, now: Date): string {
  const minutes = resetsAt
    ? Math.max(1, Math.ceil((resetsAt.getTime() - now.getTime()) / 60_000))
    : 0;
  if (language === 'en') {
    if (!resetsAt) return 'The AI quota is used up right now. Please mention me again later.';
    const wait =
      minutes < 90
        ? `${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}`
        : `${String(Math.round(minutes / 60))} hours`;
    return `The AI quota is used up right now and will be free again in about ${wait}. Please mention me again then.`;
  }
  if (!resetsAt)
    return 'Das KI-Kontingent ist gerade aufgebraucht. Erwähne mich bitte später noch einmal.';
  const wait =
    minutes < 90
      ? `${String(minutes)} ${minutes === 1 ? 'Minute' : 'Minuten'}`
      : `${String(Math.round(minutes / 60))} Stunden`;
  return `Das KI-Kontingent ist gerade aufgebraucht und in etwa ${wait} wieder frei. Erwähne mich dann bitte noch einmal.`;
}

export type AgentTurnDeps = {
  /** Role covibes_admin: agent messages and runs are written by the worker only. */
  admin: Kysely<DB>;
  boards: BoardAccess;
  /** The gateway's `streamAgentReply`; tests pass a scripted model. */
  reply: (request: AgentReplyRequest) => Promise<AgentReplyResult>;
  /** The gateway's `completeText`, for the intent of the triggering message (spec 13). */
  complete: (request: {
    model: string;
    system: string;
    prompt: string;
    signal?: AbortSignal;
  }) => Promise<AgentReplyResult>;
  logger: { error: (message: string) => void };
  flushMs?: number;
};

export type AgentTurnAttempt = {
  /** Number of this attempt, starting at 1. */
  attempt: number;
  maxAttempts: number;
  /** Fires when the worker shuts down; the run then fails and is retried later. */
  signal?: AbortSignal;
};

type Run = {
  id: string;
  projectId: string;
  triggerMessageId: string | null;
  replyMessageId: string | null;
  /** The message the reply answers. */
  replyTo: string | null;
};

/**
 * What a run answers besides a message that mentions the agent (spec 15): its own raised hand that
 * someone listened to, or the moderator's offer of help that someone accepted.
 */
export type Occasion =
  | { kind: 'hand'; reason: string; by: string }
  | { kind: 'offer'; offer: string; task: string; by: string };

/** The raised hand or accepted offer that started a run, and the message its reply answers. */
async function loadOccasion(
  admin: Kysely<DB>,
  row: { trigger_message_id: string | null; hand_raise_id: string | null; offer_id: string | null },
): Promise<{ occasion: Occasion | null; replyTo: string | null }> {
  if (row.hand_raise_id) {
    const hand = await admin
      .selectFrom('hand_raises')
      .leftJoin('users', 'users.id', 'hand_raises.decided_by')
      .select(['hand_raises.reason', 'users.name'])
      .where('hand_raises.id', '=', row.hand_raise_id)
      .executeTakeFirst();
    if (hand) {
      return {
        occasion: { kind: 'hand', reason: hand.reason, by: hand.name ?? 'Someone' },
        replyTo: null,
      };
    }
  }
  if (row.offer_id) {
    const offer = await admin
      .selectFrom('offers')
      .innerJoin('messages', 'messages.id', 'offers.message_id')
      .leftJoin('users', 'users.id', 'offers.decided_by')
      .select(['offers.task', 'offers.message_id', 'messages.content', 'users.name'])
      .where('offers.id', '=', row.offer_id)
      .executeTakeFirst();
    if (offer) {
      return {
        occasion: {
          kind: 'offer',
          offer: offer.content,
          task: offer.task,
          by: offer.name ?? 'Someone',
        },
        replyTo: offer.message_id,
      };
    }
  }
  return { occasion: null, replyTo: row.trigger_message_id };
}

/**
 * One answer of an agent (spec 07): mark the run as running, stream the reply into a new agent
 * message while tools run along the way, then store text, usage and cost. Idempotent: a run that
 * is finished is not executed again, and a retry reuses the reply message of the first attempt.
 *
 * Errors end in a friendly note in the message. While attempts remain, the run waits again and the
 * error is rethrown, so Graphile Worker retries it; configuration errors are never retried.
 */
export async function runAgentTurn(
  deps: AgentTurnDeps,
  payload: unknown,
  attempt: AgentTurnAttempt,
): Promise<void> {
  const { runId } = payloadSchema.parse(payload);
  const row = await deps.admin
    .selectFrom('ai_runs')
    .select([
      'id',
      'project_id',
      'agent_key',
      'status',
      'trigger_message_id',
      'reply_message_id',
      'hand_raise_id',
      'offer_id',
    ])
    .where('id', '=', runId)
    .where('kind', '=', 'reply')
    .executeTakeFirst();
  // Gone with its project, or finished: nothing to do.
  if (!row || row.status === 'done' || row.status === 'error') return;

  const { occasion, replyTo } = await loadOccasion(deps.admin, row);
  const run: Run = {
    id: row.id,
    projectId: row.project_id,
    triggerMessageId: row.trigger_message_id,
    replyMessageId: row.reply_message_id,
    replyTo,
  };
  const agent = findAgent(row.agent_key);
  if (!agent) {
    // The trigger only creates runs for agents that can answer; this is a leftover of an old one.
    await settleRun(deps.admin, run, { status: 'error', error: `No agent "${row.agent_key}"` });
    return;
  }
  const team = await loadTeam(deps.admin, run.projectId);
  const member = team.members.find((entry) => entry.key === agent.key);
  if (!member) {
    // Removed from the team after the mention (spec 14): only team agents answer.
    await settleRun(deps.admin, run, {
      status: 'error',
      error: `"${agent.key}" is no longer in the team`,
    });
    return;
  }

  const project = await deps.admin
    .selectFrom('projects')
    .select(['name', 'language', 'settings'])
    .where('id', '=', run.projectId)
    .executeTakeFirstOrThrow();
  const language: Language = project.language === 'en' ? 'en' : 'de';
  const settings = projectSettingsSchema.safeParse(project.settings);
  const proposalsOnly = settings.success && settings.data.proposalsOnly === true;

  const messageId = await startRun(deps.admin, run, agent);
  try {
    const result = await converse(
      deps,
      {
        run,
        agent,
        // The owner's choice for this project, or the catalog default.
        model: member.model ?? agent.model,
        team,
        occasion,
        projectName: project.name,
        messageId,
        proposalsOnly,
      },
      attempt,
    );
    await finishRun(deps.admin, run, messageId, result, NOTES[language].done);
  } catch (error) {
    // Neither a missing setup nor a used-up quota gets better by retrying in a few seconds.
    const final =
      error instanceof GatewayConfigError ||
      error instanceof GatewayLimitError ||
      attempt.attempt >= attempt.maxAttempts;
    const note =
      error instanceof GatewayLimitError
        ? quotaNote(language, error.resetsAt, new Date())
        : error instanceof GatewayConfigError
          ? NOTES[language].unavailable
          : NOTES[language][final ? 'failed' : 'retry'];
    await failRun(deps.admin, run, messageId, { final, note, reason: describe(error) });
    if (!final) throw error;
    deps.logger.error(`Run ${run.id} failed for good: ${describe(error)}`);
  }
}

/** The Graphile Worker task for `agent_turn`. */
export function agentTurnTask(deps: Omit<AgentTurnDeps, 'logger'>): Task {
  return (payload, helpers) =>
    runAgentTurn({ ...deps, logger: helpers.logger }, payload, {
      attempt: helpers.job.attempts,
      maxAttempts: helpers.job.max_attempts,
      signal: helpers.abortSignal,
    });
}

/** Marks the run as running and opens its reply message: new, or the one of an earlier attempt. */
function startRun(admin: Kysely<DB>, run: Run, agent: AgentDefinition): Promise<string> {
  return admin.transaction().execute(async (trx) => {
    await trx
      .updateTable('ai_runs')
      .set({ status: 'running', started_at: sql`coalesce(started_at, now())`, error: null })
      .where('id', '=', run.id)
      .execute();

    let messageId = run.replyMessageId;
    if (messageId) {
      await trx
        .updateTable('messages')
        .set({ content: '', status: 'streaming' })
        .where('id', '=', messageId)
        .execute();
    } else {
      const inserted = await trx
        .insertInto('messages')
        .values({
          project_id: run.projectId,
          author_kind: 'agent',
          author_agent_key: agent.key,
          content: '',
          status: 'streaming',
          reply_to: run.replyTo,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      messageId = inserted.id;
      await trx
        .updateTable('ai_runs')
        .set({ reply_message_id: messageId })
        .where('id', '=', run.id)
        .execute();
    }

    // The message first: the chat shows who is typing by the run's streaming reply.
    await notifyLive(trx, { kind: 'message', projectId: run.projectId, messageId });
    await notifyLive(trx, { kind: 'run', projectId: run.projectId, runId: run.id });
    return messageId;
  });
}

async function converse(
  deps: AgentTurnDeps,
  turn: {
    run: Run;
    agent: AgentDefinition;
    model: string;
    team: TeamContext;
    occasion: Occasion | null;
    projectName: string;
    messageId: string;
    proposalsOnly: boolean;
  },
  attempt: AgentTurnAttempt,
): Promise<AgentReplyResult> {
  const { run, agent, messageId } = turn;
  const [conversation, board] = await Promise.all([
    loadConversation(deps.admin, run),
    deps.admin
      .selectFrom('boards')
      .select('id')
      .where('project_id', '=', run.projectId)
      .where('kind', '=', 'main')
      .executeTakeFirst(),
  ]);
  const canvas = board
    ? await deps.boards.withBoard(board.id, (doc, session) => ({
        nodes: readNodes(doc),
        edges: readEdges(doc),
        locks: session.locks(),
      }))
    : { nodes: [], edges: [], locks: new Map<string, NodeLock>() };
  const proposals = await loadOpenProposals(deps.admin, run.projectId);

  // The rule engine needs the intent of the message (spec 13). It is classified next to the
  // agent's reply, so the reply does not wait; the first canvas tool does.
  // A raised hand is the agent's own initiative; accepting an offer is an instruction of the
  // person who accepted it (spec 15). Neither needs a classification.
  const given = (intent: Intent) =>
    Promise.resolve({ intent, costUsd: 0, inputTokens: 0, outputTokens: 0 });
  const intent =
    turn.occasion?.kind === 'hand'
      ? given('initiative')
      : turn.occasion?.kind === 'offer'
        ? given('instruction')
        : conversation.request
          ? classifyIntent(deps.complete, conversation.request.content, attempt.signal)
          : given('question');

  const rules = {
    intent: intent.then((result) => result.intent),
    proposalsOnly: turn.proposalsOnly,
  };
  const tools: AgentTool[] = [];
  if (board) {
    const toolOptions: CanvasToolOptions = {
      boards: deps.boards,
      boardId: board.id,
      author: { kind: 'agent', agentKey: agent.key },
      rules: {
        ...rules,
        proposal: await openRunProposal(deps.admin, {
          id: run.id,
          projectId: run.projectId,
          boardId: board.id,
          agentKey: agent.key,
        }),
      },
    };
    for (const name of agent.tools) {
      const create = CANVAS_TOOLS[name];
      if (create) tools.push(create(toolOptions));
    }
  }
  if (agent.tools.includes('add_agents')) {
    const team = teamWriter(deps.admin, {
      id: run.id,
      projectId: run.projectId,
      agentKey: agent.key,
    });
    tools.push(addAgentsTool({ team, rules }));
  }

  const deltas = createDeltaStream(deps.flushMs ?? FLUSH_MS, async (text) => {
    try {
      await notifyLive(deps.admin, { kind: 'delta', projectId: run.projectId, messageId, text });
    } catch (error) {
      // Only the live preview suffers; the complete text is stored at the end.
      deps.logger.error(`Run ${run.id} could not stream a delta: ${describe(error)}`);
    }
  });
  try {
    const result = await deps.reply({
      model: turn.model,
      effort: agent.effort,
      system: agent.prompt,
      prompt: buildPrompt({
        projectName: turn.projectName,
        team: {
          self: agent.key,
          members: turn.team.members.map((entry) => entry.key),
          proposed: turn.team.proposed,
          rejected: turn.team.rejected,
        },
        ...canvas,
        proposals,
        ...conversation,
        occasion: turn.occasion,
      }),
      tools,
      onText: deltas.push,
      signal: attempt.signal,
    });
    // The classification belongs to the run: its tokens and cost count too.
    const classified = await intent;
    return {
      ...result,
      usage: {
        ...result.usage,
        inputTokens: result.usage.inputTokens + classified.inputTokens,
        outputTokens: result.usage.outputTokens + classified.outputTokens,
      },
      costUsd: result.costUsd + classified.costUsd,
    };
  } finally {
    // All deltas are out before the message changes again, so none arrives after it.
    await deltas.close();
  }
}

/** The latest messages, oldest first, and the message the agent answers. */
async function loadConversation(admin: Kysely<DB>, run: Run) {
  const rows = await selectMessages(admin)
    .where('messages.project_id', '=', run.projectId)
    // Answers that are still streaming or failed are not part of the conversation.
    .where('messages.status', '=', 'complete')
    .orderBy('messages.created_at', 'desc')
    .orderBy('messages.id', 'desc')
    .limit(CONTEXT_MESSAGES)
    .execute();
  const messages = rows
    .map(toMessage)
    .filter((message) => message !== undefined)
    .reverse();
  const request =
    messages.find((message) => message.id === run.triggerMessageId) ??
    (run.triggerMessageId ? await loadMessage(admin, run.triggerMessageId) : undefined);
  return { messages, request };
}

function authorName(message: ChatMessage): string {
  if (message.author.kind === 'human') return message.author.name || 'Someone';
  const { agentKey } = message.author;
  return findAgent(agentKey)?.names.en ?? agentKey.charAt(0).toUpperCase() + agentKey.slice(1);
}

/** Chat text is data: it must not close the sections the prompt is built from. */
function asData(text: string): string {
  return text.replace(/<(\/?)(team|canvas|chat|request)>/gi, '‹$1$2›');
}

/**
 * The team of the project (spec 14). An agent that can add agents also sees the catalog agents
 * outside the team, and what became of earlier proposals.
 */
function describeTeam(team: {
  self: AgentKey;
  members: readonly AgentKey[];
  proposed?: readonly AgentKey[];
  rejected?: readonly AgentKey[];
}): string {
  const line = (agent: AgentDefinition, note = '') =>
    `- ${describeName(agent)}, key ${agent.key}: ${agent.role}${note}`;
  const lines = [
    "The agents of this project's team; only they answer when someone mentions them:",
    ...CATALOG.filter((agent) => team.members.includes(agent.key)).map((agent) =>
      line(agent, agent.key === team.self ? ' (you)' : ''),
    ),
  ];
  const self = findAgent(team.self);
  const others = CATALOG.filter((agent) => !team.members.includes(agent.key));
  if (self?.tools.includes('add_agents') && others.length > 0) {
    lines.push(
      'Catalog agents not in the team yet:',
      ...others.map((agent) =>
        line(
          agent,
          team.proposed?.includes(agent.key)
            ? ' (proposed, waiting for the team)'
            : team.rejected?.includes(agent.key)
              ? ' (the team rejected it before)'
              : '',
        ),
      ),
    );
  }
  return lines.join('\n');
}

const NODE_NAMES: Record<CanvasNode['type'], string> = {
  block: 'block',
  sticky: 'note',
  frame: 'frame',
};

/**
 * One line per node, with the id the tools take, the frame it belongs to and who is editing it
 * right now.
 */
function describeNode(
  node: CanvasNode,
  lock: NodeLock | undefined,
  frames: ReadonlyMap<string, CanvasNode>,
): string {
  const subtitle = node.subtitle ? ` (${node.subtitle})` : '';
  const type =
    node.type === 'block' && node.blockType
      ? `, type ${node.blockType}`
      : node.type === 'frame' && node.diagramType
        ? `, diagram ${node.diagramType}`
        : '';
  const fields =
    node.type === 'block' && node.blockType === 'entity' && node.fields.length > 0
      ? `, fields: ${node.fields.map((field) => `${field.name}${field.type ? ` ${field.type}` : ''}`).join(', ')}`
      : '';
  const size =
    node.type === 'frame'
      ? `, ${String(Math.round(node.size.width))} × ${String(Math.round(node.size.height))}`
      : '';
  const frame = node.frameId ? frames.get(node.frameId) : undefined;
  const inFrame = frame ? `, in frame "${frame.label}"` : '';
  const editing = lock ? `, ${lock.name} is editing it` : '';
  const where = `at ${describePosition(node.position)}${size}`;
  return `- ${NODE_NAMES[node.type]} "${node.label}"${subtitle}${type} ${where}, id ${node.id}${inFrame}${fields}${editing}`;
}

/** One line per arrow, by the titles of its blocks. */
function describeEdge(edge: CanvasEdge, nodes: ReadonlyMap<string, CanvasNode>): string {
  const from = nodes.get(edge.source)?.label ?? edge.source;
  const to = nodes.get(edge.target)?.label ?? edge.target;
  const label = edge.label ? `: ${edge.label}` : '';
  return `- "${from}" → "${to}"${label}, id ${edge.id}`;
}

/** The canvas overview: frames first, then blocks and notes, then the arrows. */
function describeCanvas(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  locks: ReadonlyMap<string, NodeLock> | undefined,
): string {
  if (nodes.length === 0) return 'The main canvas is empty.';
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const frames = new Map(
    nodes.filter((node) => node.type === 'frame').map((node) => [node.id, node]),
  );
  const ordered = [
    ...nodes.filter((node) => node.type === 'frame'),
    ...nodes.filter((node) => node.type !== 'frame'),
  ];
  const lines = ordered.map((node) => describeNode(node, locks?.get(node.id), frames));
  if (edges.length > 0) lines.push('Arrows:', ...edges.map((edge) => describeEdge(edge, byId)));
  return lines.join('\n');
}

/**
 * The turn's context as one text: the canvas, the conversation and the message to answer. The
 * agent's instructions come separately as the system prompt, so prompt caching applies to them.
 */
export function buildPrompt(context: {
  projectName: string;
  /** The team (spec 14); `self` is the agent that answers. */
  team?: Parameters<typeof describeTeam>[0];
  nodes: readonly CanvasNode[];
  edges?: readonly CanvasEdge[];
  locks?: ReadonlyMap<string, NodeLock>;
  /** Open proposals of the project (spec 13), so agents do not propose the same again. */
  proposals?: readonly { id: string; agentKey: string; operations: CanvasOperation[] }[];
  messages: readonly ChatMessage[];
  request: ChatMessage | undefined;
  /** A raised hand or an accepted offer, which the reply answers instead of a message. */
  occasion?: Occasion | null;
}): string {
  const proposals = context.proposals ?? [];
  const canvas = [
    describeCanvas(context.nodes, context.edges ?? [], context.locks),
    ...(proposals.length > 0
      ? [
          'Open proposals (not on the canvas until someone applies them):',
          ...proposals.map(
            (proposal) =>
              `- by ${proposal.agentKey}: ${describeOperations(proposal.operations, context.nodes)}`,
          ),
        ]
      : []),
  ].join('\n');
  const chat = context.messages
    .map((message) => `${authorName(message)}: ${message.content}`)
    .join('\n');
  const { occasion } = context;
  const request =
    occasion?.kind === 'hand'
      ? `Earlier you raised your hand in this chat for this point:\n<request>\n${asData(occasion.reason)}\n</request>\n${asData(occasion.by)} asked you to speak now. Make your point briefly and concretely, in the language of the conversation, without a greeting.`
      : occasion?.kind === 'offer'
        ? `You offered the team your help:\n<request>\n${asData(occasion.offer)}\n</request>\n${asData(occasion.by)} accepted the offer. Do it now: ${asData(occasion.task)}`
        : context.request
          ? `Answer this message from ${authorName(context.request)}:\n<request>\n${asData(context.request.content)}\n</request>`
          : 'The message addressed to you was removed. Answer the latest message in the chat.';
  return [
    `Project: ${asData(context.projectName)}`,
    ...(context.team ? [`<team>\n${describeTeam(context.team)}\n</team>`] : []),
    `<canvas>\n${asData(canvas)}\n</canvas>`,
    `<chat>\n${asData(chat)}\n</chat>`,
    request,
  ].join('\n\n');
}

/**
 * Collects streamed text and sends it in batches, one after the other and at most
 * `MAX_DELTA_LENGTH` per notification, so the chat updates smoothly without a notification per
 * token.
 */
export function createDeltaStream(flushMs: number, send: (text: string) => Promise<void>) {
  let buffer = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending = Promise.resolve();

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const text = buffer;
    buffer = '';
    if (!text) return;
    sending = sending.then(async () => {
      for (const chunk of splitText(text, MAX_DELTA_LENGTH)) await send(chunk);
    });
  }

  return {
    push: (text: string) => {
      buffer += text;
      timer ??= setTimeout(flush, flushMs);
    },
    /** Sends what is left and resolves once everything is sent. */
    close: async () => {
      flush();
      await sending;
    },
  };
}

/** Splits text into pieces of at most `max` UTF-16 units, never inside a surrogate pair. */
export function splitText(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const end = isHighSurrogate(rest.charCodeAt(max - 1)) ? max - 1 : max;
    pieces.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  if (rest) pieces.push(rest);
  return pieces;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function limitLength(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${(splitText(text, max - 1)[0] ?? '').trimEnd()}…`;
}

function describe(error: unknown): string {
  return limitLength(error instanceof Error ? error.message : String(error), MAX_ERROR_LENGTH);
}

async function finishRun(
  admin: Kysely<DB>,
  run: Run,
  messageId: string,
  result: AgentReplyResult,
  emptyNote: string,
) {
  const { usage } = result;
  await admin.transaction().execute(async (trx) => {
    await trx
      .updateTable('messages')
      .set({
        // An agent that only drew still says something, and a message is never empty.
        content: limitLength(result.text.trim() || emptyNote, MAX_CONTENT_LENGTH),
        status: 'complete',
      })
      .where('id', '=', messageId)
      .execute();
    await trx
      .updateTable('ai_runs')
      .set({
        status: 'done',
        provider: result.provider,
        model: result.model,
        // All input the model processed, cached or not; the cost accounts for the difference.
        input_tokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
        output_tokens: usage.outputTokens,
        cost_usd: result.costUsd.toFixed(6),
        error: null,
        finished_at: sql`now()`,
      })
      .where('id', '=', run.id)
      .execute();
    await notifyLive(trx, { kind: 'message', projectId: run.projectId, messageId });
    await notifyLive(trx, { kind: 'run', projectId: run.projectId, runId: run.id });
  });
}

async function failRun(
  admin: Kysely<DB>,
  run: Run,
  messageId: string,
  failure: { final: boolean; note: string; reason: string },
) {
  await admin.transaction().execute(async (trx) => {
    await trx
      .updateTable('messages')
      .set({ content: failure.note, status: 'error' })
      .where('id', '=', messageId)
      .execute();
    await notifyLive(trx, { kind: 'message', projectId: run.projectId, messageId });
    // A run that will be retried waits again; the chat shows it as waiting.
    await settleRun(trx, run, {
      status: failure.final ? 'error' : 'queued',
      error: failure.reason,
    });
  });
}

async function settleRun(
  db: Kysely<DB>,
  run: Run,
  outcome: { status: 'queued' | 'error'; error: string },
) {
  await db
    .updateTable('ai_runs')
    .set({
      status: outcome.status,
      error: outcome.error,
      finished_at: outcome.status === 'error' ? sql`now()` : null,
    })
    .where('id', '=', run.id)
    .execute();
  await notifyLive(db, { kind: 'run', projectId: run.projectId, runId: run.id });
}
