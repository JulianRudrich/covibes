import { randomUUID } from 'node:crypto';

import type {
  ApiErrorBody,
  ChatMessage,
  CustomAgent,
  ProjectDetails,
  ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';

import { APP_URL, createTestServer } from '@server/testing';

// Custom agents (spec 19): creating, sharing, the team and mentions.
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
    body: JSON.stringify({ name: 'Eigene Agenten' }),
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

let names = 0;
/** A name no other test uses, valid as a mention. */
function freshName(prefix = 'Jurist') {
  names += 1;
  return `${prefix} ${String(names)}`;
}

const create = (cookie: string, input: Record<string, unknown> = {}) =>
  request('/api/agents', cookie, {
    method: 'POST',
    body: JSON.stringify({ name: freshName(), role: 'Prüft Verträge', color: 2, ...input }),
  });

async function created(cookie: string, input: Record<string, unknown> = {}) {
  const response = await create(cookie, input);
  expect(response.status).toBe(201);
  return (await response.json()) as CustomAgent;
}

const update = (cookie: string, agentId: string, input: Record<string, unknown>) =>
  request(`/api/agents/${agentId}`, cookie, { method: 'PATCH', body: JSON.stringify(input) });

const remove = (cookie: string, agentId: string) =>
  request(`/api/agents/${agentId}`, cookie, { method: 'DELETE' });

const listOf = async (cookie: string, projectId?: string) =>
  (await (
    await request(`/api/agents${projectId ? `?projectId=${projectId}` : ''}`, cookie)
  ).json()) as CustomAgent[];

const detailsOf = async (projectId: string, cookie: string) =>
  (await (await request(`/api/projects/${projectId}`, cookie)).json()) as ProjectDetails;

const addToTeam = (projectId: string, cookie: string, agentKey: string) =>
  request(`/api/projects/${projectId}/agents`, cookie, {
    method: 'POST',
    body: JSON.stringify({ agentKey }),
  });

describe('personal agents', () => {
  it('are created with their settings and listed for their creator only', async () => {
    const olga = await test.signIn();
    const other = await test.signIn();
    const name = freshName();

    const agent = await created(olga, {
      name,
      instructions: '  Achte auf Haftung.  ',
      canDraw: false,
      model: 'claude-sonnet-5-5',
      color: 4,
      template: 'critic',
    });

    expect(agent).toMatchObject({
      name,
      role: 'Prüft Verträge',
      instructions: 'Achte auf Haftung.',
      canDraw: false,
      model: 'claude-sonnet-5-5',
      color: 4,
      template: 'critic',
      scope: 'personal',
      projectId: null,
      deleted: false,
    });
    expect((await listOf(olga)).map((entry) => entry.key)).toContain(agent.key);
    expect((await listOf(other)).map((entry) => entry.key)).not.toContain(agent.key);
    expect((await request('/api/agents', '')).status).toBe(401);
  });

  it('need a name that works as a mention and that no catalog agent answers to', async () => {
    const olga = await test.signIn();
    for (const name of ['X', 'Zwei  Leerzeichen', 'Mit@Zeichen', 'Backend', 'kritiker', 'UX']) {
      const response = await create(olga, { name });
      expect(response.status, name).toBe(400);
    }
    expect((await create(olga, { role: '' })).status).toBe(400);
    expect((await create(olga, { color: 7 })).status).toBe(400);
    expect((await create(olga, { model: 'gpt-4' })).status).toBe(400);
    expect((await create(olga, { template: 'moderator' })).status).toBe(400);
    expect((await create(olga, { instructions: 'x'.repeat(4001) })).status).toBe(400);
  });

  it('have a unique name per person', async () => {
    const olga = await test.signIn();
    const other = await test.signIn();
    const name = freshName();
    await created(olga, { name });

    const again = await create(olga, { name: name.toUpperCase() });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe('name_taken');
    await created(other, { name });
  });

  it('are changed and deleted by their creator only', async () => {
    const olga = await test.signIn();
    const other = await test.signIn();
    const agent = await created(olga);

    const changed = await update(olga, agent.key, { role: 'Prüft AGB', canDraw: false, color: 5 });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ role: 'Prüft AGB', canDraw: false, color: 5 });
    expect((await update(olga, agent.key, {})).status).toBe(400);
    expect((await update(other, agent.key, { role: 'Gekapert' })).status).toBe(404);
    expect((await remove(other, agent.key)).status).toBe(404);

    expect((await remove(olga, agent.key)).status).toBe(204);
    expect((await listOf(olga)).map((entry) => entry.key)).not.toContain(agent.key);
    expect((await remove(olga, agent.key)).status).toBe(404);
    expect((await update(olga, agent.key, { role: 'Zu spät' })).status).toBe(404);
  });

  it('stop at twenty per person', async () => {
    const olga = await test.signIn();
    for (let count = 0; count < 20; count += 1) await created(olga);
    const next = await create(olga);
    expect(next.status).toBe(409);
    expect(await errorOf(next)).toBe('limit_reached');
  });
});

describe('agents shared in a project', () => {
  it('are created by owners and editors and visible to every member', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addMember(projectId, viewer, 'viewer');
    const publish = vi.spyOn(test.realtime, 'publish');

    const agent = await created(editor, { projectId, instructions: 'Sei knapp.' });
    expect(agent).toMatchObject({ scope: 'project', projectId });
    expect(publish).toHaveBeenCalledWith(projectId, { type: 'project' });

    for (const member of [owner, editor, viewer]) {
      const shared = (await listOf(member, projectId)).find((entry) => entry.key === agent.key);
      expect(shared?.instructions).toBe('Sei knapp.');
    }
    // Without the project, the list holds personal agents only.
    expect((await listOf(owner)).map((entry) => entry.key)).not.toContain(agent.key);
    expect((await listOf(stranger, projectId)).map((entry) => entry.key)).not.toContain(agent.key);

    expect((await create(viewer, { projectId })).status).toBe(403);
    expect((await create(stranger, { projectId })).status).toBe(404);
    publish.mockRestore();
  });

  it('are changed and deleted by owners and editors, not by viewers', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addMember(projectId, viewer, 'viewer');
    const agent = await created(editor, { projectId });

    expect((await update(owner, agent.key, { role: 'Vom Owner' })).status).toBe(200);
    expect((await update(viewer, agent.key, { role: 'Vom Viewer' })).status).toBe(403);
    expect((await remove(viewer, agent.key)).status).toBe(403);
    expect((await remove(owner, agent.key)).status).toBe(204);
  });

  it('are shared and taken back by their creator', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const foreign = await createProject(await test.signIn());
    const agent = await created(editor);

    expect((await update(editor, agent.key, { projectId: foreign })).status).toBe(404);
    const shared = await update(editor, agent.key, { projectId });
    expect(await shared.json()).toMatchObject({ scope: 'project', projectId });
    expect((await listOf(owner, projectId)).map((entry) => entry.key)).toContain(agent.key);

    // The owner of the project edits it but cannot take it for themselves.
    expect((await update(owner, agent.key, { projectId: null })).status).toBe(403);
    const back = await update(editor, agent.key, { projectId: null });
    expect(await back.json()).toMatchObject({ scope: 'personal', projectId: null });
    expect((await listOf(owner, projectId)).map((entry) => entry.key)).not.toContain(agent.key);
  });
});

describe('custom agents in a team', () => {
  it('join the team of a project and show in its directory without instructions', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const personal = await created(editor, { name: 'Zeta Agent', instructions: 'Geheim.' });
    const shared = await created(owner, { name: 'Alpha Agent', projectId });

    expect((await addToTeam(projectId, editor, personal.key)).status).toBe(204);
    expect((await addToTeam(projectId, editor, shared.key)).status).toBe(204);
    expect((await addToTeam(projectId, editor, 'critic')).status).toBe(204);
    // Someone else's personal agent cannot be added, not even by the owner of the project.
    const second = await created(editor);
    expect((await addToTeam(projectId, owner, second.key)).status).toBe(404);
    expect((await addToTeam(projectId, owner, randomUUID())).status).toBe(404);

    const details = await detailsOf(projectId, owner);
    // Catalog agents first, then custom agents by name.
    expect(details.agents.map((agent) => agent.key)).toEqual([
      'moderator',
      'critic',
      shared.key,
      personal.key,
    ]);
    const entry = details.customAgents.find((agent) => agent.key === personal.key);
    expect(entry).toMatchObject({ name: 'Zeta Agent', scope: 'personal', deleted: false });
    expect(entry).not.toHaveProperty('instructions');
    expect(JSON.stringify(details)).not.toContain('Geheim.');
  });

  it('refuse a second agent that answers to the same name', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const name = freshName('Doppel');
    const first = await created(owner, { name });
    const second = await created(editor, { name: name.toLowerCase() });

    expect((await addToTeam(projectId, owner, first.key)).status).toBe(204);
    const clash = await addToTeam(projectId, editor, second.key);
    expect(clash.status).toBe(409);
    expect(await errorOf(clash)).toBe('name_taken');
    // Adding the same agent again is fine and changes nothing.
    expect((await addToTeam(projectId, owner, first.key)).status).toBe(204);
  });

  it('answer a mention by their name and keep their name after they were deleted', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const agent = await created(owner, { name: 'UX Writer' });
    await addToTeam(projectId, owner, agent.key);

    const sent = await request(`/api/projects/${projectId}/messages`, owner, {
      method: 'POST',
      body: JSON.stringify({
        id: randomUUID(),
        content: '@ux-writer und @Kritiker, wie nennen wir den Knopf? @UX Writer zählt nicht.',
      }),
    });
    const message = (await sent.json()) as ChatMessage;
    // The critic is not in the team; "@UX" alone is the frontend agent's name, not this one.
    expect(message.mentions).toEqual([agent.key]);
    const runs = await test.db.admin
      .selectFrom('ai_runs')
      .select('agent_key')
      .where('trigger_message_id', '=', message.id)
      .execute();
    expect(runs).toEqual([{ agent_key: agent.key }]);

    const model = await request(`/api/projects/${projectId}/agents/${agent.key}`, owner, {
      method: 'PATCH',
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001' }),
    });
    expect(model.status).toBe(204);

    expect((await remove(owner, agent.key)).status).toBe(204);
    const details = await detailsOf(projectId, owner);
    expect(details.agents.map((entry) => entry.key)).toEqual(['moderator']);
    // The run keeps the agent in the directory, so its messages keep their name.
    expect(details.customAgents).toMatchObject([
      { key: agent.key, name: 'UX Writer', deleted: true },
    ]);
  });

  it('leave a team without being deleted', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const agent = await created(owner);
    await addToTeam(projectId, owner, agent.key);

    const removed = await request(`/api/projects/${projectId}/agents/${agent.key}`, owner, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(204);
    expect((await detailsOf(projectId, owner)).agents.map((entry) => entry.key)).toEqual([
      'moderator',
    ]);
    expect((await listOf(owner)).map((entry) => entry.key)).toContain(agent.key);
  });

  it('tell the projects that use them when they change', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const agent = await created(owner);
    await addToTeam(projectId, owner, agent.key);
    const publish = vi.spyOn(test.realtime, 'publish');

    await update(owner, agent.key, { role: 'Neu' });

    expect(publish).toHaveBeenCalledWith(projectId, { type: 'project' });
    publish.mockRestore();
  });
});
