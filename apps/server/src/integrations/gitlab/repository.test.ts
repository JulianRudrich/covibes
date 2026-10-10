import type { ProjectSummary } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitConnections } from '@server/integrations/gitlab/connections';
import { createGitlabStandIn } from '@server/integrations/gitlab/dev/stand-in';
import {
  cleanPath,
  repositoryReaders,
  RepositoryGoneError,
  type RepositoryReader,
} from '@server/integrations/gitlab/repository';
import { DEV_GITLAB_CLIENT, type GitlabSetup } from '@server/integrations/gitlab/setup';
import { APP_URL, createTestServer } from '@server/testing';

// Reading the repository of a project (spec 28b) against the example repository of the stand-in.
const test = createTestServer();

const SETUP: GitlabSetup = {
  tokenKey: 'a-token-key-with-at-least-32-characters',
  standIn: true,
  source: {
    baseUrl: 'http://gitlab.test',
    clientId: DEV_GITLAB_CLIENT.id,
    clientSecret: DEV_GITLAB_CLIENT.secret,
    redirectUri: 'http://localhost:5173/api/git/callback',
  },
};

function setUp() {
  const clock = { now: Date.parse('2026-10-09T10:00:00Z') };
  const now = () => clock.now;
  const standIn = createGitlabStandIn(SETUP.source, now);
  const calls: string[] = [];
  const state = { away: false };
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const { pathname, search } = new URL(url);
    calls.push(`${init?.method ?? 'GET'} ${pathname}${search}`);
    if (state.away) return Promise.reject(new Error('ECONNREFUSED'));
    return Promise.resolve(standIn.routes.request(url, init));
  };
  const client = createGitlabClient(fetcher, now);
  const connections = createGitConnections({ admin: test.db.admin, client, setup: SETUP, now });
  const readers = repositoryReaders({ admin: test.db.admin, client, connections });

  /** A project whose owner connected their account; `repositoryId` is the repository picked, if any. */
  async function project(repositoryId: number | null = 101) {
    const cookie = await test.signIn();
    const created = await test.app.request('/api/projects', {
      method: 'POST',
      headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Vereins-App' }),
    });
    const projectId = ((await created.json()) as ProjectSummary).id;
    const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
    const page = await fetcher(client.authorizeUrl(SETUP.source, 'state'));
    const allow = /class="allow" href="([^"]+)"/.exec(await page.text())?.[1] ?? '';
    const code = new URL(allow.replaceAll('&amp;', '&')).searchParams.get('code') ?? '';
    const tokens = await client.exchangeCode(SETUP.source, code);
    const userId = session?.user.id ?? '';
    await connections.connectAccount(
      userId,
      await client.account(SETUP.source.baseUrl, tokens.accessToken),
      tokens,
    );
    if (repositoryId !== null) {
      const repository = await client.repository(
        SETUP.source.baseUrl,
        tokens.accessToken,
        repositoryId,
      );
      if (!repository) throw new Error('The example repository is missing');
      await connections.setRepository(projectId, userId, repository);
    }
    calls.length = 0;
    return projectId;
  }

  async function reader(repositoryId = 101): Promise<RepositoryReader> {
    const found = await readers(await project(repositoryId));
    if (!found) throw new Error('The project has no reader');
    return found;
  }

  return { clock, calls, state, connections, readers, project, reader };
}

describe('the reader of a project', () => {
  it('names the repository the project is connected to', async () => {
    const { reader } = setUp();

    expect((await reader()).repository).toEqual({
      path: 'beispiel-verein/vereins-app',
      name: 'Vereins-App',
      defaultBranch: 'main',
    });
  });

  it('does not exist before a repository is picked, also when the owner has an account', async () => {
    const { readers, project } = setUp();

    expect(await readers('00000000-0000-4000-8000-000000000000')).toBeUndefined();
    expect(await readers(await project(null))).toBeUndefined();
  });
});

describe('files', () => {
  it('lists a folder, folders first', async () => {
    const { reader, calls } = setUp();
    const repository = await reader();

    const top = await repository.tree('');
    const api = await repository.tree('/src/api/');

    expect(top).toEqual({
      entries: [
        { name: 'context', path: 'context', kind: 'folder' },
        { name: 'docs', path: 'docs', kind: 'folder' },
        { name: 'src', path: 'src', kind: 'folder' },
        { name: 'package.json', path: 'package.json', kind: 'file' },
        { name: 'README.md', path: 'README.md', kind: 'file' },
      ],
      more: false,
    });
    expect(api?.entries.map((entry) => entry.path)).toEqual([
      'src/api/routes',
      'src/api/db.js',
      'src/api/server.js',
    ]);
    // The default branch is asked for unless another ref is named.
    expect(calls[0]).toBe('GET /api/v4/projects/101/repository/tree?ref=main&per_page=100&page=1');
  });

  it('knows no folder that is not there, and no ref that is not there', async () => {
    const { reader } = setUp();
    const repository = await reader();

    expect(await repository.tree('src/nichts')).toBeUndefined();
    expect(await repository.tree('', 'no-such-branch')).toBeUndefined();
    expect((await repository.tree('', 'HEAD'))?.entries).toHaveLength(5);
  });

  it('reads a text file', async () => {
    const { reader, calls } = setUp();
    const repository = await reader();

    const file = await repository.file('./src/api/routes/members.js');

    expect(file).toMatchObject({ kind: 'text', path: 'src/api/routes/members.js' });
    expect(file?.kind === 'text' ? file.text : '').toContain('export async function listMembers()');
    expect(calls).toEqual([
      'GET /api/v4/projects/101/repository/files/src%2Fapi%2Froutes%2Fmembers.js?ref=main',
    ]);
  });

  it('does not read a file that is no text, and knows none that is not there', async () => {
    const { reader } = setUp();
    const repository = await reader();

    expect(await repository.file('docs/logo.png')).toEqual({
      kind: 'unreadable',
      path: 'docs/logo.png',
      size: 12,
      reason: 'binary',
    });
    expect(await repository.file('src/nichts.js')).toBeUndefined();
    // A folder is no file.
    expect(await repository.file('src')).toBeUndefined();
    expect(await repository.file('README.md', 'no-such-branch')).toBeUndefined();
  });
});

describe('issues', () => {
  it('lists them by state, the latest changed first, and by a search', async () => {
    const { reader } = setUp();
    const repository = await reader();

    const open = await repository.issues({ state: 'open' });
    const all = await repository.issues({ state: 'all' });
    const found = await repository.issues({ state: 'all', search: 'aufsetzen' });

    expect(open.map((issue) => `#${String(issue.number)} ${issue.state}`)).toEqual([
      '#1 opened',
      '#2 opened',
    ]);
    expect(all.map((issue) => issue.number)).toEqual([1, 2, 3]);
    expect(found.map((issue) => issue.title)).toEqual(['Projekt aufsetzen']);
    expect(open[0]).toMatchObject({
      title: 'Login per E-Mail-Link bauen',
      labels: ['Meilenstein 1'],
      assignees: ['Olga Beispiel'],
      author: 'Olga Beispiel',
      updatedAt: '2026-10-02T09:30:00.000Z',
    });
  });

  it('reads one with what people wrote below it, without the notes of GitLab itself', async () => {
    const { reader } = setUp();
    const repository = await reader();

    const found = await repository.issue(1);

    expect(found?.issue.description).toContain('einen Link, der 15 Minuten gilt');
    expect(found?.notes).toEqual([
      {
        author: 'Sam Muster',
        body: 'Über welchen Dienst verschicken wir die E-Mails? Das ist noch nicht entschieden.',
        createdAt: '2026-10-01T10:15:00.000Z',
      },
      {
        author: 'Olga Beispiel',
        body: 'Fürs Erste schreibe ich den Link nur ins Log, bis der Versanddienst feststeht.',
        createdAt: '2026-10-02T09:30:00.000Z',
      },
    ]);
    expect(await repository.issue(99)).toBeUndefined();
  });
});

describe('merge requests', () => {
  it('lists them by state', async () => {
    const { reader } = setUp();
    const repository = await reader();

    expect(await repository.mergeRequests({ state: 'open' })).toEqual([
      {
        number: 1,
        title: 'Login per E-Mail-Link',
        state: 'opened',
        draft: true,
        sourceBranch: 'feature/login',
        targetBranch: 'main',
        description: expect.stringContaining('Erster Teil von #1') as string,
        author: 'Olga Beispiel',
        updatedAt: '2026-10-02T09:40:00.000Z',
        // Its last commit, which a review is for (spec 30b).
        sha: expect.stringMatching(/^[0-9a-f]{40}$/) as string,
      },
    ]);
    expect(
      (await repository.mergeRequests({ state: 'merged' })).map((request) => request.number),
    ).toEqual([2]);
    expect(await repository.mergeRequests({ state: 'all' })).toHaveLength(2);
  });

  it('reads one with its changes and comments', async () => {
    const { reader } = setUp();
    const repository = await reader();

    const found = await repository.mergeRequest(1);

    expect(found?.diffs.map((diff) => `${diff.path}: ${diff.change}`)).toEqual([
      'src/api/routes/login.js: added',
      'src/api/server.js: changed',
    ]);
    expect(found?.diffs[0]?.diff).toContain('+export function createLoginLink(email) {');
    expect(found?.moreDiffs).toBe(false);
    expect(found?.notes.map((note) => note.author)).toEqual(['Sam Muster']);
    expect(await repository.mergeRequest(99)).toBeUndefined();
  });
});

describe('the connection behind the reader', () => {
  it('renews its token when it is about to end', async () => {
    const { clock, calls, reader } = setUp();
    const repository = await reader();

    clock.now += 3 * 60 * 60_000;
    const issues = await repository.issues({ state: 'open' });

    expect(issues).toHaveLength(2);
    expect(calls[0]).toBe('POST /oauth/token');
  });

  it('says that the connection ended, and passes on that GitLab is away', async () => {
    const { state, connections, readers, project } = setUp();
    const projectId = await project();
    const repository = await readers(projectId);

    state.away = true;
    await expect(repository?.tree('')).rejects.toMatchObject({ name: 'GitlabError', status: 0 });
    state.away = false;

    await connections.disconnect(projectId);
    await expect(repository?.file('README.md')).rejects.toBeInstanceOf(RepositoryGoneError);
    expect(await readers(projectId)).toBeUndefined();
  });
});

describe('cleanPath', () => {
  it('takes a path as people write it', () => {
    expect(cleanPath(' /src/api/ ')).toBe('src/api');
    expect(cleanPath('./README.md')).toBe('README.md');
    expect(cleanPath('src\\web\\App.jsx')).toBe('src/web/App.jsx');
    expect(cleanPath('/')).toBe('');
    expect(cleanPath('')).toBe('');
  });
});
