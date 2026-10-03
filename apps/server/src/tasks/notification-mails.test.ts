import { randomUUID } from 'node:crypto';

import type { ProjectSummary } from '@covibes/shared';
import { sql } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { withUser } from '@server/db/database';
import { DevOutbox } from '@server/integrations/mail/mailer';
import {
  MAIL_GAP_MS,
  sendNotificationMail,
  type NotificationMailDeps,
} from '@server/tasks/notification-mails';
import { APP_URL, createTestServer } from '@server/testing';

// The mail job of a person (spec 22b).
const test = createTestServer();

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  return test.app.request(path, { ...init, headers });
}

/** Signs in and gives the account a name and an address the mail can be found by. */
async function person(name: string) {
  const email = `${name.toLowerCase()}-${randomUUID()}@example.com`;
  const cookie = await test.signIn(email);
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  await test.db.adminPool.query('update users set name = $1 where id = $2', [
    name,
    session.user.id,
  ]);
  return { cookie, id: session.user.id, email };
}

async function createProject(cookie: string, name: string) {
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
}

/** What assigning a task of the plan does in the database (spec 26b). */
const assignTask = (actorId: string, projectId: string, assigneeId: string, title: string) =>
  withUser(test.db.app, actorId, (trx) =>
    sql`select public.assign_task(${projectId}, ${randomUUID()}, ${assigneeId}, ${title})`.execute(
      trx,
    ),
  );

/** An agent has one open hand per project, so a second hand is another agent's. */
const raiseHand = (projectId: string, agentKey = 'critic') =>
  test.db.adminPool.query(
    `insert into hand_raises (project_id, agent_key, reason) values ($1, $2, 'Einwand')`,
    [projectId, agentKey],
  );

/** The job with a mailbox of its own; `now` moves the clock. */
function job(overrides: Partial<NotificationMailDeps> = {}) {
  const outbox = new DevOutbox();
  const reschedule = vi.fn<NotificationMailDeps['reschedule']>(() => Promise.resolve());
  const deps: NotificationMailDeps = {
    admin: test.db.admin,
    mailer: outbox,
    appUrl: APP_URL,
    reschedule,
    ...overrides,
  };
  return {
    outbox,
    reschedule,
    run: (userId: string, now?: Date) =>
      sendNotificationMail(now ? { ...deps, now: () => now } : deps, { userId }),
  };
}

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe('the notification mail', () => {
  it('tells someone who was mentioned who wrote what in which project', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const projectId = await createProject(olga.cookie, 'Sportverein');
    await addMember(projectId, alex.id, 'editor');
    await say(olga.cookie, projectId, '@Alex schaust du dir\ndas Datenmodell an?');
    const { outbox, run } = job();

    expect(await run(alex.id)).toBe('sent');

    expect(outbox.list()).toMatchObject([
      {
        to: alex.email,
        subject: 'Olga hat dich in „Sportverein“ erwähnt',
        text: [
          'Hallo Alex,',
          'das hast du in Covibes noch nicht gesehen:',
          `„Sportverein“\n${APP_URL}/p/${projectId}\n- Olga hat dich erwähnt: „@Alex schaust du dir das Datenmodell an?“`,
          `Covibes schreibt dir höchstens alle 30 Minuten und nur über das, was du in der App noch nicht gesehen hast. Abstellen kannst du diese Mails im Konto-Menü unter „E-Mail-Benachrichtigungen“: ${APP_URL}`,
        ].join('\n\n'),
      },
    ]);
    // The author gets nothing: nothing happened for her.
    expect(await run(olga.id)).toBe('nothing');
    expect(outbox.list()).toHaveLength(1);
  });

  it('mails everything once and keeps a pause of 30 minutes between mails', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const projectId = await createProject(olga.cookie, 'Pausen');
    await addMember(projectId, alex.id, 'editor');
    await say(olga.cookie, projectId, '@Alex erste');
    const { outbox, reschedule, run } = job();
    const start = new Date();
    expect(await run(alex.id, start)).toBe('sent');

    // Too early for the next mail: the job comes back when the pause is over.
    await say(olga.cookie, projectId, '@Alex zweite');
    expect(await run(alex.id, new Date(start.getTime() + 10 * 60_000))).toBe('later');
    expect(reschedule).toHaveBeenCalledExactlyOnceWith(
      alex.id,
      new Date(start.getTime() + MAIL_GAP_MS),
    );
    expect(outbox.list()).toHaveLength(1);

    expect(await run(alex.id, new Date(start.getTime() + MAIL_GAP_MS))).toBe('sent');
    const [second] = outbox.list();
    // Only what was not mailed before.
    expect(second?.text).toContain('@Alex zweite');
    expect(second?.text).not.toContain('@Alex erste');
    expect(await run(alex.id, later(120))).toBe('nothing');
    expect(outbox.list()).toHaveLength(2);
  });

  it('leaves out what was read in the app', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const projectId = await createProject(olga.cookie, 'Gelesen');
    await addMember(projectId, alex.id, 'editor');
    await say(olga.cookie, projectId, '@Alex gelesen');
    await request('/api/notifications/read', alex.cookie, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    });
    const { outbox, run } = job();

    expect(await run(alex.id)).toBe('nothing');
    expect(outbox.list()).toEqual([]);
  });

  it('sends nothing to someone who turned mails off, and nothing without a mailer', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const projectId = await createProject(olga.cookie, 'Aus');
    await addMember(projectId, alex.id, 'editor');
    await say(olga.cookie, projectId, '@Alex hallo');
    const off = await request('/api/notifications/settings', alex.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ email: false }),
    });
    expect(off.status).toBe(200);
    const { outbox, run } = job();

    expect(await run(alex.id)).toBe('off');
    expect(await job({ mailer: undefined }).run(olga.id)).toBe('off');
    expect(await run(randomUUID())).toBe('off');
    expect(outbox.list()).toEqual([]);

    // Switched on again, the mention that waited goes out.
    await request('/api/notifications/settings', alex.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ email: true }),
    });
    expect(await run(alex.id)).toBe('sent');
    expect(outbox.list()[0]?.text).toContain('@Alex hallo');
  });

  it('says how much waits in a project the person has not opened since', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const vera = await person('Vera');
    const projectId = await createProject(olga.cookie, 'Wartet');
    await addMember(projectId, alex.id, 'editor');
    await addMember(projectId, vera.id, 'viewer');
    await raiseHand(projectId);
    const { outbox, run } = job();

    expect(await run(alex.id)).toBe('sent');
    expect(outbox.list()[0]).toMatchObject({
      to: alex.email,
      subject: 'Neues für dich in „Wartet“',
    });
    expect(outbox.list()[0]?.text).toContain(
      `„Wartet“\n${APP_URL}/p/${projectId}\n- 1 Sache wartet auf dich (ein Vorschlag, ein Handzeichen oder eine Abstimmung).`,
    );
    // Nothing waits for someone who only reads.
    expect(await run(vera.id)).toBe('nothing');

    // The same hand is not mailed again; a new one is, with the count of all that wait.
    expect(await run(alex.id, later(60))).toBe('nothing');
    await raiseHand(projectId, 'security');
    expect(await run(alex.id, later(120))).toBe('sent');
    expect(outbox.list()[0]?.text).toContain('- 2 Dinge warten auf dich');
    expect(outbox.list()).toHaveLength(2);
  });

  it('counts a project as seen while its member has it open', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const projectId = await createProject(olga.cookie, 'Gesehen');
    await addMember(projectId, alex.id, 'editor');
    await raiseHand(projectId);
    // The browser tells the server that the project is open and visible.
    const seen = await request(`/api/projects/${projectId}/seen`, alex.cookie, { method: 'POST' });
    expect(seen.status).toBe(200);
    // A first visit is no return from an absence (spec 23).
    expect(await seen.json()).toEqual({ returned: false });
    const { outbox, run } = job();

    expect(await run(alex.id)).toBe('nothing');
    // The owner did not look.
    expect(await run(olga.id)).toBe('sent');
    expect(outbox.list().map((mail) => mail.to)).toEqual([olga.email]);
  });

  it('lists a changed role and a removal, and sums up several projects', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const team = await createProject(olga.cookie, 'Team');
    const old = await createProject(olga.cookie, 'Altes Projekt');
    await addMember(team, alex.id, 'editor');
    await addMember(old, alex.id, 'editor');
    const member = (projectId: string) => `/api/projects/${projectId}/members/${alex.id}`;
    await request(member(team), olga.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'viewer' }),
    });
    await request(member(old), olga.cookie, { method: 'DELETE' });
    const { outbox, run } = job();

    expect(await run(alex.id)).toBe('sent');

    const [mail] = outbox.list();
    expect(mail?.subject).toBe('Neues für dich in 2 Projekten');
    expect(mail?.text).toContain(
      `„Team“\n${APP_URL}/p/${team}\n- Olga hat deine Rolle geändert: Leser`,
    );
    // No link to a project the person can no longer open.
    expect(mail?.text).toContain('„Altes Projekt“\n- Olga hat dich aus dem Projekt entfernt.');
    expect(mail?.text).not.toContain(`/p/${old}`);
    // That alex joined both projects is in olga's app, not in a mail.
    expect(await run(olga.id)).toBe('nothing');

    // Back in the project, the next mail links it again.
    await addMember(old, alex.id, 'editor');
    await say(olga.cookie, old, '@Alex willkommen zurück');
    expect(await run(alex.id, later(60))).toBe('sent');
    expect(outbox.list()[0]?.text).toContain(
      `„Altes Projekt“\n${APP_URL}/p/${old}\n- Olga hat dich erwähnt: „@Alex willkommen zurück“`,
    );
  });

  it('tells someone which task they were given (spec 26b)', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const projectId = await createProject(olga.cookie, 'Sportverein');
    await addMember(projectId, alex.id, 'editor');
    await assignTask(olga.id, projectId, alex.id, 'Login\nbauen');
    // A task someone takes themselves is no news to them.
    await assignTask(alex.id, projectId, alex.id, 'Export bauen');
    const { outbox, run } = job();

    expect(await run(alex.id)).toBe('sent');

    const [mail] = outbox.list();
    expect(mail).toMatchObject({ to: alex.email, subject: 'Neues für dich in „Sportverein“' });
    // The text of a task comes from people: one line, like the excerpt of a mention.
    expect(mail?.text).toContain(
      `„Sportverein“\n${APP_URL}/p/${projectId}\n- Olga hat dir eine Aufgabe zugewiesen: Login bauen\n\n`,
    );
    expect(mail?.text).not.toContain('Export bauen');
    // Mailed once, and nothing to the person who assigned it.
    expect(await run(alex.id, later(60))).toBe('nothing');
    expect(await run(olga.id)).toBe('nothing');
  });

  it('writes in the language of the person', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    await test.db.adminPool.query(`update users set locale = 'en' where id = $1`, [alex.id]);
    const projectId = await createProject(olga.cookie, 'Club app');
    await addMember(projectId, alex.id, 'editor');
    await say(olga.cookie, projectId, '@Alex please have a look');
    await assignTask(olga.id, projectId, alex.id, 'Login bauen');
    await raiseHand(projectId);
    await raiseHand(projectId, 'security');
    const { outbox, run } = job();

    expect(await run(alex.id)).toBe('sent');

    const [mail] = outbox.list();
    expect(mail?.subject).toBe('News for you in "Club app"');
    expect(mail?.text).toContain('Hello Alex,');
    expect(mail?.text).toContain('- Olga mentioned you: "@Alex please have a look"');
    expect(mail?.text).toContain('- Olga assigned you a task: Login bauen');
    expect(mail?.text).toContain('- 2 things wait for you (proposals, raised hands or votes).');
    expect(mail?.text).toContain('under "Email notifications"');
  });

  it('keeps everything for the next run when the mail cannot be sent', async () => {
    const olga = await person('Olga');
    const alex = await person('Alex');
    const projectId = await createProject(olga.cookie, 'Fehler');
    await addMember(projectId, alex.id, 'editor');
    await say(olga.cookie, projectId, '@Alex kommt an');
    const failing = job({ mailer: { send: () => Promise.reject(new Error('SMTP down')) } });

    await expect(failing.run(alex.id)).rejects.toThrow('SMTP down');

    // The worker retries the job; nothing was marked as mailed.
    const { outbox, run } = job();
    expect(await run(alex.id)).toBe('sent');
    expect(outbox.list()[0]?.text).toContain('@Alex kommt an');
  });
});

describe('the switch for mails', () => {
  it('is on by default and belongs to the signed-in person', async () => {
    const olga = await person('Olga');
    const settings = async () =>
      await (await request('/api/notifications/settings', olga.cookie)).json();

    expect(await settings()).toEqual({ email: true });
    const off = await request('/api/notifications/settings', olga.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ email: false }),
    });
    expect(await off.json()).toEqual({ email: false });
    expect(await settings()).toEqual({ email: false });

    for (const body of [{}, { email: 'nein' }, { mail: false }]) {
      const response = await request('/api/notifications/settings', olga.cookie, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect((await test.app.request('/api/notifications/settings')).status).toBe(401);
    const anonymous = await test.app.request(`/api/projects/${randomUUID()}/seen`, {
      method: 'POST',
      headers: { origin: APP_URL },
    });
    expect(anonymous.status).toBe(401);
  });
});
