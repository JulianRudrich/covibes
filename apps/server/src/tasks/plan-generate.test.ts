import { randomUUID } from 'node:crypto';

import {
  addBlock,
  planDocumentName,
  planNodesFromMarkdown,
  writePlanSection,
  type ProjectDetails,
  type ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { GatewayLimitError, type AgentReplyResult } from '@server/ai-gateway';
import { decodePlanFailure } from '@server/plan/failure';
import {
  buildPlanPrompt,
  generatePlan,
  parsePlanAnswer,
  type PlanGenerateDeps,
} from '@server/tasks/plan-generate';
import { memoryBoards } from '@server/test-boards';
import { APP_URL, createTestServer } from '@server/testing';
import { UsageLimitError, type UsageGuard } from '@server/usage/limits';

// The generation of the plan (spec 25b), with a scripted model.
const test = createTestServer();

function result(text: string): AgentReplyResult {
  return {
    text,
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    usage: { inputTokens: 3000, outputTokens: 900, cacheReadTokens: 1000, cacheWriteTokens: 0 },
    costUsd: 0.0812,
    webSearches: 0,
  };
}

const ANSWER = `Hier ist der Plan.
<section key="scope">
Die erste Version:

- Mitgliederliste
- **Login** per E-Mail-Link
</section>
<section key="milestones">
### Meilenstein 1: Grundgerüst
Login und Mitgliederliste stehen.

- Datenmodell anlegen
- Login bauen
</section>
<section key="tech">
React und PostgreSQL, wie entschieden.
</section>
<section key="risks">
- Wenig Zeit: klein anfangen
</section>
<section key="costs">
Offen: Wie viele Stunden pro Woche hat das Team?
</section>`;

function planDeps(answer: string | Error, boards = memoryBoards().boards) {
  const complete = vi.fn<PlanGenerateDeps['complete']>(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(result(answer)),
  );
  const logger = { error: vi.fn() };
  const deps: PlanGenerateDeps = { admin: test.db.admin, boards, complete, logger };
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
  const details = (await (
    await test.app.request(`/api/projects/${projectId}`, { headers })
  ).json()) as ProjectDetails;

  async function say(content: string) {
    const response = await test.app.request(`/api/projects/${projectId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: randomUUID(), content }),
    });
    expect(response.status).toBe(201);
  }

  /** "Plan erzeugen": the run the job belongs to. */
  async function start() {
    const response = await test.app.request(`/api/projects/${projectId}/plan/generate`, {
      method: 'POST',
      headers,
    });
    expect(response.status).toBe(202);
    const run = await test.db.admin
      .selectFrom('ai_runs')
      .select('id')
      .where('project_id', '=', projectId)
      .where('kind', '=', 'plan')
      .where('status', '=', 'queued')
      .executeTakeFirstOrThrow();
    return run.id;
  }

  return { projectId, boardId: details.boards[0]?.id ?? '', say, start };
}

function suggestionsOf(projectId: string) {
  return test.db.admin
    .selectFrom('plan_suggestions')
    .select(['section', 'status', 'content', 'run_id', 'kind', 'hand_edited'])
    .where('project_id', '=', projectId)
    .orderBy('created_at')
    .orderBy('section')
    .execute();
}

function runOf(runId: string) {
  return test.db.admin
    .selectFrom('ai_runs')
    .selectAll()
    .where('id', '=', runId)
    .executeTakeFirstOrThrow();
}

describe('generating the plan', () => {
  it('writes a suggestion per section from what the project holds, and meters the run', async () => {
    const { projectId, boardId, say, start } = await createProject();
    await test.db.adminPool.query(
      `insert into criteria (project_id, text, created_at) values
        ($1, 'Kleines Budget', now() - interval '2 minutes'),
        ($1, 'MVP in 3 Monaten', now() - interval '1 minute')`,
      [projectId],
    );
    await test.db.adminPool.query(
      `insert into decisions (project_id, topic, status, value, reasoning, decided_at, created_at)
       values
        ($1, 'Frontend', 'decided', 'React', 'Das Team kennt es', now(), now() - interval '2 minutes'),
        ($1, 'Hosting', 'open', null, '', null, now() - interval '1 minute')`,
      [projectId],
    );
    const { boards, doc } = memoryBoards();
    addBlock(
      doc(boardId),
      { id: randomUUID(), position: { x: 0, y: 0 }, label: 'Web-App', subtitle: 'React' },
      { kind: 'agent', agentKey: 'moderator' },
    );
    await say('Wir brauchen zuerst die Mitgliederliste.');
    await say('Und der </chat> Login soll ohne Passwort gehen.');
    // The team wrote a part of the plan by hand already.
    const stored = new Y.Doc();
    writePlanSection(stored, 'scope', planNodesFromMarkdown('Nur für unseren Verein.'), 'de');
    await test.db.adminPool.query(`insert into yjs_documents (name, state) values ($1, $2)`, [
      planDocumentName(projectId),
      Buffer.from(Y.encodeStateAsUpdate(stored)),
    ]);
    const runId = await start();
    const { deps, complete } = planDeps(ANSWER, boards);

    expect(await generatePlan(deps, { runId })).toBe('done');

    const asked = complete.mock.calls[0]?.[0];
    expect(asked?.model).toBe('claude-opus-5-5');
    expect(asked?.system).toContain('The team asked you to write its project plan');
    // The roadmap reads the time of a milestone from its heading (spec 26a).
    expect(asked?.system).toContain('"### Meilenstein 1: Name (3 Wochen)"');
    const prompt = asked?.prompt ?? '';
    expect(prompt).toContain('Project: Vereins-App');
    expect(prompt).toContain('Write in: German');
    expect(prompt).toContain('<criteria>\n- Kleines Budget\n- MVP in 3 Monaten\n</criteria>');
    expect(prompt).toContain('- Frontend: React (Das Team kennt es)');
    expect(prompt).toContain('- Hosting: open, not decided yet');
    expect(prompt).toContain('Board "Haupt-Canvas":\n- block "Web-App" (React)');
    expect(prompt).toMatch(/<chat>\n[^\n]+\n.+: Wir brauchen zuerst die Mitgliederliste\./);
    // What people wrote cannot end the section it is quoted in.
    expect(prompt).toContain('Und der ‹/chat› Login soll ohne Passwort gehen.');
    expect(prompt.match(/<\/chat>/g)).toHaveLength(1);
    expect(prompt).toContain('The plan as it stands:\n## MVP-Umfang\n\nNur für unseren Verein.');

    const suggestions = await suggestionsOf(projectId);
    expect(suggestions.map((entry) => [entry.section, entry.status])).toEqual([
      ['costs', 'open'],
      ['milestones', 'open'],
      ['risks', 'open'],
      ['scope', 'open'],
      ['tech', 'open'],
    ]);
    expect(suggestions.every((entry) => entry.run_id === runId)).toBe(true);
    expect(suggestions.find((entry) => entry.section === 'milestones')?.content).toEqual([
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Meilenstein 1: Grundgerüst' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Login und Mitgliederliste stehen.' }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Datenmodell anlegen' }] },
            ],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Login bauen' }] }],
          },
        ],
      },
    ]);
    expect(await runOf(runId)).toMatchObject({
      kind: 'plan',
      status: 'done',
      agent_key: 'moderator',
      model: 'claude-opus-5-5',
      input_tokens: 4000,
      output_tokens: 900,
      error: null,
    });
    // Nothing was written into the plan itself.
    const plan = await test.db.adminPool.query('select 1 from yjs_documents where name = $1', [
      planDocumentName(projectId),
    ]);
    expect(plan.rowCount).toBe(1);

    // The job of a finished run does nothing more.
    expect(await generatePlan(deps, { runId })).toBe('gone');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('replaces the open suggestions of the generation before and keeps the decided ones', async () => {
    const { projectId, start } = await createProject();
    const first = await start();
    await generatePlan(planDeps(ANSWER).deps, { runId: first });
    await test.db.adminPool.query(
      `update plan_suggestions set status = 'accepted', decided_at = now()
       where project_id = $1 and section = 'scope'`,
      [projectId],
    );

    const second = await start();
    const answer =
      '<section key="scope">Neuer Umfang</section><section key="tech">Neue Technik</section>';
    expect(await generatePlan(planDeps(answer).deps, { runId: second })).toBe('done');

    const suggestions = await suggestionsOf(projectId);
    expect(
      suggestions
        .map((entry) => `${entry.section} ${entry.status} ${entry.run_id === second ? '2' : '1'}`)
        .sort(),
    ).toEqual([
      'costs replaced 1',
      'milestones replaced 1',
      'risks replaced 1',
      'scope accepted 1',
      'scope open 2',
      'tech open 2',
      'tech replaced 1',
    ]);
  });

  it('uses the model the owner chose for the moderator and writes in the project language', async () => {
    const { projectId, start } = await createProject();
    await test.db.adminPool.query(
      `update project_agents set model = 'claude-sonnet-5-5'
       where project_id = $1 and agent_key = 'moderator'`,
      [projectId],
    );
    await test.db.adminPool.query(`update projects set language = 'en' where id = $1`, [projectId]);
    const runId = await start();
    const { deps, complete } = planDeps(ANSWER);

    await generatePlan(deps, { runId });

    const asked = complete.mock.calls[0]?.[0];
    expect(asked?.model).toBe('claude-sonnet-5-5');
    expect(asked?.prompt).toContain('Write in: English');
    expect(asked?.prompt).toContain('The team has stated no criteria.');
    expect(asked?.prompt).toContain('Nothing is decided yet.');
    expect(asked?.prompt).toContain('The boards are empty.');
    expect(asked?.prompt).toContain('Nobody has written yet.');
    expect(asked?.prompt).toContain('The plan is empty so far.');
  });

  it('changes nothing when the model fails, and says why', async () => {
    const { projectId, start } = await createProject();
    const first = await start();
    await generatePlan(planDeps(ANSWER).deps, { runId: first });

    const limited = await start();
    const quota = planDeps(
      new GatewayLimitError("You've hit your session limit", new Date('2026-10-02T20:30:00Z')),
    );
    expect(await generatePlan(quota.deps, { runId: limited })).toBe('failed');
    const failedRun = await runOf(limited);
    expect(failedRun.status).toBe('error');
    expect(decodePlanFailure(failedRun.error)).toEqual({
      kind: 'quota',
      resetsAt: '2026-10-02T20:30:00.000Z',
    });
    expect(quota.logger.error).toHaveBeenCalledTimes(1);

    const broken = await start();
    expect(await generatePlan(planDeps(new Error('overloaded')).deps, { runId: broken })).toBe(
      'failed',
    );
    expect(decodePlanFailure((await runOf(broken)).error)).toEqual({
      kind: 'failed',
      resetsAt: null,
    });

    // An answer without a section is no plan; the run is metered all the same.
    const empty = await start();
    expect(await generatePlan(planDeps('Das kann ich nicht.').deps, { runId: empty })).toBe(
      'failed',
    );
    expect(await runOf(empty)).toMatchObject({ status: 'error', output_tokens: 900 });

    // The suggestions of the first generation are still the open ones.
    const open = (await suggestionsOf(projectId)).filter((entry) => entry.status === 'open');
    expect(open).toHaveLength(5);
    expect(open.every((entry) => entry.run_id === first)).toBe(true);
  });

  it('does nothing for a run that does not wait', async () => {
    const { deps, complete } = planDeps(ANSWER);

    expect(await generatePlan(deps, { runId: randomUUID() })).toBe('gone');
    await expect(generatePlan(deps, {})).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('updating the plan (spec 25c)', () => {
  /** Stores the plan as the collaboration server would. */
  async function storePlan(projectId: string, sections: Record<string, string>) {
    const doc = new Y.Doc();
    for (const [section, markdown] of Object.entries(sections)) {
      writePlanSection(doc, section as 'scope', planNodesFromMarkdown(markdown), 'de');
    }
    await test.db.adminPool.query(
      `insert into yjs_documents (name, state) values ($1, $2)
       on conflict (name) do update set state = excluded.state`,
      [planDocumentName(projectId), Buffer.from(Y.encodeStateAsUpdate(doc))],
    );
  }

  /** A project whose plan the moderator wrote two hours ago and the team accepted. */
  async function projectWithPlan() {
    const project = await createProject();
    const { projectId } = project;
    await test.db.adminPool.query(
      `insert into ai_runs (project_id, agent_key, kind, status, created_at, finished_at)
       values ($1, 'moderator', 'plan', 'done', now() - interval '2 hours', now() - interval '2 hours')`,
      [projectId],
    );
    const written = {
      scope: 'Mitgliederliste und Login.',
      tech: 'React, gehostet auf einem eigenen Server.',
      costs: 'Drei Monate.',
    };
    for (const [section, markdown] of Object.entries(written)) {
      await test.db.adminPool.query(
        `insert into plan_suggestions (project_id, section, content, status, decided_at)
         values ($1, $2, $3, 'accepted', now() - interval '2 hours')`,
        [projectId, section, JSON.stringify(planNodesFromMarkdown(markdown))],
      );
    }
    // The team changed the costs by hand and wrote the risks itself.
    await storePlan(projectId, {
      ...written,
      costs: 'Vier Monate, weil wir nur abends arbeiten.',
      risks: 'Wenig Zeit.',
    });
    return project;
  }

  async function startUpdate(projectId: string) {
    const run = await test.db.adminPool.query<{ id: string }>(
      `insert into ai_runs (project_id, agent_key, kind, status)
       values ($1, 'moderator', 'plan', 'queued') returning id`,
      [projectId],
    );
    return { runId: run.rows[0]?.id ?? '', kind: 'update' };
  }

  it('tells the moderator what changed and which sections people wrote by hand', async () => {
    const { projectId } = await projectWithPlan();
    await test.db.adminPool.query(
      `insert into decision_log (project_id, kind, topic, value, details, created_at) values
        ($1, 'decided', 'Sprache', 'TypeScript', '{}', now() - interval '5 hours'),
        ($1, 'reopened', 'Hosting', 'Eigener Server', '{"reason": "Zu viel Wartung"}', now() - interval '50 minutes'),
        ($1, 'decided', 'Hosting', 'Verwalteter Dienst', '{}', now() - interval '40 minutes'),
        ($1, 'criterion_changed', null, 'MVP in 4 Monaten', '{"previous": "MVP in 3 Monaten"}', now() - interval '30 minutes'),
        ($1, 'criterion_added', null, 'EU-Hosting', '{}', now() - interval '20 minutes')`,
      [projectId],
    );
    const { deps, complete } = planDeps(
      [
        '<section key="tech">React, gehostet bei einem verwalteten Dienst.</section>',
        // The model returns a section it did not change; that is no suggestion.
        '<section key="scope">Mitgliederliste und Login.</section>',
        '<section key="costs">Vier Monate, weil wir nur abends arbeiten. Der Dienst kostet etwas.</section>',
      ].join('\n'),
    );

    expect(await generatePlan(deps, await startUpdate(projectId))).toBe('done');

    const asked = complete.mock.calls[0]?.[0];
    expect(asked?.system).toContain('You bring the plan up to date');
    expect(asked?.system).toContain(
      'Milestone headings keep this form, including the time in parentheses',
    );
    const prompt = asked?.prompt ?? '';
    expect(prompt).toContain(
      [
        '<changes>',
        'What changed since the plan was last written, oldest first:',
        '- reopened: Hosting (it was: Eigener Server), reason: Zu viel Wartung',
        '- decided: Hosting: Verwalteter Dienst',
        '- criterion changed: MVP in 3 Monaten → MVP in 4 Monaten',
        '- criterion added: EU-Hosting',
        '</changes>',
      ].join('\n'),
    );
    // What was decided before the plan was written is no change.
    expect(prompt).not.toContain('TypeScript');
    expect(prompt).toContain(
      'People changed these sections by hand since you last wrote them: risks, costs.',
    );
    expect(prompt).toContain('The plan as it stands:\n## MVP-Umfang');

    const suggestions = await suggestionsOf(projectId);
    expect(
      suggestions
        .filter((entry) => entry.status === 'open')
        .map((entry) => [entry.section, entry.kind, entry.hand_edited]),
    ).toEqual([
      ['costs', 'update', true],
      ['tech', 'update', false],
    ]);
  });

  it('leaves the open suggestions of other sections and replaces the one of its own', async () => {
    const { projectId } = await projectWithPlan();
    await test.db.adminPool.query(
      `insert into plan_suggestions (project_id, section, content) values
        ($1, 'milestones', '[]'), ($1, 'tech', '[]')`,
      [projectId],
    );
    await test.db.adminPool.query(
      `insert into decision_log (project_id, kind, topic, value) values ($1, 'decided', 'Hosting', 'Dienst')`,
      [projectId],
    );
    const { deps } = planDeps('<section key="tech">React bei einem Dienst.</section>');

    await generatePlan(deps, await startUpdate(projectId));

    const open = (await suggestionsOf(projectId))
      .filter((entry) => entry.status !== 'accepted')
      .map((entry) => `${entry.section} ${entry.status} ${entry.kind}`)
      .sort();
    expect(open).toEqual([
      'milestones open generate',
      'tech open update',
      'tech replaced generate',
    ]);
  });

  it('finds the plan current when nothing has to change', async () => {
    const { projectId } = await projectWithPlan();
    const payload = await startUpdate(projectId);
    const { deps } = planDeps('unchanged');

    expect(await generatePlan(deps, payload)).toBe('current');

    expect(await runOf(payload.runId)).toMatchObject({ status: 'done', error: null });
    expect((await suggestionsOf(projectId)).filter((entry) => entry.status === 'open')).toEqual([]);
    // Without any change in the log the context says so.
    const { deps: again, complete } = planDeps('unchanged');
    await generatePlan(again, await startUpdate(projectId));
    expect(complete.mock.calls[0]?.[0].prompt).toContain(
      'What changed since the plan was last written, oldest first:\n\n</changes>',
    );
  });

  it('is a generation while there is no plan to update', async () => {
    const { projectId } = await createProject();
    const { deps, complete } = planDeps(ANSWER);

    expect(await generatePlan(deps, await startUpdate(projectId))).toBe('done');

    expect(complete.mock.calls[0]?.[0].system).toContain(
      'The team asked you to write its project plan',
    );
    expect(complete.mock.calls[0]?.[0].prompt).not.toContain('<changes>');
    const suggestions = await suggestionsOf(projectId);
    expect(suggestions).toHaveLength(5);
    expect(suggestions.every((entry) => entry.kind === 'generate' && !entry.hand_edited)).toBe(
      true,
    );
  });

  it('marks what the team wrote itself, also in a generation', async () => {
    const { projectId, start } = await createProject();
    await storePlan(projectId, { scope: 'Nur für unseren Verein.' });
    const runId = await start();

    await generatePlan(planDeps(ANSWER).deps, { runId });

    const edited = (await suggestionsOf(projectId))
      .filter((entry) => entry.hand_edited)
      .map((entry) => entry.section);
    expect(edited).toEqual(['scope']);
  });
});

describe('parsePlanAnswer', () => {
  it('gives the sections in the order of the plan, each once', () => {
    const sections = parsePlanAnswer(
      [
        "<section key='risks'>Zeit</section>",
        '<SECTION KEY="Scope" >Umfang</SECTION>',
        '<section key="scope">Doppelt</section>',
        '<section key="launch">Unbekannt</section>',
        '<section key="tech">   </section>',
        '<section key="costs">Offen',
      ].join('\n'),
    );

    expect(sections.map((entry) => entry.section)).toEqual(['scope', 'risks']);
    expect(sections[0]?.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Umfang' }] },
    ]);
    expect(parsePlanAnswer('')).toEqual([]);
  });
});

describe('buildPlanPrompt', () => {
  it('cuts long messages and names what waits to be decided', () => {
    const prompt = buildPlanPrompt({
      projectName: 'Shop <plan>',
      language: 'de',
      decisions: {
        criteria: [],
        decisions: [],
        pending: [
          { op: 'decide', topic: 'Zahlung', value: 'Rechnung', reasoning: '', alternatives: [] },
        ],
        votes: [{ topic: 'Hosting', options: ['A', 'B'] }],
        openVariants: [{ topic: 'Aufbau', names: ['Monolith', 'Dienste'] }],
      },
      boards: [],
      messages: [{ author: 'Sam', content: 'x'.repeat(2000) }],
      plan: '',
    });

    expect(prompt).toContain('Project: Shop ‹plan›');
    expect(prompt).toContain('- Zahlung: Rechnung (not confirmed yet)');
    expect(prompt).toContain('- Hosting: a vote is open');
    expect(prompt).toContain('- Aufbau: variants wait for the team');
    expect(prompt).toContain(`Sam: ${'x'.repeat(499)}…\n`);
  });
});

/** A check of the limits that finds one reached (spec 31a). */
function atLimit(
  scope: 'project' | 'user' = 'project',
  resetsAt = new Date('2026-11-01T00:00:00Z'),
) {
  return vi.fn<UsageGuard>(() => Promise.reject(new UsageLimitError(scope, resetsAt)));
}

describe('a generation at a limit of the AI (spec 31a)', () => {
  it('asks no model, changes nothing, and says when the limit is free again', async () => {
    const { projectId, start } = await createProject();
    const runId = await start();
    const { deps, complete } = planDeps(ANSWER);
    const limits = atLimit();

    expect(await generatePlan({ ...deps, limits }, { runId })).toBe('failed');

    expect(complete).not.toHaveBeenCalled();
    const run = await runOf(runId);
    expect(run.user_id).not.toBeNull();
    expect(limits).toHaveBeenCalledExactlyOnceWith({ projectId, userId: run.user_id });
    expect(run.status).toBe('error');
    expect(decodePlanFailure(run.error)).toEqual({
      kind: 'quota',
      resetsAt: '2026-11-01T00:00:00.000Z',
    });
    expect(await suggestionsOf(projectId)).toEqual([]);
  });
});
