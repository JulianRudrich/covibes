import { randomUUID } from 'node:crypto';

import type { ApiErrorBody, ChatMessage, ProjectDetails, ProjectSummary } from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';

import { APP_URL, createTestServer } from '@server/testing';

// The project's agent team (spec 14).
const test = createTestServer();

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  if (init.body) headers.set('content-type', 'application/json');
  return test.app.request(path, { ...init, headers });
}

async function errorOf(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

async function createProject(cookie: string) {
  const created = await request('/api/projects', cookie, {
    method: 'POST',
    body: JSON.stringify({ name: 'Team' }),
  });
  return ((await created.json()) as ProjectSummary).id;
}

async function addMember(projectId: string, cookie: string, role: 'editor' | 'viewer') {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, session.user.id, role],
  );
}

async function teamOf(projectId: string, cookie: string) {
  const response = await request(`/api/projects/${projectId}`, cookie);
  return ((await response.json()) as ProjectDetails).agents;
}

const addAgent = (projectId: string, cookie: string, agentKey: string) =>
  request(`/api/projects/${projectId}/agents`, cookie, {
    method: 'POST',
    body: JSON.stringify({ agentKey }),
  });

const removeAgent = (projectId: string, cookie: string, agentKey: string) =>
  request(`/api/projects/${projectId}/agents/${agentKey}`, cookie, { method: 'DELETE' });

const chooseModel = (projectId: string, cookie: string, agentKey: string, model: string | null) =>
  request(`/api/projects/${projectId}/agents/${agentKey}`, cookie, {
    method: 'PATCH',
    body: JSON.stringify({ model }),
  });

describe('team', () => {
  it('starts with the moderator only', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    expect(await teamOf(projectId, owner)).toEqual([{ key: 'moderator', model: null }]);
  });

  it('owners and editors add and remove specialists, and everyone hears of it', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const publish = vi.spyOn(test.realtime, 'publish');

    expect((await addAgent(projectId, editor, 'security')).status).toBe(204);
    expect((await addAgent(projectId, owner, 'critic')).status).toBe(204);
    // Adding again changes nothing.
    expect((await addAgent(projectId, owner, 'critic')).status).toBe(204);
    expect(await teamOf(projectId, owner)).toEqual([
      { key: 'moderator', model: null },
      { key: 'critic', model: null },
      { key: 'security', model: null },
    ]);
    expect(publish).toHaveBeenCalledWith(projectId, { type: 'project' });

    expect((await removeAgent(projectId, editor, 'critic')).status).toBe(204);
    expect((await removeAgent(projectId, editor, 'critic')).status).toBe(404);
    expect((await teamOf(projectId, owner)).map((agent) => agent.key)).toEqual([
      'moderator',
      'security',
    ]);
    publish.mockRestore();
  });

  it('keeps the moderator', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const removed = await removeAgent(projectId, owner, 'moderator');
    expect(removed.status).toBe(403);
    const added = await addAgent(projectId, owner, 'moderator');
    expect(await errorOf(added)).toBe('invalid_input');
    expect(await teamOf(projectId, owner)).toEqual([{ key: 'moderator', model: null }]);
  });

  it('lets viewers only see the team, and strangers not even that', async () => {
    const owner = await test.signIn();
    const viewer = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, viewer, 'viewer');
    await addAgent(projectId, owner, 'data');

    expect((await teamOf(projectId, viewer)).map((agent) => agent.key)).toEqual([
      'moderator',
      'data',
    ]);
    expect((await addAgent(projectId, viewer, 'ml')).status).toBe(403);
    expect((await removeAgent(projectId, viewer, 'data')).status).toBe(403);
    expect((await addAgent(projectId, stranger, 'ml')).status).toBe(404);
    expect((await removeAgent(projectId, stranger, 'data')).status).toBe(404);
  });

  it('rejects unknown agents', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    expect(await errorOf(await addAgent(projectId, owner, 'ghost'))).toBe('invalid_input');
    expect((await removeAgent(projectId, owner, 'ghost')).status).toBe(404);
  });

  it('lets only owners choose the model of a team agent', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addAgent(projectId, owner, 'backend');

    expect((await chooseModel(projectId, editor, 'backend', 'claude-sonnet-5-5')).status).toBe(403);
    expect((await chooseModel(projectId, owner, 'backend', 'claude-sonnet-5-5')).status).toBe(204);
    expect(
      (await chooseModel(projectId, owner, 'moderator', 'claude-haiku-4-5-20251001')).status,
    ).toBe(204);
    expect(await teamOf(projectId, owner)).toEqual([
      { key: 'moderator', model: 'claude-haiku-4-5-20251001' },
      { key: 'backend', model: 'claude-sonnet-5-5' },
    ]);

    expect((await chooseModel(projectId, owner, 'backend', null)).status).toBe(204);
    expect(await errorOf(await chooseModel(projectId, owner, 'backend', 'gpt-9'))).toBe(
      'invalid_input',
    );
    expect((await chooseModel(projectId, owner, 'critic', null)).status).toBe(404);
  });
});

describe('mentions', () => {
  it('keeps only mentions of team agents, and only they answer', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    await addAgent(projectId, owner, 'critic');

    const send = async (content: string) => {
      const response = await request(`/api/projects/${projectId}/messages`, owner, {
        method: 'POST',
        body: JSON.stringify({ id: randomUUID(), content }),
      });
      return (await response.json()) as ChatMessage;
    };
    const message = await send('@Kritiker und @Sicherheit, was meint ihr? @Moderator auch.');
    expect(message.mentions).toEqual(['critic', 'moderator']);

    const runs = await test.db.admin
      .selectFrom('ai_runs')
      .select('agent_key')
      .where('trigger_message_id', '=', message.id)
      .execute();
    expect(runs.map((run) => run.agent_key).sort()).toEqual(['critic', 'moderator']);
  });
});
