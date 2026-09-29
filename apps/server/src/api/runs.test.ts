import { randomUUID } from 'node:crypto';

import type { AiRun, ProjectSummary } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { createTestServer } from '@server/testing';

const test = createTestServer();

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  return test.app.request(path, { ...init, headers });
}

async function createProject(cookie: string) {
  const response = await request('/api/projects', cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Runs' }),
  });
  return ((await response.json()) as ProjectSummary).id;
}

function send(cookie: string, projectId: string, content: string) {
  return request(`/api/projects/${projectId}/messages`, cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: randomUUID(), content }),
  });
}

async function runs(cookie: string, projectId: string) {
  const response = await request(`/api/projects/${projectId}/runs`, cookie);
  return { status: response.status, body: (await response.json()) as AiRun[] };
}

describe('runs', () => {
  it('lists the runs that wait or work, oldest first', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    await send(owner, projectId, '@Moderator, first');
    await send(owner, projectId, 'no mention');
    await send(owner, projectId, '@moderator, second');

    const { status, body } = await runs(owner, projectId);
    expect(status).toBe(200);
    expect(body.map((run) => [run.agentKey, run.status])).toEqual([
      ['moderator', 'queued'],
      ['moderator', 'queued'],
    ]);
    expect(body[0]?.projectId).toBe(projectId);
  });

  it('leaves out finished runs', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    await send(owner, projectId, '@Moderator, hello');
    await test.db.adminPool.query("update ai_runs set status = 'done' where project_id = $1", [
      projectId,
    ]);

    expect((await runs(owner, projectId)).body).toEqual([]);
  });

  it('answers 401 without a session and 404 for strangers', async () => {
    const owner = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);

    expect((await test.app.request(`/api/projects/${projectId}/runs`)).status).toBe(401);
    expect((await runs(stranger, projectId)).status).toBe(404);
    expect((await runs(owner, 'not-a-uuid')).status).toBe(404);
  });
});
