import type { DB } from '@covibes/db';
import type { UsageState } from '@covibes/shared';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import { GatewayLimitError } from '@server/ai-gateway/types';

// The limits of the AI (spec 31a): what a project may cost in a month and a person in a day, as
// estimated costs in USD. The worker checks them before every model call; the usage itself
// follows the runs in the database (migration 0038).

/**
 * The limits as the environment gives them, the same for server and worker. They are generous
 * and meant against abuse (owner decision, 2026-10-10); 0 switches a limit off.
 */
export const usageLimitsEnv = {
  /** What the instance may cost in a UTC month; the closed-beta reserve. */
  AI_LIMIT_INSTANCE_MONTH_USD: z.coerce.number().min(0).max(1_000_000).default(20),
  /** Conservative reservation per provider invocation; production must explicitly set it. */
  AI_MAX_CALL_USD: z.coerce.number().min(0).max(1_000_000).optional(),
  /** What one project may cost in a calendar month, in USD. */
  AI_LIMIT_PROJECT_MONTH_USD: z.coerce.number().min(0).max(1_000_000).default(100),
  /** What one person may cost in a day across all projects, in USD. */
  AI_LIMIT_USER_DAY_USD: z.coerce.number().min(0).max(1_000_000).default(15),
};

/** The limits in USD; 0 means none. */
export type UsageLimits = {
  projectMonthUsd: number;
  userDayUsd: number;
  instanceMonthUsd?: number;
};

export function usageLimitsOf(env: {
  AI_LIMIT_PROJECT_MONTH_USD: number;
  AI_LIMIT_USER_DAY_USD: number;
  AI_LIMIT_INSTANCE_MONTH_USD?: number;
}): UsageLimits {
  return {
    projectMonthUsd: env.AI_LIMIT_PROJECT_MONTH_USD,
    userDayUsd: env.AI_LIMIT_USER_DAY_USD,
    instanceMonthUsd: env.AI_LIMIT_INSTANCE_MONTH_USD ?? 20,
  };
}

/** No limits at all, e.g. for a job in a test. */
export const NO_USAGE_LIMITS: UsageLimits = { projectMonthUsd: 0, userDayUsd: 0 };

/**
 * The day and the month a moment falls in, in UTC: the same for everyone on an instance. The
 * days are written as the database writes a date.
 */
export function usagePeriods(now: Date): {
  day: string;
  monthStart: string;
  /** When the next day and the next month begin: when a limit is free again. */
  dayEnds: Date;
  monthEnds: Date;
} {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  return {
    day: iso(now),
    monthStart: iso(new Date(Date.UTC(year, month, 1))),
    dayEnds: new Date(Date.UTC(year, month, date + 1)),
    monthEnds: new Date(Date.UTC(year, month + 1, 1)),
  };
}

/** What counts toward the limits, in USD. */
export type UsageTotals = {
  projectMonthUsd: number;
  userDayUsd: number;
  instanceMonthUsd?: number;
};

/**
 * What a project cost in the month of `now`, and what a person cost on its day across all
 * projects. Read with the admin role, for the worker; nobody's usage counts for no person.
 */
export async function loadUsageTotals(
  admin: Kysely<DB>,
  who: { projectId: string; userId: string | null },
  now: Date,
): Promise<UsageTotals> {
  const { day, monthStart, monthEnds } = usagePeriods(now);
  const cost = sql<string>`coalesce(sum(cost_usd), 0)`.as('cost');
  // The days as text with a cast: a date must not pass through a time zone on its way.
  const [project, user] = await Promise.all([
    admin
      .selectFrom('usage')
      .select(cost)
      .where('project_id', '=', who.projectId)
      .where('day', '>=', sql<Date>`${monthStart}::date`)
      .where('day', '<', sql<Date>`${monthEnds}::date`)
      .executeTakeFirstOrThrow(),
    who.userId === null
      ? undefined
      : admin
          .selectFrom('usage')
          .select(cost)
          .where('user_id', '=', who.userId)
          .where('day', '=', sql<Date>`${day}::date`)
          .executeTakeFirstOrThrow(),
  ]);
  return { projectMonthUsd: Number(project.cost), userDayUsd: Number(user?.cost ?? 0) };
}

/** Operator aggregate, read only by the worker or an already authorized HTTP state reader. */
export async function loadInstanceUsageTotal(admin: Kysely<DB>, now: Date): Promise<number> {
  const { monthStart, monthEnds } = usagePeriods(now);
  const totals = await sql<{ total: string }>`select
    (select coalesce(sum(cost_usd), 0) from public.usage
      where day >= ${monthStart}::date and day < ${monthEnds}::date)
    + (select coalesce(sum(hold_usd), 0) from public.ai_attempts
      where hold_usd > 0 and budget_month = ${monthStart}::date) as total`.execute(admin);
  return Number(totals.rows[0]?.total ?? 0);
}

/** Which limit: the project's month, or the person's day. */
export type UsageLimitScope = 'project' | 'user' | 'instance';

/**
 * A limit of the AI is reached. It is a used-up quota like the provider's, so every job that
 * calls a model treats it the same way: it does not retry, and says when it is free again.
 */
export class UsageLimitError extends GatewayLimitError {
  override name = 'UsageLimitError';

  constructor(
    readonly scope: UsageLimitScope,
    resetsAt: Date,
  ) {
    super(
      scope === 'instance'
        ? 'The instance AI limit is reached for this month'
        : scope === 'project'
          ? 'The AI limit of the project is reached for this month'
          : 'The AI limit of the person is reached for today',
      resetsAt,
    );
  }
}

/** The limits as they stand for these totals: which is reached, and until when. */
export function usageStateOf(limits: UsageLimits, totals: UsageTotals, now: Date): UsageState {
  const { dayEnds, monthEnds } = usagePeriods(now);
  const project = limits.projectMonthUsd > 0 && totals.projectMonthUsd >= limits.projectMonthUsd;
  const user = limits.userDayUsd > 0 && totals.userDayUsd >= limits.userDayUsd;
  return {
    ...(limits.instanceMonthUsd === undefined
      ? {}
      : {
          instance: {
            reached:
              limits.instanceMonthUsd > 0 &&
              (totals.instanceMonthUsd ?? 0) >= limits.instanceMonthUsd,
            resetsAt:
              limits.instanceMonthUsd > 0 &&
              (totals.instanceMonthUsd ?? 0) >= limits.instanceMonthUsd
                ? monthEnds.toISOString()
                : null,
          },
        }),
    project: { reached: project, resetsAt: project ? monthEnds.toISOString() : null },
    user: { reached: user, resetsAt: user ? dayEnds.toISOString() : null },
  };
}

/**
 * Checks the limits before a model call, for the project of a run and the person it is for
 * (null: nobody, what runs by itself). Throws `UsageLimitError`; the project's limit comes first,
 * since it holds for everyone.
 */
export type UsageGuard = (who: { projectId: string; userId: string | null }) => Promise<void>;

export function usageGuard(
  admin: Kysely<DB>,
  limits: UsageLimits,
  now: () => Date = () => new Date(),
): UsageGuard {
  return async (who) => {
    if (
      limits.projectMonthUsd <= 0 &&
      limits.userDayUsd <= 0 &&
      (limits.instanceMonthUsd ?? 0) <= 0
    )
      return;
    const at = now();
    const totals = await loadUsageTotals(admin, who, at);
    if (limits.instanceMonthUsd !== undefined) {
      totals.instanceMonthUsd = await loadInstanceUsageTotal(admin, at);
    }
    const state = usageStateOf(limits, totals, at);
    const periods = usagePeriods(at);
    if (state.instance?.reached) throw new UsageLimitError('instance', periods.monthEnds);
    if (state.project.reached) throw new UsageLimitError('project', periods.monthEnds);
    if (state.user.reached) throw new UsageLimitError('user', periods.dayEnds);
  };
}
