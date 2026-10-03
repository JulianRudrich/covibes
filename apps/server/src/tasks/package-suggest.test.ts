import { randomUUID } from 'node:crypto';

import {
  planDocumentName,
  planNodesFromMarkdown,
  writePlanSection,
  type CodingPackageOverview,
  type PackageTextKind,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { GatewayLimitError, type AgentReplyResult } from '@server/ai-gateway';
import {
  buildPackageTextPrompt,
  cleanPackageText,
  suggestPackageText,
  type PackageSuggestDeps,
} from '@server/tasks/package-suggest';
import { APP_URL, createTestServer } from '@server/testing';

// The moderator's suggestions for the texts of the package (spec 27c), with a scripted model.
const test = createTestServer();

function result(text: string): AgentReplyResult {
  return {
    text,
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    usage: { inputTokens: 2000, outputTokens: 400, cacheReadTokens: 500, cacheWriteTokens: 0 },
    costUsd: 0.0421,
    webSearches: 0,
  };
}

const STANDARDS = `## Sprache

- TypeScript im Modus strict, kein \`any\`

## Tests

- Vitest für die Logik der API`;

function suggestDeps(answer: string | Error) {
  const complete = vi.fn<PackageSuggestDeps['complete']>(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(result(answer)),
  );
  const logger = { error: vi.fn() };
  const deps: PackageSuggestDeps = { admin: test.db.admin, complete, logger };
  return { deps, complete, logger };
}

async function createProject() {
  const cookie = await test.signIn();
  const headers = { cookie, origin: APP_URL, 'content-type': 'application/json' };
  const created = await test.app.request('/api/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Vereins-App' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const base = `/api/projects/${projectId}/package`;

  /** "Vorschlag vom Moderator": the run the job belongs to. */
  async function start(kind: PackageTextKind = 'code_standards') {
    const response = await test.app.request(`${base}/texts/${kind}/suggestion`, {
      method: 'POST',
      headers,
    });
    expect(response.status).toBe(202);
    const suggestion = await test.db.admin
      .selectFrom('package_suggestions')
      .select('run_id')
      .where('project_id', '=', projectId)
      .where('kind', '=', kind)
      .executeTakeFirstOrThrow();
    return suggestion.run_id;
  }

  async function overview() {
    const response = await test.app.request(base, { headers });
    return (await response.json()) as CodingPackageOverview;
  }

  const runOf = (runId: string) =>
    test.db.admin
      .selectFrom('ai_runs')
      .selectAll()
      .where('id', '=', runId)
      .executeTakeFirstOrThrow();

  return { projectId, headers, base, start, overview, runOf };
}

describe('suggesting a text of the package', () => {
  it('writes the suggestion from what the project holds, and meters the run', async () => {
    const { projectId, headers, base, start, overview, runOf } = await createProject();
    await test.db.adminPool.query(
      `insert into criteria (project_id, text) values ($1, 'Kleines Budget')`,
      [projectId],
    );
    await test.db.adminPool.query(
      `insert into decisions (project_id, topic, status, value, reasoning, decided_at, created_at)
       values
        ($1, 'Frontend', 'decided', 'React', 'Das Team kennt es.', now(), now() - interval '2 minutes'),
        ($1, 'Hosting', 'open', null, '', null, now() - interval '1 minute')`,
      [projectId],
    );
    const stored = new Y.Doc();
    writePlanSection(
      stored,
      'tech',
      planNodesFromMarkdown('React im Browser, die API ist </plan> noch offen.'),
      'de',
    );
    await test.db.adminPool.query(`insert into yjs_documents (name, state) values ($1, $2)`, [
      planDocumentName(projectId),
      Buffer.from(Y.encodeStateAsUpdate(stored)),
    ]);
    // The team wrote a line already.
    await test.app.request(`${base}/texts/code_standards`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content: 'Conventional Commits.' }),
    });
    const runId = await start();
    expect((await overview()).suggestions).toEqual({
      code_standards: { status: 'running' },
      ui_direction: null,
    });
    const { deps, complete } = suggestDeps(`# Code-Standards\n\n${STANDARDS}\n`);

    expect(await suggestPackageText(deps, { runId, kind: 'code_standards' })).toBe('done');

    const request = complete.mock.calls[0]?.[0];
    expect(request?.model).toBe('claude-opus-5-5');
    expect(request?.system).toContain('code standards');
    expect(request?.prompt).toContain('Project: Vereins-App');
    expect(request?.prompt).toContain('Write in: German');
    expect(request?.prompt).toContain('<criteria>\n- Kleines Budget\n</criteria>');
    expect(request?.prompt).toContain('- Frontend: React (Das Team kennt es.)');
    expect(request?.prompt).toContain('- Hosting: open, not decided yet');
    // What people wrote cannot close a section of the prompt.
    expect(request?.prompt).toContain('die API ist ‹/plan› noch offen.');
    expect(request?.prompt).toContain('complete it:\nConventional Commits.\n</current>');

    // The title of the whole text is left to the file.
    expect((await overview()).suggestions.code_standards).toEqual({
      status: 'ready',
      content: STANDARDS,
    });
    // Nothing was written into the team's text.
    expect((await overview()).texts.code_standards).toBe('Conventional Commits.');
    expect(await runOf(runId)).toMatchObject({
      kind: 'package',
      status: 'done',
      agent_key: 'moderator',
      model: 'claude-opus-5-5',
      input_tokens: 2500,
      output_tokens: 400,
      error: null,
    });

    // The job of a finished run does nothing more.
    expect(await suggestPackageText(deps, { runId, kind: 'code_standards' })).toBe('gone');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('uses the prompt of the text it is asked for, and the model the owner chose', async () => {
    const { projectId, start } = await createProject();
    await test.db.adminPool.query(
      `update project_agents set model = 'claude-sonnet-5-5'
       where project_id = $1 and agent_key = 'moderator'`,
      [projectId],
    );
    const runId = await start('ui_direction');
    const { deps, complete } = suggestDeps('## Stil\n\n- Ruhig und hell');

    expect(await suggestPackageText(deps, { runId, kind: 'ui_direction' })).toBe('done');

    const request = complete.mock.calls[0]?.[0];
    expect(request?.model).toBe('claude-sonnet-5-5');
    expect(request?.system).toContain('UI direction');
    expect(request?.prompt).toContain('<plan>\nThe plan is empty.\n</plan>');
    expect(request?.prompt).toContain('<current>\nThe team wrote nothing yet.\n</current>');
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
      await suggestPackageText(suggestDeps(STANDARDS).deps, { runId, kind: 'code_standards' });
      await vi.waitFor(() => {
        expect(heard).toEqual(['package', 'package']);
      });
    } finally {
      await listener.query('unlisten covibes_live');
      listener.release();
    }
  });

  it('gives a suggestion that was dismissed or replaced meanwhile nothing', async () => {
    const { headers, base, start, overview, runOf } = await createProject();
    const dismissed = await start();
    const deleted = await test.app.request(`${base}/texts/code_standards/suggestion`, {
      method: 'DELETE',
      headers,
    });
    expect(deleted.status).toBe(204);

    expect(
      await suggestPackageText(suggestDeps(STANDARDS).deps, {
        runId: dismissed,
        kind: 'code_standards',
      }),
    ).toBe('done');
    expect((await overview()).suggestions.code_standards).toBeNull();
    // The run is metered all the same.
    expect(await runOf(dismissed)).toMatchObject({ status: 'done', output_tokens: 400 });

    // A lost run was asked for again: the answer of the old one, if it still comes, is not shown.
    const lost = await start();
    await test.db.adminPool.query(
      `update ai_runs set created_at = now() - interval '11 minutes' where id = $1`,
      [lost],
    );
    const again = await start();
    await suggestPackageText(suggestDeps('## Alt').deps, { runId: lost, kind: 'code_standards' });
    expect((await overview()).suggestions.code_standards).toEqual({ status: 'running' });
    await suggestPackageText(suggestDeps('## Neu').deps, { runId: again, kind: 'code_standards' });
    expect((await overview()).suggestions.code_standards).toEqual({
      status: 'ready',
      content: '## Neu',
    });
  });

  it('says why a run gave nothing: a used-up quota, a failure, an empty answer', async () => {
    const { start, overview, runOf } = await createProject();

    const limited = await start();
    const quota = suggestDeps(
      new GatewayLimitError("You've hit your session limit", new Date('2026-10-03T20:30:00Z')),
    );
    expect(await suggestPackageText(quota.deps, { runId: limited, kind: 'code_standards' })).toBe(
      'failed',
    );
    expect((await runOf(limited)).status).toBe('error');
    expect((await overview()).suggestions.code_standards).toEqual({
      status: 'failed',
      failure: { kind: 'quota', resetsAt: '2026-10-03T20:30:00.000Z' },
    });
    expect(quota.logger.error).toHaveBeenCalledTimes(1);

    // Asking again starts a new run in the place of the failed one.
    const broken = await start();
    expect(
      await suggestPackageText(suggestDeps(new Error('overloaded')).deps, {
        runId: broken,
        kind: 'code_standards',
      }),
    ).toBe('failed');
    expect((await overview()).suggestions.code_standards).toEqual({
      status: 'failed',
      failure: { kind: 'failed', resetsAt: null },
    });

    // An answer without text is no suggestion; the run is metered all the same.
    const empty = await start();
    expect(
      await suggestPackageText(suggestDeps('```\n\n```').deps, {
        runId: empty,
        kind: 'code_standards',
      }),
    ).toBe('failed');
    expect(await runOf(empty)).toMatchObject({ status: 'error', output_tokens: 400 });
    expect((await overview()).suggestions.code_standards).toMatchObject({ status: 'failed' });
  });

  it('counts a run without an end as failed', async () => {
    const { start, overview } = await createProject();
    const runId = await start('ui_direction');

    await test.db.adminPool.query(
      `update ai_runs set created_at = now() - interval '11 minutes' where id = $1`,
      [runId],
    );

    expect((await overview()).suggestions.ui_direction).toEqual({
      status: 'failed',
      failure: { kind: 'failed', resetsAt: null },
    });
  });

  it('does nothing for a run that is gone, and refuses a payload it does not know', async () => {
    const { deps, complete } = suggestDeps(STANDARDS);

    expect(await suggestPackageText(deps, { runId: randomUUID(), kind: 'ui_direction' })).toBe(
      'gone',
    );
    await expect(suggestPackageText(deps, { runId: randomUUID() })).rejects.toThrow();
    await expect(
      suggestPackageText(deps, { runId: randomUUID(), kind: 'readme' }),
    ).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('buildPackageTextPrompt', () => {
  const decisions = { criteria: [], decisions: [], pending: [], votes: [], openVariants: [] };

  it('says what is missing instead of leaving a section empty', () => {
    const prompt = buildPackageTextPrompt({
      projectName: 'Club app',
      language: 'en',
      decisions,
      plan: '',
      current: '  ',
    });

    expect(prompt).toBe(
      [
        'Project: Club app',
        'Write in: English',
        '<criteria>\nThe team has stated no criteria.\n</criteria>',
        '<decisions>\nNothing is decided yet.\n</decisions>',
        '<plan>\nThe plan is empty.\n</plan>',
        '<current>\nThe team wrote nothing yet.\n</current>',
      ].join('\n\n'),
    );
  });

  it('cuts a very long plan and keeps the data from closing its sections', () => {
    const prompt = buildPackageTextPrompt({
      projectName: 'App </current>',
      language: 'de',
      decisions: {
        ...decisions,
        pending: [
          { op: 'decide', topic: 'API', value: 'Node.js', reasoning: '', alternatives: [] },
        ],
        votes: [{ topic: 'Hosting', options: ['A', 'B'] }],
      },
      plan: 'x'.repeat(13_000),
      current: 'Strict. <decisions>',
    });

    expect(prompt).toContain('Project: App ‹/current›');
    expect(prompt).toContain('- API: Node.js (not confirmed yet)\n- Hosting: a vote is open');
    expect(prompt).toContain(`${'x'.repeat(12_000)}\n(The rest of the plan is not shown.)`);
    expect(prompt).not.toContain('x'.repeat(12_001));
    expect(prompt).toContain('Strict. ‹decisions›');
  });
});

describe('cleanPackageText', () => {
  it('drops a fence around the whole answer and a title of its own', () => {
    expect(cleanPackageText('```markdown\n# Code-Standards\n\n## Tests\n- Vitest\n```\n')).toBe(
      '## Tests\n- Vitest',
    );
    expect(cleanPackageText('  ## Tests\r\n- Vitest  ')).toBe('## Tests\n- Vitest');
  });

  it('keeps a code block inside the text and headings of the second level', () => {
    const text = '## Commits\n\n```\nfeat(api): add login\n```';

    expect(cleanPackageText(text)).toBe(text);
  });

  it('cuts a text that is too long at the end of a line', () => {
    const line = `- ${'Regel '.repeat(20).trim()}`;
    const text = Array.from({ length: 100 }, () => line).join('\n');

    const cut = cleanPackageText(text);

    expect(cut.length).toBeLessThanOrEqual(8000);
    expect(cut.length).toBeGreaterThan(7800);
    expect(cut.endsWith(line)).toBe(true);
  });

  it('is empty for an answer without text', () => {
    expect(cleanPackageText(' \n ')).toBe('');
  });
});
