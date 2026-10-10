import { describe, expect, it } from 'vitest';

import { createGitlabClient, GitlabError } from '@server/integrations/gitlab/client';
import { createGitlabStandIn } from '@server/integrations/gitlab/dev/stand-in';
import { readIssueStates } from '@server/integrations/gitlab/issues';
import { DEV_GITLAB_CLIENT } from '@server/integrations/gitlab/setup';
import { gitlabWriter } from '@server/integrations/gitlab/writer';

// Reading whether issues are open or closed (spec 30a), against the stand-in and against answers
// a GitLab could give.
const SOURCE = {
  baseUrl: 'http://gitlab.test',
  clientId: DEV_GITLAB_CLIENT.id,
  clientSecret: DEV_GITLAB_CLIENT.secret,
  redirectUri: 'http://localhost:5173/api/git/callback',
};
const TARGET = { baseUrl: SOURCE.baseUrl, repositoryId: 101 };

async function setUp() {
  const standIn = createGitlabStandIn(SOURCE, () => Date.parse('2026-10-10T10:00:00Z'));
  const calls: string[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const { pathname, search } = new URL(url);
    calls.push(`${init?.method ?? 'GET'} ${pathname}${decodeURIComponent(search)}`);
    return Promise.resolve(standIn.routes.request(url, init));
  };
  const client = createGitlabClient(fetcher);
  const page = await fetcher(client.authorizeUrl(SOURCE, 'state'));
  const allow = /class="allow" href="([^"]+)"/.exec(await page.text())?.[1] ?? '';
  const code = new URL(allow.replaceAll('&amp;', '&')).searchParams.get('code') ?? '';
  const { accessToken } = await client.exchangeCode(SOURCE, code);
  calls.length = 0;
  return { standIn, calls, client, accessToken, fetcher };
}

/** A client that answers every reading call with `answer`, and notes what it was asked. */
function answering(answer: (path: string) => unknown) {
  const paths: string[] = [];
  return {
    paths,
    client: {
      get: (_baseUrl: string, path: string) => {
        paths.push(decodeURIComponent(path));
        return Promise.resolve(answer(path));
      },
    },
  };
}

describe('readIssueStates', () => {
  it('reads the issues with these numbers, open and closed ones, in one call', async () => {
    const { client, accessToken, calls, fetcher } = await setUp();
    const writer = gitlabWriter(client, TARGET, accessToken);
    const first = await writer.createIssue({
      title: 'Projekt aufsetzen',
      description: '',
      milestoneId: null,
    });
    const second = await writer.createIssue({
      title: 'Login per Link',
      description: '',
      milestoneId: null,
    });
    // Someone closes the second issue: the button of its page.
    await fetcher(`${new URL(second.url).href}/state`, { method: 'POST' });
    calls.length = 0;

    const states = await readIssueStates(client, TARGET, accessToken, [
      first.number,
      second.number,
      9999,
    ]);

    expect([...states]).toEqual(
      expect.arrayContaining([
        [first.number, 'opened'],
        [second.number, 'closed'],
      ]),
    );
    // An issue that is not there (any more) is left out, and the others of the repository too.
    expect(states.size).toBe(2);
    expect(calls).toEqual([
      `GET /api/v4/projects/101/issues?state=all&per_page=100&iids[]=${String(first.number)}&iids[]=${String(second.number)}&iids[]=9999`,
    ]);
  });

  it('asks in parts of a hundred', async () => {
    const numbers = Array.from({ length: 230 }, (_, index) => index + 1);
    const { client, paths } = answering((path) =>
      [...decodeURIComponent(path).matchAll(/iids\[\]=(\d+)/g)].map((match) => ({
        iid: Number(match[1]),
        state: Number(match[1]) % 2 === 0 ? 'closed' : 'opened',
      })),
    );

    const states = await readIssueStates(client, TARGET, 'token', numbers);

    expect(paths).toHaveLength(3);
    expect(paths.map((path) => path.match(/iids\[\]=/g)?.length)).toEqual([100, 100, 30]);
    expect(states.size).toBe(230);
    expect(states.get(1)).toBe('opened');
    expect(states.get(230)).toBe('closed');
  });

  it('asks nothing for no numbers', async () => {
    const { client, paths } = answering(() => []);

    expect((await readIssueStates(client, TARGET, 'token', [])).size).toBe(0);
    expect(paths).toEqual([]);
  });

  it('skips entries that are no issues, and refuses an answer that is no list', async () => {
    const mixed = answering(() => [
      { iid: 4, state: 'closed' },
      { iid: 'five', state: 'opened' },
      null,
      { iid: 6, state: 'locked' },
    ]);
    const broken = answering(() => ({ message: 'hello' }));

    const states = await readIssueStates(mixed.client, TARGET, 'token', [4, 5, 6]);

    // Whatever is not closed counts as open.
    expect([...states]).toEqual([
      [4, 'closed'],
      [6, 'opened'],
    ]);
    await expect(readIssueStates(broken.client, TARGET, 'token', [4])).rejects.toBeInstanceOf(
      GitlabError,
    );
  });
});
