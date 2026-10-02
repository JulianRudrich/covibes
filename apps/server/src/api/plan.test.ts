import {
  planNodesFromMarkdown,
  planToMarkdown,
  writePlanSection,
  type ApiErrorBody,
  type PlanSection,
  type PlanState,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { APP_URL, createTestServer } from '@server/testing';

// The plan's suggestions and its generation (spec 25b).
const test = createTestServer();

function request(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  return test.app.request(path, { ...init, headers });
}

const post = (path: string, cookie: string | null) => request(path, cookie, { method: 'POST' });

async function errorCode(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

async function createProject(name = 'Vereins-App') {
  const owner = await test.signIn();
  const created = await request('/api/projects', owner, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  return { owner, projectId, plan: `/api/projects/${projectId}/plan` };
}

async function member(projectId: string, role: 'editor' | 'viewer') {
  const cookie = await test.signIn();
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, session?.user.id, role],
  );
  return cookie;
}

/** The worker's suggestions, as Markdown per section. */
async function suggest(projectId: string, sections: Partial<Record<PlanSection, string>>) {
  const ids: Partial<Record<PlanSection, string>> = {};
  for (const [section, markdown] of Object.entries(sections)) {
    const { rows } = await test.db.adminPool.query<{ id: string }>(
      `insert into plan_suggestions (project_id, section, content)
       values ($1, $2, $3) returning id`,
      [projectId, section, JSON.stringify(planNodesFromMarkdown(markdown))],
    );
    ids[section as PlanSection] = rows[0]?.id ?? '';
  }
  return ids;
}

async function stateOf(path: string, cookie: string) {
  const response = await request(path, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as PlanState;
}

/** The plan as the collaboration server holds it. */
const planOf = (projectId: string) => test.collab.changePlan(projectId, planToMarkdown);

describe('the state of the plan', () => {
  it('is quiet for a new project', async () => {
    const { owner, plan } = await createProject();

    expect(await stateOf(plan, owner)).toEqual({
      suggestions: [],
      generating: false,
      failure: null,
    });
  });

  it('lists the open suggestions in the order of the sections, for every member', async () => {
    const { projectId, plan } = await createProject();
    const viewer = await member(projectId, 'viewer');
    const ids = await suggest(projectId, {
      risks: 'Wenig Zeit',
      scope: '- Mitgliederliste\n- **Login**',
      tech: 'React',
    });
    await test.db.adminPool.query(
      `update plan_suggestions set status = 'rejected', decided_at = now() where id = $1`,
      [ids.tech],
    );

    const { suggestions } = await stateOf(plan, viewer);

    expect(suggestions.map((suggestion) => suggestion.section)).toEqual(['scope', 'risks']);
    expect(suggestions[0]).toMatchObject({
      id: ids.scope,
      content: [{ type: 'bulletList' }],
    });
    expect(Number.isNaN(Date.parse(suggestions[0]?.createdAt ?? ''))).toBe(false);
  });

  it('says that the moderator writes, and what became of the last generation', async () => {
    const { owner, projectId, plan } = await createProject();
    const run = (status: string, error: string | null, ago: string) =>
      test.db.adminPool.query(
        `insert into ai_runs (project_id, agent_key, kind, status, error, created_at)
         values ($1, 'moderator', 'plan', $2, $3, now() - $4::interval)`,
        [projectId, status, error, ago],
      );

    await run('error', 'quota:2026-10-02T20:30:00.000Z You have hit your limit', '3 hours');
    expect(await stateOf(plan, owner)).toMatchObject({
      generating: false,
      failure: { kind: 'quota', resetsAt: '2026-10-02T20:30:00.000Z' },
    });

    await run('error', 'The model wrote no section of the plan', '2 hours');
    expect((await stateOf(plan, owner)).failure).toEqual({ kind: 'failed', resetsAt: null });

    // A run that never ended is taken as lost; a fresh one is running.
    await run('running', null, '1 hour');
    expect(await stateOf(plan, owner)).toMatchObject({ generating: false, failure: null });
    await run('queued', null, '5 seconds');
    expect(await stateOf(plan, owner)).toMatchObject({ generating: true, failure: null });

    await run('done', null, '1 second');
    expect(await stateOf(plan, owner)).toMatchObject({ generating: false, failure: null });
  });

  it('is for members with a session', async () => {
    const { plan } = await createProject();

    expect((await request(plan, null)).status).toBe(401);
    expect((await request(plan, await test.signIn())).status).toBe(404);
    expect((await request('/api/projects/demo/plan', await test.signIn())).status).toBe(404);
  });
});

describe('generating the plan', () => {
  it('queues the run of the moderator, one at a time', async () => {
    const { owner, projectId, plan } = await createProject();
    const editor = await member(projectId, 'editor');

    expect((await post(`${plan}/generate`, editor)).status).toBe(202);

    const runs = await test.db.adminPool.query<{ kind: string; status: string }>(
      'select kind, status from ai_runs where project_id = $1',
      [projectId],
    );
    expect(runs.rows).toEqual([{ kind: 'plan', status: 'queued' }]);
    expect(await stateOf(plan, owner)).toMatchObject({ generating: true });

    const again = await post(`${plan}/generate`, owner);
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('already_running');
  });

  it('is not for viewers, strangers or someone without a session', async () => {
    const { projectId, plan } = await createProject();
    const viewer = await member(projectId, 'viewer');

    const refused = await post(`${plan}/generate`, viewer);
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe('forbidden');
    expect((await post(`${plan}/generate`, await test.signIn())).status).toBe(404);
    expect((await post(`${plan}/generate`, null)).status).toBe(401);
    const runs = await test.db.adminPool.query('select 1 from ai_runs where project_id = $1', [
      projectId,
    ]);
    expect(runs.rowCount).toBe(0);
  });
});

describe('deciding a suggestion', () => {
  it('writes an accepted one into its section of the plan and leaves the others', async () => {
    const { owner, projectId, plan } = await createProject();
    await test.collab.changePlan(projectId, (doc) => {
      writePlanSection(doc, 'scope', planNodesFromMarkdown('Von Hand geschrieben'), 'de');
      writePlanSection(doc, 'risks', planNodesFromMarkdown('Bleibt stehen'), 'de');
    });
    const ids = await suggest(projectId, {
      scope: 'Die erste Version:\n\n- Mitgliederliste\n- **Login** per Link',
      tech: 'React, weil das Team es kennt.',
    });

    const accepted = await post(`${plan}/suggestions/${ids.scope ?? ''}/accept`, owner);

    expect(accepted.status).toBe(204);
    expect(await planOf(projectId)).toBe(
      [
        '## MVP-Umfang',
        'Die erste Version:',
        '- Mitgliederliste\n- **Login** per Link',
        '## Risiken',
        'Bleibt stehen',
      ].join('\n\n'),
    );
    expect((await stateOf(plan, owner)).suggestions.map((entry) => entry.section)).toEqual([
      'tech',
    ]);

    // Once decided, a suggestion is decided.
    const again = await post(`${plan}/suggestions/${ids.scope ?? ''}/accept`, owner);
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('already_decided');
  });

  it('leaves the plan as it is when a suggestion is rejected', async () => {
    const { owner, projectId, plan } = await createProject();
    await test.collab.changePlan(projectId, (doc) => {
      writePlanSection(doc, 'scope', planNodesFromMarkdown('Von Hand geschrieben'), 'de');
    });
    const ids = await suggest(projectId, { scope: 'Etwas anderes' });

    expect((await post(`${plan}/suggestions/${ids.scope ?? ''}/reject`, owner)).status).toBe(204);

    expect(await planOf(projectId)).toBe('## MVP-Umfang\n\nVon Hand geschrieben');
    expect((await stateOf(plan, owner)).suggestions).toEqual([]);
  });

  it('accepts all open ones at once, with missing sections in their order', async () => {
    const { projectId, plan } = await createProject();
    const editor = await member(projectId, 'editor');
    await test.db.adminPool.query(`update projects set language = 'en' where id = $1`, [projectId]);
    await suggest(projectId, { costs: 'About 3 months', scope: 'Member list', risks: 'Time' });

    expect((await post(`${plan}/suggestions/accept`, editor)).status).toBe(204);

    expect(await planOf(projectId)).toBe(
      [
        '## MVP scope',
        'Member list',
        '## Risks',
        'Time',
        '## Costs and time',
        'About 3 months',
      ].join('\n\n'),
    );
    expect((await stateOf(plan, editor)).suggestions).toEqual([]);
    // Nothing is open any more: accepting all again changes nothing.
    expect((await post(`${plan}/suggestions/accept`, editor)).status).toBe(204);
  });

  it('is for owners and editors of the project', async () => {
    const { projectId, plan } = await createProject();
    const viewer = await member(projectId, 'viewer');
    const ids = await suggest(projectId, { scope: 'Mitgliederliste' });
    const accept = `${plan}/suggestions/${ids.scope ?? ''}/accept`;

    const refused = await post(accept, viewer);
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe('forbidden');
    expect((await post(`${plan}/suggestions/accept`, viewer)).status).toBe(403);
    expect((await post(accept, await test.signIn())).status).toBe(404);
    expect((await post(accept, null)).status).toBe(401);
    // A suggestion of another project, an unknown one and a broken id are not found.
    const other = await createProject('Anderes');
    expect(
      (await post(`${other.plan}/suggestions/${ids.scope ?? ''}/accept`, other.owner)).status,
    ).toBe(404);
    expect(
      (await post(`${plan}/suggestions/0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de/reject`, viewer))
        .status,
    ).toBe(403);
    expect((await post(`${plan}/suggestions/nope/accept`, viewer)).status).toBe(404);
    expect(await planOf(projectId)).toBe('');
  });
});
