import { z } from 'zod';

import { agentKeySchema } from './agents/custom';

/** Longest reason of a raised hand (check constraint on `hand_raises.reason`). */
export const HAND_REASON_MAX_LENGTH = 300;

/**
 * An open raised hand of a specialist (spec 15): it has something important to say and speaks
 * once someone listens. `GET /api/projects/:projectId/hands` lists the open ones, oldest first.
 */
export const handRaiseSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  agentKey: agentKeySchema,
  /** What the agent wants to say, in one line, e.g. "Einwand zu den Kosten". */
  reason: z.string(),
  createdAt: z.string(),
});
export type HandRaise = z.infer<typeof handRaiseSchema>;

/** At most this many raised hands are open per project at the same time. */
export const MAX_OPEN_HANDS = 2;

/**
 * Why the moderator offers help: the team agrees, it is stuck, or the current phase has done its
 * work and the next one can start (spec 24).
 */
export const OFFER_KINDS = ['consensus', 'stuck', 'next_step'] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

export const OFFER_STATUSES = ['open', 'accepted', 'declined'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/**
 * The moderator's offer of help that a message makes (spec 15): the team agrees or is stuck, and
 * the moderator offers to act. `decidedBy` is the name of the person who accepted or declined it.
 */
export const messageOfferSchema = z.object({
  id: z.uuid(),
  kind: z.enum(OFFER_KINDS),
  /** The text of the button that accepts the offer. */
  action: z.string(),
  status: z.enum(OFFER_STATUSES),
  decidedBy: z.string().nullable(),
});
export type MessageOffer = z.infer<typeof messageOfferSchema>;
