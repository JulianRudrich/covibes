import { randomUUID } from 'node:crypto';

import type {
  ApiErrorBody,
  ChatMessage,
  CreatedInvitation,
  NotificationList,
  OpenVote,
  ProjectSummary,
} from '@covibes/shared';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { withUser } from '@server/db/database';
import { APP_URL, createTestServer } from '@server/testing';

// Mentions of people, notifications and what waits for someone (spec 22a).
const test = createTestServer();

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  return test.app.request(path, { ...init, headers });
}

/** Signs in and gives the account a name people can be mentioned by. */
async function person(name: string) {
  const cookie = await test.signIn();
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  await test.db.adminPool.query('update users set name = $1 where id = $2', [
    name,
    session.user.id,
  ]);
  return { cookie, id: session.user.id };
}

async function createProject(cookie: string, name = 'Vereins-App') {
  const created = await request('/api/projects', cookie, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return ((await created.json()) as ProjectSummary).id;
}

async function addMember(projectId: string, userId: string, role: 'editor' | 'viewer') {
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, userId, role],
  );
}

async function say(cookie: string, projectId: string, content: string) {
  const response = await request(`/api/projects/${projectId}/messages`, cookie, {
    method: 'POST',
    body: JSON.stringify({ id: randomUUID(), content }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as ChatMessage;
}

async function notificationsOf(cookie: string) {
  const response = await request('/api/notifications', cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as NotificationList;
}

const markRead = (cookie: string, body: Record<string, unknown>) =>
  request('/api/notifications/read', cookie, { method: 'POST', body: JSON.stringify(body) });

async function projectsOf(cookie: string) {
  return (await (await request('/api/projects', cookie)).json()) as ProjectSummary[];
}

describe('mentioning people', () => {
  it('stores whom a message mentions and notifies them', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex Berg');
    const projectId = await createProject(olga.cookie, 'Sportverein');
    await addMember(projectId, alex.id, 'editor');

    const message = await say(
      olga.cookie,
      projectId,
      'Hallo @Alex-Berg, schaust du dir\n  das Datenmodell an? Danke, @alex-berg!',
    );

    expect(message.mentionedUsers).toEqual([alex.id]);
    expect(message.mentions).toEqual([]);
    expect(await notificationsOf(alex.cookie)).toEqual({
      notifications: [
        {
          id: expect.any(String) as unknown,
          kind: 'mention',
          projectId,
          projectName: 'Sportverein',
          actorName: 'Olga',
          excerpt: 'Hallo @Alex-Berg, schaust du dir das Datenmodell an? Danke, @alex-berg!',
          role: null,
          createdAt: expect.any(String) as unknown,
          read: false,
        },
      ],
      unread: 1,
    });
    // Everyone else in the project gets the stored mention with the message.
    const listed = (await (
      await request(`/api/projects/${projectId}/messages`, alex.cookie)
    ).json()) as ChatMessage[];
    expect(listed[0]?.mentionedUsers).toEqual([alex.id]);
  });

  it('mentions members only, never the author, and all who share a handle', async () => {
    const olga = await person('Olga');
    const first = await person('Sam');
    const second = await person('sam');
    const stranger = await person('Fremd');
    const projectId = await createProject(olga.cookie);
    await addMember(projectId, first.id, 'editor');
    await addMember(projectId, second.id, 'viewer');

    const message = await say(olga.cookie, projectId, '@Sam @Olga @Fremd @Niemand sam@example.com');

    expect([...(message.mentionedUsers ?? [])].sort()).toEqual([first.id, second.id].sort());
    expect((await notificationsOf(first.cookie)).unread).toBe(1);
    expect((await notificationsOf(second.cookie)).unread).toBe(1);
    expect((await notificationsOf(stranger.cookie)).notifications).toEqual([]);
    expect(
      (await notificationsOf(olga.cookie)).notifications.filter(
        (entry) => entry.kind === 'mention',
      ),
    ).toEqual([]);
    // A message without a mention carries none.
    expect((await say(olga.cookie, projectId, 'Nur Text')).mentionedUsers).toBeUndefined();
  });

  it('lets an agent of the team keep its name', async () => {
    const olga = await person('Olga');
    const namesake = await person('Backend');
    const projectId = await createProject(olga.cookie);
    await addMember(projectId, namesake.id, 'editor');

    // Without the agent in the team the name is the person's.
    const before = await say(olga.cookie, projectId, '@Backend, hast du Zeit?');
    expect(before.mentionedUsers).toEqual([namesake.id]);
    expect(before.mentions).toEqual([]);

    const added = await request(`/api/projects/${projectId}/agents`, olga.cookie, {
      method: 'POST',
      body: JSON.stringify({ agentKey: 'backend' }),
    });
    expect(added.status).toBeLessThan(300);
    const after = await say(olga.cookie, projectId, '@Backend, was meinst du?');
    expect(after.mentions).toEqual(['backend']);
    expect(after.mentionedUsers).toBeUndefined();
  });
});

describe('notifications', () => {
  it('are marked as read one by one, per project, or all at once', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const one = await createProject(olga.cookie, 'Eins');
    const two = await createProject(olga.cookie, 'Zwei');
    await addMember(one, alex.id, 'editor');
    await addMember(two, alex.id, 'editor');
    await say(olga.cookie, one, '@Alex erste');
    await say(olga.cookie, one, '@Alex zweite');
    await say(olga.cookie, two, '@Alex dritte');
    const unread = async () => (await notificationsOf(alex.cookie)).unread;
    expect(await unread()).toBe(3);
    // Newest first.
    const { notifications } = await notificationsOf(alex.cookie);
    expect(notifications.map((entry) => entry.excerpt)).toEqual([
      '@Alex dritte',
      '@Alex zweite',
      '@Alex erste',
    ]);

    expect((await markRead(alex.cookie, { ids: [notifications[2]?.id] })).status).toBe(204);
    expect(await unread()).toBe(2);
    // Someone else's notification is none of the caller's.
    expect((await markRead(olga.cookie, { ids: [notifications[0]?.id] })).status).toBe(204);
    expect(await unread()).toBe(2);

    expect((await markRead(alex.cookie, { projectId: one })).status).toBe(204);
    expect(await unread()).toBe(1);
    expect((await markRead(alex.cookie, { all: true })).status).toBe(204);
    expect(await unread()).toBe(0);
    expect((await notificationsOf(alex.cookie)).notifications.every((entry) => entry.read)).toBe(
      true,
    );
  });

  it('need a session and a clear target', async () => {
    const olga = await person('Olga');

    expect((await test.app.request('/api/notifications')).status).toBe(401);
    for (const body of [{}, { ids: [] }, { ids: ['x'] }, { all: false }, { all: true, ids: [] }]) {
      const response = await markRead(olga.cookie, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(((await response.json()) as ApiErrorBody).error.code).toBe('invalid_input');
    }
  });

  it('tell about a new member, a changed role and a removal', async () => {
    const olga = await person('Olga');
    const sam = await person('Sam');
    const projectId = await createProject(olga.cookie, 'Team');
    const created = (await (
      await request(`/api/projects/${projectId}/invitations`, olga.cookie, {
        method: 'POST',
        body: JSON.stringify({ kind: 'link', role: 'viewer' }),
      })
    ).json()) as CreatedInvitation;
    const token = created.url?.split('/invite/')[1];

    await request('/api/invitations/accept', sam.cookie, {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    expect((await notificationsOf(olga.cookie)).notifications).toMatchObject([
      { kind: 'joined', projectName: 'Team', actorName: 'Sam', role: 'viewer', read: false },
    ]);
    // Whoever joins is told nothing about it.
    expect((await notificationsOf(sam.cookie)).notifications).toEqual([]);

    const member = `/api/projects/${projectId}/members/${sam.id}`;
    await request(member, olga.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'editor' }),
    });
    await request(member, olga.cookie, { method: 'DELETE' });

    // The removed person still reads what happened, newest first.
    expect((await notificationsOf(sam.cookie)).notifications).toMatchObject([
      { kind: 'removed', projectId, projectName: 'Team', actorName: 'Olga', role: null },
      { kind: 'role_changed', projectName: 'Team', actorName: 'Olga', role: 'editor' },
    ]);
    // Opening a project reads its mentions only; these stay until they are seen.
    await markRead(sam.cookie, { projectId });
    expect((await notificationsOf(sam.cookie)).unread).toBe(2);
  });

  it('tell about a task someone gave the person (spec 26b)', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const projectId = await createProject(olga.cookie, 'Team');
    await addMember(projectId, alex.id, 'editor');

    // What assigning a task on the roadmap or in the plan does in the database.
    await withUser(test.db.app, olga.id, (trx) =>
      sql`select public.assign_task(${projectId}, ${randomUUID()}, ${alex.id}, ${'Login bauen'})`.execute(
        trx,
      ),
    );

    expect(await notificationsOf(alex.cookie)).toEqual({
      notifications: [
        {
          id: expect.any(String) as unknown,
          kind: 'task_assigned',
          projectId,
          projectName: 'Team',
          actorName: 'Olga',
          excerpt: 'Login bauen',
          role: null,
          createdAt: expect.any(String) as unknown,
          read: false,
        },
      ],
      unread: 1,
    });
    // Like a changed role, it stays until it is seen.
    await markRead(alex.cookie, { projectId });
    expect((await notificationsOf(alex.cookie)).unread).toBe(1);
  });
});

describe('what waits for someone', () => {
  it('is counted per project in the project list', async () => {
    const olga = await person('Olga');
    const vera = await person('Vera');
    const projectId = await createProject(olga.cookie);
    await createProject(olga.cookie, 'Ruhig');
    await addMember(projectId, vera.id, 'viewer');
    await test.db.adminPool.query(
      `insert into hand_raises (project_id, agent_key, reason) values
        ($1, 'critic', 'Einwand zu den Kosten'), ($1, 'security', 'Frage zum Datenschutz')`,
      [projectId],
    );

    const waiting = async (cookie: string) =>
      Object.fromEntries(
        (await projectsOf(cookie)).map((project) => [project.name, project.waiting]),
      );
    expect(await waiting(olga.cookie)).toEqual({ 'Vereins-App': 2, Ruhig: 0 });
    // Nothing waits for someone who only reads.
    expect(await waiting(vera.cookie)).toEqual({ 'Vereins-App': 0 });
  });

  it('includes the open votes of a project, with who voted for what', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const stranger = await person('Fremd');
    const projectId = await createProject(olga.cookie);
    await addMember(projectId, alex.id, 'editor');
    const message = await test.db.adminPool.query<{ id: string }>(
      `insert into messages (project_id, author_kind, author_agent_key, content)
       values ($1, 'agent', 'moderator', 'Stimmt bitte ab.') returning id`,
      [projectId],
    );
    const vote = await test.db.adminPool.query<{ id: string }>(
      `insert into votes (project_id, message_id, topic, options)
       values ($1, $2, 'Hosting', '["Eigener Server", "Verwalteter Dienst"]') returning id`,
      [projectId, message.rows[0]?.id],
    );
    const votesOf = async (cookie: string) =>
      (await (await request(`/api/projects/${projectId}/votes`, cookie)).json()) as OpenVote[];

    expect(await votesOf(alex.cookie)).toEqual([
      {
        id: vote.rows[0]?.id,
        messageId: message.rows[0]?.id,
        topic: 'Hosting',
        options: ['Eigener Server', 'Verwalteter Dienst'],
        status: 'open',
        winner: null,
        ballots: [],
        createdAt: expect.any(String) as unknown,
      },
    ]);
    expect((await projectsOf(alex.cookie))[0]?.waiting).toBe(1);

    const cast = await request(
      `/api/projects/${projectId}/votes/${vote.rows[0]?.id ?? ''}/cast`,
      alex.cookie,
      { method: 'POST', body: JSON.stringify({ option: 1 }) },
    );
    expect(cast.status).toBe(204);
    expect((await votesOf(olga.cookie))[0]?.ballots).toEqual([{ userId: alex.id, option: 1 }]);
    // The vote waits for olga still, no longer for alex.
    expect((await projectsOf(alex.cookie))[0]?.waiting).toBe(0);
    expect((await projectsOf(olga.cookie))[0]?.waiting).toBe(1);

    expect((await request(`/api/projects/${projectId}/votes`, stranger.cookie)).status).toBe(404);
  });
});
