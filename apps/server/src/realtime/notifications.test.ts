import { randomUUID } from 'node:crypto';

import type { LiveEvent, ProjectSummary } from '@covibes/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LIVE_NOTIFY_CHANNEL, notifyLive, startLiveBridge } from '@server/realtime/notifications';
import { createTestServer } from '@server/testing';

const test = createTestServer();
const published: { projectId: string; event: LiveEvent }[] = [];
const closed: { projectId: string; userId: string; scope: 'boards' | 'all' }[] = [];
let bridge: ReturnType<typeof startLiveBridge>;

beforeAll(async () => {
  bridge = startLiveBridge({
    adminPool: test.db.adminPool,
    admin: test.db.admin,
    connections: {
      closeUser: (projectId, userId, scope) => {
        closed.push({ projectId, userId, scope });
      },
    },
    live: {
      publish: (projectId, event) => {
        published.push({ projectId, event });
      },
    },
  });
  await bridge.ready;
});

afterAll(() => {
  bridge.stop();
});

async function until(check: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The events of a project after the one its first member causes (spec 21a). */
function eventsFor(projectId: string) {
  return published
    .filter((entry) => entry.projectId === projectId)
    .map((entry) => entry.event)
    .filter((event) => event.type !== 'project');
}

async function projectWithMessage(content: string) {
  const cookie = await test.signIn();
  const created = await test.app.request('/api/projects', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Bridge' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const messageId = randomUUID();
  await test.app.request(`/api/projects/${projectId}/messages`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ id: messageId, content }),
  });
  return { projectId, messageId };
}

describe('live bridge', () => {
  it('announces a new moderator run from the database trigger as a live event', async () => {
    const { projectId, messageId } = await projectWithMessage('@Moderator, draw a block');

    await until(() => eventsFor(projectId).some((event) => event.type === 'run'));
    expect(eventsFor(projectId)).toContainEqual({
      type: 'run',
      run: expect.objectContaining({
        agentKey: 'moderator',
        status: 'queued',
        triggerMessageId: messageId,
      }) as unknown,
    });
  });

  it('loads announced messages and forwards text deltas as they are', async () => {
    const { projectId, messageId } = await projectWithMessage('Plain text');

    await notifyLive(test.db.admin, { kind: 'message', projectId, messageId });
    await notifyLive(test.db.admin, { kind: 'delta', projectId, messageId, text: 'Hel' });

    await until(() => eventsFor(projectId).length === 2);
    expect(eventsFor(projectId)).toEqual([
      {
        type: 'message',
        message: expect.objectContaining({ id: messageId, content: 'Plain text' }) as unknown,
      },
      { type: 'message_delta', messageId, text: 'Hel' },
    ]);
  });

  it('forwards changed proposals of an agent (spec 13)', async () => {
    const { projectId } = await projectWithMessage('Vorschlag');

    await notifyLive(test.db.admin, { kind: 'proposals', projectId });

    await until(() => eventsFor(projectId).length === 1);
    expect(eventsFor(projectId)).toEqual([{ type: 'proposals' }]);
  });

  it('ignores malformed notifications and rows that no longer exist', async () => {
    const { projectId } = await projectWithMessage('Plain text');

    await test.db.adminPool.query('select pg_notify($1, $2)', [LIVE_NOTIFY_CHANNEL, 'not json']);
    await test.db.adminPool.query('select pg_notify($1, $2)', [
      LIVE_NOTIFY_CHANNEL,
      JSON.stringify({ kind: 'message', projectId, messageId: 'nope' }),
    ]);
    await notifyLive(test.db.admin, { kind: 'message', projectId, messageId: randomUUID() });
    await notifyLive(test.db.admin, {
      kind: 'delta',
      projectId,
      messageId: randomUUID(),
      text: 'x',
    });

    await until(() => eventsFor(projectId).length === 1);
    expect(eventsFor(projectId)[0]?.type).toBe('message_delta');
  });

  it('announces every change of the members from the database trigger (spec 21a)', async () => {
    const { projectId } = await projectWithMessage('Plain text');
    const changes = () =>
      published.filter((entry) => entry.projectId === projectId && entry.event.type === 'project')
        .length;
    // Creating the project added its owner.
    await until(() => changes() === 1);

    const other = await test.signIn();
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie: other }) });
    const member = [projectId, session?.user.id];
    await test.db.adminPool.query(
      `insert into project_members (project_id, user_id, role) values ($1, $2, 'viewer')`,
      member,
    );
    await until(() => changes() === 2);
    await test.db.adminPool.query(
      `update project_members set role = 'editor' where project_id = $1 and user_id = $2`,
      member,
    );
    await until(() => changes() === 3);
    await until(() =>
      closed.some(
        (entry) =>
          entry.projectId === projectId &&
          entry.userId === session?.user.id &&
          entry.scope === 'boards',
      ),
    );
    await test.db.adminPool.query(
      'delete from project_members where project_id = $1 and user_id = $2',
      member,
    );
    await until(() => changes() === 4);
    await until(() =>
      closed.some(
        (entry) =>
          entry.projectId === projectId &&
          entry.userId === session?.user.id &&
          entry.scope === 'all',
      ),
    );
  });

  it('refuses to send a notification that does not match the format', async () => {
    await expect(
      notifyLive(test.db.admin, {
        kind: 'delta',
        projectId: randomUUID(),
        messageId: randomUUID(),
        text: 'x'.repeat(3000),
      }),
    ).rejects.toThrow();
  });
});
