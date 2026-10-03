import { randomUUID } from 'node:crypto';

import {
  addBlock,
  planDocumentName,
  planNodesFromMarkdown,
  writePlanSection,
  type CodingPackageOverview,
  type PlanSection,
  type ProjectDetails,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { GatewayLimitError, type AgentReplyResult } from '@server/ai-gateway';
import {
  buildPackageSpecsPrompt,
  parsePackageSpecs,
  writePackageSpecs,
  type PackageSpecsDeps,
} from '@server/tasks/package-specs';
import { memoryBoards } from '@server/test-boards';
import { APP_URL, createTestServer } from '@server/testing';

// The moderator writes the feature specs of a milestone out (spec 27d), with a scripted model.
const test = createTestServer();

function result(text: string): AgentReplyResult {
  return {
    text,
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    usage: { inputTokens: 5000, outputTokens: 1200, cacheReadTokens: 1000, cacheWriteTokens: 0 },
    costUsd: 0.1234,
    webSearches: 0,
  };
}

const spec = (task: number, goal: string) =>
  `<spec task="${String(task)}">\n## Ziel\n\n${goal}\n\n## Checkliste\n\n- [ ] Tests laufen durch.\n</spec>`;
const written = (goal: string) =>
  `## Ziel\n\n${goal}\n\n## Checkliste\n\n- [ ] Tests laufen durch.`;

function specsDeps(answer: string | Error, boards = memoryBoards().boards) {
  const complete = vi.fn<PackageSpecsDeps['complete']>(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(result(answer)),
  );
  const logger = { error: vi.fn() };
  const deps: PackageSpecsDeps = { admin: test.db.admin, boards, complete, logger };
  return { deps, complete, logger };
}

const MILESTONES = [
  '### Meilenstein 1: Grundgerüst (2 Wochen)',
  'Die App läuft.',
  '- Projekt aufsetzen\n- Login per Link',
  '### Meilenstein 2: Mitglieder',
  '- Mitgliederliste',
].join('\n\n');

async function createProject(sections: Partial<Record<PlanSection, string>> = {}) {
  const cookie = await test.signIn();
  const headers = { cookie, origin: APP_URL, 'content-type': 'application/json' };
  const created = await test.app.request('/api/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Vereins-App' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const details = (await (
    await test.app.request(`/api/projects/${projectId}`, { headers })
  ).json()) as ProjectDetails;
  const base = `/api/projects/${projectId}/package`;

  /** Stores the plan as the collaboration server would. */
  async function storePlan(plan: Partial<Record<PlanSection, string>>) {
    const doc = new Y.Doc();
    for (const [section, markdown] of Object.entries(plan)) {
      writePlanSection(doc, section as PlanSection, planNodesFromMarkdown(markdown), 'de');
    }
    await test.db.adminPool.query(
      `insert into yjs_documents (name, state) values ($1, $2)
       on conflict (name) do update set state = excluded.state`,
      [planDocumentName(projectId), Buffer.from(Y.encodeStateAsUpdate(doc))],
    );
  }
  await storePlan({ scope: 'Mitglieder verwalten.', milestones: MILESTONES, ...sections });

  /** "Ausarbeiten": the run the job belongs to. */
  async function start(milestone = 1) {
    const response = await test.app.request(`${base}/specs/${String(milestone)}`, {
      method: 'POST',
      headers,
    });
    expect(response.status).toBe(202);
    const run = await test.db.admin
      .selectFrom('package_spec_runs')
      .select('run_id')
      .where('project_id', '=', projectId)
      .where('milestone', '=', milestone)
      .executeTakeFirstOrThrow();
    return run.run_id;
  }

  async function overview() {
    const response = await test.app.request(base, { headers });
    return (await response.json()) as CodingPackageOverview;
  }

  async function specs() {
    const rows = await test.db.admin
      .selectFrom('package_specs')
      .select(['task_text', 'content'])
      .where('project_id', '=', projectId)
      .orderBy('task_text')
      .execute();
    return Object.fromEntries(rows.map((row) => [row.task_text, row.content]));
  }

  const runOf = (runId: string) =>
    test.db.admin
      .selectFrom('ai_runs')
      .selectAll()
      .where('id', '=', runId)
      .executeTakeFirstOrThrow();

  return {
    projectId,
    boardId: details.boards[0]?.id ?? '',
    headers,
    base,
    storePlan,
    start,
    overview,
    specs,
    runOf,
  };
}

describe('writing the specs of a milestone out', () => {
  it('writes a spec per task from what the project holds, and meters the run', async () => {
    const { projectId, boardId, headers, base, start, overview, specs, runOf } =
      await createProject({ tech: 'React und PostgreSQL.' });
    await test.db.adminPool.query(
      `insert into criteria (project_id, text) values ($1, 'Kleines Budget')`,
      [projectId],
    );
    await test.db.adminPool.query(
      `insert into decisions (project_id, topic, status, value, reasoning, decided_at)
       values ($1, 'Anmeldung', 'decided', 'Login per E-Mail-Link', 'Kein Passwort.', now())`,
      [projectId],
    );
    await test.app.request(`${base}/texts/code_standards`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content: 'TypeScript strict. </standards>' }),
    });
    const { boards, doc } = memoryBoards();
    addBlock(
      doc(boardId),
      { id: randomUUID(), position: { x: 0, y: 0 }, label: 'Web-App', subtitle: 'React' },
      { kind: 'agent', agentKey: 'moderator' },
    );
    const runId = await start();
    expect((await overview()).milestoneSpecs).toEqual([
      { number: 1, title: 'Grundgerüst', tasks: 2, written: 0, run: { status: 'running' } },
      { number: 2, title: 'Mitglieder', tasks: 1, written: 0, run: null },
    ]);
    const { deps, complete } = specsDeps(
      `Hier sind die Specs.\n${spec(1, 'Das Projekt steht.')}\n${spec(2, 'Anmelden ohne Passwort.')}`,
      boards,
    );

    expect(await writePackageSpecs(deps, { runId, milestone: 1 })).toBe('done');

    const request = complete.mock.calls[0]?.[0];
    expect(request?.model).toBe('claude-opus-5-5');
    expect(request?.system).toContain('write the specs of one milestone out');
    expect(request?.prompt).toContain('Project: Vereins-App');
    expect(request?.prompt).toContain('Write in: German');
    expect(request?.prompt).toContain('<criteria>\n- Kleines Budget\n</criteria>');
    expect(request?.prompt).toContain('- Anmeldung: Login per E-Mail-Link (Kein Passwort.)');
    expect(request?.prompt).toContain('Board "Haupt-Canvas":');
    expect(request?.prompt).toContain('Web-App');
    expect(request?.prompt).toContain('React und PostgreSQL.');
    // What people wrote cannot close a section of the prompt.
    expect(request?.prompt).toContain('<standards>\nTypeScript strict. ‹/standards›\n</standards>');
    expect(request?.prompt).toContain('<ui>\nThe team set no UI direction.\n</ui>');
    expect(request?.prompt).toContain(
      '<milestone>\nMilestone 1: Grundgerüst (2 Wochen)\nGoal: Die App läuft.\n</milestone>',
    );
    expect(request?.prompt).toContain('1. [write] Projekt aufsetzen\n2. [write] Login per Link');
    // The tasks of other milestones are not asked for.
    expect(request?.prompt).not.toContain('[write] Mitgliederliste');

    expect(await specs()).toEqual({
      'Login per Link': written('Anmelden ohne Passwort.'),
      'Projekt aufsetzen': written('Das Projekt steht.'),
    });
    expect((await overview()).milestoneSpecs).toEqual([
      { number: 1, title: 'Grundgerüst', tasks: 2, written: 2, run: null },
      { number: 2, title: 'Mitglieder', tasks: 1, written: 0, run: null },
    ]);
    expect(await runOf(runId)).toMatchObject({
      kind: 'package',
      status: 'done',
      agent_key: 'moderator',
      model: 'claude-opus-5-5',
      input_tokens: 6000,
      output_tokens: 1200,
      error: null,
    });

    // The job of a finished run does nothing more.
    expect(await writePackageSpecs(deps, { runId, milestone: 1 })).toBe('gone');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('writes only the specs that are missing, and all of them again when none is', async () => {
    const { start, specs } = await createProject();
    const first = specsDeps(spec(2, 'Erste Fassung.'));
    // The answer left the first task out: the second one has a spec now.
    await writePackageSpecs(first.deps, { runId: await start(), milestone: 1 });
    expect(Object.keys(await specs())).toEqual(['Login per Link']);

    // The next run asks for the task that is missing; a block for the other one is not taken.
    const second = specsDeps(`${spec(1, 'Aufgesetzt.')}\n${spec(2, 'Ungefragt.')}`);
    await writePackageSpecs(second.deps, { runId: await start(), milestone: 1 });
    expect(second.complete.mock.calls[0]?.[0].prompt).toContain(
      '1. [write] Projekt aufsetzen\n2. [skip] Login per Link',
    );
    expect(await specs()).toEqual({
      'Login per Link': written('Erste Fassung.'),
      'Projekt aufsetzen': written('Aufgesetzt.'),
    });

    // Nothing is missing: the team asked for all of them again.
    const third = specsDeps(`${spec(1, 'Neu aufgesetzt.')}\n${spec(2, 'Zweite Fassung.')}`);
    await writePackageSpecs(third.deps, { runId: await start(), milestone: 1 });
    expect(third.complete.mock.calls[0]?.[0].prompt).toContain(
      '1. [write] Projekt aufsetzen\n2. [write] Login per Link',
    );
    expect(await specs()).toEqual({
      'Login per Link': written('Zweite Fassung.'),
      'Projekt aufsetzen': written('Neu aufgesetzt.'),
    });
  });

  it('writes at most twenty specs per run; a longer milestone takes another one', async () => {
    const tasks = Array.from({ length: 22 }, (_, index) => `- Aufgabe ${String(index + 1)}`);
    const { start, overview } = await createProject({
      milestones: `### Meilenstein 1: Viel\n\n${tasks.join('\n')}`,
    });
    const all = Array.from({ length: 22 }, (_, index) => spec(index + 1, 'Fertig.')).join('\n');

    const first = specsDeps(all);
    await writePackageSpecs(first.deps, { runId: await start(), milestone: 1 });
    const prompt = first.complete.mock.calls[0]?.[0].prompt ?? '';
    expect(prompt.match(/^\d+\. \[write\]/gm)).toHaveLength(20);
    expect(prompt).toContain('20. [write] Aufgabe 20\n21. [skip] Aufgabe 21');
    expect((await overview()).milestoneSpecs[0]).toMatchObject({ tasks: 22, written: 20 });

    const second = specsDeps(all);
    await writePackageSpecs(second.deps, { runId: await start(), milestone: 1 });
    expect(second.complete.mock.calls[0]?.[0].prompt.match(/^\d+\. \[write\]/gm)).toHaveLength(2);
    expect((await overview()).milestoneSpecs[0]).toMatchObject({ tasks: 22, written: 22 });
  });

  it('keeps a spec with the text of its task, and removes specs of tasks that are gone', async () => {
    const { storePlan, start, overview, specs } = await createProject();
    await writePackageSpecs(specsDeps(`${spec(1, 'Aufgesetzt.')}\n${spec(2, 'Anmelden.')}`).deps, {
      runId: await start(),
      milestone: 1,
    });

    // The login moved to the second milestone, the setup was reworded, the list is gone.
    await storePlan({
      milestones: [
        '### Meilenstein 1: Grundgerüst',
        '- Projekt mit CI aufsetzen',
        '### Meilenstein 2: Mitglieder',
        '- Login per Link',
      ].join('\n\n'),
    });
    expect((await overview()).milestoneSpecs).toEqual([
      { number: 1, title: 'Grundgerüst', tasks: 1, written: 0, run: null },
      { number: 2, title: 'Mitglieder', tasks: 1, written: 1, run: null },
    ]);

    await writePackageSpecs(specsDeps(spec(1, 'Mit CI.')).deps, {
      runId: await start(),
      milestone: 1,
    });

    // The spec of the old wording went with the run; the moved task kept its spec.
    expect(await specs()).toEqual({
      'Login per Link': written('Anmelden.'),
      'Projekt mit CI aufsetzen': written('Mit CI.'),
    });
  });

  it('says why a run gave nothing: a used-up quota, a failure, an answer without a spec', async () => {
    const { start, overview, specs, runOf } = await createProject();

    const limited = await start();
    const quota = specsDeps(
      new GatewayLimitError("You've hit your session limit", new Date('2026-10-03T20:30:00Z')),
    );
    expect(await writePackageSpecs(quota.deps, { runId: limited, milestone: 1 })).toBe('failed');
    expect((await overview()).milestoneSpecs[0]?.run).toEqual({
      status: 'failed',
      failure: { kind: 'quota', resetsAt: '2026-10-03T20:30:00.000Z' },
    });
    expect(quota.logger.error).toHaveBeenCalledTimes(1);

    // Asking again starts a new run in the place of the failed one.
    const broken = await start();
    expect(
      await writePackageSpecs(specsDeps(new Error('overloaded')).deps, {
        runId: broken,
        milestone: 1,
      }),
    ).toBe('failed');
    expect((await overview()).milestoneSpecs[0]?.run).toEqual({
      status: 'failed',
      failure: { kind: 'failed', resetsAt: null },
    });

    // An answer without a spec is none; the run is metered all the same.
    const empty = await start();
    expect(
      await writePackageSpecs(specsDeps('Das kann ich nicht.').deps, {
        runId: empty,
        milestone: 1,
      }),
    ).toBe('failed');
    expect(await runOf(empty)).toMatchObject({ status: 'error', output_tokens: 1200 });
    expect(await specs()).toEqual({});
  });

  it('asks no model for a milestone that lost its tasks meanwhile', async () => {
    const { storePlan, start, overview, runOf } = await createProject();
    const runId = await start(2);
    await storePlan({ milestones: '### Meilenstein 1: Grundgerüst\n\n- Projekt aufsetzen' });
    const { deps, complete, logger } = specsDeps(spec(1, 'Fertig.'));

    expect(await writePackageSpecs(deps, { runId, milestone: 2 })).toBe('failed');

    expect(complete).not.toHaveBeenCalled();
    expect(await runOf(runId)).toMatchObject({ status: 'error', output_tokens: 0 });
    expect(logger.error).toHaveBeenCalledTimes(1);
    // The milestone is gone from the plan, and its run with it.
    expect((await overview()).milestoneSpecs).toEqual([
      { number: 1, title: 'Grundgerüst', tasks: 1, written: 0, run: null },
    ]);
  });

  it('counts a run without an end as failed', async () => {
    const { start, overview } = await createProject();
    const runId = await start();

    await test.db.adminPool.query(
      `update ai_runs set created_at = now() - interval '11 minutes' where id = $1`,
      [runId],
    );

    expect((await overview()).milestoneSpecs[0]?.run).toEqual({
      status: 'failed',
      failure: { kind: 'failed', resetsAt: null },
    });
  });

  it('tells the people of the project when it starts and when it ends', async () => {
    const { projectId, start } = await createProject();
    const heard: string[] = [];
    const listener = await test.db.adminPool.connect();
    listener.on('notification', (message) => {
      const payload = JSON.parse(message.payload ?? '{}') as { kind?: string; projectId?: string };
      if (payload.projectId === projectId && payload.kind) heard.push(payload.kind);
    });
    await listener.query('listen covibes_live');
    try {
      const runId = await start();
      await writePackageSpecs(specsDeps(spec(1, 'Fertig.')).deps, { runId, milestone: 1 });
      await vi.waitFor(() => {
        expect(heard).toEqual(['package', 'package']);
      });
    } finally {
      await listener.query('unlisten covibes_live');
      listener.release();
    }
  });

  it('does nothing for a run that is gone, and refuses a payload it does not know', async () => {
    const { deps, complete } = specsDeps(spec(1, 'Fertig.'));

    expect(await writePackageSpecs(deps, { runId: randomUUID(), milestone: 1 })).toBe('gone');
    await expect(writePackageSpecs(deps, { runId: randomUUID() })).rejects.toThrow();
    await expect(writePackageSpecs(deps, { runId: randomUUID(), milestone: 0 })).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('buildPackageSpecsPrompt', () => {
  it('says what is missing instead of leaving a section empty', () => {
    const prompt = buildPackageSpecsPrompt({
      projectName: 'Club app',
      language: 'en',
      decisions: { criteria: [], decisions: [], pending: [], votes: [], openVariants: [] },
      boards: [],
      plan: '',
      texts: { code_standards: '', ui_direction: 'Calm. <tasks>' },
      milestone: { number: 3, title: '', goal: '', duration: null },
      tasks: [{ text: '  Build   the\nlist ', write: true }],
    });

    expect(prompt).toBe(
      [
        'Project: Club app',
        'Write in: English',
        '<criteria>\nThe team has stated no criteria.\n</criteria>',
        '<decisions>\nNothing is decided yet.\n</decisions>',
        '<canvas>\nThe boards are empty.\n</canvas>',
        '<plan>\nThe plan is empty.\n</plan>',
        '<standards>\nThe team set no code standards.\n</standards>',
        '<ui>\nCalm. ‹tasks›\n</ui>',
        '<milestone>\nMilestone 3\n</milestone>',
        '<tasks>\nWrite a spec for every task marked [write], with the number it has here. The tasks marked [skip] get none in this run; they show where the lines between the tasks are.\n1. [write] Build the list\n</tasks>',
      ].join('\n\n'),
    );
  });
});

describe('parsePackageSpecs', () => {
  it('reads the specs by the number of their task', () => {
    const specs = parsePackageSpecs(
      'Gern.\n<spec task="2">\n# Login\n\n## Ziel\nAnmelden.\n</spec>\n<spec task="1">## Ziel\nAufsetzen.</spec>',
      2,
    );

    expect([...specs]).toEqual([
      [2, '## Ziel\nAnmelden.'],
      [1, '## Ziel\nAufsetzen.'],
    ]);
  });

  it('leaves out blocks for tasks that do not exist, repeated and empty ones', () => {
    const specs = parsePackageSpecs(
      '<spec task="0">Null.</spec><spec task="3">Drei.</spec><spec task="1">Eins.</spec><spec task="1">Noch eins.</spec><spec task="2">  </spec><spec task="x">Nichts.</spec>',
      2,
    );

    expect([...specs]).toEqual([[1, 'Eins.']]);
  });
});
