import type { DB } from '@covibes/db';
import {
  isCustomAgentKey,
  isRoadmap,
  planToMarkdown,
  projectSettingsSchema,
  readEdges,
  readNodes,
  readPlanSections,
  readRoadmap,
  toPhase,
  withAssignees,
  type CanvasEdge,
  type CanvasNode,
  type CanvasOperation,
  type ChatMessage,
  type DecisionProcess,
  type ModeratorStance,
  type NodeLock,
  type Phase,
  type Roadmap,
} from '@covibes/shared';
import type { Task } from 'graphile-worker';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import {
  CATALOG,
  describeName,
  findAgent,
  teamDefinitions,
  type AgentDefinition,
} from '@server/agents/catalog';
import { loadCustomAgentNames, resolveAgent } from '@server/agents/custom';
import { describePhase } from '@server/agents/phases';
import {
  describeKnowledge,
  loadAgentKnowledge,
  type KnowledgeEntry,
} from '@server/agents/knowledge';
import {
  GatewayConfigError,
  GatewayLimitError,
  type AgentReplyRequest,
  type AgentReplyResult,
  type AgentTool,
} from '@server/ai-gateway';
import { loadMessage, selectMessages, toMessage } from '@server/chat/rows';
import type { BoardAccess } from '@server/collab/board-client';
import { loadAssignees } from '@server/plan/assignees';
import type { AgentGitRequestsFor } from '@server/git/agent-requests';
import type { RepositoryReaders } from '@server/integrations/gitlab/repository';
import { readStoredPlan } from '@server/plan/stored-plan';
import { MAX_DELTA_LENGTH, notifyLive } from '@server/realtime/notifications';
import type { Intent } from '@server/rules/decide';
import type { FileStorage } from '@server/storage/storage';
import { classifyIntent } from '@server/rules/intent';
import { describeOperations, loadOpenProposals, openRunProposal } from '@server/tasks/run-proposal';
import { debateWriter } from '@server/tasks/run-debates';
import {
  decisionWriter,
  loadDecisionContext,
  type DecisionContext,
} from '@server/tasks/run-decisions';
import { phaseWriter } from '@server/tasks/run-phase';
import { loadTeam, teamWriter, type TeamContext } from '@server/tasks/run-team';
import { addAgentsTool } from '@server/tools/add-agents';
import { addBlockTool } from '@server/tools/add-block';
import { addFrameTool } from '@server/tools/add-frame';
import { addNoteTool } from '@server/tools/add-note';
import { addRoadmapTool } from '@server/tools/add-roadmap';
import { arrangeFrameTool } from '@server/tools/arrange-frame';
import { connectBlocksTool } from '@server/tools/connect-blocks';
import {
  compareOptionsTool,
  recordDecisionTool,
  startVoteTool,
  updateCriteriaTool,
} from '@server/tools/decision-tools';
import { describePosition, type CanvasToolOptions } from '@server/tools/placement';
import { proposeVariantsTool } from '@server/tools/propose-variants';
import { describeFile, fileReader, readFileTool, type ProjectFile } from '@server/tools/read-file';
import { readLinkTool, type PageReader } from '@server/tools/read-link';
import { GIT_TOOLS, gitTools } from '@server/tools/git-tools';
import { repositoryTools } from '@server/tools/repository-tools';
import { setPhaseTool } from '@server/tools/set-phase';
import { startDebateTool } from '@server/tools/start-debate';
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

/** The tools that write criteria, decisions, comparisons and votes (specs 16a and 16b). */
const DECISION_TOOLS = [
  'update_criteria',
  'record_decision',
  'compare_options',
  'start_vote',
  'propose_variants',
];

/** Name of the job the database trigger creates for every mention (migration 0005). */
export const AGENT_TURN_TASK = 'agent_turn';

/** Files of the project listed in the agent's context (spec 20a). */
const FILES_IN_CONTEXT = 20;

/** Messages of the conversation the agent sees (spec 07). */
const CONTEXT_MESSAGES = 30;
/** Streamed text reaches the chat in batches, about this often. */
const FLUSH_MS = 50;
/** Longest message content (database constraint). */
const MAX_CONTENT_LENGTH = 8000;
const MAX_ERROR_LENGTH = 1000;
/** The plan in an agent's context; a longer plan is cut at the end. */
const MAX_PLAN_LENGTH = 8000;
/** Who took which task, in an agent's context: a longer list is cut at the end, a task sooner. */
const MAX_ASSIGNMENTS_LENGTH = 4000;
const MAX_TASK_LENGTH = 200;

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
  /** Where the content of uploaded files lies (spec 20a); without it agents read no files. */
  files?: FileStorage;
  /** How `read_link` fetches a page (spec 20b); tests pass their own. */
  pages?: PageReader;
  /**
   * The repository a project is connected to (spec 28b); without it, or without a connection,
   * agents read no repository.
   */
  repository?: RepositoryReaders;
  /**
   * What an agent can propose for the repository (spec 29e); without it, agents propose no Git
   * actions.
   */
  gitRequests?: AgentGitRequestsFor;
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
 * What a run answers besides a message that mentions the agent: its own raised hand that someone
 * listened to, the moderator's offer of help that someone accepted (spec 15), a decision that
 * someone reopened (spec 16a), or a debate (spec 18): a participant's turn or the moderator's
 * summary.
 */
export type Occasion =
  | { kind: 'hand'; reason: string; by: string }
  | { kind: 'offer'; offer: string; task: string; by: string }
  | { kind: 'reopen'; topic: string; previous: string; reason: string; by: string }
  | {
      kind: 'debate';
      question: string;
      participants: string[];
      round: number;
      rounds: number;
      /** Whether this turn opens the debate. */
      first: boolean;
    }
  | {
      kind: 'debate_summary';
      question: string;
      participants: string[];
      /** Who ended the debate early, if someone did. */
      stoppedBy: string | null;
    };

/** In a debate agents only talk: no tools, no canvas, nothing recorded (spec 18). */
function isDebate(occasion: Occasion | null): boolean {
  return occasion?.kind === 'debate' || occasion?.kind === 'debate_summary';
}

/**
 * What started a run besides a mention, the message its reply answers, and the person on whose
 * behalf the run acts (who accepted the offer), if any.
 */
async function loadOccasion(
  admin: Kysely<DB>,
  row: {
    trigger_message_id: string | null;
    reply_message_id: string | null;
    hand_raise_id: string | null;
    offer_id: string | null;
    decision_id: string | null;
    debate_id: string | null;
    debate_round: number | null;
  },
): Promise<{ occasion: Occasion | null; replyTo: string | null; actorUserId?: string | null }> {
  if (row.debate_id) {
    const debate = await admin
      .selectFrom('debates')
      .leftJoin('users', 'users.id', 'debates.stopped_by')
      .select([
        'debates.message_id',
        'debates.question',
        'debates.participants',
        'debates.rounds',
        'debates.turns',
        'debates.stopped_at',
        'users.name',
      ])
      .where('debates.id', '=', row.debate_id)
      .executeTakeFirst();
    const participants = debate?.participants ?? [];
    if (debate && row.debate_round !== null) {
      return {
        occasion: {
          kind: 'debate',
          question: debate.question,
          participants,
          round: row.debate_round,
          rounds: debate.rounds,
          first: debate.turns === 0,
        },
        replyTo: debate.message_id,
      };
    }
    // The answer that opened the debate belongs to it too, but still answers its message; the
    // other run without a round is the summary.
    if (debate && debate.message_id !== row.reply_message_id) {
      return {
        occasion: {
          kind: 'debate_summary',
          question: debate.question,
          participants,
          stoppedBy: debate.stopped_at ? (debate.name ?? 'Someone') : null,
        },
        replyTo: debate.message_id,
      };
    }
  }
  if (row.decision_id) {
    const decision = await admin
      .selectFrom('decisions')
      .leftJoin('users', 'users.id', 'decisions.reopened_by')
      .select(['decisions.topic', 'decisions.reopen_reason', 'users.name'])
      .where('decisions.id', '=', row.decision_id)
      .executeTakeFirst();
    // The value that was reopened is in the log; the decision itself is open again.
    const reopened = await admin
      .selectFrom('decision_log')
      .select('value')
      .where('decision_id', '=', row.decision_id)
      .where('kind', '=', 'reopened')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (decision) {
      return {
        occasion: {
          kind: 'reopen',
          topic: decision.topic,
          previous: reopened?.value ?? '',
          reason: decision.reopen_reason ?? '',
          by: decision.name ?? 'Someone',
        },
        replyTo: null,
      };
    }
  }
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
      .select([
        'offers.task',
        'offers.message_id',
        'offers.decided_by',
        'messages.content',
        'users.name',
      ])
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
        actorUserId: offer.decided_by,
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
      'decision_id',
      'debate_id',
      'debate_round',
    ])
    .where('id', '=', runId)
    .where('kind', '=', 'reply')
    .executeTakeFirst();
  // Gone with its project, or finished: nothing to do.
  if (!row || row.status === 'done' || row.status === 'error') return;

  const { occasion, replyTo, actorUserId } = await loadOccasion(deps.admin, row);
  const run: Run = {
    id: row.id,
    projectId: row.project_id,
    triggerMessageId: row.trigger_message_id,
    replyMessageId: row.reply_message_id,
    replyTo,
  };
  const agent = await resolveAgent(deps.admin, row.agent_key);
  if (!agent) {
    // The trigger only creates runs for agents of the team; this one is unknown to this version,
    // or a custom agent that was deleted since.
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
    .select(['name', 'language', 'settings', 'phase'])
    .where('id', '=', run.projectId)
    .executeTakeFirstOrThrow();
  const language: Language = project.language === 'en' ? 'en' : 'de';
  const settings = projectSettingsSchema.safeParse(project.settings);
  const proposalsOnly = settings.success && settings.data.proposalsOnly === true;
  // Agents search the web and read links unless the project switched it off (spec 20b).
  const webAccess = !settings.success || settings.data.webAccess !== false;
  // The moderator's stance and how the project decides (spec 16b).
  const moderation = {
    stance: (settings.success ? settings.data.stance : undefined) ?? ('criteria' as const),
    process:
      (settings.success ? settings.data.decisionProcess : undefined) ?? ('consensus' as const),
  };
  const decisions = await loadDecisionContext(deps.admin, run.projectId);
  // On its first use the moderator asks for the project criteria, once (spec 16a).
  const askForCriteria =
    !isDebate(occasion) &&
    agent.tools.includes('update_criteria') &&
    decisions.criteria.length === 0 &&
    !(settings.success && settings.data.criteriaAsked === true);

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
        actorUserId: actorUserId ?? null,
        decisions,
        moderation,
        askForCriteria,
        projectName: project.name,
        phase: toPhase(project.phase),
        messageId,
        proposalsOnly,
        webAccess,
      },
      attempt,
    );
    await finishRun(deps.admin, run, messageId, result, NOTES[language].done);
    if (askForCriteria) {
      await deps.admin
        .updateTable('projects')
        .set({ settings: sql`settings || '{"criteriaAsked": true}'::jsonb` })
        .where('id', '=', run.projectId)
        .execute();
    }
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
    /** The person who accepted the offer the run does, if it does one. */
    actorUserId: string | null;
    decisions: DecisionContext;
    moderation: Moderation;
    askForCriteria: boolean;
    projectName: string;
    /** Where the project stands (spec 24); every agent's context names it. */
    phase: Phase;
    messageId: string;
    proposalsOnly: boolean;
    webAccess: boolean;
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
  // The project plan as text (spec 25b), so agents answer questions about it and build on it,
  // and its tasks with who took them (spec 26b).
  const plan = await readStoredPlan(deps.admin, run.projectId, (doc) => ({
    text: planToMarkdown(doc),
    roadmap: readRoadmap(readPlanSections(doc)),
  }));
  const roadmap = withAssignees(plan.roadmap, await loadAssignees(deps.admin, run.projectId));
  // The files people attached to the chat (spec 20a); every agent may read them.
  // A custom agent also reads the files of its own knowledge (spec 20b).
  const custom = isCustomAgentKey(agent.key) ? agent.key : undefined;
  const reader = deps.files ? fileReader(deps.admin, deps.files, run.projectId, custom) : undefined;
  const files = reader ? await reader.list(FILES_IN_CONTEXT) : [];
  const knowledge = custom ? await loadAgentKnowledge(deps.admin, custom) : [];

  // The rule engine needs the intent of the message (spec 13). It is classified next to the
  // agent's reply, so the reply does not wait; the first canvas tool does.
  // A raised hand is the agent's own initiative; accepting an offer is an instruction of the
  // person who accepted it (spec 15); a reopened decision asks for a new round, not for changes
  // (spec 16a); a debate only talks (spec 18). None of them needs a classification.
  const debating = isDebate(turn.occasion);
  const given = (intent: Intent) =>
    Promise.resolve({ intent, costUsd: 0, inputTokens: 0, outputTokens: 0 });
  const intent =
    turn.occasion?.kind === 'hand'
      ? given('initiative')
      : turn.occasion?.kind === 'offer'
        ? given('instruction')
        : turn.occasion?.kind === 'reopen' || debating
          ? given('question')
          : conversation.request
            ? classifyIntent(deps.complete, conversation.request.content, attempt.signal)
            : given('question');

  const rules = {
    intent: intent.then((result) => result.intent),
    proposalsOnly: turn.proposalsOnly,
  };
  const tools: AgentTool[] = [];
  // Reading changes nothing, so it needs no rule; a debate only talks.
  if (reader && !debating) tools.push(readFileTool({ files: reader }));
  // The web (spec 20b): the search is the gateway's, reading a link is our own tool.
  const web = turn.webAccess && !debating;
  if (web) tools.push(readLinkTool(deps.pages ? { pages: deps.pages } : {}));
  // The project's repository in GitLab (spec 28b): files, issues and merge requests.
  const repository = debating ? undefined : await deps.repository?.(run.projectId);
  if (repository) tools.push(...repositoryTools(repository));
  // The handover to the repository (spec 29e): requests that wait for approval. Only an agent
  // that has the tools gets them, and none in a debate.
  const proposing =
    !debating && GIT_TOOLS.some((name) => agent.tools.includes(name))
      ? await deps.gitRequests?.(run.projectId, agent.key)
      : undefined;
  if (proposing) {
    tools.push(...gitTools(proposing).filter((tool) => agent.tools.includes(tool.name)));
  }
  if (board && !debating) {
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
      // The roadmap (spec 26a) is sized from the plan as it was last stored.
      if (name === 'add_roadmap') {
        tools.push(
          addRoadmapTool({
            ...toolOptions,
            loadRoadmap: () =>
              readStoredPlan(deps.admin, run.projectId, (doc) =>
                readRoadmap(readPlanSections(doc)),
              ),
          }),
        );
        continue;
      }
      const create = CANVAS_TOOLS[name];
      if (create) tools.push(create(toolOptions));
    }
  }
  if (!debating && agent.tools.includes('add_agents')) {
    const team = teamWriter(deps.admin, {
      id: run.id,
      projectId: run.projectId,
      agentKey: agent.key,
    });
    tools.push(addAgentsTool({ team, rules }));
  }
  // The moderator changes the phase when someone tells it to (spec 24).
  if (!debating && agent.tools.includes('set_phase')) {
    tools.push(setPhaseTool({ phases: phaseWriter(deps.admin, run.projectId), rules }));
  }
  const moderates = agent.tools.includes('record_decision');
  if (!debating && agent.tools.includes('start_debate')) {
    tools.push(
      startDebateTool({
        debates: debateWriter(deps.admin, { id: run.id, projectId: run.projectId, messageId }),
      }),
    );
  }
  if (!debating && DECISION_TOOLS.some((name) => agent.tools.includes(name))) {
    const writer = decisionWriter(deps.admin, {
      id: run.id,
      projectId: run.projectId,
      agentKey: agent.key,
      messageId,
    });
    if (agent.tools.includes('update_criteria')) {
      tools.push(updateCriteriaTool({ decisions: writer }));
    }
    if (moderates) {
      // A decision recorded directly is confirmed by whoever asked for it: the person who
      // accepted the offer, or the author of the message.
      const author = conversation.request?.author;
      const actorUserId = turn.actorUserId ?? (author?.kind === 'human' ? author.userId : null);
      const actor = actorUserId
        ? await deps.admin
            .selectFrom('project_members')
            .select('role')
            .where('project_id', '=', run.projectId)
            .where('user_id', '=', actorUserId)
            .executeTakeFirst()
        : undefined;
      tools.push(
        recordDecisionTool({
          decisions: writer,
          rules,
          actorUserId,
          process: turn.moderation.process,
          actorIsOwner: actor?.role === 'owner',
        }),
      );
    }
    if (agent.tools.includes('compare_options')) {
      tools.push(compareOptionsTool({ decisions: writer, stance: turn.moderation.stance }));
    }
    if (agent.tools.includes('start_vote')) tools.push(startVoteTool({ decisions: writer }));
    if (board && agent.tools.includes('propose_variants')) {
      tools.push(
        proposeVariantsTool({
          boards: deps.boards,
          boardId: board.id,
          author: { kind: 'agent', agentKey: agent.key },
          decisions: writer,
        }),
      );
    }
  }

  // Custom agents (spec 19) go by their name: those of the team, of the chat and of a debate.
  const agentNames = await loadCustomAgentNames(deps.admin, [
    ...turn.team.members.map((entry) => entry.key),
    ...conversation.messages.flatMap((message) =>
      message.author.kind === 'agent' ? [message.author.agentKey] : [],
    ),
    ...proposals.map((proposal) => proposal.agentKey),
    ...(turn.occasion && 'participants' in turn.occasion ? turn.occasion.participants : []),
  ]);

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
        phase: turn.phase,
        team: {
          self: agent.key,
          members: turn.team.members.map((entry) => entry.definition),
          proposed: turn.team.proposed,
          rejected: turn.team.rejected,
        },
        agentNames,
        ...canvas,
        proposals,
        plan: plan.text,
        roadmap,
        files,
        // A debate only talks: it lists no knowledge and says nothing about the web.
        ...(debating ? {} : { knowledge, web }),
        ...(repository
          ? { repository: { ...repository.repository, proposing: proposing !== undefined } }
          : {}),
        ...conversation,
        occasion: turn.occasion,
        decisions: {
          ...turn.decisions,
          withIds: agent.tools.includes('update_criteria'),
          askForCriteria: turn.askForCriteria,
        },
        moderation: moderates ? turn.moderation : undefined,
      }),
      tools,
      webSearch: web,
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

/** What a message has attached, for its line in the chat: ` [attached: "a.png" (id …)]`. */
function attachedTo(message: ChatMessage): string {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return '';
  const list = attachments.map((file) => `"${file.name}" (id ${file.id})`).join(', ');
  return ` [attached: ${list}]`;
}

/** The English name of a catalog agent, or the name of a custom agent from `names`. */
type NameOf = (agentKey: string) => string;

function authorName(message: ChatMessage, nameOf: NameOf): string {
  if (message.author.kind === 'human') return message.author.name || 'Someone';
  return nameOf(message.author.agentKey);
}

/** Chat text is data: it must not close the sections the prompt is built from. */
function asData(text: string): string {
  return text.replace(
    /<(\/?)(phase|team|moderation|criteria|decisions|canvas|plan|assignments|files|knowledge|repository|chat|request)>/gi,
    '‹$1$2›',
  );
}

/**
 * The team of the project (spec 14): catalog agents by key or definition, custom agents (spec 19)
 * by definition. An agent that can add agents also sees the catalog agents outside the team, and
 * what became of earlier proposals.
 */
function describeTeam(team: {
  self: string;
  members: readonly (string | AgentDefinition)[];
  proposed?: readonly string[];
  rejected?: readonly string[];
}): string {
  const members = teamDefinitions(team.members);
  const line = (agent: AgentDefinition, note = '') =>
    `- ${asData(describeName(agent))}, key ${agent.key}: ${asData(agent.role)}${note}`;
  const lines = [
    "The agents of this project's team; only they answer when someone mentions them:",
    ...members.map((agent) => line(agent, agent.key === team.self ? ' (you)' : '')),
  ];
  const self = findAgent(team.self);
  const inTeam = new Set(members.map((agent) => agent.key));
  const others = CATALOG.filter((agent) => !inTeam.has(agent.key));
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
      : isRoadmap(node)
        ? ", roadmap of the plan's milestones (follows the plan by itself, holds no blocks)"
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
export function describeCanvas(
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

/** The moderator's stance and how the project decides (spec 16b). */
export type Moderation = { stance: ModeratorStance; process: DecisionProcess };

const STANCES: Readonly<Record<ModeratorStance, string>> = {
  criteria:
    "neutral by the team's criteria. Assess options by the criteria and say which option they favor; add no preferences of your own.",
  opinion:
    'with your own opinion. Assess options by the criteria, and also say clearly what you would choose and why.',
  strict:
    'strictly neutral. Lay out options and arguments, but never recommend or favor one, not even when asked.',
};

const PROCESSES: Readonly<Record<DecisionProcess, string>> = {
  consensus:
    'consensus with confirmation. Record a decision when the team agrees; unless someone told you to record it, it waits until someone confirms it.',
  vote: 'by vote. Decisions are made with start_vote: start a vote when the team has its options or asks for one. Do not record decisions with record_decision.',
  owner:
    'the owner decides. A decision you record waits until an owner confirms it, unless an owner told you to record it.',
  informal:
    'informally in the chat. When the team has decided something and calls you, record it right away with record_decision; nobody has to confirm it.',
};

function describeModeration(moderation: Moderation): string {
  return `<moderation>\nYour stance: ${STANCES[moderation.stance]}\nHow this project decides: ${PROCESSES[moderation.process]}\n</moderation>`;
}

/** The project's criteria and decisions (spec 16a), which every agent assesses by. */
function describeDecisions(
  context: DecisionContext & { withIds?: boolean },
): [criteria: string, decisions: string] {
  const criteria =
    context.criteria.length > 0
      ? context.criteria
          .map((criterion) => `- ${criterion.text}${context.withIds ? `, id ${criterion.id}` : ''}`)
          .join('\n')
      : 'The team has stated no criteria yet.';
  const lines = [
    ...context.decisions.map((decision) =>
      decision.status === 'decided'
        ? `- ${decision.topic}: ${decision.value ?? ''}${decision.reasoning ? ` (${decision.reasoning})` : ''}`
        : `- ${decision.topic}: open, not decided yet`,
    ),
    ...context.pending.map(
      (operation) => `- ${operation.topic}: ${operation.value} (waits for confirmation)`,
    ),
    ...context.votes.map((vote) => `- ${vote.topic}: a vote is open (${vote.options.join(', ')})`),
    ...context.openVariants.map(
      (open) => `- ${open.topic}: variants wait for the team (${open.names.join(', ')})`,
    ),
  ];
  const decisions = lines.length > 0 ? lines.join('\n') : 'Nothing is decided yet.';
  return [
    `<criteria>\n${asData(criteria)}\n</criteria>`,
    `<decisions>\n${asData(decisions)}\n</decisions>`,
  ];
}

/**
 * Who took which task of the plan (spec 26b): one line per task of the roadmap that someone took,
 * in the order of the plan.
 */
function describeAssignments(roadmap: Roadmap): string[] {
  return roadmap.milestones.flatMap((milestone) =>
    milestone.tasks.flatMap((task) => {
      if (!task.assignee) return [];
      // A name is one line, like the title and the task the plan gives.
      const name = task.assignee.name.replace(/\s+/g, ' ').trim() || 'Someone';
      const text = limitLength(task.text, MAX_TASK_LENGTH);
      return [`- Milestone ${String(milestone.number)} "${milestone.title}": "${text}" → ${name}`];
    }),
  );
}

function agentNames(keys: readonly string[], nameOf: NameOf): string {
  return keys.map(nameOf).join(', ');
}

/** What a participant's turn in a debate is for (spec 18): open, answer, or close. */
function describeDebateTurn(
  occasion: Extract<Occasion, { kind: 'debate' }>,
  nameOf: NameOf,
): string {
  const closing = occasion.rounds > 1 && occasion.round === occasion.rounds;
  const task = occasion.first
    ? 'You open the debate: state your position from the view of your role and give your strongest reasons.'
    : occasion.round === 1
      ? 'State your position from the view of your role, and answer what was said before you: where you agree and where you see it differently.'
      : closing
        ? 'This is the last round: answer the strongest point against your position, concede what the others got right, and say in one sentence what you would do.'
        : 'Answer what the others said since your last turn: take up their strongest point, say where you agree and where you still disagree and why.';
  return [
    `The moderator opened a debate between ${agentNames(occasion.participants, nameOf)} on this question:`,
    `<request>\n${asData(occasion.question)}\n</request>`,
    `It is your turn in round ${String(occasion.round)} of ${String(occasion.rounds)}; the turns so far are in the chat. ${task}`,
    'Argue by the criteria of the project and stay with the question. Three or four sentences of about 80 words in all, in the language of the conversation, without a greeting. Address the others by name, without @. You cannot draw or change anything in a debate, and you do not decide: the team does.',
  ].join('\n');
}

/** The moderator's summary at the end of a debate (spec 18). */
function describeDebateSummary(
  occasion: Extract<Occasion, { kind: 'debate_summary' }>,
  nameOf: NameOf,
): string {
  const ended = occasion.stoppedBy
    ? `${asData(occasion.stoppedBy)} ended the debate early`
    : 'The debate is over';
  return [
    `${ended}. ${agentNames(occasion.participants, nameOf)} debated this question:`,
    `<request>\n${asData(occasion.question)}\n</request>`,
    'Sum the debate up for the team, in the language of the conversation: where the participants agree, where they still differ, and what speaks for each side by the criteria of the project. Follow your stance on whether you recommend something. Then ask the team how it wants to go on. Three to six sentences; add no arguments of your own, and decide and record nothing.',
  ].join('\n');
}

/**
 * The turn's context as one text: the canvas, the conversation and the message to answer. The
 * agent's instructions come separately as the system prompt, so prompt caching applies to them.
 */
export function buildPrompt(context: {
  projectName: string;
  /** The current phase of the project (spec 24). */
  phase?: Phase;
  /** The team (spec 14); `self` is the agent that answers. */
  team?: Parameters<typeof describeTeam>[0];
  /** The names of custom agents by key (spec 19), for the chat and for debates. */
  agentNames?: ReadonlyMap<string, string>;
  nodes: readonly CanvasNode[];
  edges?: readonly CanvasEdge[];
  locks?: ReadonlyMap<string, NodeLock>;
  /** Open proposals of the project (spec 13), so agents do not propose the same again. */
  proposals?: readonly { id: string; agentKey: string; operations: CanvasOperation[] }[];
  /** The project plan as Markdown (spec 25b); empty or missing while there is none. */
  plan?: string;
  /** The plan's roadmap with who took which task (spec 26b). */
  roadmap?: Roadmap;
  /** The latest files attached to the chat (spec 20a), which `read_file` reads. */
  files?: readonly ProjectFile[];
  /** The knowledge of the custom agent that answers (spec 20b). */
  knowledge?: readonly KnowledgeEntry[];
  /** Whether the run may search the web and read links (spec 20b). */
  web?: boolean;
  /**
   * The repository the project is connected to (spec 28b), which the repository tools read.
   * `proposing`: the agent can also propose changes to it (spec 29e).
   */
  repository?: {
    path: string;
    name: string;
    defaultBranch: string | null;
    proposing?: boolean;
  };
  messages: readonly ChatMessage[];
  request: ChatMessage | undefined;
  /** A raised hand, an accepted offer or a debate, which the reply answers instead of a message. */
  occasion?: Occasion | null;
  /** Criteria and decisions (spec 16a); `withIds` for the agent that maintains the criteria. */
  decisions?: DecisionContext & { withIds?: boolean; askForCriteria?: boolean };
  /** For the moderator: its stance and the decision process of the project (spec 16b). */
  moderation?: Moderation;
}): string {
  const proposals = context.proposals ?? [];
  const nameOf: NameOf = (agentKey) =>
    findAgent(agentKey)?.names.en ?? asData(context.agentNames?.get(agentKey) ?? 'Agent');
  const canvas = [
    describeCanvas(context.nodes, context.edges ?? [], context.locks),
    ...(proposals.length > 0
      ? [
          'Open proposals (not on the canvas until someone applies them):',
          ...proposals.map(
            (proposal) =>
              `- by ${nameOf(proposal.agentKey)}: ${describeOperations(proposal.operations, context.nodes)}`,
          ),
        ]
      : []),
  ].join('\n');
  const chat = context.messages
    .map((message) => `${authorName(message, nameOf)}: ${message.content}${attachedTo(message)}`)
    .join('\n');
  const assignments = context.roadmap ? describeAssignments(context.roadmap) : [];
  const files = context.files ?? [];
  const knowledge = context.knowledge ?? [];
  const { occasion } = context;
  const request =
    occasion?.kind === 'hand'
      ? `Earlier you raised your hand in this chat for this point:\n<request>\n${asData(occasion.reason)}\n</request>\n${asData(occasion.by)} asked you to speak now. Make your point briefly and concretely, in the language of the conversation, without a greeting.`
      : occasion?.kind === 'offer'
        ? `You offered the team your help:\n<request>\n${asData(occasion.offer)}\n</request>\n${asData(occasion.by)} accepted the offer. Do it now: ${asData(occasion.task)}`
        : occasion?.kind === 'reopen'
          ? `${asData(occasion.by)} reopened the decision "${asData(occasion.topic)}" (it was: ${asData(occasion.previous)}) for this reason:\n<request>\n${asData(occasion.reason)}\n</request>\nStart a new round in the language of the conversation: say in one sentence what was decided and why it is open again, then ask the team what speaks for and against now. Do not decide it yourself.`
          : occasion?.kind === 'debate'
            ? describeDebateTurn(occasion, nameOf)
            : occasion?.kind === 'debate_summary'
              ? describeDebateSummary(occasion, nameOf)
              : context.request
                ? `Answer this message from ${authorName(context.request, nameOf)}:\n<request>\n${asData(context.request.content)}${asData(attachedTo(context.request))}\n</request>`
                : 'The message addressed to you was removed. Answer the latest message in the chat.';
  return [
    `Project: ${asData(context.projectName)}`,
    ...(context.phase ? [`<phase>\n${describePhase(context.phase)}\n</phase>`] : []),
    ...(context.team ? [`<team>\n${describeTeam(context.team)}\n</team>`] : []),
    ...(context.moderation ? [describeModeration(context.moderation)] : []),
    ...(context.decisions ? describeDecisions(context.decisions) : []),
    `<canvas>\n${asData(canvas)}\n</canvas>`,
    ...(context.plan
      ? [
          `<plan>\nThe project plan as the team has it in the tab "Projektplan"; people edit it there, you cannot change it:\n${asData(limitLength(context.plan, MAX_PLAN_LENGTH))}\n</plan>`,
        ]
      : []),
    ...(assignments.length > 0
      ? [
          `<assignments>\nWho took which task of the plan; people assign tasks in the plan and on the roadmap, you cannot:\n${asData(limitLength(assignments.join('\n'), MAX_ASSIGNMENTS_LENGTH))}\n</assignments>`,
        ]
      : []),
    ...(files.length > 0
      ? [
          `<files>\nFiles people attached to the chat, newest first; read one with read_file and its id:\n${asData(files.map(describeFile).join('\n'))}\n</files>`,
        ]
      : []),
    ...(knowledge.length > 0
      ? [
          `<knowledge>\nYour own knowledge, given to you by the person who created you. Read an entry when the question calls for it, a file with read_file and its id, a link with read_link${context.web === false ? ' (web access is switched off in this project, so links cannot be read right now)' : ''}:\n${asData(knowledge.map(describeKnowledge).join('\n'))}\n</knowledge>`,
        ]
      : []),
    ...(context.repository
      ? [
          `<repository>\nThe project is connected to a repository in GitLab: ${asData(context.repository.path)}${context.repository.defaultBranch ? ` (default branch ${asData(context.repository.defaultBranch)})` : ''}. You can read it: its files with list_repository_files and read_repository_file, its issues with list_issues and read_issue, its merge requests with list_merge_requests and read_merge_request. Look into it when a question is about the code or about the state of the work.${context.repository.proposing ? ' You change nothing there yourself, but you can propose changes: issues for the tasks of the plan with propose_issues, the plan package as a merge request with propose_plan_merge_request, and the merging of a merge request with propose_merge. Each only makes a request that waits under "Wartet auf dich" until someone who may approve Git actions approves it.' : ' You can only read it.'}\n</repository>`,
        ]
      : []),
    ...(context.web === false
      ? [
          'Web access is switched off in this project: you cannot search the web or read links. If someone asks for it, say that an owner can switch it on in the project settings.',
        ]
      : []),
    `<chat>\n${asData(chat)}\n</chat>`,
    context.decisions?.askForCriteria
      ? `${request}\n\nThe project has no criteria yet and you have not asked for them. After your answer, ask the team once for its goals, budget, time, know-how and priorities, and to answer with @Moderator.`
      : request,
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
        web_searches: result.webSearches,
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
