import { randomUUID } from 'node:crypto';

import type { LiveEvent, ProjectSummary } from '@covibes/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LIVE_NOTIFY_CHANNEL, notifyLive, startLiveBridge } from '@server/realtime/notifications';
import { createTestServer } from '@server/testing';

const test = createTestServer();
const published: { projectId: string; event: LiveEvent }[] = [];
let bridge: ReturnType<typeof startLiveBridge>;

beforeAll(async () => {
  bridge = startLiveBridge({
    adminPool: test.db.adminPool,
    admin: test.db.admin,
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

function eventsFor(projectId: string) {
  return published.filter((entry) => entry.projectId === projectId).map((entry) => entry.event);
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
