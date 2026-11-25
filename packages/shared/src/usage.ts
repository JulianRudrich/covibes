import { z } from 'zod';

// Usage and limits (spec 31): what members learn of the limits. The numbers are for owners
// (part 31b); everyone else only reads whether a limit is reached.

/** One limit: whether it is reached, and when it is free again. */
export type UsageLimitState = {
  reached: boolean;
  /** When the limit is free again; null while it is not reached. */
  resetsAt: string | null;
};

/**
 * `GET /api/projects/:projectId/usage/state`: the two limits of the AI as they stand for the
 * person who asks. `project`: what the project may cost in a month. `user`: what the person may
 * cost in a day, across all projects. While one is reached, no model is called; everything else
 * keeps working.
 */
export type UsageState = {
  instance?: UsageLimitState;
  project: UsageLimitState;
  user: UsageLimitState;
};

/** A month as the overview takes it: "2026-10", a calendar month of UTC. */
export const usageMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** What was used: estimated costs in USD at list prices, runs that ended, and tokens. */
export type UsageAmount = {
  costUsd: number;
  runs: number;
  inputTokens: number;
  outputTokens: number;
};

/**
 * Who usage is for: a member of the project; everyone who is no longer in it, together and
 * without a name; or nobody, which is what ran by itself (the observer, an automatic review) and
 * what an account used that was deleted.
 */
export type UsageSource =
  { kind: 'member'; userId: string; name: string } | { kind: 'left' } | { kind: 'nobody' };

/**
 * `GET /api/projects/:projectId/usage?month=2026-10`, for owners (spec 31b): what the AI cost in
 * the project in one calendar month of UTC, in total and by where it came from. Only this
 * project's numbers: what a person used elsewhere is not in it.
 */
export type UsageOverview = {
  /** The month shown, e.g. "2026-10". */
  month: string;
  /** It is the running month: its limit can still be reached. */
  current: boolean;
  /** The limits in USD (part 31a); 0 means none. */
  limits: { projectMonthUsd: number; userDayUsd: number };
  /** When the month shown ends; for the running month, when the project's limit is free again. */
  endsAt: string;
  total: UsageAmount;
  /** By agent, the largest costs first. */
  byAgent: (UsageAmount & { agentKey: string })[];
  /** By who it was for, the largest costs first. */
  bySource: (UsageAmount & UsageSource)[];
  /** Every day of the month up to today, in order, also the days without usage. */
  byDay: { day: string; costUsd: number; runs: number }[];
};
