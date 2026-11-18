import type { DB } from '@covibes/db';
import { sql, type Kysely, type Transaction } from 'kysely';

import {
  GatewayConfigError,
  type AgentReplyResult,
  type GatewayAttemptUsage,
} from '@server/ai-gateway/types';
import { UsageLimitError, usagePeriods, type UsageLimits } from '@server/usage/limits';

/** One lock order across every worker: admission and settlement share the same transaction lock. */
async function lockBudget(trx: Transaction<DB>) {
  await sql`select pg_advisory_xact_lock(400044)`.execute(trx);
}

const micros = (usd: number) => Math.ceil(usd * 1_000_000);

export type BudgetWarning = { month: string; committedUsd: number; limitUsd: number };

export type AttemptReservation = { id: string; warning?: BudgetWarning };

/** Atomically reserves the entire invocation bound against every applicable budget. */
export async function reserveAttempt(
  admin: Kysely<DB>,
  request: { runId: string; model: string; purpose?: string; maxCostUsd: number },
  limits: UsageLimits,
  now?: Date,
): Promise<AttemptReservation> {
  if (!Number.isFinite(request.maxCostUsd) || request.maxCostUsd <= 0) {
    throw new GatewayConfigError('AI_MAX_CALL_USD must configure a positive invocation bound');
  }
  const reservation = micros(request.maxCostUsd);
  return admin.transaction().execute(async (trx) => {
    await lockBudget(trx);
    const clock = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(trx);
    const at = now ?? clock.rows[0]?.now ?? new Date();
    const { day, monthStart, dayEnds, monthEnds } = usagePeriods(at);
    const run = await trx
      .selectFrom('ai_runs')
      .selectAll()
      .where('id', '=', request.runId)
      .executeTakeFirst();
    if (!run) throw new GatewayConfigError('A model call needs an existing parent run');
    const totals = await sql<{ instance: string; project: string; person: string }>`
      select
        (select coalesce(sum(cost_usd), 0) from usage where day >= ${monthStart}::date and day < ${monthEnds}::date)
          + (select coalesce(sum(hold_usd), 0) from ai_attempts where hold_usd > 0 and budget_month = ${monthStart}::date) as instance,
        (select coalesce(sum(cost_usd), 0) from usage where project_id = ${run.project_id} and day >= ${monthStart}::date and day < ${monthEnds}::date)
          + (select coalesce(sum(hold_usd), 0) from ai_attempts where hold_usd > 0 and project_id = ${run.project_id} and budget_month = ${monthStart}::date) as project,
        (select coalesce(sum(cost_usd), 0) from usage where user_id = ${run.user_id} and day = ${day}::date)
          + (select coalesce(sum(hold_usd), 0) from ai_attempts where hold_usd > 0 and user_id = ${run.user_id} and budget_day = ${day}::date) as person
    `.execute(trx);
    const total = totals.rows[0];
    if (!total) throw new Error('No budget totals');
    const checks = [
      {
        scope: 'instance',
        limit: limits.instanceMonthUsd ?? 0,
        used: total.instance,
        reset: monthEnds,
      },
      { scope: 'project', limit: limits.projectMonthUsd, used: total.project, reset: monthEnds },
      {
        scope: 'user',
        limit: run.user_id ? limits.userDayUsd : 0,
        used: total.person,
        reset: dayEnds,
      },
    ] as const;
    for (const check of checks) {
      if (
        check.limit > 0 &&
        Math.round(Number(check.used) * 1_000_000) + reservation > micros(check.limit)
      ) {
        throw new UsageLimitError(check.scope, check.reset);
      }
    }
    const row = await trx
      .insertInto('ai_attempts')
      .values({
        run_id: run.id,
        project_id: run.project_id,
        user_id: run.user_id,
        agent_key: run.agent_key,
        kind: run.kind,
        purpose: request.purpose ?? run.kind,
        model: request.model,
        budget_day: sql`${day}::date`,
        budget_month: sql`${monthStart}::date`,
        reserved_usd: (reservation / 1_000_000).toFixed(6),
        hold_usd: (reservation / 1_000_000).toFixed(6),
        created_at: at,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const limitUsd = limits.instanceMonthUsd ?? 0;
    const committedUsd = Number(total.instance) + reservation / 1_000_000;
    let warning: BudgetWarning | undefined;
    if (limitUsd > 0 && committedUsd >= limitUsd * 0.8) {
      const inserted = await trx
        .insertInto('ai_budget_warnings')
        .values({
          month: sql`${monthStart}::date`,
          committed_usd: committedUsd.toFixed(6),
          limit_usd: limitUsd.toFixed(6),
        })
        .onConflict((oc) => oc.column('month').doNothing())
        .returning('month')
        .executeTakeFirst();
      if (inserted) warning = { month: monthStart, committedUsd, limitUsd };
    }
    return { id: row.id, ...(warning ? { warning } : {}) };
  });
}

/**
 * Stores an attempt once. Unknown final usage retains the unaccounted reservation; a crash
 * therefore does not refund money. The usage row is dated to admission, even over midnight.
 */
export async function settleAttempt(
  admin: Kysely<DB>,
  id: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  metrics: GatewayAttemptUsage | AgentReplyResult | undefined,
): Promise<void> {
  await admin.transaction().execute(async (trx) => {
    await lockBudget(trx);
    const row = await trx
      .selectFrom('ai_attempts')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (row.status !== 'running') return;
    const complete = metrics !== undefined && (!('complete' in metrics) || metrics.complete);
    const cost = metrics?.costUsd ?? 0;
    if (!Number.isFinite(cost) || cost < 0)
      throw new Error('The provider returned an invalid cost');
    const input = metrics
      ? metrics.usage.inputTokens + metrics.usage.cacheReadTokens + metrics.usage.cacheWriteTokens
      : 0;
    const output = metrics?.usage.outputTokens ?? 0;
    const hold = complete ? 0 : Math.max(0, Number(row.reserved_usd) - cost);
    await trx
      .updateTable('ai_attempts')
      .set({
        status: complete ? status : 'uncertain',
        outcome: status,
        cost_usd: cost.toFixed(6),
        hold_usd: hold.toFixed(6),
        input_tokens: input,
        output_tokens: output,
        web_searches: metrics?.webSearches ?? 0,
        provider: metrics?.provider ?? row.provider,
        finished_at: sql`clock_timestamp()`,
      })
      .where('id', '=', id)
      .execute();
    await sql`
      insert into usage (day, project_id, user_id, agent_key, kind, model, input_tokens, output_tokens, cost_usd)
      values (${row.budget_day}, ${row.project_id}, ${row.user_id}, ${row.agent_key}, ${row.kind}, ${row.model}, ${input}, ${output}, ${cost.toFixed(6)})
      on conflict (day, project_id, user_id, agent_key, kind, model) do update set
        input_tokens = usage.input_tokens + excluded.input_tokens,
        output_tokens = usage.output_tokens + excluded.output_tokens,
        cost_usd = usage.cost_usd + excluded.cost_usd
    `.execute(trx);
    await sql`
      update ai_runs r set cost_usd = a.cost, input_tokens = a.input, output_tokens = a.output
      from (select coalesce(sum(cost_usd), 0) as cost, coalesce(sum(input_tokens), 0) as input,
                   coalesce(sum(output_tokens), 0) as output from ai_attempts where run_id = ${row.run_id}) a
      where r.id = ${row.run_id}
    `.execute(trx);
    await sql`select pg_notify('covibes_live', json_build_object('kind', 'usage', 'projectId', ${row.project_id}::uuid)::text)`.execute(
      trx,
    );
  });
}

/** Administrative reconciliation after the operator stopped the work and verified its bill. */
export async function reconcileAttempt(
  admin: Kysely<DB>,
  id: string,
  finalCostUsd: number,
  note: string,
): Promise<void> {
  if (!Number.isFinite(finalCostUsd) || finalCostUsd < 0 || note.trim().length < 10) {
    throw new Error('Reconciliation needs a nonnegative verified cost and an explanatory note');
  }
  await admin.transaction().execute(async (trx) => {
    await lockBudget(trx);
    const row = await trx
      .selectFrom('ai_attempts')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (!['running', 'uncertain'].includes(row.status))
      throw new Error('This attempt is already settled');
    const additional = finalCostUsd - Number(row.cost_usd);
    if (additional < 0) throw new Error('Reconciliation cannot remove already accounted spending');
    await trx
      .updateTable('ai_attempts')
      .set({
        status: 'reconciled',
        hold_usd: '0',
        cost_usd: finalCostUsd.toFixed(6),
        operator_note: note.trim(),
        finished_at: sql`clock_timestamp()`,
      })
      .where('id', '=', id)
      .execute();
    await sql`
      insert into usage (day, project_id, user_id, agent_key, kind, model, cost_usd)
      values (${row.budget_day}, ${row.project_id}, ${row.user_id}, ${row.agent_key}, ${row.kind}, ${row.model}, ${additional.toFixed(6)})
      on conflict (day, project_id, user_id, agent_key, kind, model) do update
        set cost_usd = usage.cost_usd + excluded.cost_usd
    `.execute(trx);
    await sql`update ai_runs set cost_usd = cost_usd + ${additional.toFixed(6)}::numeric where id = ${row.run_id}`.execute(
      trx,
    );
  });
}
