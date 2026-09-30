import { z } from 'zod';

import { AGENT_KEYS } from './agents/keys';

/** Same limit as the check constraint on `messages.content` (packages/db/migrations). */
export const MESSAGE_MAX_LENGTH = 8000;

/** How many of the latest messages the chat loads. */
export const MESSAGE_PAGE_SIZE = 100;

export const MESSAGE_STATUSES = ['complete', 'streaming', 'error'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const messageAuthorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human'), userId: z.string(), name: z.string() }),
  z.object({ kind: z.literal('agent'), agentKey: z.enum(AGENT_KEYS) }),
]);
export type MessageAuthor = z.infer<typeof messageAuthorSchema>;

/** A chat message as the API and the live channel deliver it. */
export const chatMessageSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  author: messageAuthorSchema,
  content: z.string(),
  /** Agents addressed with `@`, found by the server (`parseMentions`). */
  mentions: z.array(z.enum(AGENT_KEYS)),
  replyTo: z.string().nullable(),
  status: z.enum(MESSAGE_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * `POST /api/projects/:projectId/messages`. The client creates the id, so a message can be shown
 * right away and sent again after an error without appearing twice.
 */
export const sendMessageInputSchema = z.object({
  id: z.uuid(),
  content: z
    .string()
    .trim()
    .min(1)
    .max(MESSAGE_MAX_LENGTH)
    // PostgreSQL cannot store NUL in text; refuse it here instead of failing in the database.
    .refine((text) => !text.includes('\u0000'), 'Messages cannot contain NUL characters'),
});
export type SendMessageInput = z.input<typeof sendMessageInputSchema>;

export const AI_RUN_STATUSES = ['queued', 'running', 'done', 'error'] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

/** One agent answering one message (spec 07): waiting in its queue, working, finished or failed. */
export const aiRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  agentKey: z.enum(AGENT_KEYS),
  status: z.enum(AI_RUN_STATUSES),
  triggerMessageId: z.string().nullable(),
  replyMessageId: z.string().nullable(),
  createdAt: z.string(),
});
export type AiRun = z.infer<typeof aiRunSchema>;

/**
 * Events on the live channel of a project (`LIVE_PATH?project=…`). The web app validates what
 * arrives with this schema; events it does not know (e.g. from a newer server) are dropped.
 * - `message`: a new or changed message (also an agent message that starts or finishes streaming)
 * - `message_delta`: text an agent just wrote, to append to its streaming message
 * - `run`: an agent run changed its status (waiting, working, done, failed)
 * - `boards`: a board was created, renamed or deleted; the project's boards are loaded again
 */
export const liveEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), message: chatMessageSchema }),
  z.object({ type: z.literal('message_delta'), messageId: z.string(), text: z.string() }),
  z.object({ type: z.literal('run'), run: aiRunSchema }),
  z.object({ type: z.literal('boards') }),
]);
export type LiveEvent = z.infer<typeof liveEventSchema>;
