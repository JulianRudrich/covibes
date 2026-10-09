import { describe, expect, it } from 'vitest';

import { fileStates, foldersOf, gitBlobId, listBlobs } from '@server/integrations/gitlab/blobs';
import { createGitlabClient } from '@server/integrations/gitlab/client';
import { createGitlabStandIn } from '@server/integrations/gitlab/dev/stand-in';
import { DEV_GITLAB_CLIENT } from '@server/integrations/gitlab/setup';

// Comparing files with a branch by Git's mark of their content (spec 29c), against the example
// repository of the stand-in.
const SOURCE = {
  baseUrl: 'http://gitlab.test',
  clientId: DEV_GITLAB_CLIENT.id,
  clientSecret: DEV_GITLAB_CLIENT.secret,
  redirectUri: 'http://localhost:5173/api/git/callback',
};

async function setUp() {
  const standIn = createGitlabStandIn(SOURCE);
  const calls: string[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const { pathname, search } = new URL(url);
    calls.push(`${init?.method ?? 'GET'} ${pathname}${search}`);
    return Promise.resolve(standIn.routes.request(url, init));
  };
  const client = createGitlabClient(fetcher);
  const page = await fetcher(client.authorizeUrl(SOURCE, 'state'));
  const allow = /class="allow" href="([^"]+)"/.exec(await page.text())?.[1] ?? '';
  const code = new URL(allow.replaceAll('&amp;', '&')).searchParams.get('code') ?? '';
  const { accessToken } = await client.exchangeCode(SOURCE, code);
  calls.length = 0;
  const blobs = (ref: string, folders: string[], repositoryId = 101) =>
    listBlobs(client, { baseUrl: SOURCE.baseUrl, repositoryId }, accessToken, ref, folders);
  return { calls, client, accessToken, blobs };
}

describe('gitBlobId', () => {
  it('is the id Git gives a file’s content', () => {
    // `git hash-object` of an empty file, and of "hello" with a line break.
    expect(gitBlobId('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(gitBlobId('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(gitBlobId(Buffer.from('hello\n'))).toBe(gitBlobId('hello\n'));
    // Bytes count, not characters.
    expect(gitBlobId('ä')).toBe(gitBlobId(Buffer.from([0xc3, 0xa4])));
  });
});

describe('foldersOf', () => {
  it('names every folder once, the top as ""', () => {
    expect(
      foldersOf(['CLAUDE.md', 'AGENTS.md', 'context/a.md', 'context/specs/b.md', 'context/c.md']),
    ).toEqual(['', 'context', 'context/specs']);
    expect(foldersOf([])).toEqual([]);
  });
});

describe('listBlobs', () => {
  it('lists the files directly in the folders asked for, with the id of their content', async () => {
    const { blobs, calls } = await setUp();

    const held = await blobs('main', ['', 'context', 'src/api']);

    expect([...(held?.keys() ?? [])].sort()).toEqual([
      'README.md',
      'context/project-overview.md',
      'package.json',
      'src/api/db.js',
      'src/api/server.js',
    ]);
    expect(held?.get('src/api/db.js')).toBe(
      gitBlobId(
        "import pg from 'pg';\n\nexport const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });\n",
      ),
    );
    // One call per folder; the top is always read, since it says whether the ref exists.
    expect(calls).toEqual([
      'GET /api/v4/projects/101/repository/tree?ref=main&per_page=100&page=1',
      'GET /api/v4/projects/101/repository/tree?ref=main&per_page=100&page=1&path=context',
      'GET /api/v4/projects/101/repository/tree?ref=main&per_page=100&page=1&path=src%2Fapi',
    ]);
  });

  it('holds nothing for a folder that is not there, and is undefined for a ref that is not', async () => {
    const { blobs } = await setUp();

    expect([...((await blobs('main', ['docs/diagrams']))?.keys() ?? [])].sort()).toEqual([
      'README.md',
      'package.json',
    ]);
    expect(await blobs('covibes/plan-nope', [''])).toBeUndefined();
    expect(await blobs('main', [''], 999)).toBeUndefined();
  });
});

describe('fileStates', () => {
  it('says for every file whether it is new, changed, the same or kept', () => {
    const held = new Map([
      ['same.md', gitBlobId('gleich\n')],
      ['changed.md', gitBlobId('alt\n')],
      ['tracker.md', gitBlobId('vom Coding-Agent\n')],
    ]);

    expect(
      fileStates(
        [
          { path: 'new.md', content: 'neu\n', mode: 'write' },
          { path: 'same.md', content: 'gleich\n', mode: 'write' },
          { path: 'changed.md', content: 'neu\n', mode: 'write' },
          { path: 'tracker.md', content: 'Vorlage\n', mode: 'create' },
          { path: 'missing-tracker.md', content: 'Vorlage\n', mode: 'create' },
        ],
        held,
      ),
    ).toEqual([
      { path: 'new.md', state: 'new' },
      { path: 'same.md', state: 'same' },
      { path: 'changed.md', state: 'changed' },
      { path: 'tracker.md', state: 'kept' },
      { path: 'missing-tracker.md', state: 'new' },
    ]);
  });
});
