import { z } from 'zod';

import type { RepositoryTarget, RepositoryPullRequest } from '@server/integrations/git-host';
import {
  GithubError,
  githubFilePath,
  githubRepositoryPath,
  type GithubClient,
} from '@server/integrations/github/client';
import {
  MAX_DIFFS,
  MAX_FILE_BYTES,
  MAX_LISTED,
  MAX_NOTES,
  MAX_TREE_ENTRIES,
  type RepositoryReader,
  type RepositoryIssue,
  type RepositoryNote,
  type RepositoryMergeRequest,
} from '@server/integrations/repository-reader';

const person = z.object({ login: z.string() }).nullable();
export const githubRepositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  full_name: z.string().min(1),
  html_url: z.string().startsWith('https://github.com/'),
  default_branch: z.string().nullable(),
  permissions: z.object({ push: z.boolean().optional(), admin: z.boolean().optional() }).optional(),
  archived: z.boolean().optional(),
  disabled: z.boolean().optional(),
});
const issueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  body: z.string().nullable(),
  user: person,
  updated_at: z.string().nullable(),
  labels: z.array(z.union([z.string(), z.object({ name: z.string().optional() })])),
  assignees: z
    .array(z.object({ login: z.string() }))
    .nullable()
    .optional(),
  pull_request: z.unknown().optional(),
});
export const githubPullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  body: z.string().nullable(),
  html_url: z.string().startsWith('https://github.com/'),
  head: z.object({
    ref: z.string(),
    sha: z.string().regex(/^[a-f0-9]{40,64}$/),
    repo: z.object({ id: z.number().int().positive() }).nullable().optional(),
  }),
  base: z.object({ ref: z.string() }),
  user: person,
  updated_at: z.string().nullable(),
  draft: z.boolean().optional(),
  merged: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  mergeable: z.boolean().nullable().optional(),
  changed_files: z.number().int().nonnegative().optional(),
});
const noteSchema = z.object({ user: person, body: z.string(), created_at: z.string().nullable() });
const entrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.string(),
  sha: z.string(),
  size: z.number().optional(),
});

export function parseGithub<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new GithubError(502, 'GitHub sent unexpected repository data');
  return parsed.data;
}

export function githubPull(answer: unknown): RepositoryPullRequest {
  const p = parseGithub(githubPullSchema, answer);
  return {
    number: p.number,
    title: p.title,
    description: p.body ?? '',
    state: p.merged || p.merged_at ? 'merged' : p.state === 'open' ? 'opened' : 'closed',
    url: p.html_url,
    sourceBranch: p.head.ref,
    targetBranch: p.base.ref,
    author: p.user?.login ?? '',
    updatedAt: p.updated_at,
    draft: p.draft ?? false,
    conflicts: p.mergeable === false,
    sha: p.head.sha,
  };
}

function issueOf(answer: unknown): RepositoryIssue {
  const p = parseGithub(issueSchema, answer);
  return {
    number: p.number,
    title: p.title,
    description: p.body ?? '',
    state: p.state === 'open' ? 'opened' : 'closed',
    labels: p.labels.flatMap((l) => (typeof l === 'string' ? [l] : l.name ? [l.name] : [])),
    assignees: (p.assignees ?? []).map((a) => a.login),
    author: p.user?.login ?? '',
    updatedAt: p.updated_at,
  };
}

export function githubRepositoryOperations(
  client: GithubClient,
  target: RepositoryTarget,
  token: string,
) {
  if (
    target.baseUrl !== 'https://github.com' ||
    !Number.isSafeInteger(target.repositoryId) ||
    target.repositoryId <= 0
  )
    throw new GithubError(400, 'Invalid GitHub target');
  const root = githubRepositoryPath(target.repositoryPath ?? '');
  const get = (path: string) => client.api('GET', `${root}${path}`, token);
  const find = (path: string) => client.find(`${root}${path}`, token);
  const query = (values: Record<string, string | number>) =>
    new URLSearchParams(
      Object.entries(values).map(([k, v]): [string, string] => [k, String(v)]),
    ).toString();

  async function repository() {
    const repo = parseGithub(githubRepositorySchema, await get(''));
    if (
      repo.id !== target.repositoryId ||
      repo.full_name.toLowerCase() !== target.repositoryPath?.toLowerCase()
    )
      throw new GithubError(403, 'GitHub repository identity changed');
    githubRepositoryPath(repo.full_name);
    if (repo.html_url !== `https://github.com/${repo.full_name}`) throw new GithubError(502);
    return repo;
  }

  async function pull(number: number) {
    if (!Number.isSafeInteger(number) || number <= 0) throw new GithubError(400);
    const answer = await find(`/pulls/${String(number)}`);
    return answer === undefined ? undefined : githubPull(answer);
  }

  async function pulls(state: 'open' | 'closed' | 'all' = 'open', limit = 50) {
    return parseGithub(
      z.array(z.unknown()),
      await get(`/pulls?${query({ state, sort: 'updated', direction: 'desc', per_page: limit })}`),
    ).map(githubPull);
  }

  async function notes(number: number): Promise<RepositoryNote[]> {
    return parseGithub(
      z.array(noteSchema),
      await get(`/issues/${String(number)}/comments?${query({ per_page: MAX_NOTES })}`),
    )
      .slice(0, MAX_NOTES)
      .map((p) => ({ author: p.user?.login ?? '', body: p.body, createdAt: p.created_at }));
  }

  async function contents(path: string, ref: string) {
    const suffix = path ? `/${githubFilePath(path)}` : '';
    return find(`/contents${suffix}?${query({ ref })}`);
  }

  return {
    root,
    get,
    find,
    repository,
    pull,
    pulls,
    async blobs(ref: string, folders: readonly string[]) {
      const blobs = new Map<string, string>();
      for (const folder of new Set(['', ...folders])) {
        const answer = await contents(folder, ref);
        if (answer === undefined) {
          if (folder === '') return undefined;
          continue;
        }
        const entries = parseGithub(z.array(entrySchema), answer);
        // GitHub's Contents API is capped at 1,000 entries. Incomplete comparison must fail.
        if (entries.length >= 1000)
          throw new GithubError(422, 'Repository folder exceeds the comparison limit');
        for (const entry of entries) if (entry.type === 'file') blobs.set(entry.path, entry.sha);
      }
      return blobs;
    },
    async issueStates(numbers: readonly number[]) {
      const states = new Map<number, 'opened' | 'closed'>();
      // Unlike GitLab, GitHub has no iids[] filter. Read the exact issue numbers, bounded by the plan.
      for (const number of new Set(numbers)) {
        const answer = await find(`/issues/${String(number)}`);
        if (answer === undefined) continue;
        const p = parseGithub(issueSchema, answer);
        if (!p.pull_request) states.set(p.number, p.state === 'closed' ? 'closed' : 'opened');
      }
      return states;
    },
    async reader(): Promise<RepositoryReader> {
      const meta = await repository();
      const refOf = (ref?: string) => ref?.trim() || meta.default_branch || 'HEAD';
      return {
        repository: { path: meta.full_name, name: meta.name, defaultBranch: meta.default_branch },
        async tree(path, ref) {
          const answer = await contents(path, refOf(ref));
          if (answer === undefined) return undefined;
          const entries = parseGithub(z.array(entrySchema), answer);
          return {
            entries: entries
              .slice(0, MAX_TREE_ENTRIES)
              .map((p) => ({
                name: p.name,
                path: p.path,
                kind: p.type === 'dir' ? ('folder' as const) : ('file' as const),
              }))
              .sort(
                (a, b) =>
                  Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
                  a.name.localeCompare(b.name),
              ),
            more: entries.length > MAX_TREE_ENTRIES,
          };
        },
        async file(path, ref) {
          const answer = await contents(path, refOf(ref));
          if (answer === undefined) return undefined;
          const p = parseGithub(
            z.object({
              path: z.string(),
              size: z.number().nonnegative(),
              encoding: z.string(),
              content: z.string(),
            }),
            answer,
          );
          if (p.size > MAX_FILE_BYTES || p.encoding !== 'base64')
            return { kind: 'unreadable', path: p.path, size: p.size, reason: 'too_large' };
          const bytes = Buffer.from(p.content, 'base64');
          if (bytes.byteLength > MAX_FILE_BYTES)
            return {
              kind: 'unreadable',
              path: p.path,
              size: bytes.byteLength,
              reason: 'too_large',
            };
          if (bytes.subarray(0, 8000).includes(0))
            return { kind: 'unreadable', path: p.path, size: p.size, reason: 'binary' };
          return { kind: 'text', path: p.path, size: p.size, text: bytes.toString('utf8') };
        },
        async issues({ state, search }) {
          const answer = parseGithub(
            z.array(z.unknown()),
            await get(
              `/issues?${query({ state, sort: 'updated', direction: 'desc', per_page: MAX_LISTED })}`,
            ),
          );
          return answer
            .map((p) => parseGithub(issueSchema, p))
            .filter((p) => !p.pull_request)
            .map(issueOf)
            .filter(
              (p) =>
                !search ||
                `${p.title}\n${p.description}`.toLowerCase().includes(search.toLowerCase()),
            )
            .slice(0, MAX_LISTED);
        },
        async issue(number) {
          const answer = await find(`/issues/${String(number)}`);
          if (answer === undefined || parseGithub(issueSchema, answer).pull_request)
            return undefined;
          return { issue: issueOf(answer), notes: await notes(number) };
        },
        async mergeRequests({ state }) {
          const list = await pulls(state === 'merged' ? 'closed' : state, MAX_LISTED);
          return list
            .filter((p) => (state === 'merged' || state === 'closed' ? p.state === state : true))
            .map((p): RepositoryMergeRequest => ({ ...p }));
        },
        async mergeRequest(number) {
          const answer = await find(`/pulls/${String(number)}`);
          if (answer === undefined) return undefined;
          const p = parseGithub(githubPullSchema, answer);
          const files = parseGithub(
            z.array(
              z.object({
                filename: z.string(),
                previous_filename: z.string().optional(),
                status: z.string(),
                patch: z.string().optional(),
              }),
            ),
            await get(`/pulls/${String(number)}/files?${query({ per_page: MAX_DIFFS + 1 })}`),
          );
          return {
            mergeRequest: githubPull(p),
            notes: await notes(number),
            moreDiffs: files.length > MAX_DIFFS || (p.changed_files ?? 0) > MAX_DIFFS,
            diffs: files.slice(0, MAX_DIFFS).map((f) => ({
              path: f.filename,
              previousPath: f.previous_filename ?? null,
              change:
                f.status === 'added'
                  ? ('added' as const)
                  : f.status === 'removed'
                    ? ('deleted' as const)
                    : f.status === 'renamed'
                      ? ('renamed' as const)
                      : ('changed' as const),
              diff: f.patch ?? '[GitHub did not supply a text diff for this file.]',
            })),
          };
        },
      };
    },
  };
}
