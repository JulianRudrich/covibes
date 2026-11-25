import { z } from 'zod';

import {
  RepositoryWriteError,
  type RepositoryTarget,
  type RepositoryWriter,
} from '@server/integrations/git-host';
import { GithubError, githubFilePath, type GithubClient } from '@server/integrations/github/client';
import {
  githubRepositoryOperations,
  githubPull,
  parseGithub,
} from '@server/integrations/github/repository';
import { fileStates, gitBlobId, foldersOf } from '@server/integrations/gitlab/blobs';

const refSchema = z.object({ object: z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/) }) });
const shaSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/) });
const writtenIssue = z.object({
  number: z.number().int().positive(),
  html_url: z.string().startsWith('https://github.com/'),
});

function branchName(branch: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,200}$/.test(branch) ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.endsWith('.lock')
  )
    throw new GithubError(400, 'Invalid repository branch');
  return encodeURIComponent(branch);
}

export function githubWriter(
  client: GithubClient,
  target: RepositoryTarget,
  token: string,
): RepositoryWriter {
  const ops = githubRepositoryOperations(client, target, token);
  const call = (method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown) =>
    client.api(method, `${ops.root}${path}`, token, body);
  async function checked<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof GithubError)) throw error;
      throw new RepositoryWriteError(
        error.status === 0 || error.status >= 500 || error.status === 429
          ? 'unreachable'
          : error.status === 401
            ? 'unauthorized'
            : error.status === 403
              ? 'forbidden'
              : error.status === 404
                ? 'not_found'
                : error.status === 409 || error.status === 422 || error.status === 400
                  ? 'invalid'
                  : 'failed',
        error.message,
      );
    }
  }

  async function pages(path: string, predicate: (item: unknown) => boolean): Promise<unknown> {
    for (let page = 1; page <= 20; page += 1) {
      const items = parseGithub(
        z.array(z.unknown()),
        await ops.get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${String(page)}`),
      );
      const item = items.find(predicate);
      if (item !== undefined) return item;
      if (items.length < 100) return undefined;
    }
    // Absence in an incomplete scan is not enough to repeat an ambiguous write.
    throw new GithubError(422, 'Repository lookup exceeds the safe retry limit');
  }

  return {
    ensureMilestone: (input) =>
      checked(async () => {
        await ops.repository();
        const schema = z.object({
          number: z.number().int().positive(),
          title: z.string(),
          html_url: z.string().startsWith('https://github.com/'),
        });
        const before = await pages(
          '/milestones?state=all',
          (item) => schema.safeParse(item).data?.title === input.title,
        );
        const found = parseGithub(
          schema,
          before ??
            (await call('POST', '/milestones', {
              title: input.title,
              description: input.description,
            })),
        );
        // GitHub issues reference the milestone NUMBER, not its unrelated database id.
        return { id: found.number, url: found.html_url, existed: before !== undefined };
      }),
    createIssue: (input) =>
      checked(async () => {
        await ops.repository();
        const value = parseGithub(
          writtenIssue,
          await call('POST', '/issues', {
            title: input.title,
            body: input.description,
            ...(input.milestoneId === null ? {} : { milestone: input.milestoneId }),
          }),
        );
        return { number: value.number, url: value.html_url };
      }),
    findIssue: (mark) =>
      checked(async () => {
        const schema = writtenIssue.extend({
          body: z.string().nullable(),
          pull_request: z.unknown().optional(),
        });
        const found = await pages('/issues?state=all&sort=created&direction=desc', (item) => {
          const value = schema.safeParse(item).data;
          return (
            value !== undefined &&
            value.pull_request === undefined &&
            (value.body ?? '').includes(mark)
          );
        });
        if (found === undefined) return undefined;
        const value = parseGithub(schema, found);
        return { number: value.number, url: value.html_url };
      }),
    commitFiles: (input) =>
      checked(async () => {
        await ops.repository();
        const branch = branchName(input.branch);
        const start = branchName(input.startBranch);
        if (
          input.files.length === 0 ||
          input.files.length > 300 ||
          new Set(input.files.map((f) => f.path)).size !== input.files.length
        )
          throw new GithubError(400, 'Invalid package file list');
        for (const file of input.files) {
          githubFilePath(file.path);
          if (file.path.split('/').includes('.git') || file.path.startsWith('.github/workflows/'))
            throw new GithubError(400, 'Package cannot change repository execution configuration');
        }
        let reference = await ops.find(`/git/ref/heads/${branch}`);
        if (reference === undefined) {
          const base = parseGithub(refSchema, await ops.get(`/git/ref/heads/${start}`));
          try {
            reference = await call('POST', '/git/refs', {
              ref: `refs/heads/${input.branch}`,
              sha: base.object.sha,
            });
          } catch (error) {
            if (!(error instanceof GithubError) || error.status !== 422) throw error;
            reference = await ops.find(`/git/ref/heads/${branch}`);
            if (reference === undefined) throw error;
          }
        }
        const head = parseGithub(refSchema, reference).object.sha;
        const blobs = await ops.blobs(head, foldersOf(input.files.map((f) => f.path)));
        if (!blobs) throw new GithubError(404);
        const states = fileStates(input.files, blobs);
        const writes = input.files.filter(
          (_, i) => states[i]?.state === 'new' || states[i]?.state === 'changed',
        );
        const added = states.filter((f) => f.state === 'new').length;
        const changed = states.filter((f) => f.state === 'changed').length;
        if (writes.length === 0) return { url: null, added: 0, changed: 0, existed: true };
        const parent = parseGithub(
          z.object({ tree: shaSchema }),
          await ops.get(`/git/commits/${head}`),
        );
        const treeEntries = [];
        for (const file of writes) {
          const blob = parseGithub(
            shaSchema,
            await call('POST', '/git/blobs', {
              content: Buffer.from(file.content).toString('base64'),
              encoding: 'base64',
            }),
          );
          if (blob.sha !== gitBlobId(file.content))
            throw new GithubError(502, 'GitHub blob identity did not match');
          treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
        }
        const tree = parseGithub(
          shaSchema,
          await call('POST', '/git/trees', { base_tree: parent.tree.sha, tree: treeEntries }),
        );
        const commit = parseGithub(
          shaSchema,
          await call('POST', '/git/commits', {
            message: input.message,
            tree: tree.sha,
            parents: [head],
          }),
        );
        // A concurrent change makes this non-fast-forward and fails; never overwrite it.
        await call('PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
        return {
          url: `${target.baseUrl}/${target.repositoryPath ?? ''}/commit/${commit.sha}`,
          added,
          changed,
          existed: false,
        };
      }),
    openMergeRequest: (input) =>
      checked(async () => {
        await ops.repository();
        branchName(input.sourceBranch);
        branchName(input.targetBranch);
        const owner = (target.repositoryPath ?? '').split('/')[0] ?? '';
        const query = new URLSearchParams({
          state: 'open',
          head: `${owner}:${input.sourceBranch}`,
          base: input.targetBranch,
          per_page: '100',
        });
        const list = parseGithub(z.array(z.unknown()), await ops.get(`/pulls?${query.toString()}`));
        const matches = list
          .map(githubPull)
          .filter(
            (p) => p.sourceBranch === input.sourceBranch && p.targetBranch === input.targetBranch,
          );
        const before = matches[0];
        const value =
          before ??
          githubPull(
            await call('POST', '/pulls', {
              head: input.sourceBranch,
              base: input.targetBranch,
              title: input.title,
              body: input.description,
            }),
          );
        return { number: value.number, url: value.url, existed: before !== undefined };
      }),
    mergeMergeRequest: (input) =>
      checked(async () => {
        await ops.repository();
        const p = await ops.pull(input.number);
        if (!p) throw new GithubError(404);
        if (!input.sha || p.sha !== input.sha)
          throw new GithubError(409, 'The approved pull request revision changed');
        if (p.state === 'merged') return { number: p.number, url: p.url, existed: true };
        if (p.state !== 'opened' || p.draft)
          throw new GithubError(409, 'Pull request cannot be merged');
        const merged = parseGithub(
          z.object({ merged: z.boolean() }),
          await call('PUT', `/pulls/${String(input.number)}/merge`, {
            sha: input.sha,
            merge_method: 'squash',
          }),
        );
        if (!merged.merged) throw new GithubError(409, 'GitHub refused the merge');
        return { number: p.number, url: p.url, existed: false };
      }),
    commentOnMergeRequest: (input) =>
      checked(async () => {
        await ops.repository();
        const value = parseGithub(
          z.object({ html_url: z.string().startsWith('https://github.com/') }),
          await call('POST', `/issues/${String(input.number)}/comments`, { body: input.body }),
        );
        return { url: value.html_url };
      }),
    findMergeRequestComment: (number, mark) =>
      checked(async () => {
        const schema = z.object({
          body: z.string(),
          html_url: z.string().startsWith('https://github.com/'),
        });
        const found = await pages(
          `/issues/${String(number)}/comments`,
          (item) => schema.safeParse(item).data?.body.includes(mark) === true,
        );
        return found === undefined ? undefined : { url: parseGithub(schema, found).html_url };
      }),
  };
}
