import { describe, expect, it } from 'vitest';

import { createGithubClient } from '@server/integrations/github/client';
import { githubRepositoryOperations } from '@server/integrations/github/repository';

const target = {
  baseUrl: 'https://github.com',
  repositoryId: 123,
  repositoryPath: 'owner/project',
};
const repository = {
  id: 123,
  name: 'project',
  full_name: 'owner/project',
  html_url: 'https://github.com/owner/project',
  default_branch: 'main',
};
const issue = {
  number: 4,
  title: 'Task',
  body: 'Do work',
  state: 'open',
  user: { login: 'owner' },
  updated_at: null,
  labels: [{ name: 'task' }],
  assignees: [],
};
const pull = {
  number: 7,
  title: 'Architecture',
  body: 'Closes #4',
  state: 'open',
  user: { login: 'builder' },
  updated_at: null,
  html_url: `${repository.html_url}/pull/7`,
  head: { ref: 'feature', sha: 'a'.repeat(40) },
  base: { ref: 'main' },
  changed_files: 31,
};

function fixture(answer: (path: string) => unknown) {
  const calls: string[] = [];
  const client = createGithubClient((input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = `${url.pathname}${url.search}`;
    calls.push(path);
    const result = path === '/repos/owner/project' ? repository : answer(path);
    return Promise.resolve(result instanceof Response ? result : Response.json(result));
  });
  return { calls, operations: githubRepositoryOperations(client, target, 'fixture-token') };
}

describe('GitHub repository reads', () => {
  it('uses native file and tree routes, with bounds and binary detection', async () => {
    const f = fixture((path) => {
      if (path.includes('/contents/binary'))
        return {
          path: 'binary',
          encoding: 'base64',
          size: 3,
          content: Buffer.from([0, 1, 2]).toString('base64'),
        };
      if (path.includes('/contents/large'))
        return { path: 'large', encoding: 'none', size: 2_000_000, content: '' };
      if (path.includes('/contents/docs%20here/plan.md'))
        return {
          path: 'docs here/plan.md',
          encoding: 'base64',
          size: 4,
          content: Buffer.from('Plan').toString('base64'),
        };
      return Array.from({ length: 201 }, (_, i) => ({
        name: `entry${String(i)}`,
        path: `entry${String(i)}`,
        type: i === 5 ? 'dir' : 'file',
        sha: 'a'.repeat(40),
      }));
    });
    const reader = await f.operations.reader();
    expect(await reader.file('docs here/plan.md', 'feature/x')).toMatchObject({
      kind: 'text',
      text: 'Plan',
    });
    expect(f.calls).toContain('/repos/owner/project/contents/docs%20here/plan.md?ref=feature%2Fx');
    expect(await reader.file('binary')).toMatchObject({ kind: 'unreadable', reason: 'binary' });
    expect(await reader.file('large')).toMatchObject({ kind: 'unreadable', reason: 'too_large' });
    const tree = await reader.tree('');
    expect(tree?.more).toBe(true);
    expect(tree?.entries).toHaveLength(200);
    expect(tree?.entries[0]?.kind).toBe('folder');
  });

  it('keeps pull requests out of task issues and maps exact task states', async () => {
    const f = fixture((path) => {
      if (path.includes('/issues?')) return [issue, { ...issue, number: 7, pull_request: {} }];
      if (path.includes('/issues/7')) return { ...issue, number: 7, pull_request: {} };
      if (path.includes('/issues/99')) return new Response(null, { status: 404 });
      return { ...issue, state: 'closed' };
    });
    expect([...(await f.operations.issueStates([4, 7, 99, 4]))]).toEqual([[4, 'closed']]);
    const reader = await f.operations.reader();
    expect(await reader.issues({ state: 'open' })).toEqual([
      expect.objectContaining({ number: 4, state: 'opened', labels: ['task'] }),
    ]);
    expect(await reader.issue(7)).toBeUndefined();
    expect(await reader.issue(99)).toBeUndefined();
  });

  it('delivers native pull request diffs and comments to architecture review, declaring truncation', async () => {
    const f = fixture((path) => {
      if (path.includes('/pulls/7/files?'))
        return Array.from({ length: 31 }, (_, i) => ({
          filename: `file${String(i)}.ts`,
          status: i === 0 ? 'renamed' : 'modified',
          ...(i === 0 ? { previous_filename: 'old.ts' } : { patch: '@@ -1 +1 @@\n-old\n+new' }),
        }));
      if (path.includes('/comments?'))
        return [{ user: { login: 'reviewer' }, body: 'Please review', created_at: null }];
      return pull;
    });
    const reader = await f.operations.reader();
    const reviewed = await reader.mergeRequest(7);
    expect(reviewed?.mergeRequest).toMatchObject({
      number: 7,
      state: 'opened',
      sourceBranch: 'feature',
      sha: 'a'.repeat(40),
    });
    expect(reviewed?.moreDiffs).toBe(true);
    expect(reviewed?.diffs).toHaveLength(30);
    expect(reviewed?.diffs[0]).toMatchObject({
      change: 'renamed',
      previousPath: 'old.ts',
      diff: '[GitHub did not supply a text diff for this file.]',
    });
    expect(reviewed?.notes[0]).toMatchObject({ author: 'reviewer', body: 'Please review' });
  });

  it('fails package comparison closed when a directory may be truncated', async () => {
    const f = fixture(() =>
      Array.from({ length: 1000 }, (_, i) => ({
        name: `file${String(i)}`,
        path: `file${String(i)}`,
        type: 'file',
        sha: 'a'.repeat(40),
      })),
    );
    await expect(f.operations.blobs('main', ['context'])).rejects.toMatchObject({ status: 422 });
  });
});
