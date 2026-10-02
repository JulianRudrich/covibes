import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Phases (spec 24): the current phase of a project, who changes it and who is told.
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = '1a111111-1111-4111-8111-111111111111';
const EDITOR = '1a222222-2222-4222-8222-222222222222';
const VIEWER = '1a333333-3333-4333-8333-333333333333';
const STRANGER = '1a444444-4444-4444-8444-444444444444';

const rejected = { code: '42501' };

async function commitAs<T>(userId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function newProject() {
  const id = randomUUID();
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Phasen', $2)`, [
    id,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [id, OWNER, EDITOR, VIEWER],
  );
  return id;
}

async function phaseOf(projectId: string) {
  const { rows } = await admin.query<{ phase: string }>(
    'select phase from projects where id = $1',
    [projectId],
  );
  return rows[0]?.phase;
}

const change = (userId: string, projectId: string, phase: string) =>
  commitAs(userId, (client) =>
    client.query('select public.set_project_phase($1, $2)', [projectId, phase]),
  );

/**
 * Runs `fn` and returns how often the project was announced as changed on the live channel
 * meanwhile. Other test files share the database, so only this project counts.
 */
async function announcedDuring(projectId: string, fn: () => Promise<unknown>): Promise<number> {
  const listener = new pg.Client({ connectionString: adminUrl });
  await listener.connect();
  const announced: string[] = [];
  listener.on('notification', (notification) => {
    const event = JSON.parse(notification.payload ?? '{}') as { kind: string; projectId: string };
    if (event.kind === 'project' && event.projectId === projectId) announced.push(event.projectId);
  });
  await listener.query('listen covibes_live');
  try {
    await fn();
    await listener.query('select 1');
  } finally {
    await listener.end();
  }
  return announced.length;
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'phase-owner@example.com', true),
      ($2, 'Eddie Editor', 'phase-editor@example.com', true),
      ($3, 'Vera Viewer', 'phase-viewer@example.com', true),
      ($4, 'Sam Stranger', 'phase-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('the phase of a project', () => {
  it('is brainstorming at first and read by the members', async () => {
    const projectId = await newProject();

    expect(await phaseOf(projectId)).toBe('brainstorming');
    const read = (userId: string) =>
      asUser(app, userId, async (client) => {
        const { rows } = await client.query<{ phase: string }>(
          'select phase from projects where id = $1',
          [projectId],
        );
        return rows;
      });
    expect(await read(VIEWER)).toEqual([{ phase: 'brainstorming' }]);
    expect(await read(STRANGER)).toEqual([]);
  });

  it('is changed by owners and editors, forward and back', async () => {
    const projectId = await newProject();

    await change(EDITOR, projectId, 'architecture');
    expect(await phaseOf(projectId)).toBe('architecture');
    await change(OWNER, projectId, 'decide');
    expect(await phaseOf(projectId)).toBe('decide');
  });

  it('is not changed by viewers, strangers or around the function', async () => {
    const projectId = await newProject();

    await expect(change(VIEWER, projectId, 'decide')).rejects.toMatchObject(rejected);
    await expect(change(STRANGER, projectId, 'decide')).rejects.toMatchObject(rejected);
    // Owners change a project's name and settings directly, but not its phase.
    await expect(
      commitAs(OWNER, (client) =>
        client.query(`update projects set phase = 'plan' where id = $1`, [projectId]),
      ),
    ).rejects.toMatchObject(rejected);
    expect(await phaseOf(projectId)).toBe('brainstorming');
  });

  it('is one of the four phases', async () => {
    const projectId = await newProject();

    await expect(change(OWNER, projectId, 'launch')).rejects.toMatchObject({ code: '23514' });
    expect(await phaseOf(projectId)).toBe('brainstorming');
  });

  it('is announced live when it changes, whoever changed it', async () => {
    const projectId = await newProject();

    expect(await announcedDuring(projectId, () => change(EDITOR, projectId, 'decide'))).toBe(1);
    // The worker changes it for the moderator.
    expect(
      await announcedDuring(projectId, () =>
        admin.query(`update projects set phase = 'architecture' where id = $1`, [projectId]),
      ),
    ).toBe(1);
    // The same phase again and other changes of the project are not a change of the phase.
    expect(await announcedDuring(projectId, () => change(OWNER, projectId, 'architecture'))).toBe(
      0,
    );
    expect(
      await announcedDuring(projectId, () =>
        admin.query(`update projects set name = 'Umbenannt' where id = $1`, [projectId]),
      ),
    ).toBe(0);
  });
});

describe('an offer of the moderator', () => {
  it('can be to move on to the next phase', async () => {
    const projectId = await newProject();
    const offer = (kind: string) =>
      admin.query(
        `with message as (
           insert into messages (project_id, author_kind, author_agent_key, content)
           values ($1, 'agent', 'moderator', 'Weiter?') returning id
         )
         insert into offers (project_id, message_id, kind, action, task, status, decided_at)
         select $1, id, $2, 'Ja, weiter', 'Move on', 'declined', now() from message`,
        [projectId, kind],
      );

    await offer('next_step');
    await expect(offer('celebrate')).rejects.toMatchObject({ code: '23514' });
  });
});
