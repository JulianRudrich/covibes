import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Variants A/B (spec 17).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = 'c1111111-1111-4111-8111-111111111111';
const EDITOR = 'c2222222-2222-4222-8222-222222222222';
const VIEWER = 'c3333333-3333-4333-8333-333333333333';
const PROJECT = 'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOARD = 'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const rejected = { code: '42501' };
let topics = 0;

/** Open variants on a fresh topic, stored like the worker does. */
async function proposeVariants() {
  topics += 1;
  const topic = `Architektur ${String(topics)}`;
  const { rows } = await admin.query<{ id: string }>(
    `insert into proposals (project_id, board_id, kind, agent_key, reason, operations)
     values ($1, $2, 'variants', 'moderator', 'variants', $3::jsonb) returning id`,
    [
      PROJECT,
      BOARD,
      JSON.stringify([
        {
          op: 'variants',
          topic,
          variants: [
            { name: 'Monolith', summary: 'Ein Dienst, einfach zu betreiben.', operations: [] },
            { name: 'Echtzeit-Dienst', summary: 'Eigener Dienst für Live-Daten.', operations: [] },
          ],
        },
      ]),
    ],
  );
  return { id: rows[0]?.id ?? '', topic };
}

/** What the API does when someone applies the proposal: claim it, then adopt the variant. */
async function adopt(client: pg.PoolClient, id: string, user: string, position: number) {
  await client.query(
    `update proposals set status = 'applied', decided_at = now(), decided_by = $2 where id = $1`,
    [id, user],
  );
  await client.query('select public.adopt_variant($1, $2)', [id, position]);
}

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'variants-owner@example.com', true),
      ($2, 'Eddie Editor', 'variants-editor@example.com', true),
      ($3, 'Vera Viewer', 'variants-viewer@example.com', true)`,
    [OWNER, EDITOR, VIEWER],
  );
  await admin.query(`insert into projects (id, name, owner_id) values ($1, 'Varianten', $2)`, [
    PROJECT,
    OWNER,
  ]);
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer')`,
    [PROJECT, OWNER, EDITOR, VIEWER],
  );
  await admin.query(
    `insert into boards (id, project_id, title, kind) values ($1, $2, 'Haupt-Canvas', 'main')`,
    [BOARD, PROJECT],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('variants', () => {
  it('belong to a board, like canvas proposals', async () => {
    await expect(
      admin.query(
        `insert into proposals (project_id, kind, agent_key, reason, operations)
         values ($1, 'variants', 'moderator', 'variants', '[]'::jsonb)`,
        [PROJECT],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('record the adopted variant as the decision, with the other as discarded', async () => {
    const { id, topic } = await proposeVariants();
    await asUser(app, EDITOR, async (client) => {
      await adopt(client, id, EDITOR, 1);

      const proposal = await client.query('select status, chosen from proposals where id = $1', [
        id,
      ]);
      expect(proposal.rows).toEqual([{ status: 'applied', chosen: 1 }]);
      const decision = await client.query(
        `select status, value, reasoning, alternatives, decided_by, recorded_by_agent, variants_id
         from decisions where project_id = $1 and topic = $2`,
        [PROJECT, topic],
      );
      expect(decision.rows).toEqual([
        {
          status: 'decided',
          value: 'Echtzeit-Dienst',
          reasoning: 'Eigener Dienst für Live-Daten.',
          alternatives: [{ name: 'Monolith', note: 'Ein Dienst, einfach zu betreiben.' }],
          decided_by: EDITOR,
          recorded_by_agent: 'moderator',
          variants_id: id,
        },
      ]);
      const log = await client.query<{ details: Record<string, unknown> }>(
        `select details from decision_log
         where project_id = $1 and kind = 'decided' and topic = $2`,
        [PROJECT, topic],
      );
      expect(log.rows[0]?.details).toMatchObject({ variantsId: id });
    });
  });

  it('are only adopted by the person who just applied them, for a variant that exists', async () => {
    const { id } = await proposeVariants();
    // Not applied yet.
    await expect(
      asUser(app, EDITOR, (client) => client.query('select public.adopt_variant($1, 0)', [id])),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      asUser(app, EDITOR, (client) => adopt(client, id, EDITOR, 2)),
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      asUser(app, VIEWER, (client) => client.query('select public.adopt_variant($1, 0)', [id])),
    ).rejects.toMatchObject(rejected);
    // The choice itself is not writable for clients.
    await expect(
      asUser(app, OWNER, (client) =>
        client.query('update proposals set chosen = 0 where id = $1', [id]),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('keep a decision that was made another way in the meantime', async () => {
    const { id, topic } = await proposeVariants();
    await admin.query(
      `select private.decide($1, $2, 'Serverless', '', '[]'::jsonb, 'moderator', $3)`,
      [PROJECT, topic, OWNER],
    );
    await asUser(app, OWNER, async (client) => {
      await adopt(client, id, OWNER, 0);
      const decision = await client.query(
        'select value, variants_id from decisions where project_id = $1 and topic = $2',
        [PROJECT, topic],
      );
      expect(decision.rows).toEqual([{ value: 'Serverless', variants_id: null }]);
      const proposal = await client.query('select chosen from proposals where id = $1', [id]);
      expect(proposal.rows).toEqual([{ chosen: 0 }]);
    });
  });

  it('are adopted by owners only while the owner decides', async () => {
    const { id } = await proposeVariants();
    await admin.query(
      `update projects set settings = '{"decisionProcess": "owner"}' where id = $1`,
      [PROJECT],
    );
    try {
      await expect(
        asUser(app, EDITOR, (client) => adopt(client, id, EDITOR, 0)),
      ).rejects.toMatchObject(rejected);
      await asUser(app, OWNER, async (client) => {
        await adopt(client, id, OWNER, 0);
        const proposal = await client.query('select chosen from proposals where id = $1', [id]);
        expect(proposal.rows).toEqual([{ chosen: 0 }]);
      });
    } finally {
      await admin.query(`update projects set settings = '{}' where id = $1`, [PROJECT]);
    }
  });

  it('let go of the decision when it is reopened', async () => {
    const { id, topic } = await proposeVariants();
    await asUser(app, OWNER, async (client) => {
      await adopt(client, id, OWNER, 0);
      const decision = await client.query<{ id: string }>(
        'select id from decisions where project_id = $1 and topic = $2',
        [PROJECT, topic],
      );
      await client.query(`select public.reopen_decision($1, 'Doch anders')`, [
        decision.rows[0]?.id,
      ]);
      const reopened = await client.query(
        'select status, variants_id from decisions where id = $1',
        [decision.rows[0]?.id],
      );
      expect(reopened.rows).toEqual([{ status: 'open', variants_id: null }]);
    });
  });

  it('are not adopted from a proposal of another kind', async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into proposals (project_id, kind, agent_key, reason, operations)
       values ($1, 'team', 'moderator', 'question', '[]'::jsonb) returning id`,
      [PROJECT],
    );
    await expect(
      asUser(app, OWNER, (client) => adopt(client, rows[0]?.id ?? '', OWNER, 0)),
    ).rejects.toMatchObject({ code: 'P0002' });
  });
});
