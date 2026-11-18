import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  GatewayConfigError,
  withGatewayAttemptUsage,
  type AgentReplyResult,
  type GatewayAttemptUsage,
} from '@server/ai-gateway/types';
import { withUser } from '@server/db/database';
import { createTestServer } from '@server/testing';
import { reconcileAttempt, reserveAttempt, settleAttempt } from '@server/usage/attempts';
import { createBudgetGateway } from '@server/usage/gateway';
import { loadWorkerEnv } from '@server/worker-env';

const test = createTestServer();
const unlimited = { projectMonthUsd: 0, userDayUsd: 0, instanceMonthUsd: 0 };
let period = 0;
const nextPeriod = () => new Date(Date.UTC(2040 + Math.floor(period / 12), period++ % 12, 2));

async function run(userId?: string, projectId?: string) {
  if (!userId) {
    const cookie = await test.signIn();
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
    if (!session) throw new Error('No session');
    userId = session.user.id;
  }
  if (!projectId) {
    const project = await test.db.admin
      .insertInto('projects')
      .values({
        name: 'Budget test',
        owner_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    projectId = project.id;
    await test.db.admin
      .insertInto('project_members')
      .values({
        project_id: projectId,
        user_id: userId,
        role: 'owner',
      })
      .execute();
  }
  const row = await test.db.admin
    .insertInto('ai_runs')
    .values({
      project_id: projectId,
      user_id: userId,
      agent_key: 'moderator',
      status: 'running',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { runId: row.id, projectId, userId, model: 'claude-opus-5-5', maxCostUsd: 0.4 };
}

const result = (costUsd = 0.1): AgentReplyResult => ({
  text: 'Done',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  costUsd,
  webSearches: 0,
  usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 3 },
});

describe('atomic AI budget admission (spec 40)', () => {
  it('admits only the reservations that fit when independent clients race', async () => {
    const now = nextPeriod();
    const requests = await Promise.all(Array.from({ length: 8 }, () => run()));
    const admissions = await Promise.allSettled(
      requests.map((request) =>
        reserveAttempt(test.db.admin, request, { ...unlimited, instanceMonthUsd: 1 }, now),
      ),
    );

    expect(admissions.filter((entry) => entry.status === 'fulfilled')).toHaveLength(2);
    const denied = admissions.filter((entry) => entry.status === 'rejected');
    expect(denied).toHaveLength(6);
    for (const entry of denied) expect(entry.reason).toMatchObject({ scope: 'instance' });
  });

  it('shares a project allowance between different people and a person allowance between projects', async () => {
    const now = nextPeriod();
    const first = await run();
    const anotherProject = await run(first.userId);
    await reserveAttempt(test.db.admin, first, { ...unlimited, userDayUsd: 0.6 }, now);
    await expect(
      reserveAttempt(test.db.admin, anotherProject, { ...unlimited, userDayUsd: 0.6 }, now),
    ).rejects.toMatchObject({ scope: 'user' });
    const anotherPerson = await run(undefined, first.projectId);
    await expect(
      reserveAttempt(test.db.admin, anotherPerson, { ...unlimited, projectMonthUsd: 0.6 }, now),
    ).rejects.toMatchObject({ scope: 'project' });
  });

  it('keeps prior usage and active reservations in the same allowance', async () => {
    const now = nextPeriod();
    const request = await run();
    const first = await reserveAttempt(test.db.admin, request, unlimited, now);
    await settleAttempt(test.db.admin, first.id, 'failed', { ...result(0.3), complete: true });
    await expect(
      reserveAttempt(test.db.admin, request, { ...unlimited, projectMonthUsd: 0.6 }, now),
    ).rejects.toMatchObject({ scope: 'project' });
    const second = await reserveAttempt(
      test.db.admin,
      { ...request, maxCostUsd: 0.3 },
      { ...unlimited, projectMonthUsd: 0.6 },
      now,
    );
    expect(second.id).not.toBe(first.id);
  });

  it('retains an uncertain attempt after cancellation and a new gateway instance', async () => {
    const now = nextPeriod();
    const request = await run();
    const reservation = await reserveAttempt(test.db.admin, request, unlimited, now);
    await settleAttempt(test.db.admin, reservation.id, 'cancelled', {
      ...result(0.1),
      complete: false,
    });
    const stored = await test.db.admin
      .selectFrom('ai_attempts')
      .selectAll()
      .where('id', '=', reservation.id)
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({
      status: 'uncertain',
      outcome: 'cancelled',
      cost_usd: '0.100000',
      hold_usd: '0.300000',
    });
    await expect(
      reserveAttempt(test.db.admin, request, { ...unlimited, projectMonthUsd: 0.7 }, now),
    ).rejects.toMatchObject({ scope: 'project' });
  });

  it('uses UTC admission periods over midnight and resets a new month', async () => {
    const request = await run();
    const before = new Date('2080-12-31T23:59:59Z');
    await reserveAttempt(
      test.db.admin,
      request,
      { ...unlimited, projectMonthUsd: 0.4, userDayUsd: 0.4 },
      before,
    );
    await expect(
      reserveAttempt(
        test.db.admin,
        request,
        { ...unlimited, projectMonthUsd: 0.4, userDayUsd: 0.4 },
        new Date('2081-01-01T00:00:01Z'),
      ),
    ).resolves.toHaveProperty('id');
  });

  it('persists one operator warning per instance month across simultaneous reservations', async () => {
    const now = nextPeriod();
    const requests = await Promise.all(Array.from({ length: 5 }, () => run()));
    const reservations = await Promise.all(
      requests.map((request) =>
        reserveAttempt(
          test.db.admin,
          { ...request, maxCostUsd: 0.2 },
          { ...unlimited, instanceMonthUsd: 1 },
          now,
        ),
      ),
    );
    expect(reservations.filter((entry) => entry.warning)).toHaveLength(1);
    expect(reservations.find((entry) => entry.warning)?.warning).toMatchObject({
      committedUsd: 0.8,
      limitUsd: 1,
    });
  });

  it('reconciles a crashed attempt only after an explicit verified-cost statement', async () => {
    const now = nextPeriod();
    const request = await run();
    const reservation = await reserveAttempt(test.db.admin, request, unlimited, now);
    await settleAttempt(test.db.admin, reservation.id, 'cancelled', {
      ...result(0.1),
      complete: false,
    });
    await reconcileAttempt(
      test.db.admin,
      reservation.id,
      0.2,
      'Provider invoice checked after worker stop',
    );
    const settled = await test.db.admin
      .selectFrom('ai_attempts')
      .selectAll()
      .where('id', '=', reservation.id)
      .executeTakeFirstOrThrow();
    expect(settled).toMatchObject({
      status: 'reconciled',
      hold_usd: '0.000000',
      cost_usd: '0.200000',
    });
    await expect(
      reconcileAttempt(
        test.db.admin,
        reservation.id,
        0.2,
        'Provider invoice checked after worker stop',
      ),
    ).rejects.toThrow('already settled');
    await expect(
      reserveAttempt(test.db.admin, request, { ...unlimited, projectMonthUsd: 0.6 }, now),
    ).resolves.toHaveProperty('id');
  });

  it('does not expose attempt or operator tables through the application role', async () => {
    const request = await run();
    for (const table of ['ai_attempts', 'ai_budget_warnings'] as const) {
      await expect(
        withUser(test.db.app, request.userId, (trx) => trx.selectFrom(table).selectAll().execute()),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withUser(test.db.app, request.userId, (trx) => trx.deleteFrom(table).execute()),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });
});

describe('gateway accounting across outcomes', () => {
  it('accounts failed and successful retries exactly once and keeps cumulative run costs', async () => {
    const now = nextPeriod();
    const request = await run();
    const first = await reserveAttempt(test.db.admin, request, unlimited, now);
    const second = await reserveAttempt(test.db.admin, request, unlimited, now);
    await settleAttempt(test.db.admin, first.id, 'failed', { ...result(0.2), complete: true });
    await settleAttempt(test.db.admin, first.id, 'failed', { ...result(0.2), complete: true });
    await settleAttempt(test.db.admin, second.id, 'succeeded', result(0.1));
    await test.db.admin
      .updateTable('ai_runs')
      .set({ status: 'done', cost_usd: '0.1', input_tokens: 1 })
      .where('id', '=', request.runId)
      .execute();
    const stored = await test.db.admin
      .selectFrom('ai_runs')
      .selectAll()
      .where('id', '=', request.runId)
      .executeTakeFirstOrThrow();
    expect(stored.cost_usd).toBe('0.300000');
    expect(stored.input_tokens).toBe(30);
    const usage = await test.db.admin
      .selectFrom('usage')
      .selectAll()
      .where('project_id', '=', request.projectId)
      .execute();
    expect(usage.reduce((sum, row) => sum + Number(row.cost_usd), 0)).toBeCloseTo(0.3);
    expect(usage.reduce((sum, row) => sum + row.runs, 0)).toBe(1);
  });

  it('never invokes a provider without a configured positive bound and billing context', async () => {
    const call = vi.fn(() => Promise.resolve(result()));
    const gateway = createBudgetGateway(
      { admin: test.db.admin, limits: unlimited, maxCallUsd: 0, onWarning: vi.fn() },
      { reply: call, complete: call },
    );
    const request = {
      model: 'claude-opus-5-5',
      system: '',
      prompt: '',
      billing: { runId: randomUUID() },
    };
    await expect(gateway.complete(request)).rejects.toBeInstanceOf(GatewayConfigError);
    await expect(gateway.complete({ ...request, billing: undefined })).rejects.toBeInstanceOf(
      GatewayConfigError,
    );
    expect(call).not.toHaveBeenCalled();
  });

  it('retains final billed usage on provider errors and forwards the reservation as a soft cap', async () => {
    const request = await run();
    const failure = new Error('Provider stopped after billable work');
    const usage: GatewayAttemptUsage = { ...result(0.2), complete: true };
    const call = vi.fn(() => Promise.reject(withGatewayAttemptUsage(failure, usage)));
    const gateway = createBudgetGateway(
      {
        admin: test.db.admin,
        limits: unlimited,
        maxCallUsd: 0.4,
        now: nextPeriod,
        onWarning: vi.fn(),
      },
      { reply: call, complete: call },
    );
    await expect(
      gateway.complete({
        model: request.model,
        system: '',
        prompt: '',
        billing: { runId: request.runId },
      }),
    ).rejects.toBe(failure);
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ maxCostUsd: 0.4 }));
    const stored = await test.db.admin
      .selectFrom('ai_attempts')
      .selectAll()
      .where('run_id', '=', request.runId)
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({ status: 'failed', cost_usd: '0.200000', hold_usd: '0.000000' });
  });

  it('defaults the instance allowance to 20 USD and validates invocation configuration', () => {
    const base = {
      DATABASE_ADMIN_URL: 'postgres://admin@localhost/test',
      INTERNAL_TOKEN: 'x'.repeat(32),
    };
    expect(loadWorkerEnv(base)).toMatchObject({ AI_LIMIT_INSTANCE_MONTH_USD: 20 });
    expect(() => loadWorkerEnv({ ...base, AI_MAX_CALL_USD: '-1' })).toThrow();
  });
});
