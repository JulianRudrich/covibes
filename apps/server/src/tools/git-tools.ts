import { MAX_MILESTONES } from '@covibes/shared';
import { z } from 'zod';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import type { AgentGitRequests } from '@server/git/agent-requests';
import { decideGit } from '@server/rules/decide';

// The tools with which an agent proposes changes to the project's repository (spec 29e). None of
// them changes the repository: each makes a Git request that waits for approval by a person, as
// the rule engine has it for every changing Git action.

/** The names of the Git tools, as the catalog lists them for an agent. */
export const GIT_TOOLS = ['propose_issues', 'propose_plan_merge_request', 'propose_merge'] as const;

/** What every answer about a request that was made ends with. */
const WAITS =
  'It waits for approval under "Wartet auf dich"; nothing changes in the repository before someone who may approve Git actions approves it. Say so in your answer, and do not say that anything was created or merged.';

const NO_REPOSITORY = 'Nothing was requested: the project has no repository any more.';
const UNREACHABLE =
  'Nothing was requested: the repository could not be read right now. Say so, and that it can be tried again later.';

/** The rule engine's word on a changing Git action; an agent without the tool is refused. */
function toQueue(): void {
  if (decideGit({ allowed: true }).kind === 'reject') {
    throw new Error('This tool is not allowed for you.');
  }
}

const count = (number: number, one: string, many: string) =>
  `${String(number)} ${number === 1 ? one : many}`;

/**
 * `propose_issues`, `propose_plan_merge_request` and `propose_merge`: the moderator hands the
 * plan over to the repository, as requests that wait for approval.
 */
export function gitTools(git: AgentGitRequests): AgentTool[] {
  const { path } = git.repository;
  return [
    defineTool({
      name: 'propose_issues',
      description:
        "Proposes issues in the repository for the tasks of the project plan that have none yet: one issue per task, grouped by the plan's milestones. It only makes a request that waits for approval by a person; no issue exists before that. Use it when someone asks you to create the issues or to hand the plan over.",
      input: {
        milestone: z
          .number()
          .int()
          .min(1)
          .max(MAX_MILESTONES)
          .optional()
          .describe(
            'The number of one milestone of the plan, to propose only its issues; leave it out for all milestones',
          ),
      },
      run: async ({ milestone }) => {
        toQueue();
        const result = await git.issues(milestone === undefined ? {} : { milestone });
        switch (result.outcome) {
          case 'requested':
            return `Request made: ${count(result.issues, 'issue', 'issues')} in ${count(result.milestones, 'milestone', 'milestones')} for the repository ${path}. ${WAITS}`;
          case 'none':
            return 'Nothing was requested: every task in question has an issue already, or a request for it waits for approval.';
          case 'no_tasks':
            return 'Nothing was requested: the plan names no tasks there yet. Tasks are the list items below the milestones of the plan.';
          case 'no_milestone':
            return 'Nothing was requested: the plan has no milestone with that number.';
          case 'no_repository':
            return NO_REPOSITORY;
        }
      },
    }),
    defineTool({
      name: 'propose_plan_merge_request',
      description:
        'Proposes a merge request that brings the plan package into the repository: CLAUDE.md, AGENTS.md, the context files, a feature spec per task and the diagrams, as one commit on a branch of its own. It only makes a request that waits for approval by a person; nothing is committed before that. Use it when someone asks you to bring the plan into the repository or to hand it over to coding agents.',
      input: {},
      run: async () => {
        toQueue();
        const result = await git.planMergeRequest();
        switch (result.outcome) {
          case 'requested':
            return `Request made: a merge request with the plan package for the repository ${path} (${count(result.added, 'new file', 'new files')}, ${count(result.changed, 'changed file', 'changed files')}). ${WAITS}`;
          case 'up_to_date':
            return 'Nothing was requested: the repository holds the plan package already, as it is right now.';
          case 'waiting':
            return 'Nothing was requested: a request for the plan package waits already. It is approved or rejected under "Wartet auf dich" first.';
          case 'no_plan':
            return 'Nothing was requested: the project plan is still empty, so there is no package.';
          case 'too_large':
            return 'Nothing was requested: the plan package is too large for one merge request.';
          case 'no_branch':
            return 'Nothing was requested: the repository has no default branch yet (it is empty). Someone has to make a first commit there.';
          case 'unreachable':
            return UNREACHABLE;
          case 'no_repository':
            return NO_REPOSITORY;
        }
      },
    }),
    defineTool({
      name: 'propose_merge',
      description:
        'Proposes to merge an open merge request of the repository. It only makes a request that waits for approval by a person; nothing is merged before that, and GitLab decides whether it can be merged at all. Use it when someone asks you to merge a merge request; look at it with read_merge_request first if you do not know it.',
      input: {
        number: z
          .number()
          .int()
          .positive()
          .describe('The number of the merge request, e.g. 7 for "!7"'),
      },
      run: async ({ number }) => {
        toQueue();
        const result = await git.merge(number);
        const name = `!${String(number)}`;
        switch (result.outcome) {
          case 'requested':
            return `Request made: merging ${name} "${result.title}" in the repository ${path}, as it is right now. ${WAITS}`;
          case 'not_found':
            return `Nothing was requested: the repository has no merge request ${name}.`;
          case 'not_open':
            return `Nothing was requested: ${name} is not open any more.`;
          case 'draft':
            return `Nothing was requested: ${name} is a draft. Whoever works on it marks it as ready first.`;
          case 'waiting':
            return `Nothing was requested: a request to merge ${name} waits already.`;
          case 'unreachable':
            return UNREACHABLE;
          case 'no_repository':
            return NO_REPOSITORY;
        }
      },
    }),
  ];
}
