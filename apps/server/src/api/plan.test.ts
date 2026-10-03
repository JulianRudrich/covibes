import {
  ensureTaskIds,
  PLAN_TASK_ATTRIBUTE,
  planNodesFromMarkdown,
  planNodesToMarkdown,
  planToMarkdown,
  readRoadmap,
  writePlanSection,
  type ApiErrorBody,
  type PlanSection,
  type PlanState,
  type PlanVersion,
  type PlanVersionContent,
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
      outdated: null,
      upToDate: false,
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

  it('lets the tasks of rewritten milestones keep their ids (spec 26b)', async () => {
    const { owner, projectId, plan } = await createProject();
    /** The tasks of the plan as the collaboration server holds it: their ids by their text. */
    const tasksOf = async () =>
      new Map(
        readRoadmap(await test.collab.readPlanSections(projectId))
          .milestones.flatMap((milestone) => milestone.tasks)
          .map((task) => [task.text, task.id]),
      );
    await test.collab.changePlan(projectId, (doc) => {
      writePlanSection(
        doc,
        'milestones',
        planNodesFromMarkdown(
          [
            '### Meilenstein 1: Grundgerüst',
            '- Projekt aufsetzen\n- Login per E-Mail-Link in der API bauen\n- Alte Aufgabe',
          ].join('\n\n'),
        ),
        'de',
      );
      // The server gives the ids once it stored the plan.
      ensureTaskIds(doc);
    });
    const before = await tasksOf();
    const ids = await suggest(projectId, {
      scope: '- Mitgliederliste',
      milestones: [
        '### Meilenstein 1: Fundament (2 Wochen)',
        '- Abnahme mit dem Vorstand\n- Login per E-Mail-Link bauen',
        '### Meilenstein 2: Start',
        '- Projekt aufsetzen',
      ].join('\n\n'),
    });

    expect((await post(`${plan}/suggestions/${ids.milestones ?? ''}/accept`, owner)).status).toBe(
      204,
    );
    expect((await post(`${plan}/suggestions/${ids.scope ?? ''}/accept`, owner)).status).toBe(204);

    const after = await tasksOf();
    expect([...after.keys()]).toEqual([
      'Abnahme mit dem Vorstand',
      'Login per E-Mail-Link bauen',
      'Projekt aufsetzen',
    ]);
    // The same text keeps its id wherever it stands now, and so does a reworded task.
    expect(after.get('Projekt aufsetzen')).toBe(before.get('Projekt aufsetzen'));
    expect(after.get('Login per E-Mail-Link bauen')).toBe(
      before.get('Login per E-Mail-Link in der API bauen'),
    );
    // A new task gets a new id, also not the one of the task that left the plan.
    expect(after.get('Abnahme mit dem Vorstand')).toMatch(/^[0-9a-f-]{36}$/);
    expect([...before.values()]).not.toContain(after.get('Abnahme mit dem Vorstand'));
    // Only the milestones hold tasks: the list of another section gets no ids.
    const { scope } = await test.collab.readPlanSections(projectId);
    expect(JSON.stringify(scope)).not.toContain(PLAN_TASK_ATTRIBUTE);
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

describe('an outdated plan (spec 25c)', () => {
  /** A finished run of the moderator: what the plan was last written or updated by. */
  const written = (projectId: string, ago: string) =>
    test.db.adminPool.query<{ id: string }>(
      `insert into ai_runs (project_id, agent_key, kind, status, created_at, finished_at)
       values ($1, 'moderator', 'plan', 'done', now() - $2::interval, now() - $2::interval)
       returning id`,
      [projectId, ago],
    );
  const logged = (projectId: string, kind: string, topic: string | null, ago: string) =>
    test.db.adminPool.query(
      `insert into decision_log (project_id, kind, topic, value, created_at)
       values ($1, $2, $3, 'x', now() - $4::interval)`,
      [projectId, kind, topic, ago],
    );

  it('says what changed since the moderator last wrote it', async () => {
    const { owner, projectId, plan } = await createProject();
    await logged(projectId, 'decided', 'Sprache', '5 hours');
    // Decisions change, but nobody generated a plan yet: nothing to be outdated against.
    expect((await stateOf(plan, owner)).outdated).toBeNull();

    const run = await written(projectId, '3 hours');
    await suggest(projectId, { scope: 'Umfang' });
    await test.db.adminPool.query('update plan_suggestions set run_id = $1 where project_id = $2', [
      run.rows[0]?.id,
      projectId,
    ]);
    expect(await stateOf(plan, owner)).toMatchObject({ outdated: null, upToDate: false });

    await logged(projectId, 'decided', 'Hosting', '2 hours');
    await logged(projectId, 'criterion_added', null, '100 minutes');
    await logged(projectId, 'criterion_removed', null, '90 minutes');
    await logged(projectId, 'reopened', 'Hosting', '1 hour');
    await logged(projectId, 'decided', 'Zahlung', '30 minutes');
    await logged(projectId, 'opened', 'Später', '20 minutes');

    // The newest first; a decision once with what happened last, the criteria as one change.
    expect((await stateOf(plan, owner)).outdated).toEqual({
      changes: [
        { kind: 'decided', topic: 'Zahlung' },
        { kind: 'reopened', topic: 'Hosting' },
        { kind: 'criteria', topic: null },
      ],
      more: 0,
    });
  });

  it('counts the changes it does not name', async () => {
    const { owner, projectId, plan } = await createProject();
    await written(projectId, '3 hours');
    for (const [index, topic] of ['A', 'B', 'C', 'D', 'E', 'F', 'G'].entries()) {
      await logged(projectId, 'decided', topic, `${String(60 - index)} minutes`);
    }

    const { outdated } = await stateOf(plan, owner);

    expect(outdated?.changes.map((change) => change.topic)).toEqual(['G', 'F', 'E', 'D', 'C']);
    expect(outdated?.more).toBe(2);
  });

  it('is current again after an update, also one that found nothing to change', async () => {
    const { owner, projectId, plan } = await createProject();
    await written(projectId, '3 hours');
    await logged(projectId, 'decided', 'Hosting', '2 hours');
    expect((await stateOf(plan, owner)).outdated).not.toBeNull();

    // The update read the change and left no suggestion behind.
    await written(projectId, '1 minute');
    expect(await stateOf(plan, owner)).toMatchObject({ outdated: null, upToDate: true });

    // The note about that does not stay for good.
    await test.db.adminPool.query(
      `update ai_runs set finished_at = now() - interval '11 minutes'
       where project_id = $1 and created_at > now() - interval '1 hour'`,
      [projectId],
    );
    expect(await stateOf(plan, owner)).toMatchObject({ outdated: null, upToDate: false });
  });

  it('is updated by owners and editors with a run of its own kind', async () => {
    const { projectId, plan } = await createProject();
    const editor = await member(projectId, 'editor');
    const viewer = await member(projectId, 'viewer');

    expect((await post(`${plan}/update`, viewer)).status).toBe(403);
    expect((await post(`${plan}/update`, editor)).status).toBe(202);

    const jobs = await test.db.adminPool.query<{ kind: string }>(
      `select jobs.payload ->> 'kind' as kind
       from graphile_worker._private_jobs jobs
       join ai_runs on ai_runs.id::text = jobs.payload ->> 'runId'
       where ai_runs.project_id = $1`,
      [projectId],
    );
    expect(jobs.rows).toEqual([{ kind: 'update' }]);
    const again = await post(`${plan}/generate`, editor);
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe('already_running');
  });
});

describe('versions of the plan (spec 25c)', () => {
  async function versionsOf(path: string, cookie: string) {
    const response = await request(`${path}/versions`, cookie);
    expect(response.status).toBe(200);
    return (await response.json()) as PlanVersion[];
  }

  async function versionText(path: string, cookie: string, id: string) {
    const response = await request(`${path}/versions/${id}`, cookie);
    expect(response.status).toBe(200);
    const version = (await response.json()) as PlanVersionContent;
    return { ...version, text: planNodesToMarkdown(version.content) };
  }

  /** The suggestions of one generation or update. */
  async function batch(
    projectId: string,
    sections: Partial<Record<PlanSection, string>>,
    kind = 'generate',
  ) {
    const ids = await suggest(projectId, sections);
    const run = await test.db.adminPool.query<{ id: string }>(
      `insert into ai_runs (project_id, agent_key, kind, status)
       values ($1, 'moderator', 'plan', 'done') returning id`,
      [projectId],
    );
    await test.db.adminPool.query(
      'update plan_suggestions set run_id = $1, kind = $2 where id = any ($3)',
      [run.rows[0]?.id, kind, Object.values(ids)],
    );
    return ids;
  }

  it('keep the plan as it stood before, and as it stands once all is decided', async () => {
    const { owner, projectId, plan } = await createProject();
    await test.collab.changePlan(projectId, (doc) => {
      writePlanSection(doc, 'scope', planNodesFromMarkdown('Von Hand geschrieben'), 'de');
    });
    const ids = await batch(projectId, { scope: 'Vom Moderator', tech: 'React', risks: 'Zeit' });
    expect(await versionsOf(plan, owner)).toEqual([]);

    // The first accepted suggestion: the hand-written plan is kept before it is replaced.
    await post(`${plan}/suggestions/${ids.scope ?? ''}/accept`, owner);
    const [manual, ...none] = await versionsOf(plan, owner);
    expect(none).toEqual([]);
    expect(manual).toMatchObject({ number: 1, reason: 'manual' });
    expect((await versionText(plan, owner, manual?.id ?? '')).text).toBe(
      '## MVP-Umfang\n\nVon Hand geschrieben',
    );

    // In between nothing is kept; the last decision closes the generation.
    await post(`${plan}/suggestions/${ids.tech ?? ''}/accept`, owner);
    expect(await versionsOf(plan, owner)).toHaveLength(1);
    await post(`${plan}/suggestions/${ids.risks ?? ''}/reject`, owner);

    const versions = await versionsOf(plan, owner);
    expect(versions.map((version) => [version.number, version.reason])).toEqual([
      [2, 'generated'],
      [1, 'manual'],
    ]);
    expect(versions[0]?.createdBy).toBeTruthy();
    expect(Number.isNaN(Date.parse(versions[0]?.createdAt ?? ''))).toBe(false);
    expect((await versionText(plan, owner, versions[0]?.id ?? '')).text).toBe(
      '## MVP-Umfang\n\nVom Moderator\n\n## Tech-Empfehlung\n\nReact',
    );
  });

  it('keep an update as its own kind, and nothing when nothing was accepted', async () => {
    const { owner, projectId, plan } = await createProject();
    await batch(projectId, { scope: 'Umfang', tech: 'React' });
    await post(`${plan}/suggestions/accept`, owner);
    // An empty plan had nothing to keep before; all at once closes the generation.
    expect((await versionsOf(plan, owner)).map((version) => version.reason)).toEqual(['generated']);

    const rejected = await batch(projectId, { risks: 'Zeit' }, 'update');
    await post(`${plan}/suggestions/${rejected.risks ?? ''}/reject`, owner);
    expect(await versionsOf(plan, owner)).toHaveLength(1);

    // Nobody touched the plan since the last version: only the updated plan is kept.
    const update = await batch(projectId, { tech: 'React und Node' }, 'update');
    await post(`${plan}/suggestions/${update.tech ?? ''}/accept`, owner);
    expect((await versionsOf(plan, owner)).map((version) => version.reason)).toEqual([
      'updated',
      'generated',
    ]);
  });

  it('hold the text of the plan without the ids of its tasks (spec 26b)', async () => {
    const { owner, projectId, plan } = await createProject();
    await test.collab.changePlan(projectId, (doc) => {
      writePlanSection(
        doc,
        'milestones',
        planNodesFromMarkdown('### Meilenstein 1: Grundgerüst\n\n- Login bauen'),
        'de',
      );
      ensureTaskIds(doc);
    });
    await batch(projectId, {
      milestones: '### Meilenstein 1: Grundgerüst\n\n- Login bauen\n- Export bauen',
    });

    await post(`${plan}/suggestions/accept`, owner);

    // The plan carries the ids, before and after; neither version does.
    const sections = await test.collab.readPlanSections(projectId);
    expect(JSON.stringify(sections).split(PLAN_TASK_ATTRIBUTE)).toHaveLength(3);
    const versions = await versionsOf(plan, owner);
    expect(versions.map((version) => version.reason)).toEqual(['generated', 'manual']);
    for (const version of versions) {
      const { content, text } = await versionText(plan, owner, version.id);
      expect(JSON.stringify(content)).not.toContain(PLAN_TASK_ATTRIBUTE);
      expect(text).toContain('### Meilenstein 1: Grundgerüst\n\n- Login bauen');
    }
  });

  it('are read by every member and by nobody else', async () => {
    const { owner, projectId, plan } = await createProject();
    const viewer = await member(projectId, 'viewer');
    await batch(projectId, { scope: 'Umfang' });
    await post(`${plan}/suggestions/accept`, owner);
    const [version] = await versionsOf(plan, viewer);

    expect((await versionText(plan, viewer, version?.id ?? '')).text).toBe(
      '## MVP-Umfang\n\nUmfang',
    );
    const stranger = await test.signIn();
    expect((await request(`${plan}/versions`, stranger)).status).toBe(404);
    expect((await request(`${plan}/versions/${version?.id ?? ''}`, stranger)).status).toBe(404);
    expect((await request(`${plan}/versions`, null)).status).toBe(401);
    expect((await request(`${plan}/versions/nope`, owner)).status).toBe(404);
    // A version belongs to its project.
    const other = await createProject('Anderes');
    expect((await request(`${other.plan}/versions/${version?.id ?? ''}`, other.owner)).status).toBe(
      404,
    );
  });
});
