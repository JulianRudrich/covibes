import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asUser } from './testing';

// Files of a project (spec 20a).
const { adminUrl, appUrl } = inject('database');
const admin = new pg.Pool({ connectionString: adminUrl });
const app = new pg.Pool({ connectionString: appUrl });

const OWNER = 'f1111111-1111-4111-8111-111111111111';
const EDITOR = 'f2222222-2222-4222-8222-222222222222';
const VIEWER = 'f3333333-3333-4333-8333-333333333333';
const STRANGER = 'f4444444-4444-4444-8444-444444444444';
const PROJECT = 'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** A second project of the editor alone. */
const OTHER = 'fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const rejected = { code: '42501' };

const upload = (
  client: pg.PoolClient | pg.Pool,
  userId: string,
  values: { projectId?: string; uploadedBy?: string; size?: number; kind?: string } = {},
) =>
  client.query<{ id: string }>(
    `insert into files (project_id, uploaded_by, name, kind, media_type, size_bytes, storage_key)
     values ($1, $2, 'notizen.md', $3, 'text/markdown', $4, $5) returning id`,
    [
      values.projectId ?? PROJECT,
      values.uploadedBy ?? userId,
      values.kind ?? 'text',
      values.size ?? 1200,
      randomUUID(),
    ],
  );

/** A file uploaded by the user, stored for good. */
async function uploaded(userId: string, projectId = PROJECT): Promise<string> {
  const { rows } = await upload(admin, userId, { projectId });
  return rows[0]?.id ?? '';
}

async function message(userId: string, projectId = PROJECT): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `insert into messages (project_id, author_kind, author_user_id, content)
     values ($1, 'human', $2, 'Schaut mal') returning id`,
    [projectId, userId],
  );
  return rows[0]?.id ?? '';
}

const attach = (client: pg.PoolClient, fileId: string, messageId: string) =>
  client.query('update files set message_id = $2 where id = $1', [fileId, messageId]);

beforeAll(async () => {
  await admin.query(
    `insert into users (id, name, email, email_verified) values
      ($1, 'Olga Owner', 'files-owner@example.com', true),
      ($2, 'Eddie Editor', 'files-editor@example.com', true),
      ($3, 'Vera Viewer', 'files-viewer@example.com', true),
      ($4, 'Sam Stranger', 'files-stranger@example.com', true)`,
    [OWNER, EDITOR, VIEWER, STRANGER],
  );
  await admin.query(
    `insert into projects (id, name, owner_id) values ($1, 'Dateien', $2), ($3, 'Anderes', $4)`,
    [PROJECT, OWNER, OTHER, EDITOR],
  );
  await admin.query(
    `insert into project_members (project_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'editor'), ($1, $4, 'viewer'), ($5, $3, 'owner')`,
    [PROJECT, OWNER, EDITOR, VIEWER, OTHER],
  );
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('files', () => {
  it('are uploaded by owners and editors in their own name', async () => {
    for (const member of [OWNER, EDITOR]) {
      const { rows } = await asUser(app, member, (client) => upload(client, member));
      expect(rows).toHaveLength(1);
    }
    await expect(asUser(app, VIEWER, (client) => upload(client, VIEWER))).rejects.toMatchObject(
      rejected,
    );
    await expect(asUser(app, STRANGER, (client) => upload(client, STRANGER))).rejects.toMatchObject(
      rejected,
    );
    await expect(
      asUser(app, EDITOR, (client) => upload(client, EDITOR, { uploadedBy: OWNER })),
    ).rejects.toMatchObject(rejected);
  });

  it('cannot be created as attached, and keep their limits', async () => {
    const messageId = await message(EDITOR);
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(
          `insert into files (project_id, uploaded_by, message_id, name, kind, media_type, size_bytes, storage_key)
           values ($1, $2, $3, 'x.md', 'text', 'text/markdown', 10, $4)`,
          [PROJECT, EDITOR, messageId, randomUUID()],
        ),
      ),
    ).rejects.toMatchObject(rejected);

    await expect(upload(admin, EDITOR, { size: 10 * 1024 * 1024 + 1 })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(upload(admin, EDITOR, { size: 0 })).rejects.toMatchObject({ code: '23514' });
    await expect(upload(admin, EDITOR, { kind: 'video' })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      admin.query(
        `insert into files (project_id, uploaded_by, name, kind, media_type, size_bytes, storage_key)
         values ($1, $2, 'x.md', 'text', 'text/markdown', 10, '../../etc/passwd')`,
        [PROJECT, EDITOR],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('are read by members only', async () => {
    const id = await uploaded(EDITOR);
    for (const member of [OWNER, EDITOR, VIEWER]) {
      const { rows } = await asUser(app, member, (client) =>
        client.query('select id from files where id = $1', [id]),
      );
      expect(rows).toHaveLength(1);
    }
    const { rows } = await asUser(app, STRANGER, (client) =>
      client.query('select id from files where id = $1', [id]),
    );
    expect(rows).toEqual([]);
  });

  it('are attached by their uploader to an own message of the same project, once', async () => {
    const id = await uploaded(EDITOR);
    const own = await message(EDITOR);
    const foreign = await message(OWNER);
    const elsewhere = await message(EDITOR, OTHER);

    // Not to someone else's message, and not to a message of another project.
    await expect(
      asUser(app, EDITOR, (client) => attach(client, id, foreign)),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, EDITOR, (client) => attach(client, id, elsewhere)),
    ).rejects.toMatchObject(rejected);
    // Nobody attaches someone else's upload.
    const byOwner = await asUser(app, OWNER, (client) => attach(client, id, foreign));
    expect(byOwner.rowCount).toBe(0);

    await asUser(app, EDITOR, async (client) => {
      expect((await attach(client, id, own)).rowCount).toBe(1);
      // Attached, it stays where it is.
      const second = await client.query(
        `insert into messages (project_id, author_kind, author_user_id, content)
         values ($1, 'human', $2, 'Noch eine') returning id`,
        [PROJECT, EDITOR],
      );
      const moved = await attach(client, id, (second.rows[0] as { id: string }).id);
      expect(moved.rowCount).toBe(0);
    });
  });

  it('change in nothing but the message they are attached to', async () => {
    const id = await uploaded(EDITOR);
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`update files set name = 'anders.md' where id = $1`, [id]),
      ),
    ).rejects.toMatchObject(rejected);
    await expect(
      asUser(app, EDITOR, (client) =>
        client.query(`update files set storage_key = $2 where id = $1`, [id, randomUUID()]),
      ),
    ).rejects.toMatchObject(rejected);
  });

  it('are taken back by their uploader while they are attached to nothing', async () => {
    const id = await uploaded(EDITOR);
    const byOwner = await asUser(app, OWNER, (client) =>
      client.query('delete from files where id = $1', [id]),
    );
    expect(byOwner.rowCount).toBe(0);
    const byUploader = await asUser(app, EDITOR, (client) =>
      client.query('delete from files where id = $1', [id]),
    );
    expect(byUploader.rowCount).toBe(1);

    const attached = await uploaded(EDITOR);
    await admin.query('update files set message_id = $2 where id = $1', [
      attached,
      await message(EDITOR),
    ]);
    const afterwards = await asUser(app, EDITOR, (client) =>
      client.query('delete from files where id = $1', [attached]),
    );
    expect(afterwards.rowCount).toBe(0);
  });

  it('go with their message and their project', async () => {
    const id = await uploaded(EDITOR);
    const messageId = await message(EDITOR);
    await admin.query('update files set message_id = $2 where id = $1', [id, messageId]);

    await admin.query('delete from messages where id = $1', [messageId]);

    const { rows } = await admin.query('select id from files where id = $1', [id]);
    expect(rows).toEqual([]);
  });
});
