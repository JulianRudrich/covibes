import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';

import {
  GatewayConfigError,
  withGatewayAttemptUsage,
  type AgentReplyResult,
  type GatewayAttemptUsage,
} from '@server/ai-gateway/types';
import { withUser } from '@server/db/database';
import { sealToken } from '@server/integrations/gitlab/crypto';
import { createTestServer } from '@server/testing';
import { reconcileAttempt, reserveAttempt, settleAttempt } from '@server/usage/attempts';
import { createBudgetGateway } from '@server/usage/gateway';
import { loadInstanceUsageTotal, loadUsageTotals } from '@server/usage/limits';
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
  it('keeps workspace-funded holds, settlement and reconciliation outside instance spending', async () => {
    const now = nextPeriod();
    const request = await run();
    const instance = await reserveAttempt(test.db.admin, request, unlimited, now);
    await settleAttempt(test.db.admin, instance.id, 'succeeded', result(0.4));
    const route = () =>
      Promise.resolve({
        payer: 'workspace' as const,
        model: request.model,
        provider: 'anthropic' as const,
      });
    const limits = { ...unlimited, instanceMonthUsd: 0.4 };
    const owned = await reserveAttempt(test.db.admin, request, limits, now, route);
    expect(owned.warning).toBeUndefined();
    expect(await loadInstanceUsageTotal(test.db.admin, now)).toBe(0.4);
    for (const cap of ['projectMonthUsd', 'userDayUsd']) {
      await expect(
        reserveAttempt(test.db.admin, request, { ...limits, [cap]: 0.9 }, now, route),
      ).rejects.toMatchObject({ scope: cap === 'userDayUsd' ? 'user' : 'project' });
    }
    await settleAttempt(test.db.admin, owned.id, 'failed', { ...result(0.1), complete: false });
    await reconcileAttempt(test.db.admin, owned.id, 0.3, 'Fixture verified amount');
    expect(await loadInstanceUsageTotal(test.db.admin, now)).toBe(0.4);
    expect(await loadUsageTotals(test.db.admin, request, now)).toMatchObject({
      projectMonthUsd: 0.7,
      userDayUsd: 0.7,
    });
    const row = await test.db.admin
      .selectFrom('ai_attempts')
      .selectAll()
      .where('id', '=', owned.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      payer: 'workspace',
      status: 'reconciled',
    });
    expect(row.workspace_id).toEqual(expect.any(String));
  });

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

  it('keeps instance spending when an account is deleted and a pending attempt settles later', async () => {
    const now = nextPeriod();
    const request = await run();
    const remainingOwner = await run();
    const settled = await reserveAttempt(test.db.admin, request, unlimited, now);
    const pending = await reserveAttempt(test.db.admin, request, unlimited, now);
    await settleAttempt(test.db.admin, settled.id, 'succeeded', result(0.3));
    await test.db.admin
      .insertInto('usage')
      .values({
        day: now,
        project_id: request.projectId,
        user_id: null,
        agent_key: 'moderator',
        kind: 'reply',
        model: request.model,
        cost_usd: '0.2',
        runs: 2,
        input_tokens: 40,
        output_tokens: 20,
      })
      .execute();

    await test.db.admin.deleteFrom('projects').where('id', '=', request.projectId).execute();
    const retained = await test.db.admin
      .selectFrom('usage')
      .selectAll()
      .where('project_id', '=', request.projectId)
      .execute();
    expect(retained.reduce((sum, row) => sum + Number(row.cost_usd), 0)).toBeCloseTo(0.5);
    await test.db.admin.deleteFrom('users').where('id', '=', request.userId).execute();

    const costs = await test.db.admin
      .selectFrom('usage')
      .selectAll()
      .where('project_id', '=', request.projectId)
      .execute();
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ user_id: null, cost_usd: '0.500000', runs: 2 });
    const held = await test.db.admin
      .selectFrom('ai_attempts')
      .selectAll()
      .where('id', '=', pending.id)
      .executeTakeFirstOrThrow();
    expect(held).toMatchObject({ user_id: null, hold_usd: '0.400000' });
    await expect(
      reserveAttempt(
        test.db.admin,
        { ...remainingOwner, maxCostUsd: 0.2 },
        { ...unlimited, instanceMonthUsd: 1 },
        now,
      ),
    ).rejects.toMatchObject({ scope: 'instance' });

    await settleAttempt(test.db.admin, pending.id, 'succeeded', result(0.1));
    const after = await test.db.admin
      .selectFrom('usage')
      .selectAll()
      .where('project_id', '=', request.projectId)
      .execute();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ user_id: null, cost_usd: '0.600000' });
    expect(Number(after[0]?.input_tokens)).toBe(70);
    expect(Number(after[0]?.output_tokens)).toBe(30);
    await expect(
      reserveAttempt(
        test.db.admin,
        { ...remainingOwner, maxCostUsd: 0.5 },
        { ...unlimited, instanceMonthUsd: 1 },
        now,
      ),
    ).rejects.toMatchObject({ scope: 'instance' });
  });

  it('rolls back usage anonymization when ownership prevents deleting the account', async () => {
    const now = nextPeriod();
    const request = await run();
    const colleague = await run();
    await test.db.admin
      .insertInto('project_members')
      .values({
        project_id: request.projectId,
        user_id: colleague.userId,
        role: 'editor',
      })
      .execute();
    const attempt = await reserveAttempt(test.db.admin, request, unlimited, now);
    await settleAttempt(test.db.admin, attempt.id, 'succeeded', result(0.3));
    await expect(
      test.db.admin.deleteFrom('users').where('id', '=', request.userId).execute(),
    ).rejects.toThrow();
    const usage = await test.db.admin
      .selectFrom('usage')
      .selectAll()
      .where('project_id', '=', request.projectId)
      .execute();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ user_id: request.userId, cost_usd: '0.300000' });
  });

  it('settles safely while an account deletion already holds its user row', async () => {
    const now = nextPeriod();
    const request = await run();
    const attempt = await reserveAttempt(test.db.admin, request, unlimited, now);
    await test.db.admin.deleteFrom('projects').where('id', '=', request.projectId).execute();
    const deleting = await test.db.adminPool.connect();
    let settling: Promise<void> | undefined;
    try {
      await deleting.query('begin');
      await deleting.query('select id from users where id = $1 for update', [request.userId]);
      settling = settleAttempt(test.db.admin, attempt.id, 'succeeded', result(0.2));
      await vi.waitFor(
        async () => {
          const waiting = await test.db.adminPool.query<{ count: number }>(
            `select count(*)::integer as count from pg_stat_activity
           where datname = current_database() and usename = current_user
             and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
          );
          expect(waiting.rows[0]?.count).toBeGreaterThan(0);
        },
        { timeout: 2000, interval: 20 },
      );
      await deleting.query('delete from users where id = $1', [request.userId]);
      await deleting.query('commit');
      await settling;
    } finally {
      await deleting.query('rollback');
      deleting.release();
      await settling?.catch(() => undefined);
    }
    const stored = await test.db.admin
      .selectFrom('ai_attempts')
      .selectAll()
      .where('id', '=', attempt.id)
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({ user_id: null, status: 'succeeded', cost_usd: '0.200000' });
  });

  it('does not grant the application role an instance-wide numeric total', async () => {
    const request = await run();
    const totals = await withUser(test.db.app, request.userId, (trx) =>
      sql<Record<string, unknown>>`select * from public.usage_totals(${request.projectId})`.execute(
        trx,
      ),
    );
    expect(Object.keys(totals.rows[0] ?? {}).sort()).toEqual(['project_month', 'user_day']);
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
  it('routes a funded workspace call and records the same provider and payer as the reservation', async () => {
    const request = await run();
    const project = await test.db.admin
      .selectFrom('projects')
      .select('workspace_id')
      .where('id', '=', request.projectId)
      .executeTakeFirstOrThrow();
    const tokenKey = 'workspace-fixture-key-that-is-long-enough';
    const secret = 'fixture-openai-secret';
    await test.db.admin
      .insertInto('workspace_provider_keys')
      .values({
        workspace_id: project.workspace_id,
        provider: 'openai',
        ciphertext: sealToken(tokenKey, secret, 'ai:' + project.workspace_id + ':openai'),
      })
      .execute();
    const response = {
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done' }] }],
        usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } },
      },
    };
    const network = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('data: ' + JSON.stringify(response) + '\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', network);
    try {
      const fallback = vi.fn(() => Promise.resolve(result()));
      const gateway = createBudgetGateway(
        {
          admin: test.db.admin,
          limits: { ...unlimited, instanceMonthUsd: 0.000001 },
          maxCallUsd: 0.4,
          now: nextPeriod,
          onWarning: vi.fn(),
          providerEnv: { NODE_ENV: 'production', TOKEN_KEY: tokenKey },
        },
        { reply: fallback, complete: fallback },
      );
      const reply = await gateway.complete({
        model: request.model,
        system: 'Guide',
        prompt: 'Hello',
        billing: { runId: request.runId },
      });
      expect(reply).toMatchObject({ provider: 'openai', model: 'gpt-4.1' });
      expect(fallback).not.toHaveBeenCalled();
      expect(network).toHaveBeenCalledOnce();
      const stored = await test.db.admin
        .selectFrom('ai_attempts')
        .selectAll()
        .where('run_id', '=', request.runId)
        .executeTakeFirstOrThrow();
      expect(stored).toMatchObject({
        payer: 'workspace',
        provider: 'openai',
        model: 'gpt-4.1',
        workspace_id: project.workspace_id,
        status: 'succeeded',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

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
