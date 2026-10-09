import type { DB } from '@covibes/db';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { GitlabError, type GitlabClient } from '@server/integrations/gitlab/client';
import type { GitConnections } from '@server/integrations/gitlab/connections';

// Reading the repository of a project (spec 28b): its files, issues and merge requests, with the
// access of the project's connection (spec 28a). Everything here only reads. The bounds keep one
// question from pulling a whole repository into a model; the tools word what comes back.

/** Entries of a folder that are shown at most. */
export const MAX_TREE_ENTRIES = 200;
/** Issues or merge requests a list shows at most. */
export const MAX_LISTED = 30;
/** Comments of an issue or merge request that are read at most. */
export const MAX_NOTES = 20;
/** Changed files of a merge request that are read at most. */
export const MAX_DIFFS = 30;
/** A file larger than this is not read. */
export const MAX_FILE_BYTES = 1024 * 1024;

/** GitLab gives at most this many entries per page. */
const PAGE = 100;

export type RepositoryEntry = { name: string; path: string; kind: 'folder' | 'file' };

export type RepositoryFile =
  | { kind: 'text'; path: string; size: number; text: string }
  /** The file is no text, or too large to read. */
  | { kind: 'unreadable'; path: string; size: number; reason: 'binary' | 'too_large' };

export type RepositoryIssue = {
  number: number;
  title: string;
  state: string;
  description: string;
  labels: string[];
  assignees: string[];
  author: string;
  updatedAt: string | null;
};

export type RepositoryNote = { author: string; body: string; createdAt: string | null };

export type RepositoryMergeRequest = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  sourceBranch: string;
  targetBranch: string;
  description: string;
  author: string;
  updatedAt: string | null;
};

export type RepositoryDiff = {
  path: string;
  /** Where the file was before, if it was renamed. */
  previousPath: string | null;
  change: 'added' | 'deleted' | 'renamed' | 'changed';
  diff: string;
};

/** The connection of the project ended, e.g. its owner disconnected or GitLab refused it. */
export class RepositoryGoneError extends Error {
  constructor() {
    super('The project has no connection to a repository any more');
    this.name = 'RepositoryGoneError';
  }
}

export type IssueState = 'open' | 'closed' | 'all';
export type MergeRequestState = 'open' | 'merged' | 'closed' | 'all';

/** The repository of one project, as the agents' tools read it. */
export type RepositoryReader = {
  /** Which repository it is, for the agent's context. */
  repository: { path: string; name: string; defaultBranch: string | null };
  /** The entries of a folder, folders first; undefined if the folder or the ref does not exist. */
  tree(
    path: string,
    ref?: string,
  ): Promise<{ entries: RepositoryEntry[]; more: boolean } | undefined>;
  /** A file; undefined if it does not exist at that ref. */
  file(path: string, ref?: string): Promise<RepositoryFile | undefined>;
  issues(options: { state: IssueState; search?: string }): Promise<RepositoryIssue[]>;
  issue(number: number): Promise<{ issue: RepositoryIssue; notes: RepositoryNote[] } | undefined>;
  mergeRequests(options: { state: MergeRequestState }): Promise<RepositoryMergeRequest[]>;
  mergeRequest(number: number): Promise<
    | {
        mergeRequest: RepositoryMergeRequest;
        diffs: RepositoryDiff[];
        /** The merge request changes more files than were read. */
        moreDiffs: boolean;
        notes: RepositoryNote[];
      }
    | undefined
  >;
};

const personSchema = z.object({ name: z.string().nullish(), username: z.string().nullish() });
const nameOf = (person: z.infer<typeof personSchema> | null | undefined) =>
  person?.name || person?.username || '';

const entrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  type: z.string(),
});

const fileSchema = z.object({
  file_path: z.string().min(1),
  size: z.number().min(0),
  encoding: z.string(),
  content: z.string(),
});

const issueSchema = z.object({
  iid: z.number().int(),
  title: z.string(),
  state: z.string(),
  description: z.string().nullish(),
  labels: z.array(z.unknown()).nullish(),
  assignees: z.array(personSchema.nullish()).nullish(),
  author: personSchema.nullish(),
  updated_at: z.string().nullish(),
});

const noteSchema = z.object({
  body: z.string(),
  system: z.boolean().nullish(),
  author: personSchema.nullish(),
  created_at: z.string().nullish(),
});

const mergeRequestSchema = z.object({
  iid: z.number().int(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean().nullish(),
  description: z.string().nullish(),
  source_branch: z.string(),
  target_branch: z.string(),
  author: personSchema.nullish(),
  updated_at: z.string().nullish(),
});

const diffSchema = z.object({
  old_path: z.string(),
  new_path: z.string(),
  new_file: z.boolean().nullish(),
  deleted_file: z.boolean().nullish(),
  renamed_file: z.boolean().nullish(),
  diff: z.string().nullish(),
});

/** The entries of a list that have the form expected; the others are left out. */
function listOf<T>(answer: unknown, schema: z.ZodType<T>): T[] {
  const list = z.array(z.unknown()).safeParse(answer);
  if (!list.success) throw new GitlabError(502, 'GitLab sent no list');
  return list.data.flatMap((entry) => {
    const parsed = schema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function toIssue(issue: z.infer<typeof issueSchema>): RepositoryIssue {
  return {
    number: issue.iid,
    title: issue.title,
    state: issue.state,
    description: issue.description ?? '',
    labels: (issue.labels ?? []).filter((label): label is string => typeof label === 'string'),
    assignees: (issue.assignees ?? []).map(nameOf).filter(Boolean),
    author: nameOf(issue.author),
    updatedAt: issue.updated_at ?? null,
  };
}

function toMergeRequest(request: z.infer<typeof mergeRequestSchema>): RepositoryMergeRequest {
  return {
    number: request.iid,
    title: request.title,
    state: request.state,
    draft: request.draft === true,
    sourceBranch: request.source_branch,
    targetBranch: request.target_branch,
    description: request.description ?? '',
    author: nameOf(request.author),
    updatedAt: request.updated_at ?? null,
  };
}

/** What people wrote, without the notes GitLab adds itself ("changed the description"). */
function toNotes(answer: unknown): RepositoryNote[] {
  return listOf(answer, noteSchema)
    .filter((note) => note.system !== true)
    .slice(0, MAX_NOTES)
    .map((note) => ({
      author: nameOf(note.author),
      body: note.body,
      createdAt: note.created_at ?? null,
    }));
}

/** A path as people and models write it: without slashes around it and without "./". */
export function cleanPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.?\/)+/, '')
    .replace(/\/+$/, '');
}

/** Whether the bytes look like text: no NUL byte in the first stretch. */
function looksLikeText(content: Buffer): boolean {
  return !content.subarray(0, 8000).includes(0);
}

const ISSUE_STATES: Record<IssueState, string> = { open: 'opened', closed: 'closed', all: 'all' };
const MERGE_REQUEST_STATES: Record<MergeRequestState, string> = {
  open: 'opened',
  merged: 'merged',
  closed: 'closed',
  all: 'all',
};

export type RepositoryReaders = (projectId: string) => Promise<RepositoryReader | undefined>;

/**
 * Gives the reader of a project's repository; undefined while the project has no connection or
 * no repository picked. Every call of a reader takes the token from the store, which renews it
 * when it is about to end; a connection that ended meanwhile is a `RepositoryGoneError`.
 */
export function repositoryReaders({
  admin,
  client,
  connections,
}: {
  /** Role covibes_admin: the worker reads which repository a project is connected to. */
  admin: Kysely<DB>;
  client: Pick<GitlabClient, 'get'>;
  connections: Pick<GitConnections, 'access'>;
}): RepositoryReaders {
  return async (projectId) => {
    const row = await admin
      .selectFrom('git_connections')
      .select(['repository_id', 'repository_path', 'repository_name', 'repository_default_branch'])
      .where('project_id', '=', projectId)
      .executeTakeFirst();
    if (!row || row.repository_id === null || !row.repository_path || !row.repository_name) {
      return undefined;
    }
    const id = row.repository_id;
    const defaultBranch = row.repository_default_branch;

    /** One reading call for this repository; the answer as JSON. */
    async function get(path: string, query: Record<string, string> = {}): Promise<unknown> {
      const access = await connections.access(projectId);
      if (!access) throw new RepositoryGoneError();
      const search = new URLSearchParams(query).toString();
      return await client.get(
        access.baseUrl,
        `/projects/${id}${path}${search ? `?${search}` : ''}`,
        access.token,
      );
    }

    /** The same, with "not there" as undefined instead of an error. */
    async function find(path: string, query: Record<string, string> = {}): Promise<unknown> {
      try {
        return await get(path, query);
      } catch (error) {
        if (error instanceof GitlabError && error.status === 404) return undefined;
        throw error;
      }
    }

    const refOf = (ref: string | undefined) => ref?.trim() || defaultBranch || 'HEAD';

    return {
      repository: { path: row.repository_path, name: row.repository_name, defaultBranch },

      async tree(path, ref) {
        const folder = cleanPath(path);
        const entries: RepositoryEntry[] = [];
        let more = false;
        // GitLab hands a folder out in pages; two of them are the most that is shown.
        for (let page = 1; page <= MAX_TREE_ENTRIES / PAGE; page += 1) {
          const answer = await find('/repository/tree', {
            ...(folder ? { path: folder } : {}),
            ref: refOf(ref),
            per_page: String(PAGE),
            page: String(page),
          });
          if (answer === undefined) return undefined;
          const list = listOf(answer, entrySchema);
          entries.push(
            ...list.map((entry): RepositoryEntry => ({
              name: entry.name,
              path: entry.path,
              kind: entry.type === 'tree' ? 'folder' : 'file',
            })),
          );
          more = list.length === PAGE;
          if (!more) break;
        }
        // GitLab answers an unknown folder with an empty list; the root is the only folder that
        // may be empty for real.
        if (entries.length === 0 && folder !== '') return undefined;
        entries.sort(
          (a, b) =>
            Number(b.kind === 'folder') - Number(a.kind === 'folder') ||
            a.name.localeCompare(b.name),
        );
        return { entries, more };
      },

      async file(path, ref) {
        const answer = await find(`/repository/files/${encodeURIComponent(cleanPath(path))}`, {
          ref: refOf(ref),
        });
        if (answer === undefined) return undefined;
        const parsed = fileSchema.safeParse(answer);
        if (!parsed.success) throw new GitlabError(502, 'GitLab sent no file');
        const { file_path, size, encoding, content } = parsed.data;
        if (size > MAX_FILE_BYTES) {
          return { kind: 'unreadable', path: file_path, size, reason: 'too_large' };
        }
        const bytes = Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf8');
        if (!looksLikeText(bytes)) {
          return { kind: 'unreadable', path: file_path, size, reason: 'binary' };
        }
        return { kind: 'text', path: file_path, size, text: bytes.toString('utf8') };
      },

      async issues({ state, search }) {
        const answer = await get('/issues', {
          state: ISSUE_STATES[state],
          order_by: 'updated_at',
          sort: 'desc',
          per_page: String(MAX_LISTED),
          ...(search?.trim() ? { search: search.trim() } : {}),
        });
        return listOf(answer, issueSchema).slice(0, MAX_LISTED).map(toIssue);
      },

      async issue(number) {
        const answer = await find(`/issues/${String(number)}`);
        const parsed = issueSchema.safeParse(answer);
        if (answer === undefined || !parsed.success) return undefined;
        const notes = await get(`/issues/${String(number)}/notes`, {
          sort: 'asc',
          per_page: String(PAGE),
        });
        return { issue: toIssue(parsed.data), notes: toNotes(notes) };
      },

      async mergeRequests({ state }) {
        const answer = await get('/merge_requests', {
          state: MERGE_REQUEST_STATES[state],
          order_by: 'updated_at',
          sort: 'desc',
          per_page: String(MAX_LISTED),
        });
        return listOf(answer, mergeRequestSchema).slice(0, MAX_LISTED).map(toMergeRequest);
      },

      async mergeRequest(number) {
        const answer = await find(`/merge_requests/${String(number)}`);
        const parsed = mergeRequestSchema.safeParse(answer);
        if (answer === undefined || !parsed.success) return undefined;
        const [diffs, notes] = await Promise.all([
          // One more than is read tells whether there are more.
          get(`/merge_requests/${String(number)}/diffs`, { per_page: String(MAX_DIFFS + 1) }),
          get(`/merge_requests/${String(number)}/notes`, { sort: 'asc', per_page: String(PAGE) }),
        ]);
        const changed = listOf(diffs, diffSchema);
        return {
          mergeRequest: toMergeRequest(parsed.data),
          diffs: changed.slice(0, MAX_DIFFS).map((entry): RepositoryDiff => ({
            path: entry.new_path,
            previousPath: entry.renamed_file ? entry.old_path : null,
            change: entry.new_file
              ? 'added'
              : entry.deleted_file
                ? 'deleted'
                : entry.renamed_file
                  ? 'renamed'
                  : 'changed',
            diff: entry.diff ?? '',
          })),
          moreDiffs: changed.length > MAX_DIFFS,
          notes: toNotes(notes),
        };
      },
    };
  };
}
