import type { DB } from '@covibes/db';
import type { UsageAmount, UsageOverview, UsageSource } from '@covibes/shared';
import { sql, type Transaction } from 'kysely';

import { usagePeriods, type UsageLimits } from '@server/usage/limits';

// The usage of a project in one month, for its owners (spec 31b): the total, and where it came
// from. Read as the person who asks, so row level security decides what there is to see.

/** A calendar month of UTC as the days it has: "2026-10" is 2026-10-01 up to 2026-11-01. */
function monthDays(month: string): { first: string; next: string; ends: Date } {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const ends = new Date(Date.UTC(year, index + 1, 1));
  return { first: `${month}-01`, next: ends.toISOString().slice(0, 10), ends };
}

/** The month a moment falls in, as the overview names it. */
export function usageMonthOf(now: Date): string {
  return usagePeriods(now).monthStart.slice(0, 7);
}

// Costs are summed in millionths of a dollar, as the database keeps them: whole numbers add up
// without the rounding of fractions.
type Sum = { micro: number; runs: number; inputTokens: number; outputTokens: number };
type Row = Sum & { day: string; userId: string | null; agentKey: string };

const nothing = (): Sum => ({ micro: 0, runs: 0, inputTokens: 0, outputTokens: 0 });

function grow(sum: Sum, row: Sum) {
  sum.micro += row.micro;
  sum.runs += row.runs;
  sum.inputTokens += row.inputTokens;
  sum.outputTokens += row.outputTokens;
}

function add(sums: Map<string, Sum>, key: string, row: Sum) {
  const sum = sums.get(key) ?? nothing();
  grow(sum, row);
  sums.set(key, sum);
}

// Keys no user id can be: a user id is a UUID.
const NOBODY = 'nobody';
const LEFT = 'left';

const amountOf = (sum: Sum): UsageAmount => ({
  costUsd: sum.micro / 1_000_000,
  runs: sum.runs,
  inputTokens: sum.inputTokens,
  outputTokens: sum.outputTokens,
});

/** The largest costs first; what cost the same, by its runs and then by its name. */
function ranked<T extends UsageAmount>(entries: T[], nameOf: (entry: T) => string): T[] {
  return entries.sort(
    (a, b) => b.costUsd - a.costUsd || b.runs - a.runs || nameOf(a).localeCompare(nameOf(b)),
  );
}

async function loadRows(trx: Transaction<DB>, projectId: string, month: string): Promise<Row[]> {
  const { first, next } = monthDays(month);
  const rows = await trx
    .selectFrom('usage')
    .select([
      'user_id',
      'agent_key',
      // The days as text with a cast: a date must not pass through a time zone on its way.
      sql<string>`to_char(day, 'YYYY-MM-DD')`.as('day'),
      sql<string>`(sum(cost_usd) * 1000000)::bigint`.as('micro'),
      sql<string>`sum(runs)`.as('runs'),
      sql<string>`sum(input_tokens)`.as('input_tokens'),
      sql<string>`sum(output_tokens)`.as('output_tokens'),
    ])
    .where('project_id', '=', projectId)
    .where('day', '>=', sql<Date>`${first}::date`)
    .where('day', '<', sql<Date>`${next}::date`)
    .groupBy(['day', 'user_id', 'agent_key'])
    .execute();
  return rows.map((row) => ({
    day: row.day,
    userId: row.user_id,
    agentKey: row.agent_key,
    micro: Number(row.micro),
    runs: Number(row.runs),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
  }));
}

/**
 * What the AI cost in a project in one month. `trx` is the transaction of an owner: nobody else
 * reads rows of `usage`, so for anyone else this is empty; the route checks the role itself and
 * says so. The names are those of the people in the project now; who left it has none.
 */
export async function loadUsageOverview(
  trx: Transaction<DB>,
  projectId: string,
  month: string,
  limits: UsageLimits,
  now: Date,
): Promise<UsageOverview> {
  const rows = await loadRows(trx, projectId, month);
  const members = await trx
    .selectFrom('project_members')
    .innerJoin('users', 'users.id', 'project_members.user_id')
    .select(['users.id', 'users.name'])
    .where('project_members.project_id', '=', projectId)
    .execute();
  const names = new Map(members.map((member) => [member.id, member.name]));

  const total = nothing();
  const agents = new Map<string, Sum>();
  // By person in the project; everyone who left under one key, nobody under another.
  const sources = new Map<string, Sum>();
  const days = new Map<string, Sum>();
  for (const row of rows) {
    grow(total, row);
    add(agents, row.agentKey, row);
    add(sources, row.userId === null ? NOBODY : names.has(row.userId) ? row.userId : LEFT, row);
    add(days, row.day, row);
  }

  const { first, ends } = monthDays(month);
  const current = month === usageMonthOf(now);
  // The running month ends today as far as the days go: there is nothing to show of tomorrow.
  const lastDay = current ? now.getUTCDate() : new Date(ends.getTime() - 1).getUTCDate();
  const byDay = Array.from({ length: lastDay }, (_, index) => {
    const day = `${first.slice(0, 8)}${String(index + 1).padStart(2, '0')}`;
    const sum = days.get(day) ?? nothing();
    return { day, costUsd: sum.micro / 1_000_000, runs: sum.runs };
  });

  const sourceOf = (key: string): UsageSource =>
    key === NOBODY
      ? { kind: 'nobody' }
      : key === LEFT
        ? { kind: 'left' }
        : { kind: 'member', userId: key, name: names.get(key) ?? '' };

  return {
    month,
    current,
    limits: { projectMonthUsd: limits.projectMonthUsd, userDayUsd: limits.userDayUsd },
    endsAt: ends.toISOString(),
    total: amountOf(total),
    byAgent: ranked(
      [...agents].map(([agentKey, sum]) => ({ agentKey, ...amountOf(sum) })),
      (entry) => entry.agentKey,
    ),
    bySource: ranked(
      [...sources].map(([key, sum]) => ({ ...sourceOf(key), ...amountOf(sum) })),
      (entry) => (entry.kind === 'member' ? entry.name : entry.kind),
    ),
    byDay,
  };
}
