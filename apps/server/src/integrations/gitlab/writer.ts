import { z } from 'zod';

import {
  RepositoryWriteError,
  type RepositoryWriteFailure,
  type RepositoryWriter,
} from '@server/integrations/git-host';
import { GitlabError, type GitlabClient } from '@server/integrations/gitlab/client';

// Writing to a repository in GitLab (spec 29b): milestones and issues, with one person's token.
// Only the job of an approved Git request calls it. Every answer is checked.

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

/** What kind of failure a status of GitLab is. */
function failureOf(status: number): RepositoryWriteFailure {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 409 || status === 422) return 'invalid';
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
  };
}
