import { describe, expect, it } from 'vitest';

import { RepositoryWriteError } from '@server/integrations/git-host';
import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitlabStandIn } from '@server/integrations/gitlab/dev/stand-in';
import {
  listOpenMergeRequests,
  readMergeRequest,
} from '@server/integrations/gitlab/merge-requests';
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

describe('commitFiles', () => {
  const BRANCH = 'covibes/plan-2026-10-09-a1b2c3';
  const overview = 'context/project-overview.md';
  const files = [
    { path: 'CLAUDE.md', content: '# Vereins-App\n', mode: 'write' as const },
    { path: overview, content: '# Übersicht aus Covibes\n', mode: 'write' as const },
    { path: 'context/progress-tracker.md', content: '# Fortschritt\n', mode: 'create' as const },
    { path: 'docs/diagrams/haupt-canvas.md', content: '# Haupt-Canvas\n', mode: 'write' as const },
  ];
  const commit = {
    branch: BRANCH,
    startBranch: 'main',
    message: 'Plan aus Covibes\n\nvia Covibes',
    files,
  };

  it('commits what is new and what differs on a new branch, and leaves the default branch alone', async () => {
    const { writer, client, accessToken, calls, get } = await setUp();

    const written = await writer.commitFiles(commit);

    // The example repository has an overview of its own, so that file is a change.
    expect(written).toMatchObject({ added: 3, changed: 1, existed: false });
    expect(written.url).toMatch(
      /^http:\/\/gitlab\.test\/beispiel-verein\/vereins-app\/-\/commit\/[0-9a-f]{40}$/,
    );
    const read = async (ref: string) =>
      (
        (await client.get(
          SOURCE.baseUrl,
          `/projects/101/repository/files/${encodeURIComponent(overview)}?ref=${encodeURIComponent(ref)}`,
          accessToken,
        )) as { content: string }
      ).content;
    expect(Buffer.from(await read(BRANCH), 'base64').toString()).toBe('# Übersicht aus Covibes\n');
    expect(Buffer.from(await read('main'), 'base64').toString()).toContain('# Projektübersicht');
    // One writing call, with the branch it starts from.
    expect(calls.filter((call) => call.startsWith('POST'))).toEqual([
      'POST /api/v4/projects/101/repository/commits',
    ]);
    const page = await get(new URL(written.url ?? '').pathname);
    expect(await page.text()).toContain('Plan aus Covibes');
    // The file of the branch has a page; on the default branch it is not there yet.
    expect((await get(`/beispiel-verein/vereins-app/-/blob/${BRANCH}/CLAUDE.md`)).status).toBe(200);
    expect((await get('/beispiel-verein/vereins-app/-/blob/main/CLAUDE.md')).status).toBe(404);
    expect((await get('/beispiel-verein/vereins-app/-/blob/main/README.md')).status).toBe(200);
  });

  it('finds nothing left to do on a second run, and commits only what changed since', async () => {
    const { writer, calls } = await setUp();
    await writer.commitFiles(commit);
    calls.length = 0;

    expect(await writer.commitFiles(commit)).toEqual({
      url: null,
      added: 0,
      changed: 0,
      existed: true,
    });
    expect(calls.filter((call) => call.startsWith('POST'))).toEqual([]);

    // A file that is only added when missing stays as the branch holds it.
    const again = await writer.commitFiles({
      ...commit,
      files: [
        { path: 'CLAUDE.md', content: '# Neu\n', mode: 'write' },
        { path: 'context/progress-tracker.md', content: '# Anders\n', mode: 'create' },
      ],
    });
    expect(again).toMatchObject({ added: 0, changed: 1, existed: false });
  });

  it('refuses when nothing differs from the branch to start from, or that branch is missing', async () => {
    const { writer, client, accessToken } = await setUp();
    const readme = (
      (await client.get(
        SOURCE.baseUrl,
        '/projects/101/repository/files/README.md?ref=main',
        accessToken,
      )) as { content: string }
    ).content;

    await expect(
      writer.commitFiles({
        ...commit,
        files: [
          {
            path: 'README.md',
            content: Buffer.from(readme, 'base64').toString(),
            mode: 'write',
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'invalid',
      detail: 'Nothing to commit: the repository holds these files already',
    });
    await expect(writer.commitFiles({ ...commit, startBranch: 'nope' })).rejects.toMatchObject({
      code: 'invalid',
      detail: 'The branch to start from does not exist',
    });
  });
});

describe('openMergeRequest', () => {
  const BRANCH = 'covibes/plan-2026-10-09-a1b2c3';
  const mergeRequest = {
    sourceBranch: BRANCH,
    targetBranch: 'main',
    title: 'Projektplan aus Covibes',
    description: 'Das Plan-Paket.\n\n*via Covibes*',
  };

  it('opens a merge request for the branch, which agents that read then see', async () => {
    const { writer, client, accessToken, get } = await setUp();
    await writer.commitFiles({
      branch: BRANCH,
      startBranch: 'main',
      message: 'Plan',
      files: [
        { path: 'CLAUDE.md', content: '# Vereins-App\n', mode: 'write' },
        { path: 'context/project-overview.md', content: '# Neu\n', mode: 'write' },
      ],
    });

    const opened = await writer.openMergeRequest(mergeRequest);

    // The example repository has two merge requests already.
    expect(opened).toEqual({
      number: 3,
      url: 'http://gitlab.test/beispiel-verein/vereins-app/-/merge_requests/3',
      existed: false,
    });
    const read = (await client.get(
      SOURCE.baseUrl,
      '/projects/101/merge_requests/3',
      accessToken,
    )) as { title: string; state: string; source_branch: string; target_branch: string };
    expect(read).toMatchObject({
      title: 'Projektplan aus Covibes',
      state: 'opened',
      source_branch: BRANCH,
      target_branch: 'main',
    });
    const diffs = (await client.get(
      SOURCE.baseUrl,
      '/projects/101/merge_requests/3/diffs',
      accessToken,
    )) as { new_path: string; new_file: boolean }[];
    expect(diffs.map((diff) => [diff.new_path, diff.new_file])).toEqual([
      ['CLAUDE.md', true],
      ['context/project-overview.md', false],
    ]);
    const page = await get('/beispiel-verein/vereins-app/-/merge_requests/3');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('!3 Projektplan aus Covibes');
  });

  it('uses the merge request that is open for the branch already', async () => {
    const { writer, calls } = await setUp();
    await writer.commitFiles({
      branch: BRANCH,
      startBranch: 'main',
      message: 'Plan',
      files: [{ path: 'CLAUDE.md', content: '# Vereins-App\n', mode: 'write' }],
    });
    const first = await writer.openMergeRequest(mergeRequest);
    calls.length = 0;

    expect(await writer.openMergeRequest(mergeRequest)).toEqual({ ...first, existed: true });
    expect(calls).toEqual([
      'GET /api/v4/projects/101/merge_requests?state=opened&source_branch=covibes%2Fplan-2026-10-09-a1b2c3&target_branch=main&per_page=5',
    ]);
  });

  it('fails with the reason when the branch is not there', async () => {
    const { writer } = await setUp();

    await expect(writer.openMergeRequest(mergeRequest)).rejects.toMatchObject({
      code: 'invalid',
      detail: 'The source or the target branch does not exist',
    });
  });
});

describe('mergeMergeRequest', () => {
  const BRANCH = 'covibes/plan-2026-10-09-d4e5f6';

  /** A merge request with one new file, as an approved request for the package leaves it. */
  async function opened() {
    const context = await setUp();
    await context.writer.commitFiles({
      branch: BRANCH,
      startBranch: 'main',
      message: 'Plan',
      files: [{ path: 'CLAUDE.md', content: '# Vereins-App\n', mode: 'write' }],
    });
    const { number } = await context.writer.openMergeRequest({
      sourceBranch: BRANCH,
      targetBranch: 'main',
      title: 'Projektplan aus Covibes',
      description: '',
    });
    const target = { baseUrl: SOURCE.baseUrl, repositoryId: 101 };
    const read = () => readMergeRequest(context.client, target, context.accessToken, number);
    return { ...context, number, target, read };
  }

  it('merges while the merge request still ends with the commit that was approved', async () => {
    const { writer, number, read, get, client, target, accessToken } = await opened();
    const before = await read();
    expect(before).toMatchObject({ state: 'opened', draft: false, conflicts: false });
    expect(before?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect((await get('/beispiel-verein/vereins-app/-/blob/main/CLAUDE.md')).status).toBe(404);

    const merged = await writer.mergeMergeRequest({ number, sha: before?.sha ?? null });

    expect(merged).toEqual({
      number,
      url: `http://gitlab.test/beispiel-verein/vereins-app/-/merge_requests/${String(number)}`,
      existed: false,
    });
    expect((await read())?.state).toBe('merged');
    // The default branch holds the file now, and the branch is gone.
    expect((await get('/beispiel-verein/vereins-app/-/blob/main/CLAUDE.md')).status).toBe(200);
    expect((await get(`/beispiel-verein/vereins-app/-/blob/${BRANCH}/CLAUDE.md`)).status).toBe(404);
    // It is no longer among the open ones.
    const open = await listOpenMergeRequests(client, target, accessToken);
    expect(open.map((entry) => entry.number)).not.toContain(number);
  });

  it('counts a merge request that is merged already as done', async () => {
    const { writer, number, read, calls } = await opened();
    const sha = (await read())?.sha ?? null;
    await writer.mergeMergeRequest({ number, sha });
    calls.length = 0;

    expect(await writer.mergeMergeRequest({ number, sha })).toMatchObject({
      number,
      existed: true,
    });
    expect(calls.filter((call) => call.startsWith('PUT'))).toEqual([]);
  });

  it('does not merge what got another last commit since the request', async () => {
    const { writer, number, read } = await opened();
    const approved = (await read())?.sha ?? null;
    // Someone pushes to the branch after the request was made.
    await writer.commitFiles({
      branch: BRANCH,
      startBranch: 'main',
      message: 'Noch etwas',
      files: [{ path: 'AGENTS.md', content: '# Später\n', mode: 'write' }],
    });

    await expect(writer.mergeMergeRequest({ number, sha: 'a'.repeat(40) })).rejects.toMatchObject({
      code: 'invalid',
      detail: 'SHA does not match HEAD of source branch',
    });
    expect((await read())?.state).toBe('opened');
    // Without a commit to hold on to, GitLab merges what is there.
    expect(approved).not.toBeNull();
    expect(await writer.mergeMergeRequest({ number, sha: null })).toMatchObject({
      existed: false,
    });
  });

  it('fails with GitLab’s reason for a draft, a closed and a missing merge request', async () => {
    const { writer, answer } = await setUp();

    // The example's own merge request !1 is a draft.
    await expect(writer.mergeMergeRequest({ number: 1, sha: null })).rejects.toMatchObject({
      code: 'invalid',
      detail: '405 Method Not Allowed',
    });
    await expect(writer.mergeMergeRequest({ number: 99, sha: null })).rejects.toMatchObject({
      code: 'not_found',
    });
    answer.next = Response.json({
      iid: 5,
      title: 'Zu',
      state: 'closed',
      web_url: 'http://gitlab.test/x/-/merge_requests/5',
      source_branch: 'a',
      target_branch: 'main',
    });
    await expect(writer.mergeMergeRequest({ number: 5, sha: null })).rejects.toMatchObject({
      code: 'invalid',
      detail: 'The merge request is closed',
    });
    answer.next = new Response('{"message":"403 Forbidden"}', { status: 403 });
    await expect(writer.mergeMergeRequest({ number: 1, sha: null })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('listOpenMergeRequests', () => {
  it('lists what is open with what merging needs, the latest changed first', async () => {
    const { client, accessToken, writer } = await setUp();
    const target = { baseUrl: SOURCE.baseUrl, repositoryId: 101 };
    await writer.commitFiles({
      branch: 'feature/x',
      startBranch: 'main',
      message: 'X',
      files: [{ path: 'x.md', content: 'x\n', mode: 'write' }],
    });
    await writer.openMergeRequest({
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      title: 'X einbauen',
      description: '',
    });

    const open = await listOpenMergeRequests(client, target, accessToken);

    expect(open.map((entry) => [entry.number, entry.title, entry.draft])).toEqual([
      [3, 'X einbauen', false],
      [1, 'Login per E-Mail-Link', true],
    ]);
    expect(open[0]).toMatchObject({
      state: 'opened',
      url: 'http://gitlab.test/beispiel-verein/vereins-app/-/merge_requests/3',
      sourceBranch: 'feature/x',
      targetBranch: 'main',
      author: 'Olga Beispiel',
      conflicts: false,
    });
    expect(await readMergeRequest(client, target, accessToken, 2)).toMatchObject({
      state: 'merged',
    });
    expect(await readMergeRequest(client, target, accessToken, 99)).toBeUndefined();
  });
});

describe('commentOnMergeRequest', () => {
  const MARK = 'covibes-action:9c000000-0000-4000-8000-000000000001';

  it('posts a comment at the merge request, which agents that read then see', async () => {
    const { writer, calls, get } = await setUp();

    const written = await writer.commentOnMergeRequest({
      number: 1,
      body: `### Review\n\nWeicht ab.\n\n<!-- ${MARK} -->`,
    });

    expect(written.url).toMatch(
      /^http:\/\/gitlab\.test\/beispiel-verein\/vereins-app\/-\/merge_requests\/1#note_\d+$/,
    );
    expect(calls).toEqual([
      'POST /api/v4/projects/101/merge_requests/1/notes',
      'GET /api/v4/projects/101/merge_requests/1',
    ]);
    // The page of the merge request shows the text as it was sent.
    const page = await (await get('/beispiel-verein/vereins-app/-/merge_requests/1')).text();
    expect(page).toContain('### Review');
    expect(page).toContain(`id="note_${written.url.split('#note_')[1] ?? ''}"`);
  });

  it('finds a comment by its mark, and nothing without one', async () => {
    const { writer } = await setUp();
    expect(await writer.findMergeRequestComment(1, MARK)).toBeUndefined();
    const written = await writer.commentOnMergeRequest({
      number: 1,
      body: `Weicht ab.\n\n<!-- ${MARK} -->`,
    });
    await writer.commentOnMergeRequest({ number: 1, body: 'Ein anderer Kommentar.' });

    expect(await writer.findMergeRequestComment(1, MARK)).toEqual(written);
    expect(await writer.findMergeRequestComment(1, 'covibes-action:another')).toBeUndefined();
    // The mark of a comment at another merge request is not this one's.
    expect(await writer.findMergeRequestComment(2, MARK)).toBeUndefined();
  });

  it('fails with the reason for a merge request that is not there, and for an empty comment', async () => {
    const { writer } = await setUp();

    await expect(writer.commentOnMergeRequest({ number: 99, body: 'x' })).rejects.toEqual(
      failure('not_found'),
    );
    await expect(writer.commentOnMergeRequest({ number: 1, body: ' ' })).rejects.toEqual(
      failure('invalid'),
    );
  });

  it('says when GitLab cannot be reached', async () => {
    const { writer, answer } = await setUp();
    answer.away = true;

    await expect(writer.commentOnMergeRequest({ number: 1, body: 'x' })).rejects.toEqual(
      failure('unreachable'),
    );
  });
});
