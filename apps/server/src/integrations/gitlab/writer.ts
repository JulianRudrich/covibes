import { z } from 'zod';

import {
  RepositoryWriteError,
  type RepositoryWriteFailure,
  type RepositoryWriter,
} from '@server/integrations/git-host';
import { fileStates, foldersOf, listBlobs } from '@server/integrations/gitlab/blobs';
import { GitlabError, type GitlabClient } from '@server/integrations/gitlab/client';
import {
  readMergeRequest,
  readMergeRequestAnswer,
} from '@server/integrations/gitlab/merge-requests';

// Writing to a repository in GitLab (specs 29b and 29c): milestones, issues, commits and merge
// requests, with one person's token. Only the job of an approved Git request calls it. Every
// answer is checked.

/** An address the web app may link to: nothing but a page on the web. */
const pageUrl = z.string().regex(/^https?:\/\//i);

const milestoneSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  // A milestone is used by its id; without an address to show, it has no link.
  web_url: pageUrl.nullish().catch(null),
});

const issueSchema = z.object({
  iid: z.number().int().positive(),
  web_url: pageUrl,
  description: z.string().nullish(),
});

const commitSchema = z.object({
  id: z.string().min(1),
  web_url: pageUrl.nullish().catch(null),
});

const mergeRequestSchema = z.object({
  iid: z.number().int().positive(),
  web_url: pageUrl,
});

/** A refusal of our own, worded like one of GitLab so it reaches the log the same way. */
const refuse = (reason: string) => new GitlabError(400, reason, reason);

/** What kind of failure a status of GitLab is. */
function failureOf(status: number): RepositoryWriteFailure {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  // What was sent is not taken as it is: also when it is too large, and when a merge request
  // cannot be merged as it is (405, 406).
  if ([400, 405, 406, 409, 413, 422].includes(status)) return 'invalid';
  // Not reachable at all, asked to wait, or a fault of its own: a later try may work.
  if (status === 0 || status === 429 || status >= 500) return 'unreachable';
  return 'failed';
}

/** The reason GitLab gave, as one line: its `message` or `error`, however it worded them. */
function reasonOf(body: string): string {
  let reason: unknown = body;
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown } | null;
    reason = parsed?.message ?? parsed?.error ?? body;
  } catch {
    // No JSON, or cut off: the text as it is.
  }
  const text = typeof reason === 'string' ? reason : JSON.stringify(reason);
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Runs a call and words a failure of GitLab as one of a repository. */
async function written<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof GitlabError)) throw error;
    throw new RepositoryWriteError(failureOf(error.status), reasonOf(error.body));
  }
}

/** The writer of one repository in GitLab, with one person's access token. */
export function gitlabWriter(
  client: GitlabClient,
  target: { baseUrl: string; repositoryId: number },
  token: string,
): RepositoryWriter {
  const base = `/projects/${String(target.repositoryId)}`;

  return {
    ensureMilestone({ title, description }) {
      return written(async () => {
        // A milestone of the group counts too: GitLab takes no second one of its title.
        const query = new URLSearchParams({ title, include_ancestors: 'true', per_page: '20' });
        const listed = z
          .array(z.unknown())
          .safeParse(
            await client.get(target.baseUrl, `${base}/milestones?${query.toString()}`, token),
          );
        const existing = (listed.success ? listed.data : [])
          .flatMap((entry) => {
            const milestone = milestoneSchema.safeParse(entry);
            return milestone.success ? [milestone.data] : [];
          })
          .find((milestone) => milestone.title === title);
        if (existing) return { id: existing.id, url: existing.web_url ?? null, existed: true };

        const created = milestoneSchema.safeParse(
          await client.post(target.baseUrl, `${base}/milestones`, token, { title, description }),
        );
        if (!created.success) throw new GitlabError(502, 'GitLab sent no milestone');
        return { id: created.data.id, url: created.data.web_url ?? null, existed: false };
      });
    },

    createIssue({ title, description, milestoneId }) {
      return written(async () => {
        const created = issueSchema.safeParse(
          await client.post(target.baseUrl, `${base}/issues`, token, {
            title,
            description,
            ...(milestoneId === null ? {} : { milestone_id: milestoneId }),
          }),
        );
        if (!created.success) throw new GitlabError(502, 'GitLab sent no issue');
        return { number: created.data.iid, url: created.data.web_url };
      });
    },

    findIssue(mark) {
      return written(async () => {
        const query = new URLSearchParams({ search: mark, in: 'description', per_page: '20' });
        const listed = z
          .array(z.unknown())
          .safeParse(await client.get(target.baseUrl, `${base}/issues?${query.toString()}`, token));
        const found = (listed.success ? listed.data : [])
          .flatMap((entry) => {
            const issue = issueSchema.safeParse(entry);
            return issue.success ? [issue.data] : [];
          })
          // The search is GitLab's; whether the mark is really there is checked here.
          .find((issue) => issue.description?.includes(mark));
        return found ? { number: found.iid, url: found.web_url } : undefined;
      });
    },

    commitFiles({ branch, startBranch, message, files }) {
      return written(async () => {
        const folders = foldersOf(files.map((file) => file.path));
        // A branch that is there already (a second run) is compared and continued; a new one
        // starts from the branch it will be merged into.
        const onBranch = await listBlobs(client, target, token, branch, folders);
        const held = onBranch ?? (await listBlobs(client, target, token, startBranch, folders));
        if (!held) throw refuse('The branch to start from does not exist');

        const states = fileStates(files, held);
        const actions = files.flatMap((file, index) => {
          const state = states[index]?.state;
          if (state !== 'new' && state !== 'changed') return [];
          return [
            {
              action: state === 'new' ? 'create' : 'update',
              file_path: file.path,
              content: file.content,
            },
          ];
        });
        if (actions.length === 0) {
          if (onBranch) return { url: null, added: 0, changed: 0, existed: true };
          throw refuse('Nothing to commit: the repository holds these files already');
        }

        const created = commitSchema.safeParse(
          await client.post(target.baseUrl, `${base}/repository/commits`, token, {
            branch,
            ...(onBranch ? {} : { start_branch: startBranch }),
            commit_message: message,
            actions,
          }),
        );
        if (!created.success) throw new GitlabError(502, 'GitLab sent no commit');
        const added = actions.filter((entry) => entry.action === 'create').length;
        return {
          url: created.data.web_url ?? null,
          added,
          changed: actions.length - added,
          existed: false,
        };
      });
    },

    openMergeRequest({ sourceBranch, targetBranch, title, description }) {
      return written(async () => {
        const query = new URLSearchParams({
          state: 'opened',
          source_branch: sourceBranch,
          target_branch: targetBranch,
          per_page: '5',
        });
        const listed = z
          .array(z.unknown())
          .safeParse(
            await client.get(target.baseUrl, `${base}/merge_requests?${query.toString()}`, token),
          );
        const open = (listed.success ? listed.data : []).flatMap((entry) => {
          const mergeRequest = mergeRequestSchema.safeParse(entry);
          return mergeRequest.success ? [mergeRequest.data] : [];
        })[0];
        if (open) return { number: open.iid, url: open.web_url, existed: true };

        const created = mergeRequestSchema.safeParse(
          await client.post(target.baseUrl, `${base}/merge_requests`, token, {
            source_branch: sourceBranch,
            target_branch: targetBranch,
            title,
            description,
            remove_source_branch: true,
          }),
        );
        if (!created.success) throw new GitlabError(502, 'GitLab sent no merge request');
        return { number: created.data.iid, url: created.data.web_url, existed: false };
      });
    },

    mergeMergeRequest({ number, sha }) {
      return written(async () => {
        const found = await readMergeRequest(client, target, token, number);
        if (!found) throw new GitlabError(404, 'No such merge request', 'No such merge request');
        if (found.state === 'merged') {
          return { number: found.number, url: found.url, existed: true };
        }
        if (found.state !== 'opened') throw refuse('The merge request is closed');

        const merged = readMergeRequestAnswer(
          await client.put(
            target.baseUrl,
            `${base}/merge_requests/${String(number)}/merge`,
            token,
            {
              // GitLab refuses if the merge request got another last commit since.
              ...(sha === null ? {} : { sha }),
              should_remove_source_branch: true,
            },
          ),
        );
        if (!merged) throw new GitlabError(502, 'GitLab sent no merge request');
        return { number: merged.number, url: merged.url, existed: false };
      });
    },
  };
}
