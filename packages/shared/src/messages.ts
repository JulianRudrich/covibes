import { z } from 'zod';

import { agentKeySchema } from './agents/custom';
import { messageReferencesSchema } from './canvas-references';
import { messageDebateSchema, messageDebateTurnSchema } from './debates';
import { comparisonSchema, messageVoteSchema } from './decisions';
import { attachmentIdsSchema, messageAttachmentSchema } from './files';
import { messageOfferSchema } from './hands';

/** Same limit as the check constraint on `messages.content` (packages/db/migrations). */
export const MESSAGE_MAX_LENGTH = 8000;

/** How many of the latest messages the chat loads. */
export const MESSAGE_PAGE_SIZE = 100;

export const MESSAGE_STATUSES = ['complete', 'streaming', 'error'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const messageAuthorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human'), userId: z.string(), name: z.string() }),
  z.object({ kind: z.literal('agent'), agentKey: agentKeySchema }),
]);
export type MessageAuthor = z.infer<typeof messageAuthorSchema>;

/** A chat message as the API and the live channel deliver it. */
export const chatMessageSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  author: messageAuthorSchema,
  content: z.string(),
  /** Agents addressed with `@`, found by the server (`parseMentions`). */
  mentions: z.array(agentKeySchema),
  /** The people the message mentions (spec 22a), found by the server; left out when none. */
  mentionedUsers: z.array(z.string()).optional(),
  /**
   * The elements of the canvas the message refers to by `[Name]` (spec 37a), found by the
   * server; left out when none.
   */
  references: messageReferencesSchema.optional(),
  replyTo: z.string().nullable(),
  status: z.enum(MESSAGE_STATUSES),
  /** The moderator's offer of help that this message makes, if any (spec 15). */
  offer: messageOfferSchema.optional(),
  /** The moderator's comparison of options that this message shows (spec 16b). */
  comparison: comparisonSchema.optional(),
  /** The vote that this message carries (spec 16b). */
  vote: messageVoteSchema.optional(),
  /** The files attached to this message (spec 20a); left out when there are none. */
  attachments: z.array(messageAttachmentSchema).optional(),
  /** The debate that this message opens (spec 18). */
  debate: messageDebateSchema.optional(),
  /** Set on a turn of a debate and on its summary (spec 18). */
  debateTurn: messageDebateTurnSchema.optional(),
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
  /** Uploaded files of the sender that the message takes along (spec 20a). */
  attachments: attachmentIdsSchema.optional(),
});
export type SendMessageInput = z.input<typeof sendMessageInputSchema>;

export const AI_RUN_STATUSES = ['queued', 'running', 'done', 'error'] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

/** One agent answering one message (spec 07): waiting in its queue, working, finished or failed. */
export const aiRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  agentKey: agentKeySchema,
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
 * - `proposals`: an agent proposed something, or a proposal was applied or rejected (spec 13)
 * - `project`: the project's settings or team changed, e.g. the proposals-only mode
 * - `hands`: an agent raised a hand, or someone listened to it or dismissed it (spec 15)
 * - `decisions`: a decision or the criteria changed (spec 16a); both and the log are loaded again
 * - `plan`: the plan's suggestions changed, or a generation started or ended (spec 25b)
 * - `roadmap`: what the plan's roadmap shows changed (spec 26a); it is loaded again
 * - `package`: a suggestion for a text of the package started, ended or was decided (spec 27c)
 * - `git`: the project's connection to GitLab changed (spec 28a)
 */
export const liveEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), message: chatMessageSchema }),
  z.object({ type: z.literal('message_delta'), messageId: z.string(), text: z.string() }),
  z.object({ type: z.literal('run'), run: aiRunSchema }),
  z.object({ type: z.literal('boards') }),
  z.object({ type: z.literal('proposals') }),
  z.object({ type: z.literal('project') }),
  z.object({ type: z.literal('hands') }),
  z.object({ type: z.literal('decisions') }),
  // The plan's suggestions changed, or a generation started or ended (spec 25b).
  z.object({ type: z.literal('plan') }),
  // What the plan's roadmap shows changed (spec 26a).
  z.object({ type: z.literal('roadmap') }),
  // A suggestion for a text of the package started, ended or was decided (spec 27c).
  z.object({ type: z.literal('package') }),
  // The project's connection to GitLab changed (spec 28a).
  z.object({ type: z.literal('git') }),
  // The usage of the AI changed (spec 31a): a limit may be reached, or free again.
  z.object({ type: z.literal('usage') }),
]);
export type LiveEvent = z.infer<typeof liveEventSchema>;
