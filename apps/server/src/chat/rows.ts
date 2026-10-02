import type { DB } from '@covibes/db';
import {
  AI_RUN_STATUSES,
  comparisonSchema,
  isAgentKey,
  isCustomAgentKey,
  MESSAGE_STATUSES,
  messageAttachmentSchema,
  messageDebateSchema,
  messageDebateTurnSchema,
  messageOfferSchema,
  messageVoteSchema,
  type AiRun,
  type AiRunStatus,
  type ChatMessage,
  type MessageStatus,
} from '@covibes/shared';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

// Database rows of the chat in their API form, shared by the API, the live bridge and the worker.
// `db` is a transaction on behalf of a user (RLS) or the admin connection.

export { isAgentKey };

/** A key that names an agent: a catalog agent, or a custom agent by its id (spec 19). */
export function isKnownAgentKey(value: unknown): value is string {
  return isAgentKey(value) || isCustomAgentKey(value);
}

function isStatus(value: string): value is MessageStatus {
  return (MESSAGE_STATUSES as readonly string[]).includes(value);
}

export function selectMessages(db: Kysely<DB>) {
  return (
    db
      .selectFrom('messages')
      .leftJoin('users', 'users.id', 'messages.author_user_id')
      // The moderator's offer of help that the message makes (spec 15), and who decided it.
      .leftJoin('offers', 'offers.message_id', 'messages.id')
      .leftJoin('users as deciders', 'deciders.id', 'offers.decided_by')
      // The comparison and the vote the message shows as cards (spec 16b).
      .leftJoin('comparisons', 'comparisons.message_id', 'messages.id')
      .leftJoin('votes', 'votes.message_id', 'messages.id')
      // The debate the message opens (spec 18), and who ended it early.
      .leftJoin('debates', 'debates.message_id', 'messages.id')
      .leftJoin('users as stoppers', 'stoppers.id', 'debates.stopped_by')
      // The run of a debate that wrote the message: a turn, or the summary without a round.
      .leftJoin('ai_runs as debate_runs', (join) =>
        join
          .onRef('debate_runs.reply_message_id', '=', 'messages.id')
          .on('debate_runs.debate_id', 'is not', null),
      )
      .leftJoin('debates as turn_debates', 'turn_debates.id', 'debate_runs.debate_id')
      .select((eb) => [
        'comparisons.data as comparison_data',
        'votes.id as vote_id',
        'votes.topic as vote_topic',
        'votes.options as vote_options',
        'votes.status as vote_status',
        'votes.winner as vote_winner',
        eb
          .selectFrom('vote_ballots')
          .whereRef('vote_ballots.vote_id', '=', 'votes.id')
          .select(
            sql`coalesce(
              json_agg(json_build_object('userId', user_id, 'option', option) order by created_at),
              '[]'::json
            )`.as('ballots'),
          )
          .as('vote_ballots'),
        // The files attached to the message (spec 20a), in the order they were uploaded.
        eb
          .selectFrom('files')
          .whereRef('files.message_id', '=', 'messages.id')
          .select(
            sql`coalesce(
              json_agg(
                json_build_object(
                  'id', files.id, 'name', files.name, 'kind', files.kind,
                  'mediaType', files.media_type, 'sizeBytes', files.size_bytes
                ) order by files.created_at, files.id
              ),
              '[]'::json
            )`.as('attachments'),
          )
          .as('attachments'),
      ])
      .select([
        'debates.id as debate_id',
        'debates.topic as debate_topic',
        'debates.question as debate_question',
        'debates.participants as debate_participants',
        'debates.rounds as debate_rounds',
        'debates.turns as debate_turns',
        'debates.status as debate_status',
        'debates.stopped_at as debate_stopped_at',
        'stoppers.name as debate_stopped_by',
        'turn_debates.id as turn_debate_id',
        'turn_debates.rounds as turn_rounds',
        'debate_runs.debate_round as turn_round',
        'offers.id as offer_id',
        'offers.kind as offer_kind',
        'offers.action as offer_action',
        'offers.status as offer_status',
        'deciders.name as offer_decided_by',
        'messages.id',
        'messages.project_id',
        'messages.author_kind',
        'messages.author_user_id',
        'messages.author_agent_key',
        'users.name as author_name',
        'messages.content',
        'messages.mentions',
        'messages.mentioned_users',
        'messages.reply_to',
        'messages.status',
        'messages.created_at',
        'messages.updated_at',
      ])
  );
}

type MessageRow = Awaited<ReturnType<ReturnType<typeof selectMessages>['executeTakeFirstOrThrow']>>;

/** The API form of a row. Agents that this version does not know yet are left out. */
export function toMessage(row: MessageRow): ChatMessage | undefined {
  let author: ChatMessage['author'];
  if (row.author_kind === 'agent') {
    if (!isKnownAgentKey(row.author_agent_key)) return undefined;
    author = { kind: 'agent', agentKey: row.author_agent_key };
  } else {
    if (!row.author_user_id) return undefined;
    author = { kind: 'human', userId: row.author_user_id, name: row.author_name ?? '' };
  }
  const offer = messageOfferSchema.safeParse({
    id: row.offer_id,
    kind: row.offer_kind,
    action: row.offer_action,
    status: row.offer_status,
    decidedBy: row.offer_decided_by,
  });
  const comparison = comparisonSchema.safeParse(row.comparison_data);
  const vote = messageVoteSchema.safeParse({
    id: row.vote_id,
    topic: row.vote_topic,
    options: row.vote_options,
    status: row.vote_status,
    winner: row.vote_winner,
    ballots: row.vote_ballots,
  });
  const attachments = z.array(messageAttachmentSchema).safeParse(row.attachments);
  const debate = messageDebateSchema.safeParse({
    id: row.debate_id,
    topic: row.debate_topic,
    question: row.debate_question,
    // Agents that this version does not know cannot be shown.
    participants: row.debate_participants?.filter(isKnownAgentKey),
    rounds: row.debate_rounds,
    turns: row.debate_turns,
    status: row.debate_status,
    stopped: row.debate_stopped_at !== null,
    stoppedBy: row.debate_stopped_by,
  });
  // The message that opens a debate shows its card; every other message of the debate its mark.
  const debateTurn = messageDebateTurnSchema.safeParse(
    debate.success
      ? undefined
      : { debateId: row.turn_debate_id, round: row.turn_round, rounds: row.turn_rounds },
  );
  return {
    id: row.id,
    projectId: row.project_id,
    author,
    content: row.content,
    mentions: row.mentions.filter(isKnownAgentKey),
    ...(row.mentioned_users.length > 0 ? { mentionedUsers: row.mentioned_users } : {}),
    replyTo: row.reply_to,
    status: isStatus(row.status) ? row.status : 'complete',
    ...(offer.success ? { offer: offer.data } : {}),
    ...(comparison.success ? { comparison: comparison.data } : {}),
    ...(vote.success ? { vote: vote.data } : {}),
    ...(attachments.success && attachments.data.length > 0
      ? { attachments: attachments.data }
      : {}),
    ...(debate.success ? { debate: debate.data } : {}),
    ...(debateTurn.success ? { debateTurn: debateTurn.data } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** One message in its API form, or undefined if it does not exist (or is not visible). */
export async function loadMessage(db: Kysely<DB>, id: string): Promise<ChatMessage | undefined> {
  const row = await selectMessages(db).where('messages.id', '=', id).executeTakeFirst();
  return row && toMessage(row);
}

function isRunStatus(value: string): value is AiRunStatus {
  return (AI_RUN_STATUSES as readonly string[]).includes(value);
}

/** Runs that answer in the chat; the observer's looks (spec 15) are not part of the chat. */
export function selectRuns(db: Kysely<DB>) {
  return db
    .selectFrom('ai_runs')
    .where('kind', '=', 'reply')
    .select([
      'id',
      'project_id',
      'agent_key',
      'status',
      'trigger_message_id',
      'reply_message_id',
      'created_at',
    ]);
}

type RunRow = Awaited<ReturnType<ReturnType<typeof selectRuns>['executeTakeFirstOrThrow']>>;

/** The API form of a run. Runs of agents that this version does not know are left out. */
export function toRun(row: RunRow): AiRun | undefined {
  if (!isKnownAgentKey(row.agent_key) || !isRunStatus(row.status)) return undefined;
  return {
    id: row.id,
    projectId: row.project_id,
    agentKey: row.agent_key,
    status: row.status,
    triggerMessageId: row.trigger_message_id,
    replyMessageId: row.reply_message_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function loadRun(db: Kysely<DB>, id: string): Promise<AiRun | undefined> {
  const row = await selectRuns(db).where('id', '=', id).executeTakeFirst();
  return row && toRun(row);
}
