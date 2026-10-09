import { z } from 'zod';

import { GitlabError, type GitlabClient } from '@server/integrations/gitlab/client';

// The merge requests of a repository as merging needs them (spec 29d): what they are, whether
// they can be merged as they are, and their last commit. The agents' tools read merge requests
// through `repository.ts`; this is for the list people merge from, and for the merge itself.

/** Open merge requests the list shows at most, the latest changed first. */
export const MAX_OPEN_MERGE_REQUESTS = 50;

export type GitlabMergeRequest = {
  number: number;
  title: string;
  /** `opened`, `merged`, `closed` or `locked`, as GitLab names it. */
  state: string;
  url: string;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  updatedAt: string | null;
  draft: boolean;
  conflicts: boolean;
  /** Its last commit; null if GitLab named none. */
  sha: string | null;
};

/** An address the web app may link to: nothing but a page on the web. */
const pageUrl = z.string().regex(/^https?:\/\//i);

const mergeRequestSchema = z.object({
  iid: z.number().int().positive(),
  title: z.string(),
  state: z.string(),
  web_url: pageUrl,
  source_branch: z.string(),
  target_branch: z.string(),
  author: z.object({ name: z.string().nullish(), username: z.string().nullish() }).nullish(),
  updated_at: z.string().nullish(),
  draft: z.boolean().nullish(),
  work_in_progress: z.boolean().nullish(),
  has_conflicts: z.boolean().nullish(),
  sha: z.string().nullish(),
});

function toMergeRequest(entry: z.infer<typeof mergeRequestSchema>): GitlabMergeRequest {
  return {
    number: entry.iid,
    title: entry.title,
    state: entry.state,
    url: entry.web_url,
    sourceBranch: entry.source_branch,
    targetBranch: entry.target_branch,
    author: entry.author?.name || entry.author?.username || '',
    updatedAt: entry.updated_at ?? null,
    // Older GitLabs call a draft "work in progress".
    draft: entry.draft ?? entry.work_in_progress ?? false,
    conflicts: entry.has_conflicts ?? false,
    sha: entry.sha || null,
  };
}

/** A merge request as GitLab answered it; undefined if the answer is none. */
export function readMergeRequestAnswer(answer: unknown): GitlabMergeRequest | undefined {
  const parsed = mergeRequestSchema.safeParse(answer);
  return parsed.success ? toMergeRequest(parsed.data) : undefined;
}

type Target = { baseUrl: string; repositoryId: number };

/** The open merge requests of a repository, the latest changed first. */
export async function listOpenMergeRequests(
  client: Pick<GitlabClient, 'get'>,
  target: Target,
  token: string,
): Promise<GitlabMergeRequest[]> {
  const query = new URLSearchParams({
    state: 'opened',
    order_by: 'updated_at',
    sort: 'desc',
    per_page: String(MAX_OPEN_MERGE_REQUESTS),
  });
  const answer = z
    .array(z.unknown())
    .safeParse(
      await client.get(
        target.baseUrl,
        `/projects/${String(target.repositoryId)}/merge_requests?${query.toString()}`,
        token,
      ),
    );
  if (!answer.success) throw new GitlabError(502, 'GitLab sent no list of merge requests');
  // An entry GitLab words differently is left out instead of failing the whole list.
  return answer.data.flatMap((entry) => {
    const mergeRequest = readMergeRequestAnswer(entry);
    return mergeRequest ? [mergeRequest] : [];
  });
}

/** One merge request by its number; undefined if the repository has none of that number. */
export async function readMergeRequest(
  client: Pick<GitlabClient, 'get'>,
  target: Target,
  token: string,
  number: number,
): Promise<GitlabMergeRequest | undefined> {
  try {
    return readMergeRequestAnswer(
      await client.get(
        target.baseUrl,
        `/projects/${String(target.repositoryId)}/merge_requests/${String(number)}`,
        token,
      ),
    );
  } catch (error) {
    if (error instanceof GitlabError && error.status === 404) return undefined;
    throw error;
  }
}
