import { randomUUID } from 'node:crypto';

import { addBlock, boardDocumentName, readNodes, type ProjectSummary } from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createTestServer } from '@server/testing';

const TOKEN = 'persistence-test-internal-token-0123456789';
const test = createTestServer({ INTERNAL_TOKEN: TOKEN });

async function board() {
  const cookie = await test.signIn();
  const response = await test.app.request('/api/projects', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Durable document' }),
  });
  const projectId = ((await response.json()) as ProjectSummary).id;
  const created = await test.db.admin
    .selectFrom('boards')
    .select('id')
    .where('project_id', '=', projectId)
    .executeTakeFirstOrThrow();
  return { cookie, projectId, id: created.id };
}

function flush(cookie: string | undefined, documentName: string) {
  return test.app.request('/api/documents/flush', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ documentName }),
  });
}

describe('durable save acknowledgement (spec 41)', () => {
  it('acknowledges only after the current document is in PostgreSQL', async () => {
    const target = await board();
    const id = randomUUID();
    await test.collab.changeBoard({ boardId: target.id, projectId: target.projectId }, (doc) => {
      addBlock(
        doc,
        { id, label: 'Durable API', position: { x: 0, y: 0 } },
        { kind: 'agent', agentKey: 'moderator' },
      );
    });
    const response = await flush(target.cookie, boardDocumentName(target.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'saved',
      savedAt: expect.any(String) as unknown,
    });
    const stored = await test.db.adminPool.query<{ state: Buffer }>(
      'select state from yjs_documents where name = $1',
      [boardDocumentName(target.id)],
    );
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, new Uint8Array(stored.rows[0]?.state ?? []));
    expect(readNodes(reopened)).toMatchObject([{ id, label: 'Durable API' }]);
    reopened.destroy();
  });

  it('checks login and membership and refuses unknown document names', async () => {
    const target = await board();
    expect((await flush(undefined, boardDocumentName(target.id))).status).toBe(401);
    expect((await flush(await test.signIn(), boardDocumentName(target.id))).status).toBe(404);
    expect((await flush(target.cookie, 'not-a-document')).status).toBe(400);
    expect((await flush(target.cookie, boardDocumentName(randomUUID()))).status).toBe(404);
  });

  it('does not report saved when the persistence layer rejects the write', async () => {
    const target = await board();
    const failed = vi
      .spyOn(test.collab, 'flushDocument')
      .mockRejectedValueOnce(new Error('database unavailable'));
    // createApp captures the document object, so its method is read at request time.
    const response = await flush(target.cookie, boardDocumentName(target.id));
    expect(response.status).toBe(500);
    expect(await response.json()).not.toMatchObject({ status: 'saved' });
    failed.mockRestore();
  });

  it('protects worker flushes with the internal credential', async () => {
    const target = await board();
    const post = (token: string) =>
      test.app.request(`/api/internal/boards/${target.id}/flush`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': token },
        body: '{}',
      });
    expect((await post('incorrect')).status).toBe(403);
    expect((await post(TOKEN)).status).toBe(200);
  });

  it('clears failed storage health when its board is deleted', async () => {
    const target = await board();
    const documentName = boardDocumentName(target.id);
    const suffix = randomUUID().replaceAll('-', '');
    const functionName = `fail_document_${suffix}`;
    const triggerName = `reject_document_${suffix}`;
    // Generated names and a generated board UUID only; no external input enters this DDL.
    await test.db.adminPool.query(`
      create function public.${functionName}() returns trigger language plpgsql as $$
      begin raise exception 'controlled document storage failure'; end; $$;
      create trigger ${triggerName} before insert or update on public.yjs_documents
      for each row when (new.name = '${documentName}') execute function public.${functionName}();
    `);
    try {
      await expect(test.collab.flushDocument(documentName)).rejects.toThrow(
        'controlled document storage failure',
      );
      expect(test.collab.persistenceState().failed).toBe(1);
      await test.db.admin.deleteFrom('boards').where('id', '=', target.id).execute();
      await test.collab.deleteBoard(target.id);
      expect(test.collab.persistenceState().failed).toBe(0);
    } finally {
      await test.db.adminPool.query(`
        drop trigger ${triggerName} on public.yjs_documents;
        drop function public.${functionName}();
      `);
    }
  });
});
