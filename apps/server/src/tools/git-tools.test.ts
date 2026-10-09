import { describe, expect, it, vi } from 'vitest';

import type { AgentTool } from '@server/ai-gateway';
import type {
  AgentGitRequests,
  IssuesProposal,
  MergeProposal,
  PackageProposal,
} from '@server/git/agent-requests';
import { decideGit } from '@server/rules/decide';
import { GIT_TOOLS, gitTools } from '@server/tools/git-tools';

// The moderator's tools for the repository (spec 29e), with a scripted project.

function setUp(
  answers: { issues?: IssuesProposal; package?: PackageProposal; merge?: MergeProposal } = {},
) {
  const git = {
    repository: { path: 'verein/app' },
    issues: vi.fn<AgentGitRequests['issues']>(() =>
      Promise.resolve(answers.issues ?? { outcome: 'requested', issues: 12, milestones: 3 }),
    ),
    planMergeRequest: vi.fn<AgentGitRequests['planMergeRequest']>(() =>
      Promise.resolve(answers.package ?? { outcome: 'requested', added: 41, changed: 1 }),
    ),
    merge: vi.fn<AgentGitRequests['merge']>(() =>
      Promise.resolve(
        answers.merge ?? { outcome: 'requested', number: 7, title: 'Login per Link' },
      ),
    ),
  };
  const tools = gitTools(git);
  const tool = (name: string): AgentTool => {
    const found = tools.find((entry) => entry.name === name);
    if (!found) throw new Error(`${name} is missing`);
    return found;
  };
  return { git, tools, tool };
}

const WAITS =
  'It waits for approval under "Wartet auf dich"; nothing changes in the repository before someone who may approve Git actions approves it.';

describe('decideGit', () => {
  it('sends every changing Git action of an agent to the approval queue', () => {
    expect(decideGit({ allowed: true })).toEqual({ kind: 'approval' });
  });

  it('refuses an agent that may not use the tool', () => {
    expect(decideGit({ allowed: false })).toEqual({ kind: 'reject' });
  });
});

describe('the Git tools', () => {
  it('are the three the catalog names', () => {
    const { tools } = setUp();

    expect(tools.map((tool) => tool.name)).toEqual([...GIT_TOOLS]);
    expect(tools.map((tool) => tool.name)).toEqual([
      'propose_issues',
      'propose_plan_merge_request',
      'propose_merge',
    ]);
    // Every description says that it only makes a request.
    for (const tool of tools) expect(tool.description).toContain('waits for approval');
  });
});

describe('propose_issues', () => {
  it('asks for the issues of the whole plan, or of one milestone, and says that they wait', async () => {
    const { git, tool } = setUp();

    const all = await tool('propose_issues').run({});
    await tool('propose_issues').run({ milestone: 2 });

    expect(git.issues.mock.calls).toEqual([[{}], [{ milestone: 2 }]]);
    expect(all).toContain('Request made: 12 issues in 3 milestones for the repository verein/app.');
    expect(all).toContain(WAITS);
    expect(all).toContain('do not say that anything was created or merged');
  });

  it('counts one issue and one milestone as one', async () => {
    const { tool } = setUp({ issues: { outcome: 'requested', issues: 1, milestones: 1 } });

    expect(await tool('propose_issues').run({})).toContain('1 issue in 1 milestone');
  });

  it('passes on why nothing was requested', async () => {
    const said = async (outcome: Exclude<IssuesProposal['outcome'], 'requested'>) =>
      setUp({ issues: { outcome } }).tool('propose_issues').run({});

    expect(await said('none')).toContain('every task in question has an issue already');
    expect(await said('no_tasks')).toContain('the plan names no tasks there yet');
    expect(await said('no_milestone')).toContain('no milestone with that number');
    expect(await said('no_repository')).toContain('no repository any more');
    for (const outcome of ['none', 'no_tasks', 'no_milestone', 'no_repository'] as const) {
      expect(await said(outcome)).toMatch(/^Nothing was requested:/);
    }
  });

  it('takes no milestone that a plan cannot have', async () => {
    const { git, tool } = setUp();

    await expect(tool('propose_issues').run({ milestone: 0 })).rejects.toThrow();
    await expect(tool('propose_issues').run({ milestone: 2.5 })).rejects.toThrow();
    await expect(tool('propose_issues').run({ milestone: 'zwei' })).rejects.toThrow();
    expect(git.issues).not.toHaveBeenCalled();
  });
});

describe('propose_plan_merge_request', () => {
  it('asks for the merge request of the package and says what it holds', async () => {
    const { git, tool } = setUp();

    const said = await tool('propose_plan_merge_request').run({});

    expect(git.planMergeRequest).toHaveBeenCalledTimes(1);
    expect(said).toContain(
      'Request made: a merge request with the plan package for the repository verein/app (41 new files, 1 changed file).',
    );
    expect(said).toContain(WAITS);
  });

  it('passes on why nothing was requested', async () => {
    const said = async (outcome: Exclude<PackageProposal['outcome'], 'requested'>) =>
      setUp({ package: { outcome } }).tool('propose_plan_merge_request').run({});

    expect(await said('up_to_date')).toContain('holds the plan package already');
    expect(await said('waiting')).toContain('a request for the plan package waits already');
    expect(await said('no_plan')).toContain('the project plan is still empty');
    expect(await said('too_large')).toContain('too large for one merge request');
    expect(await said('no_branch')).toContain('no default branch yet');
    expect(await said('unreachable')).toContain('could not be read right now');
    expect(await said('no_repository')).toContain('no repository any more');
  });
});

describe('propose_merge', () => {
  it('asks to merge a merge request by its number', async () => {
    const { git, tool } = setUp();

    const said = await tool('propose_merge').run({ number: 7 });

    expect(git.merge).toHaveBeenCalledWith(7);
    expect(said).toContain(
      'Request made: merging !7 "Login per Link" in the repository verein/app, as it is right now.',
    );
    expect(said).toContain(WAITS);
  });

  it('passes on why nothing was requested, and needs a number', async () => {
    const said = async (outcome: Exclude<MergeProposal['outcome'], 'requested'>) =>
      setUp({ merge: { outcome } }).tool('propose_merge').run({ number: 7 });

    expect(await said('not_found')).toContain('has no merge request !7');
    expect(await said('not_open')).toContain('!7 is not open any more');
    expect(await said('draft')).toContain('!7 is a draft');
    expect(await said('waiting')).toContain('a request to merge !7 waits already');
    expect(await said('unreachable')).toContain('could not be read right now');
    expect(await said('no_repository')).toContain('no repository any more');
    const { git, tool } = setUp();
    await expect(tool('propose_merge').run({})).rejects.toThrow();
    await expect(tool('propose_merge').run({ number: -1 })).rejects.toThrow();
    expect(git.merge).not.toHaveBeenCalled();
  });
});
