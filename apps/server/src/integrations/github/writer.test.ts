import { describe, expect, it } from 'vitest';

import { createGithubClient } from '@server/integrations/github/client';
import { githubWriter } from '@server/integrations/github/writer';
import { gitBlobId } from '@server/integrations/gitlab/blobs';

const sha = (digit: string) => digit.repeat(40);
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
const pull = {
  number: 7,
  title: 'Plan',
  body: 'Architecture plan',
  html_url: 'https://github.com/owner/project/pull/7',
  state: 'open',
  head: { sha: sha('a'), ref: 'covibes/plan' },
  base: { ref: 'main' },
  user: { login: 'owner' },
  updated_at: null,
  draft: false,
};
type Call = { method: string; path: string; body: unknown };

function fixture(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const client = createGithubClient((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const call = {
      method: init?.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      body: init?.body
        ? (JSON.parse(typeof init.body === 'string' ? init.body : '') as unknown)
        : undefined,
    };
    calls.push(call);
    const result = answer(call);
    return Promise.resolve(result instanceof Response ? result : Response.json(result));
  });
  return { calls, writer: githubWriter(client, target, 'test-installation-token') };
}

describe('native GitHub approved writes', () => {
  it('uses milestone numbers, native issue bodies and retry marks that exclude pull requests', async () => {
    const issues: unknown[] = [
      {
        number: 6,
        html_url: `${repository.html_url}/pull/6`,
        body: '<!-- covibes:action -->',
        pull_request: {},
      },
    ];
    const milestones: unknown[] = [];
    const { writer, calls } = fixture((c) => {
      if (c.path === '/repos/owner/project') return repository;
      if (c.path.startsWith('/repos/owner/project/milestones?')) return milestones;
      if (c.path.endsWith('/milestones')) {
        const found = {
          id: 9000,
          number: 12,
          title: 'Launch',
          html_url: `${repository.html_url}/milestone/12`,
        };
        milestones.push(found);
        return found;
      }
      if (c.path.startsWith('/repos/owner/project/issues?')) return issues;
      if (c.path.endsWith('/issues')) {
        const found = {
          number: 8,
          html_url: `${repository.html_url}/issues/8`,
          body: '<!-- covibes:action -->',
        };
        issues.push(found);
        return found;
      }
      throw new Error(`Unexpected API call ${c.path}`);
    });
    const milestone = await writer.ensureMilestone({ title: 'Launch', description: 'Ship' });
    expect(milestone.id).toBe(12);
    expect(await writer.ensureMilestone({ title: 'Launch', description: 'Ship' })).toMatchObject({
      existed: true,
      id: 12,
    });
    expect(await writer.findIssue('covibes:action')).toBeUndefined();
    const issue = await writer.createIssue({
      title: 'Ship',
      description: '<!-- covibes:action -->',
      milestoneId: milestone.id,
    });
    expect(await writer.findIssue('covibes:action')).toEqual(issue);
    expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/issues'))?.body).toEqual({
      title: 'Ship',
      body: '<!-- covibes:action -->',
      milestone: 12,
    });
  });

  it('compares the branch before committing, preserves create-only files and retries without an extra commit', async () => {
    let head = sha('a');
    let content = 'Old';
    const { writer, calls } = fixture((c) => {
      if (c.path === '/repos/owner/project') return repository;
      if (c.path.includes('/git/ref/heads/')) return { object: { sha: head } };
      if (c.path.includes('/contents?'))
        return [
          { name: 'README.md', path: 'README.md', type: 'file', sha: gitBlobId(content) },
          { name: 'tracker.md', path: 'tracker.md', type: 'file', sha: gitBlobId('Keep') },
        ];
      if (c.path.includes('/git/commits/') && c.method === 'GET')
        return { tree: { sha: sha('b') } };
      if (c.path.endsWith('/git/blobs')) return { sha: gitBlobId('New') };
      if (c.path.endsWith('/git/trees')) return { sha: sha('c') };
      if (c.path.endsWith('/git/commits')) return { sha: sha('d') };
      if (c.method === 'PATCH') {
        content = 'New';
        head = sha('d');
        return { object: { sha: head } };
      }
      throw new Error(`Unexpected API call ${c.path}`);
    });
    const input = {
      branch: 'covibes/plan',
      startBranch: 'main',
      message: 'Plan',
      files: [
        { path: 'README.md', content: 'New', mode: 'write' as const },
        { path: 'tracker.md', content: 'Do not overwrite', mode: 'create' as const },
      ],
    };
    expect(await writer.commitFiles(input)).toEqual({
      url: `${repository.html_url}/commit/${sha('d')}`,
      added: 0,
      changed: 1,
      existed: false,
    });
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ sha: sha('d'), force: false });
    const posts = calls.filter((c) => c.method === 'POST').length;
    expect(await writer.commitFiles(input)).toEqual({
      url: null,
      added: 0,
      changed: 0,
      existed: true,
    });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(posts);
    expect(calls.filter((c) => c.path.endsWith('/git/blobs'))).toHaveLength(1);
  });

  it('refuses writes to a repository whose immutable identity changed and to workflow files', async () => {
    const moved = fixture(() => ({ ...repository, id: 999 }));
    await expect(
      moved.writer.createIssue({ title: 'x', description: '', milestoneId: null }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(moved.calls).toHaveLength(1);
    const safe = fixture(() => repository);
    for (const path of ['.github/workflows/run.yml', '../outside', '.git/config']) {
      await expect(
        safe.writer.commitFiles({
          branch: 'covibes/plan',
          startBranch: 'main',
          message: 'x',
          files: [{ path, content: 'x', mode: 'write' }],
        }),
      ).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(safe.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('merges only the explicitly approved head SHA and treats an ambiguous completed merge as done', async () => {
    let merged = false;
    const { writer, calls } = fixture((c) => {
      if (c.path === '/repos/owner/project') return repository;
      if (c.method === 'GET') return { ...pull, merged, state: merged ? 'closed' : 'open' };
      if (c.path.endsWith('/pulls/7/merge')) {
        merged = true;
        return { merged: true };
      }
      throw new Error(`Unexpected API call ${c.path}`);
    });
    await expect(writer.mergeMergeRequest({ number: 7, sha: sha('b') })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(writer.mergeMergeRequest({ number: 7, sha: null })).rejects.toMatchObject({
      code: 'invalid',
    });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(await writer.mergeMergeRequest({ number: 7, sha: sha('a') })).toMatchObject({
      existed: false,
    });
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      sha: sha('a'),
      merge_method: 'squash',
    });
    expect(await writer.mergeMergeRequest({ number: 7, sha: sha('a') })).toMatchObject({
      existed: true,
    });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('never retries an issue write based on an incomplete absence scan', async () => {
    const { writer, calls } = fixture(() =>
      Array.from({ length: 100 }, (_, i) => ({
        number: i + 1,
        html_url: `${repository.html_url}/issues/${String(i + 1)}`,
        body: 'No mark',
      })),
    );
    await expect(writer.findIssue('missing-mark')).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toHaveLength(20);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
});
