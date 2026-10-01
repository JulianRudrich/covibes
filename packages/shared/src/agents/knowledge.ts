import { z } from 'zod';

import { FILE_KINDS } from '../files';

// The knowledge of a custom agent (spec 20b): files and links its creator gives it. The agent
// reads them in a run when the question calls for it; what they say is data, never an instruction.

/** Entries per agent. */
export const MAX_AGENT_KNOWLEDGE = 10;

/** Same limits as the check constraints on `agent_knowledge` (packages/db/migrations). */
export const KNOWLEDGE_URL_MAX_LENGTH = 2000;
export const KNOWLEDGE_NOTE_MAX_LENGTH = 200;

/** A web address: `http` or `https` with a host, as agents can read it. */
export const webUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(KNOWLEDGE_URL_MAX_LENGTH)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
    } catch {
      return false;
    }
  }, 'A web address starting with http:// or https://');

/** `POST /api/agents/:agentId/knowledge/links`. */
export const addKnowledgeLinkInputSchema = z.object({
  url: webUrlSchema,
  /** What the agent should know about the page, e.g. what it is good for. */
  note: z
    .string()
    .trim()
    .max(KNOWLEDGE_NOTE_MAX_LENGTH)
    .refine((text) => !text.includes('\u0000'))
    .default(''),
});
export type AddKnowledgeLinkInput = z.input<typeof addKnowledgeLinkInputSchema>;

/** One entry of an agent's knowledge (`GET /api/agents/:agentId/knowledge`). */
export const agentKnowledgeItemSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['file', 'link']),
  /** The file's name, or the link's address. */
  name: z.string(),
  url: z.string().nullable(),
  note: z.string(),
  fileKind: z.enum(FILE_KINDS).nullable(),
  mediaType: z.string().nullable(),
  sizeBytes: z.number().int().positive().nullable(),
});
export type AgentKnowledgeItem = z.infer<typeof agentKnowledgeItemSchema>;
