import { z } from 'zod';

import { chatMessageSchema } from './messages';

/** PostgreSQL's full timestamp precision is retained at a history boundary. */
export const messageCursorSchema = z.object({ at: z.iso.datetime(), id: z.uuid() });
export type MessageCursor = z.infer<typeof messageCursorSchema>;
export const messagePageSchema = z.object({
  items: z.array(chatMessageSchema),
  before: messageCursorSchema.nullable(),
});
export type MessagePage = z.infer<typeof messagePageSchema>;

export const projectSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(200) });
export const searchResultSchema = z.object({
  kind: z.enum(['message', 'decision', 'block', 'plan']),
  id: z.string(),
  title: z.string(),
  snippet: z.string(),
  boardId: z.string().optional(),
  section: z.string().optional(),
});
export type ProjectSearchResult = z.infer<typeof searchResultSchema>;
export type ProjectSearchResults = { results: ProjectSearchResult[] };
