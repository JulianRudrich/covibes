import type { DB } from '@covibes/db';
import {
  AGENT_KEYS,
  AI_RUN_STATUSES,
  MESSAGE_STATUSES,
  type AgentKey,
  type AiRun,
  type AiRunStatus,
  type ChatMessage,
  type MessageStatus,
} from '@covibes/shared';
import type { Kysely } from 'kysely';

// Database rows of the chat in their API form, shared by the API, the live bridge and the worker.
// `db` is a transaction on behalf of a user (RLS) or the admin connection.

export function isAgentKey(value: string | null): value is AgentKey {
  return (AGENT_KEYS as readonly (string | null)[]).includes(value);
}

function isStatus(value: string): value is MessageStatus {
  return (MESSAGE_STATUSES as readonly string[]).includes(value);
}

export function selectMessages(db: Kysely<DB>) {
  return db
    .selectFrom('messages')
    .leftJoin('users', 'users.id', 'messages.author_user_id')
    .select([
      'messages.id',
      'messages.project_id',
      'messages.author_kind',
      'messages.author_user_id',
      'messages.author_agent_key',
      'users.name as author_name',
      'messages.content',
      'messages.mentions',
      'messages.reply_to',
      'messages.status',
      'messages.created_at',
      'messages.updated_at',
    ]);
}

type MessageRow = Awaited<ReturnType<ReturnType<typeof selectMessages>['executeTakeFirstOrThrow']>>;

/** The API form of a row. Agents that this version does not know yet are left out. */
export function toMessage(row: MessageRow): ChatMessage | undefined {
  let author: ChatMessage['author'];
  if (row.author_kind === 'agent') {
    if (!isAgentKey(row.author_agent_key)) return undefined;
    author = { kind: 'agent', agentKey: row.author_agent_key };
  } else {
    if (!row.author_user_id) return undefined;
    author = { kind: 'human', userId: row.author_user_id, name: row.author_name ?? '' };
  }
  return {
    id: row.id,
    projectId: row.project_id,
    author,
    content: row.content,
    mentions: row.mentions.filter(isAgentKey),
    replyTo: row.reply_to,
    status: isStatus(row.status) ? row.status : 'complete',
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

export function selectRuns(db: Kysely<DB>) {
  return db
    .selectFrom('ai_runs')
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
  if (!isAgentKey(row.agent_key) || !isRunStatus(row.status)) return undefined;
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
