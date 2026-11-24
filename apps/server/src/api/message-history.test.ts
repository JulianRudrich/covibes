import { randomUUID } from 'node:crypto';

import {
  addBlock,
  writePlanSection,
  type MessagePage,
  type ProjectSearchResults,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { projectBoardIds } from '@server/chat/references';
import { createTestServer } from '@server/testing';

const test = createTestServer();
async function project() {
  const cookie = await test.signIn();
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  const created = await test.app.request('/api/projects', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Conversation' }),
  });
  const id = ((await created.json()) as ProjectSummary).id;
  return { cookie, id, userId: session.user.id };
}
function get(projectId: string, path: string, cookie: string) {
  return test.app.request(`/api/projects/${projectId}/${path}`, { headers: { cookie } });
}

describe('long conversation history (spec 47)', () => {
  it('pages 1,000 tied and microsecond timestamps without gaps while new messages arrive', async () => {
    const { cookie, id, userId } = await project();
    await test.db.adminPool.query(
      `insert into messages(project_id,author_kind,author_user_id,content,created_at)
      select $1,'human',$2,'History ' || n, '2026-11-01T12:00:00Z'::timestamptz + floor(n/3)*interval '1 microsecond'
      from generate_series(1,1000) n`,
      [id, userId],
    );
    const expected = await test.db.adminPool.query<{ id: string }>(
      'select id from messages where project_id=$1 order by created_at,id',
      [id],
    );
    let page = (await (await get(id, 'message-history', cookie)).json()) as MessagePage;
    const seen = page.items.map((item) => item.id);
    expect(page.before?.at).toMatch(/\.\d{6}Z$/);
    // New arrivals are newer than the captured first-page boundary, never inside older pages.
    await test.db.adminPool.query(
      "insert into messages(project_id,author_kind,author_user_id,content) values($1,'human',$2,'New arrival')",
      [id, userId],
    );
    while (page.before) {
      page = (await (
        await get(
          id,
          `message-history?before=${encodeURIComponent(JSON.stringify(page.before))}`,
          cookie,
        )
      ).json()) as MessagePage;
      seen.unshift(...page.items.map((item) => item.id));
    }
    expect(seen).toEqual(expected.rows.map((row) => row.id));
    expect(new Set(seen).size).toBe(1000);
    const earliest = seen[0];
    const context = (await (
      await get(id, `message-history/${earliest ?? ''}`, cookie)
    ).json()) as MessagePage;
    expect(context.items.map((item) => item.id)).toEqual([earliest]);
    expect(context.before).toBeNull();
  });

  it('rejects malformed cursors and does not expose messages to nonmembers or another project', async () => {
    const own = await project();
    const other = await project();
    const message = await test.db.adminPool.query<{ id: string }>(
      "insert into messages(project_id,author_kind,author_user_id,content) values($1,'human',$2,'Private') returning id",
      [own.id, own.userId],
    );
    const id = message.rows[0]?.id ?? '';
    expect((await get(own.id, 'message-history?before=bad', own.cookie)).status).toBe(400);
    expect((await get(own.id, 'message-history', other.cookie)).status).toBe(404);
    expect((await get(other.id, `message-history/${id}`, other.cookie)).status).toBe(404);
    expect((await test.app.request(`/api/projects/${own.id}/message-history`)).status).toBe(401);
  });

  it('searches all four source kinds and keeps private projects isolated', async () => {
    const own = await project();
    const other = await project();
    const boardId = (await projectBoardIds(test.db.admin, own.id))[0] ?? '';
    await test.db.adminPool.query(
      "insert into messages(project_id,author_kind,author_user_id,content) values($1,'human',$2,'Orbit conversation')",
      [own.id, own.userId],
    );
    await test.db.adminPool.query(
      "insert into decisions(project_id,topic) values($1,'Orbit decision')",
      [own.id],
    );
    await test.collab.changeBoard({ projectId: own.id, boardId }, (doc) => {
      addBlock(
        doc,
        { id: randomUUID(), label: 'Orbit service', position: { x: 0, y: 0 } },
        { kind: 'human', userId: own.userId },
      );
    });
    await test.collab.changePlan(own.id, (doc) => {
      writePlanSection(
        doc,
        'scope',
        [{ type: 'paragraph', content: [{ type: 'text', text: 'Orbit plan scope' }] }],
        'en',
      );
    });
    const response = await get(own.id, 'search?q=orbit', own.cookie);
    expect(response.status).toBe(200);
    const found = (await response.json()) as ProjectSearchResults;
    expect(found.results.map((result) => result.kind)).toEqual([
      'message',
      'decision',
      'block',
      'plan',
    ]);
    expect((await get(own.id, 'search?q=orbit', other.cookie)).status).toBe(404);
    const empty = (await (
      await get(other.id, 'search?q=orbit', other.cookie)
    ).json()) as ProjectSearchResults;
    expect(empty.results).toEqual([]);
    // SQL wildcard characters are literal query characters, not a request to list everything.
    const wildcard = (await (
      await get(own.id, 'search?q=%25_', own.cookie)
    ).json()) as ProjectSearchResults;
    expect(wildcard.results).toEqual([]);
  });
});
