import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });
const [OWNER, EDITOR, VIEWER, STRANGER, PROJECT, OTHER, DECISION, FOREIGN, BOARD, FOREIGN_BOARD] =
  Array.from({ length: 10 }, () => randomUUID()) as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
beforeAll(async () => {
  for (const id of [OWNER, EDITOR, VIEWER, STRANGER])
    await admin.query(
      "insert into users(id,name,email,email_verified) values($1,'Person',$2,true)",
      [id, `${id}@example.com`],
    );
  await admin.query(
    "insert into projects(id,name,owner_id) values($1,'Linked',$3),($2,'Other',$3)",
    [PROJECT, OTHER, OWNER],
  );
  await admin.query(
    "insert into project_members(project_id,user_id,role) values($1,$2,'owner'),($1,$3,'editor'),($1,$4,'viewer'),($5,$2,'owner')",
    [PROJECT, OWNER, EDITOR, VIEWER, OTHER],
  );
  await admin.query(
    "insert into decisions(id,project_id,topic) values($1,$2,'Choice'),($3,$4,'Other')",
    [DECISION, PROJECT, FOREIGN, OTHER],
  );
  await admin.query(
    "insert into boards(id,project_id,title,kind) values($1,$2,'Board','main'),($3,$4,'Foreign','main')",
    [BOARD, PROJECT, FOREIGN_BOARD, OTHER],
  );
});
afterAll(async () => {
  await admin.end();
  await app.end();
});
const insert = (
  client: pg.PoolClient,
  actor: string,
  decision = DECISION,
  board: string | null = null,
) =>
  client.query<{ id: string }>(
    'insert into decision_links(project_id,decision_id,target_kind,board_id,target_id,target_label,created_by) values($1,$2,$3,$4,$5,$6,$7) returning id',
    [PROJECT, decision, board ? 'block' : 'task', board, randomUUID(), 'Task', actor],
  );
describe('decision links access rules', () => {
  it('lets editors add/read/remove and refuses mutation by viewers', async () => {
    await asUser(app, EDITOR, async (client) => {
      const link = await insert(client, EDITOR);
      expect(
        (await client.query('select id from decision_links where project_id=$1', [PROJECT]))
          .rowCount,
      ).toBe(1);
      expect(
        (await client.query('delete from decision_links where id=$1', [link.rows[0]?.id])).rowCount,
      ).toBe(1);
    });
    await expect(asUser(app, VIEWER, (client) => insert(client, VIEWER))).rejects.toMatchObject({
      code: '42501',
    });
  });
  it('discloses nothing to strangers and rejects foreign decisions and boards even for their owner', async () => {
    await asUser(app, STRANGER, async (client) => {
      expect((await client.query('select * from decision_links')).rowCount).toBe(0);
    });
    await expect(
      asUser(app, OWNER, (client) => insert(client, OWNER, FOREIGN)),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      asUser(app, OWNER, (client) => insert(client, OWNER, DECISION, FOREIGN_BOARD)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(app, EDITOR, (client) => insert(client, OWNER))).rejects.toMatchObject({
      code: '42501',
    });
  });
  it('preserves a link when its board is removed and exposes it only to members', async () => {
    const linkId = randomUUID();
    await admin.query(
      "insert into decision_links(id,project_id,decision_id,target_kind,board_id,target_id,target_label,created_by) values($1,$2,$3,'block',$4,$5,'Old block',$6)",
      [linkId, PROJECT, DECISION, BOARD, randomUUID(), OWNER],
    );
    await admin.query('delete from boards where id=$1', [BOARD]);
    await asUser(app, VIEWER, async (client) => {
      expect(
        (await client.query('select id from decision_links where id=$1', [linkId])).rowCount,
      ).toBe(1);
      expect(
        (await client.query('delete from decision_links where id=$1', [linkId])).rowCount,
      ).toBe(0);
    });
  });
});
