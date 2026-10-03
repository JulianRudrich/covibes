import { randomUUID } from 'node:crypto';

import {
  addBlock,
  ensureTaskIds,
  planNodesFromMarkdown,
  readRoadmap,
  writePlanSection,
  type ApiErrorBody,
  type CodingPackageOverview,
  type PlanSection,
  type ProjectDetails,
  type ProjectSummary,
} from '@covibes/shared';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { APP_URL, createTestServer } from '@server/testing';

// The package for coding agents (spec 27b): what it holds, the team's texts, and the ZIP.
const test = createTestServer();

function request(path: string, cookie: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  return test.app.request(path, { ...init, headers });
}

const putText = (path: string, cookie: string | null, content: unknown) =>
  request(path, cookie, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(content),
  });

async function errorCode(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

async function userIdOf(cookie: string) {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user.id;
}

async function createProject() {
  const owner = await test.signIn();
  const created = await request('/api/projects', owner, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Vereins-App' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const details = (await (
    await request(`/api/projects/${projectId}`, owner)
  ).json()) as ProjectDetails;
  return {
    owner,
    projectId,
    mainBoardId: details.boards[0]?.id ?? '',
    package: `/api/projects/${projectId}/package`,
  };
}

async function member(projectId: string, role: 'editor' | 'viewer') {
  const cookie = await test.signIn();
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, await userIdOf(cookie), role],
  );
  return cookie;
}

/** Writes sections into the plan, as people do in the editor, with ids for its tasks. */
function writePlan(projectId: string, sections: Partial<Record<PlanSection, string>>) {
  return test.collab.changePlan(projectId, (doc) => {
    for (const [section, markdown] of Object.entries(sections)) {
      writePlanSection(doc, section as PlanSection, planNodesFromMarkdown(markdown), 'de');
    }
    ensureTaskIds(doc);
  });
}

const PLAN: Partial<Record<PlanSection, string>> = {
  scope: 'Mitglieder verwalten und Beiträge einziehen.',
  milestones: [
    '### Meilenstein 1: Grundgerüst (2 Wochen)',
    'Die App läuft.',
    '- Projekt aufsetzen\n- Login per Link',
    '### Meilenstein 2: Mitglieder',
    '- Mitgliederliste',
  ].join('\n\n'),
  tech: 'React und PostgreSQL.',
};

/** A project with a plan, a decided and an open decision, a criterion and a block on the canvas. */
async function plannedProject() {
  const project = await createProject();
  const ownerId = await userIdOf(project.owner);
  await test.db.adminPool.query('update users set name = $1 where id = $2', ['Olga', ownerId]);
  await writePlan(project.projectId, PLAN);
  await test.db.adminPool.query(
    `insert into decisions
       (project_id, topic, status, value, reasoning, decided_by, decided_at, created_at)
     values ($1, 'Datenbank', 'decided', 'PostgreSQL', 'Bewährt und frei.', $2, now(), now()),
            ($1, 'Hosting', 'open', null, '', null, null, now() + interval '1 second')`,
    [project.projectId, ownerId],
  );
  await test.db.adminPool.query(
    `insert into criteria (project_id, text, created_by) values ($1, 'EU-Hosting', $2)`,
    [project.projectId, ownerId],
  );
  await test.collab.changeBoard(
    { boardId: project.mainBoardId, projectId: project.projectId },
    (doc) => {
      addBlock(
        doc,
        { id: randomUUID(), blockType: 'service', position: { x: 0, y: 0 }, label: 'Web-App' },
        { kind: 'human', userId: ownerId },
      );
    },
  );
  return { ...project, ownerId };
}

async function overviewOf(path: string, cookie: string) {
  const response = await request(path, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as CodingPackageOverview;
}

async function unzip(response: Response): Promise<Record<string, string>> {
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return Object.fromEntries(Object.entries(files).map(([path, data]) => [path, strFromU8(data)]));
}

describe('GET /api/projects/:projectId/package', () => {
  it('says what the package of a project holds', async () => {
    const project = await plannedProject();

    const overview = await overviewOf(project.package, project.owner);

    expect(overview).toMatchObject({
      hasPlan: true,
      milestones: 2,
      tasks: 3,
      decisions: { decided: 1, open: 1 },
      diagrams: 1,
      language: 'de',
      texts: { code_standards: '', ui_direction: '' },
      canEdit: true,
    });
    expect(overview.files).toEqual([
      'CLAUDE.md',
      'AGENTS.md',
      'context/project-overview.md',
      'context/architecture.md',
      'context/decisions.md',
      'context/code-standards.md',
      'context/ui-context.md',
      'context/project-plan.md',
      'context/progress-tracker.md',
      'context/feature-specs/00-overview.md',
      'context/feature-specs/01-01-projekt-aufsetzen.md',
      'context/feature-specs/01-02-login-per-link.md',
      'context/feature-specs/02-01-mitgliederliste.md',
      'docs/diagrams/haupt-canvas.md',
    ]);
  });

  it('has no files for a project without a plan', async () => {
    const project = await createProject();

    expect(await overviewOf(project.package, project.owner)).toMatchObject({
      hasPlan: false,
      milestones: 0,
      tasks: 0,
      decisions: { decided: 0, open: 0 },
      diagrams: 0,
      files: [],
    });
  });

  it('is there for viewers, who cannot write the texts', async () => {
    const project = await plannedProject();
    const viewer = await member(project.projectId, 'viewer');

    expect(await overviewOf(project.package, viewer)).toMatchObject({
      hasPlan: true,
      canEdit: false,
    });
  });

  it('is there for members only', async () => {
    const project = await plannedProject();
    const stranger = await test.signIn();

    expect((await request(project.package, null)).status).toBe(401);
    expect((await request(project.package, stranger)).status).toBe(404);
    expect((await request('/api/projects/nope/package', project.owner)).status).toBe(404);
  });
});

describe('PUT /api/projects/:projectId/package/texts/:kind', () => {
  it('stores the texts of owners and editors, the latest one counts', async () => {
    const project = await plannedProject();
    const editor = await member(project.projectId, 'editor');

    const first = await putText(`${project.package}/texts/code_standards`, project.owner, {
      content: '  TypeScript strict.\n',
    });
    await putText(`${project.package}/texts/code_standards`, editor, {
      content: 'TypeScript strict, keine any.',
    });
    await putText(`${project.package}/texts/ui_direction`, editor, { content: 'Ruhig und hell.' });

    expect(first.status).toBe(204);
    expect((await overviewOf(project.package, project.owner)).texts).toEqual({
      code_standards: 'TypeScript strict, keine any.',
      ui_direction: 'Ruhig und hell.',
    });
    const { rows } = await test.db.adminPool.query<{ kind: string; updated_by: string }>(
      'select kind, updated_by from package_texts where project_id = $1 order by kind',
      [project.projectId],
    );
    expect(rows).toEqual([
      { kind: 'code_standards', updated_by: await userIdOf(editor) },
      { kind: 'ui_direction', updated_by: await userIdOf(editor) },
    ]);
  });

  it('removes a text that is emptied', async () => {
    const project = await plannedProject();
    await putText(`${project.package}/texts/ui_direction`, project.owner, { content: 'Hell.' });

    const emptied = await putText(`${project.package}/texts/ui_direction`, project.owner, {
      content: '  ',
    });
    // Emptying what is empty already is fine as well.
    const again = await putText(`${project.package}/texts/ui_direction`, project.owner, {
      content: '',
    });

    expect([emptied.status, again.status]).toEqual([204, 204]);
    expect((await overviewOf(project.package, project.owner)).texts.ui_direction).toBe('');
  });

  it('refuses viewers and people outside of the project', async () => {
    const project = await plannedProject();
    const viewer = await member(project.projectId, 'viewer');
    const stranger = await test.signIn();
    await putText(`${project.package}/texts/code_standards`, project.owner, { content: 'Strict.' });
    const path = `${project.package}/texts/code_standards`;

    const changed = await putText(path, viewer, { content: 'Locker.' });
    const emptied = await putText(path, viewer, { content: '' });
    const outside = await putText(path, stranger, { content: 'Locker.' });
    const signedOut = await putText(path, null, { content: 'Locker.' });

    expect([changed.status, emptied.status, outside.status, signedOut.status]).toEqual([
      403, 403, 404, 401,
    ]);
    expect(await errorCode(changed)).toBe('forbidden');
    expect((await overviewOf(project.package, project.owner)).texts.code_standards).toBe('Strict.');
  });

  it('takes only the kinds it knows and texts within the limit', async () => {
    const project = await plannedProject();

    const unknown = await putText(`${project.package}/texts/readme`, project.owner, {
      content: 'Hallo.',
    });
    const tooLong = await putText(`${project.package}/texts/code_standards`, project.owner, {
      content: 'x'.repeat(8001),
    });
    const noText = await putText(`${project.package}/texts/code_standards`, project.owner, {});
    const atLimit = await putText(`${project.package}/texts/code_standards`, project.owner, {
      content: 'x'.repeat(8000),
    });

    expect([unknown.status, tooLong.status, noText.status, atLimit.status]).toEqual([
      404, 400, 400, 204,
    ]);
  });
});

describe('GET /api/projects/:projectId/package/download', () => {
  it('sends the package as a ZIP named after the project', async () => {
    const project = await plannedProject();
    await putText(`${project.package}/texts/code_standards`, project.owner, {
      content: 'TypeScript strict.',
    });
    // Olga takes the login.
    const sections = await test.collab.readPlanSections(project.projectId);
    const login = readRoadmap(sections).milestones[0]?.tasks[1];
    await request(
      `/api/projects/${project.projectId}/roadmap/tasks/${login?.id ?? ''}/assignee`,
      project.owner,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: project.ownerId }),
      },
    );

    const response = await request(`${project.package}/download`, project.owner);
    const files = await unzip(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="vereins-app-coding-paket.zip"',
    );
    expect(Object.keys(files)).toEqual((await overviewOf(project.package, project.owner)).files);
    expect(files['CLAUDE.md']).toBe(files['AGENTS.md']);
    expect(files['CLAUDE.md']).toContain('# Vereins-App');
    expect(files['CLAUDE.md']).toContain(
      '`context/ui-context.md`: Richtung für die Oberfläche (noch offen)',
    );
    expect(files['context/code-standards.md']).toBe(
      '# Code-Standards: Vereins-App\n\nTypeScript strict.\n',
    );
    expect(files['context/project-overview.md']).toContain('- EU-Hosting');
    expect(files['context/architecture.md']).toContain(
      '- [Haupt-Canvas](../docs/diagrams/haupt-canvas.md)',
    );
    expect(files['context/decisions.md']).toContain('**Entscheidung:** PostgreSQL');
    expect(files['context/decisions.md']).toMatch(/Entschieden am .+ von Olga\./);
    expect(files['context/decisions.md']).toContain('## Offen');
    expect(files['context/project-plan.md']).toContain('- Login per Link *(Olga)*');
    expect(files['context/progress-tracker.md']).toContain(
      '- [ ] [01-02 Login per Link](feature-specs/01-02-login-per-link.md) (Olga)',
    );
    expect(files['context/feature-specs/01-02-login-per-link.md']).toContain(
      '## Zuständig\n\nOlga\n',
    );
    expect(files['docs/diagrams/haupt-canvas.md']).toContain('```mermaid');
    expect(files['docs/diagrams/haupt-canvas.md']).toContain('Web-App');
  });

  it('is there for viewers', async () => {
    const project = await plannedProject();
    const viewer = await member(project.projectId, 'viewer');

    const response = await request(`${project.package}/download`, viewer);

    expect(response.status).toBe(200);
    expect(Object.keys(await unzip(response))).toContain('CLAUDE.md');
  });

  it('gives no package without a plan, and none to people outside of the project', async () => {
    const project = await createProject();
    const planned = await plannedProject();
    const stranger = await test.signIn();

    expect((await request(`${project.package}/download`, project.owner)).status).toBe(404);
    expect((await request(`${planned.package}/download`, stranger)).status).toBe(404);
    expect((await request(`${planned.package}/download`, null)).status).toBe(401);
  });
});

describe('the moderator’s suggestions for the texts (spec 27c)', () => {
  const post = (path: string, cookie: string | null) => request(path, cookie, { method: 'POST' });
  const remove = (path: string, cookie: string | null) =>
    request(path, cookie, { method: 'DELETE' });

  /** What the worker does once the moderator wrote the text. */
  async function write(projectId: string, kind: string, content: string) {
    await test.db.adminPool.query(
      `update ai_runs set status = 'done'
       where id = (select run_id from package_suggestions where project_id = $1 and kind = $2)`,
      [projectId, kind],
    );
    await test.db.adminPool.query(
      'update package_suggestions set content = $3 where project_id = $1 and kind = $2',
      [projectId, kind, content],
    );
  }

  it('asks the moderator for owners and editors, one run per text at a time', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    const path = `${project.package}/texts/code_standards/suggestion`;
    expect((await overviewOf(project.package, project.owner)).suggestions).toEqual({
      code_standards: null,
      ui_direction: null,
    });

    const started = await post(path, editor);
    const again = await post(path, project.owner);
    const other = await post(`${project.package}/texts/ui_direction/suggestion`, project.owner);

    expect([started.status, again.status, other.status]).toEqual([202, 409, 202]);
    expect(await errorCode(again)).toBe('already_running');
    expect((await overviewOf(project.package, project.owner)).suggestions).toEqual({
      code_standards: { status: 'running' },
      ui_direction: { status: 'running' },
    });
    const { rows } = await test.db.adminPool.query<{ kind: string; status: string }>(
      `select kind, status from ai_runs where project_id = $1 and kind = 'package'`,
      [project.projectId],
    );
    expect(rows).toEqual([
      { kind: 'package', status: 'queued' },
      { kind: 'package', status: 'queued' },
    ]);
  });

  it('does not ask for viewers, strangers or texts it does not know', async () => {
    const project = await createProject();
    const viewer = await member(project.projectId, 'viewer');
    const stranger = await test.signIn();
    const path = `${project.package}/texts/code_standards/suggestion`;

    const asViewer = await post(path, viewer);

    expect(asViewer.status).toBe(403);
    expect(await errorCode(asViewer)).toBe('forbidden');
    expect((await post(path, stranger)).status).toBe(404);
    expect((await post(path, null)).status).toBe(401);
    expect((await post(`${project.package}/texts/readme/suggestion`, project.owner)).status).toBe(
      404,
    );
    expect((await overviewOf(project.package, viewer)).suggestions.code_standards).toBeNull();
  });

  it('shows a written suggestion to every member and takes it over for owners and editors', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    const viewer = await member(project.projectId, 'viewer');
    await putText(`${project.package}/texts/code_standards`, project.owner, { content: 'Alt.' });
    const path = `${project.package}/texts/code_standards/suggestion`;
    await post(path, project.owner);

    // Nothing to take over while the moderator writes.
    expect((await post(`${path}/accept`, project.owner)).status).toBe(404);

    await write(project.projectId, 'code_standards', '## Tests\n\n- Vitest');
    expect((await overviewOf(project.package, viewer)).suggestions.code_standards).toEqual({
      status: 'ready',
      content: '## Tests\n\n- Vitest',
    });
    expect((await post(`${path}/accept`, viewer)).status).toBe(403);

    const accepted = await post(`${path}/accept`, editor);

    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ content: '## Tests\n\n- Vitest' });
    const overview = await overviewOf(project.package, project.owner);
    expect(overview.texts.code_standards).toBe('## Tests\n\n- Vitest');
    expect(overview.suggestions.code_standards).toBeNull();
    // It is gone: a second click finds nothing.
    expect((await post(`${path}/accept`, editor)).status).toBe(404);
  });

  it('dismisses a suggestion for owners and editors, also one that is still written', async () => {
    const project = await createProject();
    const editor = await member(project.projectId, 'editor');
    const viewer = await member(project.projectId, 'viewer');
    const stranger = await test.signIn();
    const path = `${project.package}/texts/ui_direction/suggestion`;
    await post(path, project.owner);

    expect((await remove(path, viewer)).status).toBe(403);
    expect((await remove(path, stranger)).status).toBe(404);
    expect((await remove(path, null)).status).toBe(401);
    expect((await overviewOf(project.package, project.owner)).suggestions.ui_direction).toEqual({
      status: 'running',
    });

    const dismissed = await remove(path, editor);
    // Dismissing what is not there is fine as well.
    const again = await remove(path, editor);

    expect([dismissed.status, again.status]).toEqual([204, 204]);
    expect((await overviewOf(project.package, project.owner)).suggestions.ui_direction).toBeNull();
    // After a dismissal the moderator can be asked again at once.
    expect((await post(path, editor)).status).toBe(202);
  });
});
