import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { GatewayLimitError } from '@server/ai-gateway/types';
import { loadServerEnv } from '@server/env';
import { createTestServer } from '@server/testing';
import {
  loadUsageTotals,
  NO_USAGE_LIMITS,
  usageGuard,
  UsageLimitError,
  usageLimitsOf,
  usagePeriods,
  usageStateOf,
} from '@server/usage/limits';
import { loadWorkerEnv } from '@server/worker-env';

// The limits of the AI (spec 31a): the periods, what is reached, and the check before a model
// call, against the usage the database keeps.
const test = createTestServer();

const LIMITS = { projectMonthUsd: 100, userDayUsd: 15 };

/** Usage as the database's trigger would have stored it. */
async function used(
  fields: { projectId: string; userId: string | null; cost: number; day?: string },
  agent = 'moderator',
) {
  await test.db.adminPool.query(
    `insert into usage (day, project_id, user_id, agent_key, kind, model, runs, cost_usd)
     values (coalesce($5::date, (now() at time zone 'utc')::date), $1, $2, $3, 'reply', $6, 1, $4)`,
    [fields.projectId, fields.userId, agent, fields.cost, fields.day ?? null, randomUUID()],
  );
}

async function person() {
  const cookie = await test.signIn();
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user.id;
}

describe('usagePeriods', () => {
  it('gives the day and the month of a moment in UTC, and when each ends', () => {
    expect(usagePeriods(new Date('2026-10-10T23:30:00+02:00'))).toEqual({
      day: '2026-10-10',
      monthStart: '2026-10-01',
      dayEnds: new Date('2026-10-11T00:00:00Z'),
      monthEnds: new Date('2026-11-01T00:00:00Z'),
    });
    // Late in the evening west of Greenwich it is the next day already, and the next year.
    expect(usagePeriods(new Date('2026-12-31T20:00:00-06:00'))).toEqual({
      day: '2027-01-01',
      monthStart: '2027-01-01',
      dayEnds: new Date('2027-01-02T00:00:00Z'),
      monthEnds: new Date('2027-02-01T00:00:00Z'),
    });
    // The last day of a month, and of a February in a leap year.
    expect(usagePeriods(new Date('2028-02-29T12:00:00Z'))).toMatchObject({
      day: '2028-02-29',
      monthStart: '2028-02-01',
      dayEnds: new Date('2028-03-01T00:00:00Z'),
      monthEnds: new Date('2028-03-01T00:00:00Z'),
    });
  });
});

describe('usageStateOf', () => {
  const now = new Date('2026-10-10T08:00:00Z');

  it('says which limit is reached, and when it is free again', () => {
    expect(usageStateOf(LIMITS, { projectMonthUsd: 99.99, userDayUsd: 14.99 }, now)).toEqual({
      project: { reached: false, resetsAt: null },
      user: { reached: false, resetsAt: null },
    });
    expect(usageStateOf(LIMITS, { projectMonthUsd: 100, userDayUsd: 3 }, now)).toEqual({
      project: { reached: true, resetsAt: '2026-11-01T00:00:00.000Z' },
      user: { reached: false, resetsAt: null },
    });
    expect(usageStateOf(LIMITS, { projectMonthUsd: 20, userDayUsd: 15.2 }, now)).toEqual({
      project: { reached: false, resetsAt: null },
      user: { reached: true, resetsAt: '2026-10-11T00:00:00.000Z' },
    });
  });

  it('knows no limit where the limit is 0', () => {
    expect(usageStateOf(NO_USAGE_LIMITS, { projectMonthUsd: 5000, userDayUsd: 5000 }, now)).toEqual(
      {
        project: { reached: false, resetsAt: null },
        user: { reached: false, resetsAt: null },
      },
    );
    expect(
      usageStateOf(
        { projectMonthUsd: 0, userDayUsd: 15 },
        { projectMonthUsd: 5000, userDayUsd: 15 },
        now,
      ),
    ).toMatchObject({ project: { reached: false }, user: { reached: true } });
  });
});

describe('the limits from the environment', () => {
  const base = {
    DATABASE_URL: 'postgres://app@localhost/covibes',
    DATABASE_ADMIN_URL: 'postgres://admin@localhost/covibes',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    INTERNAL_TOKEN: 'b'.repeat(32),
  };

  it('are 100 USD per project and month and 15 USD per person and day by default', () => {
    expect(usageLimitsOf(loadServerEnv(base))).toEqual({ ...LIMITS, instanceMonthUsd: 20 });
    expect(usageLimitsOf(loadWorkerEnv(base))).toEqual({ ...LIMITS, instanceMonthUsd: 20 });
  });

  it('are what the operator sets, the same way for server and worker; 0 switches one off', () => {
    const set = { ...base, AI_LIMIT_PROJECT_MONTH_USD: '250.5', AI_LIMIT_USER_DAY_USD: '0' };

    expect(usageLimitsOf(loadServerEnv(set))).toEqual({
      projectMonthUsd: 250.5,
      userDayUsd: 0,
      instanceMonthUsd: 20,
    });
    expect(usageLimitsOf(loadWorkerEnv(set))).toEqual({
      projectMonthUsd: 250.5,
      userDayUsd: 0,
      instanceMonthUsd: 20,
    });
    expect(() => loadWorkerEnv({ ...base, AI_LIMIT_USER_DAY_USD: '-1' })).toThrow();
    expect(() => loadServerEnv({ ...base, AI_LIMIT_PROJECT_MONTH_USD: 'viel' })).toThrow();
  });
});

describe('usageGuard', () => {
  it('lets a call through below the limits', async () => {
    const projectId = randomUUID();
    const userId = await person();
    await used({ projectId, userId, cost: 14.99 });
    await used({ projectId, userId: null, cost: 80 });

    await expect(usageGuard(test.db.admin, LIMITS)({ projectId, userId })).resolves.toBeUndefined();
    expect(await loadUsageTotals(test.db.admin, { projectId, userId }, new Date())).toEqual({
      projectMonthUsd: 94.99,
      userDayUsd: 14.99,
    });
  });

  it('stops at the project’s month, whoever caused the usage', async () => {
    const projectId = randomUUID();
    const userId = await person();
    await used({ projectId, userId: await person(), cost: 60 });
    await used({ projectId, userId: null, cost: 40 });
    const now = new Date();

    const check = usageGuard(test.db.admin, LIMITS, () => now)({ projectId, userId });

    await expect(check).rejects.toBeInstanceOf(UsageLimitError);
    // It is a used-up quota like the provider's, so every job treats it the same way.
    await expect(check).rejects.toBeInstanceOf(GatewayLimitError);
    await expect(check).rejects.toMatchObject({
      scope: 'project',
      resetsAt: usagePeriods(now).monthEnds,
    });
    // What runs by itself is stopped too.
    await expect(
      usageGuard(test.db.admin, LIMITS)({ projectId, userId: null }),
    ).rejects.toMatchObject({ scope: 'project' });
  });

  it('stops at the person’s day across all projects, and nobody else', async () => {
    const userId = await person();
    const other = await person();
    const projectId = randomUUID();
    await used({ projectId: randomUUID(), userId, cost: 9 });
    await used({ projectId: randomUUID(), userId, cost: 6 });
    const now = new Date();
    const guard = usageGuard(test.db.admin, LIMITS, () => now);

    await expect(guard({ projectId, userId })).rejects.toMatchObject({
      scope: 'user',
      resetsAt: usagePeriods(now).dayEnds,
    });
    await expect(guard({ projectId, userId: other })).resolves.toBeUndefined();
    await expect(guard({ projectId, userId: null })).resolves.toBeUndefined();
  });

  it('counts this month for the project and today for the person', async () => {
    const projectId = randomUUID();
    const userId = await person();
    const { monthStart } = usagePeriods(new Date());
    const before = new Date(Date.parse(`${monthStart}T00:00:00Z`) - 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
    // Last month the project and the person used far more than a limit.
    await used({ projectId, userId, cost: 500, day: before });

    await expect(usageGuard(test.db.admin, LIMITS)({ projectId, userId })).resolves.toBeUndefined();
  });

  it('checks nothing without limits', async () => {
    const projectId = randomUUID();
    const userId = await person();
    await used({ projectId, userId, cost: 5000 });

    await expect(
      usageGuard(test.db.admin, NO_USAGE_LIMITS)({ projectId, userId }),
    ).resolves.toBeUndefined();
    // One limit can be off while the other holds.
    await expect(
      usageGuard(test.db.admin, { projectMonthUsd: 0, userDayUsd: 15 })({ projectId, userId }),
    ).rejects.toMatchObject({ scope: 'user' });
  });
});
