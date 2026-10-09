import { describe, expect, it } from 'vitest';

import { packageSpecRefs } from './coding-package';
import { buildIssueActions, gitIssueMark } from './git-issues';
import {
  approveGitRequestsInputSchema,
  gitActionDraftSchema,
  gitIssuesInputSchema,
  MAX_GIT_ISSUES,
} from './git-requests';
import type { Roadmap } from './plan-roadmap';

const SETUP = '7c000000-0000-4000-8000-000000000011';
const LOGIN = '7c000000-0000-4000-8000-000000000012';
const LIST = '7c000000-0000-4000-8000-000000000021';
const OLGA = '7c000000-0000-4000-8000-000000000001';

const ROADMAP: Roadmap = {
  milestones: [
    {
      number: 1,
      title: 'Grundgerüst',
      goal: 'Die App läuft und man kann sich anmelden.',
      duration: { text: '3 Wochen', weeks: 3 },
      tasks: [
        { id: SETUP, text: 'Projekt aufsetzen', assignee: null },
        {
          id: LOGIN,
          text: 'Login per E-Mail-Link bauen',
          assignee: { userId: OLGA, name: 'Olga' },
        },
        { id: null, text: 'Noch ohne Kennung', assignee: null },
      ],
    },
    {
      number: 2,
      title: 'Mitgliederverwaltung',
      goal: '',
      duration: null,
      tasks: [{ id: LIST, text: 'Mitgliederliste im Frontend bauen', assignee: null }],
    },
    { number: 3, title: 'Leer', goal: '', duration: null, tasks: [] },
  ],
};

const REPOSITORY = { url: 'https://gitlab.example.com/verein/app', defaultBranch: 'main' };

function build(
  taskIds: string[],
  overrides: Partial<Parameters<typeof buildIssueActions>[0]> = {},
) {
  return buildIssueActions({
    projectName: 'Vereins-App',
    language: 'de',
    roadmap: ROADMAP,
    taskIds: new Set(taskIds),
    repository: REPOSITORY,
    ...overrides,
  });
}

describe('packageSpecRefs', () => {
  it('names the spec of every task as the package does, numbered by milestone', () => {
    expect(packageSpecRefs(ROADMAP, 'de')).toEqual([
      { taskId: SETUP, number: '01-01', path: 'context/feature-specs/01-01-projekt-aufsetzen.md' },
      {
        taskId: LOGIN,
        number: '01-02',
        path: 'context/feature-specs/01-02-login-per-e-mail-link-bauen.md',
      },
      { taskId: null, number: '01-03', path: 'context/feature-specs/01-03-noch-ohne-kennung.md' },
      {
        taskId: LIST,
        number: '02-01',
        path: 'context/feature-specs/02-01-mitgliederliste-im-frontend-bauen.md',
      },
    ]);
  });
});

describe('buildIssueActions', () => {
  it('puts the milestone before its issues, in the order of the plan', () => {
    const actions = build([LIST, LOGIN, SETUP]);

    expect(actions.map((action) => [action.kind, action.payload.title])).toEqual([
      ['milestone', 'Meilenstein 1: Grundgerüst'],
      ['issue', 'Projekt aufsetzen'],
      ['issue', 'Login per E-Mail-Link bauen'],
      ['milestone', 'Meilenstein 2: Mitgliederverwaltung'],
      ['issue', 'Mitgliederliste im Frontend bauen'],
    ]);
    // Every action is one the server takes.
    for (const action of actions) expect(gitActionDraftSchema.safeParse(action).success).toBe(true);
  });

  it('leaves out milestones without a chosen task, and tasks without an id', () => {
    expect(build([LIST]).map((action) => action.payload.title)).toEqual([
      'Meilenstein 2: Mitgliederverwaltung',
      'Mitgliederliste im Frontend bauen',
    ]);
    expect(build([])).toEqual([]);
    expect(build(['7c000000-0000-4000-8000-000000000099'])).toEqual([]);
  });

  it('writes an issue with its task, milestone, goal, assignee, spec and "via Covibes"', () => {
    const [milestone, , login] = build([SETUP, LOGIN]);

    expect(milestone).toEqual({
      kind: 'milestone',
      payload: {
        title: 'Meilenstein 1: Grundgerüst',
        description: 'Die App läuft und man kann sich anmelden.',
      },
    });
    expect(login).toEqual({
      kind: 'issue',
      payload: {
        title: 'Login per E-Mail-Link bauen',
        milestone: 'Meilenstein 1: Grundgerüst',
        taskId: LOGIN,
        description: [
          'Login per E-Mail-Link bauen',
          '',
          '**Meilenstein:** Meilenstein 1: Grundgerüst  ',
          '**Ziel:** Die App läuft und man kann sich anmelden.  ',
          '**Zuständig:** Olga  ',
          '**Feature-Spec:** [`context/feature-specs/01-02-login-per-e-mail-link-bauen.md`](https://gitlab.example.com/verein/app/-/blob/main/context/feature-specs/01-02-login-per-e-mail-link-bauen.md)',
          '',
          '---',
          '',
          '*Angelegt via Covibes aus dem Projektplan von „Vereins-App“.*',
        ].join('\n'),
      },
    });
  });

  it('leaves out what a task does not have', () => {
    const [, issue] = build([LIST]);

    expect(issue?.payload.description).toBe(
      [
        'Mitgliederliste im Frontend bauen',
        '',
        '**Meilenstein:** Meilenstein 2: Mitgliederverwaltung  ',
        '**Feature-Spec:** [`context/feature-specs/02-01-mitgliederliste-im-frontend-bauen.md`](https://gitlab.example.com/verein/app/-/blob/main/context/feature-specs/02-01-mitgliederliste-im-frontend-bauen.md)',
        '',
        '---',
        '',
        '*Angelegt via Covibes aus dem Projektplan von „Vereins-App“.*',
      ].join('\n'),
    );
  });

  it('writes in the project’s language, and links to the default branch whatever its name', () => {
    const [milestone, issue] = build([LIST], {
      language: 'en',
      projectName: 'Club *App*',
      repository: { url: 'https://gitlab.example.com/verein/app/', defaultBranch: 'release/1.0 x' },
    });

    expect(milestone?.payload.title).toBe('Milestone 2: Mitgliederverwaltung');
    expect(issue?.payload.description).toContain(
      '**Milestone:** Milestone 2: Mitgliederverwaltung',
    );
    expect(issue?.payload.description).toContain(
      '(https://gitlab.example.com/verein/app/-/blob/release/1.0%20x/context/feature-specs/',
    );
    // A name cannot start markup in the note.
    expect(issue?.payload.description).toContain(
      '*Created via Covibes from the project plan of "Club \\*App\\*".*',
    );

    const [, headless] = build([LIST], { repository: { ...REPOSITORY, defaultBranch: null } });
    expect(headless?.payload.description).toContain('/-/blob/HEAD/context/feature-specs/');
  });

  it('cuts a title that is too long for an issue, and keeps the whole task in the text', () => {
    const long = `Aufgabe ${'sehr lang '.repeat(40)}`.trim();
    const [, issue] = build([SETUP], {
      roadmap: {
        milestones: [
          {
            number: 1,
            title: 'A',
            goal: '',
            duration: null,
            tasks: [{ id: SETUP, text: long, assignee: null }],
          },
        ],
      },
    });

    expect(issue?.payload.title).toHaveLength(255);
    expect(issue?.payload.title.endsWith('…')).toBe(true);
    expect(issue?.payload.description.startsWith(long)).toBe(true);
  });
});

describe('the inputs of Git requests', () => {
  it('take tasks and requests by their ids, within limits', () => {
    expect(gitIssuesInputSchema.safeParse({ taskIds: [SETUP] }).success).toBe(true);
    expect(gitIssuesInputSchema.safeParse({ taskIds: [] }).success).toBe(false);
    expect(gitIssuesInputSchema.safeParse({ taskIds: ['nope'] }).success).toBe(false);
    expect(
      gitIssuesInputSchema.safeParse({
        taskIds: Array.from({ length: MAX_GIT_ISSUES + 1 }, () => SETUP),
      }).success,
    ).toBe(false);
    expect(approveGitRequestsInputSchema.safeParse({ requestIds: [SETUP, LOGIN] }).success).toBe(
      true,
    );
    expect(approveGitRequestsInputSchema.safeParse({ requestIds: [] }).success).toBe(false);
    expect(approveGitRequestsInputSchema.safeParse({ requestIds: [SETUP], more: 1 }).success).toBe(
      false,
    );
  });

  it('give an action a mark of its own', () => {
    expect(gitIssueMark(SETUP)).toBe(`covibes-action:${SETUP}`);
  });
});
