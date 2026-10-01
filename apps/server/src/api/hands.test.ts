import type {
  ApiErrorBody,
  ChatMessage,
  HandRaise,
  ProjectDetails,
  ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { loadMessage } from '@server/chat/rows';
import { APP_URL, createTestServer } from '@server/testing';

// Raised hands, offers and the observer switch (spec 15).
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

async function userIdOf(cookie: string) {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user.id;
}

async function createProject(cookie: string) {
  const created = await request('/api/projects', cookie, {
    method: 'POST',
    body: JSON.stringify({ name: 'Handzeichen' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  await test.db.admin
    .insertInto('project_agents')
    .values([
      { project_id: projectId, agent_key: 'security' },
      { project_id: projectId, agent_key: 'critic' },
    ])
    .execute();
  return projectId;
}

async function addMember(projectId: string, cookie: string, role: 'editor' | 'viewer') {
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, await userIdOf(cookie), role],
  );
}

/** An open raised hand, as the observer stores it. */
async function raiseHand(projectId: string, agentKey = 'security') {
  const row = await test.db.admin
    .insertInto('hand_raises')
    .values({ project_id: projectId, agent_key: agentKey, reason: 'Einwand zum Datenschutz' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** An open offer with the moderator's message, as the observer stores it. */
async function makeOffer(projectId: string) {
  const message = await test.db.admin
    .insertInto('messages')
    .values({
      project_id: projectId,
      author_kind: 'agent',
      author_agent_key: 'moderator',
      content: 'Ihr seid euch einig. Soll ich es festhalten?',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const offer = await test.db.admin
    .insertInto('offers')
    .values({
      project_id: projectId,
      message_id: message.id,
      kind: 'consensus',
      action: 'Ja, festhalten',
      task: 'Sum up the agreement.',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { offerId: offer.id, messageId: message.id };
}

const handsOf = async (projectId: string, cookie: string) =>
  (await (await request(`/api/projects/${projectId}/hands`, cookie)).json()) as HandRaise[];

describe('raised hands', () => {
  it('are listed while open, to members only', async () => {
    const owner = await test.signIn();
    const viewer = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, viewer, 'viewer');
    const id = await raiseHand(projectId);

    expect(await handsOf(projectId, viewer)).toEqual([
      {
        id,
        projectId,
        agentKey: 'security',
        reason: 'Einwand zum Datenschutz',
        createdAt: expect.any(String) as unknown,
      },
    ]);
    expect((await request(`/api/projects/${projectId}/hands`, stranger)).status).toBe(404);
  });

  it('let editors listen, which lets the agent speak, once', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const id = await raiseHand(projectId);

    const listened = await request(`/api/projects/${projectId}/hands/${id}/listen`, editor, {
      method: 'POST',
    });
    expect(listened.status).toBe(204);
    expect(await handsOf(projectId, owner)).toEqual([]);
    const run = await test.db.admin
      .selectFrom('ai_runs')
      .select(['agent_key', 'status', 'kind'])
      .where('hand_raise_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(run).toEqual({ agent_key: 'security', status: 'queued', kind: 'reply' });

    const again = await request(`/api/projects/${projectId}/hands/${id}/listen`, owner, {
      method: 'POST',
    });
    expect(await errorOf(again)).toBe('already_decided');
  });

  it('are dismissed by owners, and neither by viewers nor for other projects', async () => {
    const owner = await test.signIn();
    const viewer = await test.signIn();
    const projectId = await createProject(owner);
    const otherProject = await createProject(owner);
    await addMember(projectId, viewer, 'viewer');
    const id = await raiseHand(projectId);

    const byViewer = await request(`/api/projects/${projectId}/hands/${id}/dismiss`, viewer, {
      method: 'POST',
    });
    expect(byViewer.status).toBe(403);
    const elsewhere = await request(`/api/projects/${otherProject}/hands/${id}/dismiss`, owner, {
      method: 'POST',
    });
    expect(elsewhere.status).toBe(404);

    const dismissed = await request(`/api/projects/${projectId}/hands/${id}/dismiss`, owner, {
      method: 'POST',
    });
    expect(dismissed.status).toBe(204);
    const row = await test.db.admin
      .selectFrom('hand_raises')
      .select(['status', 'decided_by'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'dismissed', decided_by: await userIdOf(owner) });
    expect(
      await test.db.admin
        .selectFrom('ai_runs')
        .select('id')
        .where('hand_raise_id', '=', id)
        .execute(),
    ).toEqual([]);
  });
});

describe('offers', () => {
  it('show in their message; accepting starts the moderator and names who accepted', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const { offerId, messageId } = await makeOffer(projectId);

    const listed = (await (
      await request(`/api/projects/${projectId}/messages`, owner)
    ).json()) as ChatMessage[];
    expect(listed.find((message) => message.id === messageId)?.offer).toEqual({
      id: offerId,
      kind: 'consensus',
      action: 'Ja, festhalten',
      status: 'open',
      decidedBy: null,
    });

    const accepted = await request(`/api/projects/${projectId}/offers/${offerId}/accept`, editor, {
      method: 'POST',
    });
    expect(accepted.status).toBe(204);
    const message = await loadMessage(test.db.admin, messageId);
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie: editor }) });
    expect(message?.offer).toMatchObject({ status: 'accepted', decidedBy: session?.user.name });
    const run = await test.db.admin
      .selectFrom('ai_runs')
      .select(['agent_key', 'status'])
      .where('offer_id', '=', offerId)
      .executeTakeFirstOrThrow();
    expect(run).toEqual({ agent_key: 'moderator', status: 'queued' });
  });

  it('are declined without a run, once, and not by viewers', async () => {
    const owner = await test.signIn();
    const viewer = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, viewer, 'viewer');
    const { offerId, messageId } = await makeOffer(projectId);

    const byViewer = await request(`/api/projects/${projectId}/offers/${offerId}/decline`, viewer, {
      method: 'POST',
    });
    expect(byViewer.status).toBe(403);
    const declined = await request(`/api/projects/${projectId}/offers/${offerId}/decline`, owner, {
      method: 'POST',
    });
    expect(declined.status).toBe(204);
    expect((await loadMessage(test.db.admin, messageId))?.offer?.status).toBe('declined');
    const again = await request(`/api/projects/${projectId}/offers/${offerId}/accept`, owner, {
      method: 'POST',
    });
    expect(await errorOf(again)).toBe('already_decided');
    expect(
      await test.db.admin
        .selectFrom('ai_runs')
        .select('id')
        .where('offer_id', '=', offerId)
        .execute(),
    ).toEqual([]);
  });
});

describe('the observer switch', () => {
  it('is on by default and switched by owners only, keeping the other settings', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const details = async () =>
      (await (await request(`/api/projects/${projectId}`, owner)).json()) as ProjectDetails;
    const patch = (cookie: string, body: unknown) =>
      request(`/api/projects/${projectId}`, cookie, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

    expect((await details()).observer).toBe(true);
    expect((await patch(owner, { proposalsOnly: true })).status).toBe(204);
    expect((await patch(editor, { observer: false })).status).toBe(403);
    expect((await patch(owner, {})).status).toBe(400);
    expect((await patch(owner, { observer: false })).status).toBe(204);
    expect(await details()).toMatchObject({ observer: false, proposalsOnly: true });
  });
});
