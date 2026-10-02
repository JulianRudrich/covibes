import type { ApiErrorBody, ProjectDetails, ProjectSummary } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { createTestServer } from '@server/testing';

const { app, signIn, auth, db } = createTestServer();

function request(path: string, cookie?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  return app.request(path, { ...init, headers });
}

function create(cookie: string, body: unknown) {
  return request('/api/projects', cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function errorCode(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

describe('without a session', () => {
  it('answers every project route with 401', async () => {
    const responses = await Promise.all([
      request('/api/projects'),
      create('', { name: 'Test' }),
      request('/api/projects/0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de'),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe('unauthorized');
    }
  });

  it('rejects a forged session cookie', async () => {
    const response = await request('/api/projects', 'covibes.session_token=forged');
    expect(response.status).toBe(401);
  });
});

describe('projects', () => {
  it('starts with an empty list', async () => {
    const cookie = await signIn();
    const response = await request('/api/projects', cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('validates the name', async () => {
    const cookie = await signIn();
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(121) }, 'text']) {
      const response = await create(cookie, body);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe('invalid_input');
    }
    const broken = await request('/api/projects', cookie, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(broken.status).toBe(400);
  });

  it('creates a project, lists it and shows its details', async () => {
    const cookie = await signIn('olga@example.com');
    const created = await create(cookie, { name: '  Covibes V1  ' });
    expect(created.status).toBe(201);
    const project = (await created.json()) as ProjectSummary;
    expect(project).toMatchObject({ name: 'Covibes V1', role: 'owner' });
    expect(Number.isNaN(Date.parse(project.updatedAt))).toBe(false);

    const list = (await (await request('/api/projects', cookie)).json()) as ProjectSummary[];
    expect(list).toEqual([project]);

    const details = await request(`/api/projects/${project.id}`, cookie);
    expect(details.status).toBe(200);
    const body = (await details.json()) as ProjectDetails;
    expect(body).toMatchObject({
      id: project.id,
      name: 'Covibes V1',
      role: 'owner',
      // A new project starts with brainstorming (spec 24).
      phase: 'brainstorming',
      // Its plan is written in German unless the project says otherwise (spec 25a).
      language: 'de',
    });
    // New users get the start of their address as name until profiles exist.
    expect(body.members).toHaveLength(1);
    expect(body.members[0]).toMatchObject({ name: 'olga', role: 'owner' });
    expect(body.boards).toHaveLength(1);
    expect(body.boards[0]).toMatchObject({ title: 'Haupt-Canvas', kind: 'main' });
  });

  it('keeps projects invisible for other users', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const project = (await (await create(owner, { name: 'Geheim' })).json()) as ProjectSummary;

    expect(await (await request('/api/projects', stranger)).json()).toEqual([]);
    const details = await request(`/api/projects/${project.id}`, stranger);
    expect(details.status).toBe(404);
    expect(await errorCode(details)).toBe('not_found');
  });

  it('answers unknown and malformed ids with 404', async () => {
    const cookie = await signIn();
    for (const id of ['0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de', 'demo']) {
      const response = await request(`/api/projects/${id}`, cookie);
      expect(response.status).toBe(404);
      expect(await errorCode(response)).toBe('not_found');
    }
  });
});

describe('the phase of a project (spec 24)', () => {
  const setPhase = (cookie: string | undefined, projectId: string, body: unknown) =>
    request(`/api/projects/${projectId}/phase`, cookie, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function phaseOf(cookie: string, projectId: string) {
    const details = await request(`/api/projects/${projectId}`, cookie);
    return ((await details.json()) as ProjectDetails).phase;
  }

  /** Signs someone in and adds them to the project. */
  async function member(projectId: string, role: 'editor' | 'viewer') {
    const cookie = await signIn();
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    await db.adminPool.query(
      'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
      [projectId, session?.user.id, role],
    );
    return cookie;
  }

  it('is changed by owners and editors, forward and back', async () => {
    const owner = await signIn();
    const { id } = (await (await create(owner, { name: 'Phasen' })).json()) as ProjectSummary;
    const editor = await member(id, 'editor');

    expect((await setPhase(editor, id, { phase: 'architecture' })).status).toBe(204);
    expect(await phaseOf(owner, id)).toBe('architecture');
    expect((await setPhase(owner, id, { phase: 'decide' })).status).toBe(204);
    expect(await phaseOf(editor, id)).toBe('decide');
    // The same phase again is fine and changes nothing.
    expect((await setPhase(owner, id, { phase: 'decide' })).status).toBe(204);
  });

  it('is read but not changed by viewers', async () => {
    const owner = await signIn();
    const { id } = (await (await create(owner, { name: 'Phasen' })).json()) as ProjectSummary;
    const viewer = await member(id, 'viewer');

    const refused = await setPhase(viewer, id, { phase: 'plan' });
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe('forbidden');
    expect(await phaseOf(viewer, id)).toBe('brainstorming');
  });

  it('is nothing a stranger or someone without a session can touch', async () => {
    const owner = await signIn();
    const { id } = (await (await create(owner, { name: 'Phasen' })).json()) as ProjectSummary;

    const stranger = await setPhase(await signIn(), id, { phase: 'plan' });
    expect(stranger.status).toBe(404);
    expect((await setPhase(undefined, id, { phase: 'plan' })).status).toBe(401);
    expect((await setPhase(owner, 'demo', { phase: 'plan' })).status).toBe(404);
    expect(await phaseOf(owner, id)).toBe('brainstorming');
  });

  it('is one of the four phases', async () => {
    const owner = await signIn();
    const { id } = (await (await create(owner, { name: 'Phasen' })).json()) as ProjectSummary;

    for (const body of [{ phase: 'launch' }, {}, null]) {
      const response = await setPhase(owner, id, body);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe('invalid_input');
    }
  });
});
