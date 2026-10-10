import { z } from 'zod';

import { GitlabError, type GitlabClient } from '@server/integrations/gitlab/client';

// The state of issues in a repository (spec 30a): after the handover GitLab owns the status of a
// task, and Covibes reads whether its issue is open or closed.

export type IssueState = 'opened' | 'closed';

/** GitLab answers for at most this many issues per call. */
const PAGE = 100;

const issueSchema = z.object({ iid: z.number().int().positive(), state: z.string() });

/**
 * Whether the issues with these numbers are open or closed. An issue GitLab does not answer for
 * (it was deleted or moved) is left out.
 */
export async function readIssueStates(
  client: Pick<GitlabClient, 'get'>,
  target: { baseUrl: string; repositoryId: number },
  token: string,
  numbers: readonly number[],
): Promise<Map<number, IssueState>> {
  const states = new Map<number, IssueState>();
  for (let start = 0; start < numbers.length; start += PAGE) {
    const query = new URLSearchParams({ state: 'all', per_page: String(PAGE) });
    for (const number of numbers.slice(start, start + PAGE)) {
      query.append('iids[]', String(number));
    }
    const answer = z
      .array(z.unknown())
      .safeParse(
        await client.get(
          target.baseUrl,
          `/projects/${String(target.repositoryId)}/issues?${query.toString()}`,
          token,
        ),
      );
    if (!answer.success) throw new GitlabError(502, 'GitLab sent no list of issues');
    for (const entry of answer.data) {
      const issue = issueSchema.safeParse(entry);
      if (issue.success) {
        states.set(issue.data.iid, issue.data.state === 'closed' ? 'closed' : 'opened');
      }
    }
  }
  return states;
}
