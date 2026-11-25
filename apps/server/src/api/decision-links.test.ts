import { randomUUID } from 'node:crypto';

import {
  addBlock,
  removeNodes,
  updateNode,
  writePlanSection,
  type DecisionLink,
  type DecisionLinkTarget,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { projectBoardIds } from '@server/chat/references';
import { createTestServer } from '@server/testing';

const test = createTestServer();
async function fixture() {
  const cookie = await test.signIn();
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  const response = await test.app.request('/api/projects', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Linked decisions' }),
  });
  const projectId = ((await response.json()) as ProjectSummary).id;
  const boardId = (await projectBoardIds(test.db.admin, projectId))[0] ?? '';
  const nodeId = randomUUID();
  const taskId = randomUUID();
  const author = { kind: 'human' as const, userId: session.user.id };
  await test.collab.changeBoard({ projectId, boardId }, (doc) => {
    addBlock(doc, { id: nodeId, label: 'API service', position: { x: 0, y: 0 } }, author);
  });
  const plan = (text: string) =>
    test.collab.changePlan(projectId, (doc) => {
      writePlanSection(
        doc,
        'milestones',
        [
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Milestone 1: Foundation' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                attrs: { taskId },
                content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
              },
            ],
          },
        ],
        'en',
      );
    });
  await plan('Build API');
  const decision = await test.db.adminPool.query<{ id: string }>(
    "insert into decisions(project_id,topic,status,value,decided_by,decided_at) values($1,'Database','decided','PostgreSQL',$2,now()) returning id",
    [projectId, session.user.id],
  );
  const decisionId = decision.rows[0]?.id ?? '';
  const block: DecisionLinkTarget = { kind: 'block', boardId, id: nodeId };
  const task: DecisionLinkTarget = { kind: 'task', id: taskId };
  const request = (path = '', method = 'GET', body?: unknown, asCookie = cookie) =>
    test.app.request(`/api/projects/${projectId}/decision-links${path}`, {
      method,
      headers: { cookie: asCookie, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const add = (target: DecisionLinkTarget, asCookie = cookie, id = decisionId) =>
    request('', 'POST', { decisionId: id, target }, asCookie);
  return {
    cookie,
    projectId,
    boardId,
    nodeId,
    taskId,
    decisionId,
    author,
    block,
    task,
    plan,
    request,
    add,
    userId: session.user.id,
  };
}

describe('linked decisions (spec 50)', () => {
  it('retains links after renames/reopening and reports removed and restored targets by identity', async () => {
    const f = await fixture();
    expect((await f.add(f.block)).status).toBe(200);
    expect((await f.add(f.task)).status).toBe(200);
    await test.collab.changeBoard(f, (doc) => {
      updateNode(doc, f.nodeId, { label: 'Renamed service' }, f.author);
    });
    await f.plan('Build renamed API');
    const reopened = await test.app.request(
      `/api/projects/${f.projectId}/decisions/${f.decisionId}/reopen`,
      {
        method: 'POST',
        headers: { cookie: f.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Review the architecture' }),
      },
    );
    expect(reopened.status).toBe(204);
    const links = (await (await f.request()).json()) as DecisionLink[];
    expect(links.map((link) => [link.label, link.status, link.available])).toEqual([
      ['Renamed service', 'open', true],
      ['Build renamed API', 'open', true],
    ]);
    await test.collab.changeBoard(f, (doc) => {
      removeNodes(doc, [f.nodeId], f.author);
    });
    expect(((await (await f.request()).json()) as DecisionLink[])[0]).toMatchObject({
      target: f.block,
      available: false,
      label: 'API service',
    });
    await test.collab.changeBoard(f, (doc) => {
      addBlock(
        doc,
        { id: f.nodeId, label: 'Restored service', position: { x: 0, y: 0 } },
        f.author,
      );
    });
    expect(((await (await f.request()).json()) as DecisionLink[])[0]).toMatchObject({
      target: f.block,
      available: true,
      label: 'Restored service',
    });
  });

  it('isolates projects and permits viewers to read but only editors to change links', async () => {
    const f = await fixture();
    const other = await fixture();
    expect((await f.request('', 'GET', undefined, other.cookie)).status).toBe(404);
    expect((await f.request('/targets', 'GET', undefined, other.cookie)).status).toBe(404);
    expect((await test.app.request(`/api/projects/${f.projectId}/decision-links`)).status).toBe(
      401,
    );
    expect((await f.add(other.block)).status).toBe(404);
    expect((await f.add(f.block, f.cookie, other.decisionId)).status).toBe(404);
    await test.db.adminPool.query(
      "insert into project_members(project_id,user_id,role) values($1,$2,'viewer')",
      [f.projectId, other.userId],
    );
    expect((await f.request('', 'GET', undefined, other.cookie)).status).toBe(200);
    expect((await f.add(f.block, other.cookie)).status).toBe(403);
    expect((await f.request('/' + randomUUID(), 'DELETE', undefined, other.cookie)).status).toBe(
      403,
    );
    await test.db.adminPool.query(
      "update project_members set role='editor' where project_id=$1 and user_id=$2",
      [f.projectId, other.userId],
    );
    expect((await f.add(f.block, other.cookie)).status).toBe(200);
  });

  it('makes concurrent duplicate adds and repeated removes idempotent and validates targets', async () => {
    const f = await fixture();
    const responses = await Promise.all([f.add(f.block), f.add(f.block)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const ids = await Promise.all(
      responses.map((response) => response.json() as Promise<{ id: string }>),
    );
    expect(ids[0]?.id).toBe(ids[1]?.id);
    expect((await (await f.request()).json()) as DecisionLink[]).toHaveLength(1);
    expect((await f.request('/' + (ids[0]?.id ?? ''), 'DELETE')).status).toBe(204);
    expect((await f.request('/' + (ids[0]?.id ?? ''), 'DELETE')).status).toBe(204);
    expect(
      (
        await f.request('', 'POST', {
          decisionId: f.decisionId,
          target: { kind: 'task', id: 'bad' },
        })
      ).status,
    ).toBe(400);
    expect((await f.add({ kind: 'task', id: randomUUID() })).status).toBe(404);
    const catalog = (await (await f.request('/targets?q=API')).json()) as {
      targets: { target: DecisionLinkTarget }[];
    };
    expect(catalog.targets.map((entry) => entry.target)).toEqual([f.block, f.task]);
  });

  it('enforces the project limit without preventing an idempotent retry', async () => {
    const f = await fixture();
    await f.add(f.block);
    await test.db.adminPool.query(
      "insert into decision_links(project_id,decision_id,target_kind,target_id,target_label,created_by) select $1,$2,'task',gen_random_uuid(),'Removed task',$3 from generate_series(1,999)",
      [f.projectId, f.decisionId, f.userId],
    );
    expect((await f.add(f.block)).status).toBe(200);
    expect((await f.add(f.task)).status).toBe(409);
  });
});
