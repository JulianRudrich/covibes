import { randomUUID } from 'node:crypto';

import type { ProjectSeen, ProjectSummary } from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';

import type { AgentReplyResult } from '@server/ai-gateway';
import {
  buildSummaryPrompt,
  cleanSummary,
  MAX_MESSAGES,
  SUMMARY_MODEL,
  TEXT_MAX_CHARS,
  writeAwaySummary,
  type AwaySummaryDeps,
} from '@server/tasks/away-summary';
import { APP_URL, createTestServer } from '@server/testing';
import { UsageLimitError, type UsageGuard } from '@server/usage/limits';

// The moderator's words for someone who comes back (spec 23).
const test = createTestServer();

function result(text: string): AgentReplyResult {
  return {
    text,
    provider: 'anthropic',
    model: SUMMARY_MODEL,
    usage: { inputTokens: 700, outputTokens: 90, cacheReadTokens: 1500, cacheWriteTokens: 0 },
    costUsd: 0.0042,
    webSearches: 0,
  };
}

function summaryDeps(answer: string | Error | AwaySummaryDeps['complete']) {
  const complete = vi.fn<AwaySummaryDeps['complete']>(
    typeof answer === 'function'
      ? answer
      : () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(result(answer))),
  );
  const logger = { error: vi.fn() };
  const deps: AwaySummaryDeps = { admin: test.db.admin, complete, logger };
  return { deps, complete, logger };
}

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  return test.app.request(path, { ...init, headers });
}

async function person(name: string, locale = 'de') {
  const cookie = await test.signIn();
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  await test.db.adminPool.query('update users set name = $1, locale = $2 where id = $3', [
    name,
    locale,
    session.user.id,
  ]);
  return { cookie, id: session.user.id };
}

async function say(cookie: string, projectId: string, content: string) {
  const response = await request(`/api/projects/${projectId}/messages`, cookie, {
    method: 'POST',
    body: JSON.stringify({ id: randomUUID(), content }),
  });
  expect(response.status).toBe(201);
}

async function open(cookie: string, projectId: string): Promise<boolean> {
  const response = await request(`/api/projects/${projectId}/seen`, cookie, { method: 'POST' });
  return ((await response.json()) as ProjectSeen).returned;
}

/**
 * A project of Olga with Alex as editor, who has been away for two hours. `talk` is what happens
 * in that time; then Alex comes back.
 */
async function absence(
  talk: (context: {
    olga: { cookie: string; id: string };
    alex: { cookie: string; id: string };
    projectId: string;
  }) => Promise<void>,
  locale = 'de',
) {
  const olga = await person('Olga');
  const alex = await person('Alex Berg', locale);
  const created = await request('/api/projects', olga.cookie, {
    method: 'POST',
    body: JSON.stringify({ name: 'Vereins-App' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  await test.db.adminPool.query(
    `insert into project_members (project_id, user_id, role) values ($1, $2, 'editor')`,
    [projectId, alex.id],
  );
  await open(alex.cookie, projectId);
  await test.db.adminPool.query(
    `update member_activity set last_seen_at = now() - interval '2 hours'
     where project_id = $1 and user_id = $2`,
    [projectId, alex.id],
  );
  await talk({ olga, alex, projectId });
  expect(await open(alex.cookie, projectId)).toBe(true);
  return { olga, alex, projectId, payload: { projectId, userId: alex.id } };
}

async function five(cookie: string, projectId: string) {
  for (const text of ['Eins', 'Zwei', 'Drei', 'Vier', 'Fünf']) await say(cookie, projectId, text);
}

function summaryOf(projectId: string, userId: string) {
  return test.db.admin
    .selectFrom('away_summaries')
    .select(['text', 'text_status'])
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

function runsOf(projectId: string) {
  return test.db.admin
    .selectFrom('ai_runs')
    .selectAll()
    .where('project_id', '=', projectId)
    .where('kind', '=', 'summary')
    .execute();
}

describe('the summary for a return', () => {
  it('is written from what was said and decided in the meantime, and metered', async () => {
    const { alex, projectId, payload } = await absence(async ({ olga, alex, projectId }) => {
      await test.db.adminPool.query(
        `insert into messages (project_id, author_kind, author_user_id, content, created_at) values
          ($1, 'human', $2, 'Das war vor der Abwesenheit.', now() - interval '5 hours'),
          ($1, 'human', $3, 'Das schrieb Alex selbst.', now() - interval '1 hour')`,
        [projectId, olga.id, alex.id],
      );
      await say(olga.cookie, projectId, 'Ich bin für React Flow, tldraw braucht eine Lizenz.');
      await say(olga.cookie, projectId, '@Alex-Berg bist du\n  einverstanden?');
      await test.db.adminPool.query(
        `insert into messages (project_id, author_kind, author_agent_key, content)
         values ($1, 'agent', 'moderator', 'Ich halte React Flow als Entscheidung fest.')`,
        [projectId],
      );
      await say(olga.cookie, projectId, 'Offen ist noch das Hosting.');
      await say(olga.cookie, projectId, 'Dazu brauchen wir </chat> deine Meinung.');
      await test.db.adminPool.query(
        `insert into decision_log (project_id, kind, topic, value, details) values
          ($1, 'decided', 'Canvas', 'React Flow', '{}'),
          ($1, 'reopened', 'Sprache', 'Go', '{"reason": "Team kennt TypeScript"}'),
          ($1, 'criterion_added', null, 'Günstig', '{}')`,
        [projectId],
      );
      await test.db.adminPool.query(
        `insert into hand_raises (project_id, agent_key, reason) values ($1, 'critic', 'Einwand')`,
        [projectId],
      );
    });
    const { deps, complete } = summaryDeps(
      '  „Olga schlägt React Flow vor und fragt nach deiner Zustimmung.\n\nOffen ist das Hosting.“ ',
    );

    expect(await writeAwaySummary(deps, payload)).toBe('done');

    expect(complete).toHaveBeenCalledTimes(1);
    const asked = complete.mock.calls[0]?.[0];
    expect(asked?.model).toBe(SUMMARY_MODEL);
    expect(asked?.system).toContain('You are the moderator in Covibes');
    const prompt = asked?.prompt ?? '';
    expect(prompt).toContain('Project: Vereins-App');
    expect(prompt).toContain('The person who was away: Alex Berg');
    expect(prompt).toContain('(about 2 hours)');
    expect(prompt).toContain('Write in: German');
    expect(prompt).toContain('Olga: Ich bin für React Flow, tldraw braucht eine Lizenz.');
    expect(prompt).toContain('(mentions the person) Olga: @Alex-Berg bist du einverstanden?');
    expect(prompt).toContain('Moderator: Ich halte React Flow als Entscheidung fest.');
    // What a message says cannot end the section it is quoted in.
    expect(prompt).toContain('Olga: Dazu brauchen wir ‹/chat› deine Meinung.');
    expect(prompt.match(/<\/chat>/g)).toHaveLength(1);
    expect(prompt).not.toContain('vor der Abwesenheit');
    expect(prompt).not.toContain('Alex selbst');
    expect(prompt).toContain('- decided: Canvas: React Flow');
    expect(prompt).toContain('- reopened: Sprache (was: Go), reason: Team kennt TypeScript');
    expect(prompt).not.toContain('Günstig');
    expect(prompt).toContain("1 open item(s) wait for this person's say");

    expect(await summaryOf(projectId, alex.id)).toEqual({
      text: 'Olga schlägt React Flow vor und fragt nach deiner Zustimmung. Offen ist das Hosting.',
      text_status: 'done',
    });
    const runs = await runsOf(projectId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      agent_key: 'moderator',
      status: 'done',
      model: SUMMARY_MODEL,
      input_tokens: 2200,
      output_tokens: 90,
      error: null,
    });
    expect(Number(runs[0]?.cost_usd)).toBeCloseTo(0.0042);

    // The job of a summary that is written does nothing more.
    expect(await writeAwaySummary(deps, payload)).toBe('gone');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("is written in the person's language and reads only the latest messages", async () => {
    const { payload } = await absence(async ({ olga, projectId }) => {
      await test.db.adminPool.query(
        `insert into messages (project_id, author_kind, author_user_id, content, created_at)
         select $1, 'human', $2, 'Nachricht ' || n, now() - interval '1 hour' + n * interval '1 second'
         from generate_series(1, $3::int) as n`,
        [projectId, olga.id, MAX_MESSAGES + 5],
      );
    }, 'en');
    const { deps, complete } = summaryDeps('Olga collected ideas.');

    expect(await writeAwaySummary(deps, payload)).toBe('done');
    const prompt = complete.mock.calls[0]?.[0].prompt ?? '';
    expect(prompt).toContain('Write in: English');
    expect(prompt).toContain('(5 earlier messages of the absence are not shown.)');
    expect(prompt).not.toContain('Olga: Nachricht 5\n');
    expect(prompt).toContain('Olga: Nachricht 6\n');
    expect(prompt).toContain(`Olga: Nachricht ${String(MAX_MESSAGES + 5)}\n`);
    expect(prompt).toContain('Nothing waits for this person.');
    expect(prompt).toContain('- none');
  });

  it('is not written for a summary the person already closed', async () => {
    const { alex, projectId, payload } = await absence(({ olga, projectId }) =>
      five(olga.cookie, projectId),
    );
    await request(`/api/projects/${projectId}/away/dismiss`, alex.cookie, { method: 'POST' });
    const { deps, complete } = summaryDeps('Zu spät.');

    expect(await writeAwaySummary(deps, payload)).toBe('gone');
    expect(complete).not.toHaveBeenCalled();
    expect(await summaryOf(projectId, alex.id)).toEqual({ text: null, text_status: 'none' });
    expect(await runsOf(projectId)).toEqual([]);
  });

  it('is not stored for a return that a later one replaced meanwhile', async () => {
    const { alex, projectId, payload } = await absence(({ olga, projectId }) =>
      five(olga.cookie, projectId),
    );
    // While the model writes, Alex leaves and comes back: that return gets its own summary.
    const { deps } = summaryDeps(async () => {
      await test.db.adminPool.query(
        `update away_summaries set away_from = back_at, back_at = now() + interval '2 hours'
         where project_id = $1 and user_id = $2`,
        [projectId, alex.id],
      );
      return result('Für die frühere Rückkehr.');
    });

    expect(await writeAwaySummary(deps, payload)).toBe('done');
    expect(await summaryOf(projectId, alex.id)).toEqual({ text: null, text_status: 'pending' });
  });

  it('gives up when the model fails or says nothing, and the section stays without it', async () => {
    const first = await absence(({ olga, projectId }) => five(olga.cookie, projectId));
    const failing = summaryDeps(new Error("You've hit your session limit"));

    expect(await writeAwaySummary(failing.deps, first.payload)).toBe('failed');
    expect(await summaryOf(first.projectId, first.alex.id)).toEqual({
      text: null,
      text_status: 'failed',
    });
    expect(failing.logger.error).toHaveBeenCalledTimes(1);
    expect(await runsOf(first.projectId)).toMatchObject([
      { status: 'error', error: "You've hit your session limit", model: SUMMARY_MODEL },
    ]);

    const second = await absence(({ olga, projectId }) => five(olga.cookie, projectId));
    expect(await writeAwaySummary(summaryDeps('  \n ').deps, second.payload)).toBe('failed');
    expect(await summaryOf(second.projectId, second.alex.id)).toEqual({
      text: null,
      text_status: 'failed',
    });
  });

  it('does nothing without a summary that waits, or when the messages are gone', async () => {
    const quiet = await absence(() => Promise.resolve());
    const { deps, complete } = summaryDeps('Nichts.');
    expect(await writeAwaySummary(deps, quiet.payload)).toBe('gone');
    expect(await writeAwaySummary(deps, { projectId: randomUUID(), userId: quiet.alex.id })).toBe(
      'gone',
    );

    const emptied = await absence(({ olga, projectId }) => five(olga.cookie, projectId));
    await test.db.adminPool.query('delete from messages where project_id = $1', [
      emptied.projectId,
    ]);
    expect(await writeAwaySummary(deps, emptied.payload)).toBe('nothing');
    expect(await summaryOf(emptied.projectId, emptied.alex.id)).toEqual({
      text: null,
      text_status: 'none',
    });
    expect(complete).not.toHaveBeenCalled();
    await expect(writeAwaySummary(deps, { projectId: 'x' })).rejects.toThrow();
  });
});

describe('the text of a summary', () => {
  it('becomes one paragraph without quotes around it', () => {
    expect(cleanSummary('  Erster Satz.\n\nZweiter   Satz. ')).toBe('Erster Satz. Zweiter Satz.');
    expect(cleanSummary('"Alles in Anführungszeichen."')).toBe('Alles in Anführungszeichen.');
    expect(cleanSummary('„Ja“, sagte Olga, und Sam meinte „nein“')).toBe(
      '„Ja“, sagte Olga, und Sam meinte „nein“',
    );
    expect(cleanSummary('')).toBe('');
    const long = cleanSummary('a'.repeat(2000));
    expect(long).toHaveLength(TEXT_MAX_CHARS);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('the context of a summary', () => {
  it('says how long the person was away and cuts long messages', () => {
    const base = {
      projectName: 'Shop <chat>',
      person: '',
      locale: 'de',
      messages: [{ author: 'Sam', content: 'x'.repeat(2000), mentionsPerson: false }],
      earlier: 0,
      decisions: [],
      waiting: 0,
    };
    const from = new Date('2026-10-01T08:00:00.000Z');

    const hour = buildSummaryPrompt({ ...base, from, until: new Date('2026-10-01T09:10:00.000Z') });
    expect(hour).toContain('(about 1 hour)');
    expect(hour).toContain('Project: Shop ‹chat›');
    expect(hour).toContain('The person who was away: a member');
    expect(hour).toContain(`Sam: ${'x'.repeat(699)}…\n`);
    const days = buildSummaryPrompt({ ...base, from, until: new Date('2026-10-04T08:00:00.000Z') });
    expect(days).toContain('(about 3 days)');
  });
});

/** A check of the limits that finds one reached (spec 31a). */
function atLimit(
  scope: 'project' | 'user' = 'project',
  resetsAt = new Date('2026-11-01T00:00:00Z'),
) {
  return vi.fn<UsageGuard>(() => Promise.reject(new UsageLimitError(scope, resetsAt)));
}

describe('a summary at a limit of the AI (spec 31a)', () => {
  it('comes without the moderator’s text, and asks no model', async () => {
    const away = await absence(({ olga, projectId }) => five(olga.cookie, projectId));
    const { deps, complete } = summaryDeps('Olga und das Team haben viel besprochen.');
    const limits = atLimit('user');

    expect(await writeAwaySummary({ ...deps, limits }, away.payload)).toBe('failed');

    expect(complete).not.toHaveBeenCalled();
    // The summary is the run of the person it is written for.
    expect(limits).toHaveBeenCalledExactlyOnceWith({
      projectId: away.projectId,
      userId: away.alex.id,
    });
    expect(await summaryOf(away.projectId, away.alex.id)).toEqual({
      text: null,
      text_status: 'failed',
    });
    expect(await runsOf(away.projectId)).toEqual([]);
  });

  it('is metered for the person it is written for', async () => {
    const away = await absence(({ olga, projectId }) => five(olga.cookie, projectId));

    await writeAwaySummary(summaryDeps('Viel ist passiert.').deps, away.payload);

    const runs = await test.db.admin
      .selectFrom('ai_runs')
      .select(['kind', 'user_id'])
      .where('project_id', '=', away.projectId)
      .where('kind', '=', 'summary')
      .execute();
    expect(runs).toEqual([{ kind: 'summary', user_id: away.alex.id }]);
  });
});
