import { describe, expect, it } from 'vitest';

import { RepositoryWriteError } from '@server/integrations/git-host';
import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitlabStandIn } from '@server/integrations/gitlab/dev/stand-in';
import { DEV_GITLAB_CLIENT } from '@server/integrations/gitlab/setup';
import { gitlabWriter } from '@server/integrations/gitlab/writer';

// Writing milestones and issues (spec 29b) against the stand-in, which also answers the reading
// calls of spec 28b for what was created.
const SOURCE = {
  baseUrl: 'http://gitlab.test',
  clientId: DEV_GITLAB_CLIENT.id,
  clientSecret: DEV_GITLAB_CLIENT.secret,
  redirectUri: 'http://localhost:5173/api/git/callback',
};

async function setUp(repositoryId = 101) {
  const standIn = createGitlabStandIn(SOURCE, () => Date.parse('2026-10-09T10:00:00Z'));
  const calls: string[] = [];
  const answer: { next?: Response; away: boolean } = { away: false };
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const { pathname, search } = new URL(url);
    calls.push(`${init?.method ?? 'GET'} ${pathname}${search}`);
    if (answer.away) return Promise.reject(new Error('ECONNREFUSED'));
    if (answer.next) {
      const { next } = answer;
      delete answer.next;
      return Promise.resolve(next);
    }
    return Promise.resolve(standIn.routes.request(url, init));
  };
  const client = createGitlabClient(fetcher);
  const page = await fetcher(client.authorizeUrl(SOURCE, 'state'));
  const allow = /class="allow" href="([^"]+)"/.exec(await page.text())?.[1] ?? '';
  const code = new URL(allow.replaceAll('&amp;', '&')).searchParams.get('code') ?? '';
  const { accessToken } = await client.exchangeCode(SOURCE, code);
  calls.length = 0;
  const target = { baseUrl: SOURCE.baseUrl, repositoryId };
  return {
    calls,
    answer,
    client,
    accessToken,
    standIn,
    writer: gitlabWriter(client, target, accessToken),
    get: (path: string) => standIn.routes.request(`${SOURCE.baseUrl}${path}`),
  };
}

const failure = (code: string) => expect.objectContaining({ code }) as unknown;

describe('ensureMilestone', () => {
  it('creates a milestone, and uses the one that is there the next time', async () => {
    const { writer, calls } = await setUp();

    const created = await writer.ensureMilestone({
      title: 'Meilenstein 1: Grundgerüst',
      description: 'Die App läuft.',
    });
    const again = await writer.ensureMilestone({
      title: 'Meilenstein 1: Grundgerüst',
      description: 'Anders.',
    });
    const second = await writer.ensureMilestone({ title: 'Meilenstein 2', description: '' });

    expect(created).toEqual({
      id: 1,
      url: 'http://gitlab.test/beispiel-verein/vereins-app/-/milestones/1',
      existed: false,
    });
    expect(again).toEqual({ ...created, existed: true });
    expect(second).toMatchObject({ id: 2, existed: false });
    // It asks for the title first, and creates only what is missing.
    expect(calls.filter((call) => call.startsWith('POST'))).toHaveLength(2);
    expect(calls[0]).toBe(
      'GET /api/v4/projects/101/milestones?title=Meilenstein+1%3A+Grundger%C3%BCst&include_ancestors=true&per_page=20',
    );
  });
});

describe('createIssue', () => {
  it('creates an issue with its milestone, which agents that read then see', async () => {
    const { writer, client, accessToken, get } = await setUp();
    const milestone = await writer.ensureMilestone({ title: 'Meilenstein 1', description: '' });

    const issue = await writer.createIssue({
      title: 'Projekt aufsetzen',
      description: 'Projekt aufsetzen\n\n<!-- covibes-action:abc -->',
      milestoneId: milestone.id,
    });
    const bare = await writer.createIssue({ title: 'Ohne', description: '', milestoneId: null });

    // The example repository has three issues already.
    expect(issue).toEqual({
      number: 4,
      url: 'http://gitlab.test/beispiel-verein/vereins-app/-/issues/4',
    });
    expect(bare.number).toBe(5);
    const read = (await client.get(SOURCE.baseUrl, '/projects/101/issues/4', accessToken)) as {
      title: string;
      state: string;
      milestone: { title: string } | null;
      author: { username: string };
    };
    expect(read).toMatchObject({
      title: 'Projekt aufsetzen',
      state: 'opened',
      milestone: { title: 'Meilenstein 1' },
      author: { username: 'olga.beispiel' },
    });
    // Its link leads to a page of the stand-in.
    const page = await get('/beispiel-verein/vereins-app/-/issues/4');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('#4 Projekt aufsetzen');
    expect((await get('/beispiel-verein/vereins-app/-/issues/99')).status).toBe(404);
  });

  it('finds an issue again by the mark in its description', async () => {
    const { writer } = await setUp();
    const created = await writer.createIssue({
      title: 'Login bauen',
      description: 'Login bauen\n\n<!-- covibes-action:1111 -->',
      milestoneId: null,
    });

    expect(await writer.findIssue('covibes-action:1111')).toEqual(created);
    expect(await writer.findIssue('covibes-action:2222')).toBeUndefined();
  });

  it('does not take an issue for the one it looks for when only the search matched', async () => {
    const { writer, answer } = await setUp();
    answer.next = Response.json([
      { iid: 9, web_url: 'http://gitlab.test/x/-/issues/9', description: 'Etwas anderes' },
      { iid: 10, web_url: 'http://gitlab.test/x/-/issues/10', description: null },
      'no issue at all',
    ]);

    expect(await writer.findIssue('covibes-action:1111')).toBeUndefined();
  });
});

describe('what GitLab refuses', () => {
  it('names the reason: no access, nothing there, not taken, away', async () => {
    const website = await setUp(102);
    // The repository "Website" has issues switched off.
    await expect(
      website.writer.createIssue({ title: 'Geht nicht', description: '', milestoneId: null }),
    ).rejects.toEqual(failure('forbidden'));

    const missing = await setUp(999);
    await expect(missing.writer.ensureMilestone({ title: 'M', description: '' })).rejects.toEqual(
      failure('not_found'),
    );

    const { writer, answer } = await setUp();
    const refused = await writer
      .createIssue({ title: 'x'.repeat(256), description: '', milestoneId: null })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RepositoryWriteError);
    expect(refused).toMatchObject({
      code: 'invalid',
      detail: '{"title":["is too long (maximum is 255 characters)"]}',
    });

    answer.next = new Response('{"message":"401 Unauthorized"}', { status: 401 });
    await expect(
      writer.createIssue({ title: 'x', description: '', milestoneId: null }),
    ).rejects.toMatchObject({ code: 'unauthorized', detail: '401 Unauthorized' });
    answer.next = new Response('<html>Bad Gateway</html>', { status: 502 });
    await expect(
      writer.createIssue({ title: 'x', description: '', milestoneId: null }),
    ).rejects.toMatchObject({ code: 'unreachable', detail: '<html>Bad Gateway</html>' });
    answer.next = new Response('{"error":"Retry later"}', { status: 429 });
    await expect(writer.findIssue('mark')).rejects.toMatchObject({
      code: 'unreachable',
      detail: 'Retry later',
    });
    answer.next = new Response('', { status: 418 });
    await expect(writer.findIssue('mark')).rejects.toMatchObject({ code: 'failed' });
    answer.away = true;
    await expect(writer.ensureMilestone({ title: 'M', description: '' })).rejects.toMatchObject({
      code: 'unreachable',
    });
  });

  it('fails when GitLab answers with something that is no milestone or issue', async () => {
    const { writer, answer } = await setUp();

    // An address that is no page on the web is no link to show.
    answer.next = Response.json(
      { iid: 7, web_url: 'javascript:alert(1)', description: '' },
      { status: 201 },
    );
    await expect(
      writer.createIssue({ title: 'x', description: '', milestoneId: null }),
    ).rejects.toMatchObject({ code: 'unreachable' });
    answer.next = Response.json([{ id: 3, title: 'M', web_url: 'javascript:alert(1)' }]);
    expect(await writer.ensureMilestone({ title: 'M', description: '' })).toEqual({
      id: 3,
      url: null,
      existed: true,
    });

    answer.next = Response.json({ id: 'seven' }, { status: 201 });
    await expect(
      writer.createIssue({ title: 'x', description: '', milestoneId: null }),
    ).rejects.toMatchObject({ code: 'unreachable' });
  });
});
