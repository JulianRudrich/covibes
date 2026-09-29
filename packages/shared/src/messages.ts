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

/**
 * Events on the live channel of a project (`LIVE_PATH?project=…`). The web app validates what
 * arrives with this schema; events it does not know (e.g. from a newer server) are dropped.
 */
export const liveEventSchema = z.object({ type: z.literal('message'), message: chatMessageSchema });
export type LiveEvent = z.infer<typeof liveEventSchema>;
