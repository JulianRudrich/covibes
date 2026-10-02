import { z } from 'zod';

// "Since you were away" (spec 23): what happened in a project while a member did not have it open.

/** Without the project for this long, a member counts as away (migration 0020). */
export const AWAY_AFTER_MS = 60 * 60_000;

/**
 * The moderator's words about the conversation. `none`: too little was said to sum up;
 * `pending`: the moderator is writing; `failed`: the model gave nothing, the rest stands alone.
 */
export const AWAY_TEXT_STATUSES = ['none', 'pending', 'done', 'failed'] as const;
export type AwayTextStatus = (typeof AWAY_TEXT_STATUSES)[number];

/** Who wrote or changed something: a person by name, an agent by its key. */
export const awayAuthorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human'), name: z.string() }),
  z.object({ kind: z.literal('agent'), agentKey: z.string() }),
]);
export type AwayAuthor = z.infer<typeof awayAuthorSchema>;

/** How many authors a row of the summary names; more are counted. */
export const AWAY_AUTHORS_SHOWN = 3;

/** A decision that was made or reopened, as the decision log recorded it. */
export const awayDecisionSchema = z.object({
  /** The id of the log entry. */
  id: z.uuid(),
  kind: z.enum(['decided', 'reopened']),
  /** The decision to open; null once it is gone. */
  decisionId: z.uuid().nullable(),
  topic: z.string(),
  /** What was decided; for `reopened` what had been decided before. */
  value: z.string().nullable(),
});
export type AwayDecision = z.infer<typeof awayDecisionSchema>;

/** What changed on a board: how many of its elements were added or changed, and by whom. */
export const awayBoardSchema = z.object({
  boardId: z.uuid(),
  title: z.string(),
  /** The board itself was created in the meantime. */
  isNew: z.boolean(),
  changed: z.number().int().min(0),
  /** Who changed it, the busiest first; `authors` counts all of them. */
  by: z.array(awayAuthorSchema),
  authors: z.number().int().min(0),
});
export type AwayBoard = z.infer<typeof awayBoardSchema>;

/**
 * `GET /api/projects/:projectId/away`: what happened between `since` and `until` for the member
 * who came back, or null when there is nothing to tell or they closed it.
 */
export const awaySummarySchema = z.object({
  since: z.string(),
  until: z.string(),
  text: z.string().nullable(),
  textStatus: z.enum(AWAY_TEXT_STATUSES),
  decisions: z.array(awayDecisionSchema),
  /** How many criteria were added, changed or removed. */
  criteriaChanges: z.number().int().min(0),
  boards: z.array(awayBoardSchema),
  messages: z.object({
    count: z.number().int().min(0),
    /** How many of them mention the member. */
    mentions: z.number().int().min(0),
    /** Who wrote, the busiest first; `authors` counts all of them. */
    by: z.array(awayAuthorSchema),
    authors: z.number().int().min(0),
  }),
});
export type AwaySummary = z.infer<typeof awaySummarySchema>;

/** `POST /api/projects/:projectId/seen`: whether the member is back from an absence. */
export type ProjectSeen = { returned: boolean };
