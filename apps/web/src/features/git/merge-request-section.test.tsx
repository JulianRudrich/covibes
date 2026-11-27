import type { GitMergeRequestPlan } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MergeRequestSection } from '@web/features/git/merge-request-section';

const PROJECT = '9c6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const BASE = `/api/projects/${PROJECT}/git`;
const REQUEST = '9c000000-0000-4000-8000-000000000001';
const REPOSITORY_URL = 'https://gitlab.example.com/verein/vereins-app';

const PLAN: GitMergeRequestPlan = {
  repository: {
    id: 101,
    path: 'verein/vereins-app',
    name: 'Vereins-App',
    url: REPOSITORY_URL,
    defaultBranch: 'main',
  },
  canRequest: true,
  canApprove: true,
  hasAccount: true,
  files: [
    { path: 'CLAUDE.md', state: 'new' },
    { path: 'AGENTS.md', state: 'new' },
    { path: 'context/project-overview.md', state: 'changed' },
    { path: 'context/decisions.md', state: 'same' },
    { path: 'context/progress-tracker.md', state: 'kept' },
  ],
  problem: null,
  stale: [],
  pending: false,
  last: null,
};

type Call = { method: string; url: string };

function renderSection(
  plan: GitMergeRequestPlan | null,
  {
    answers = {},
    beforeRequest = () => Promise.resolve(true),
  }: { answers?: Record<string, () => Response>; beforeRequest?: () => Promise<boolean> } = {},
) {
  const calls: Call[] = [];
  const responses: Record<string, () => Response> = {
    ...(plan ? { [`GET ${BASE}/merge-request`]: () => Response.json(plan) } : {}),
    ...answers,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      const answer = responses[`${method} ${url}`];
      return Promise.resolve(answer ? answer() : new Response(null, { status: 404 }));
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MergeRequestSection projectId={PROJECT} beforeRequest={beforeRequest} />
    </QueryClientProvider>,
  );
  return {
    calls,
    posted: () => calls.filter((call) => call.method === 'POST').map((call) => call.url),
    section: screen.getByRole('region', { name: 'Ins Repository' }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MergeRequestSection', () => {
  it('says how the package compares with the repository, file by file', async () => {
    const { section } = renderSection(PLAN);

    expect(within(section).getByRole('status')).toHaveTextContent(
      'Vergleiche mit dem Repository …',
    );
    expect(
      await within(section).findByText(
        '2 neu · 1 geändert · 1 unverändert · 1 bleibt, wie sie ist',
      ),
    ).toBeVisible();
    expect(within(section).getByText('verein/vereins-app').tagName).toBe('CODE');
    // The files unfold, each with what becomes of it.
    const files = within(section).getAllByRole('listitem');
    expect(files.map((file) => file.textContent)).toEqual([
      'CLAUDE.mdneu',
      'AGENTS.mdneu',
      'context/project-overview.mdgeändert',
      'context/decisions.mdunverändert',
      'context/progress-tracker.mdbleibt',
    ]);
    expect(within(section).getByRole('button', { name: 'Merge Request anlegen' })).toBeEnabled();
  });

  it('opens the merge request in one step for who may approve, after the texts are stored', async () => {
    const beforeRequest = vi.fn(() => Promise.resolve(true));
    const { section, posted } = renderSection(PLAN, {
      beforeRequest,
      answers: {
        [`POST ${BASE}/merge-request`]: () =>
          Response.json({ requestId: REQUEST }, { status: 201 }),
        [`POST ${BASE}/requests/approve`]: () => Response.json({ approved: 1 }),
      },
    });

    fireEvent.click(await within(section).findByRole('button', { name: 'Merge Request anlegen' }));

    await waitFor(() => {
      expect(posted()).toEqual([`${BASE}/merge-request`, `${BASE}/requests/approve`]);
    });
    expect(beforeRequest).toHaveBeenCalledTimes(1);
    expect(await within(section).findByText(/Der Merge Request wird angelegt\./)).toBeVisible();
  });

  it('lays the request before the approvers for everyone else', async () => {
    const { section, posted } = renderSection(
      { ...PLAN, canApprove: false, hasAccount: false },
      {
        answers: {
          [`POST ${BASE}/merge-request`]: () =>
            Response.json({ requestId: REQUEST }, { status: 201 }),
        },
      },
    );

    fireEvent.click(await within(section).findByRole('button', { name: 'Zur Freigabe vorlegen' }));

    expect(await within(section).findByText(/Vorgelegt\. Der Antrag wartet/)).toBeVisible();
    expect(posted()).toEqual([`${BASE}/merge-request`]);
  });

  it('makes no request while a text of the package is not stored', async () => {
    const { section, posted } = renderSection(PLAN, {
      beforeRequest: () => Promise.resolve(false),
    });

    fireEvent.click(await within(section).findByRole('button', { name: 'Merge Request anlegen' }));

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Ein Text des Pakets ist noch nicht gespeichert.',
    );
    expect(posted()).toEqual([]);
  });

  it('says when a request waits already, something failed, or the approval did not follow', async () => {
    const answer = { status: 409, code: 'already_running' };
    const { section } = renderSection(PLAN, {
      answers: {
        [`POST ${BASE}/merge-request`]: () =>
          answer.status === 201
            ? Response.json({ requestId: REQUEST }, { status: 201 })
            : Response.json(
                { error: { code: answer.code, message: 'x' } },
                { status: answer.status },
              ),
      },
    });
    const button = await within(section).findByRole('button', { name: 'Merge Request anlegen' });

    fireEvent.click(button);
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Ein Antrag für das Paket wartet schon.',
    );

    answer.status = 500;
    answer.code = 'internal';
    fireEvent.click(button);
    await waitFor(() => {
      expect(within(section).getByRole('alert')).toHaveTextContent('Das hat nicht geklappt.');
    });

    // The request is made, but approving it is refused (the stub has no answer for it).
    answer.status = 201;
    fireEvent.click(button);
    await waitFor(() => {
      expect(within(section).getByRole('alert')).toHaveTextContent(
        'Der Antrag ist angelegt, aber die Freigabe hat nicht geklappt.',
      );
    });
  });

  it('holds the button back while a request waits, and when nothing differs', async () => {
    const waiting = renderSection({ ...PLAN, pending: true });
    expect(
      await within(waiting.section).findByText(/Ein Antrag für das Paket wartet schon unter/),
    ).toBeVisible();
    expect(
      within(waiting.section).getByRole('button', { name: 'Merge Request anlegen' }),
    ).toBeDisabled();
  });

  it('says that the repository holds the package already', async () => {
    const { section } = renderSection({
      ...PLAN,
      files: [
        { path: 'CLAUDE.md', state: 'same' },
        { path: 'context/progress-tracker.md', state: 'kept' },
      ],
    });

    expect(
      await within(section).findByText('Das Repository ist schon auf dem Stand des Pakets.'),
    ).toBeVisible();
    expect(within(section).getByRole('button', { name: 'Merge Request anlegen' })).toBeDisabled();
  });

  it('names earlier feature specs, and links the merge request that was opened last', async () => {
    const { section } = renderSection({
      ...PLAN,
      stale: ['context/feature-specs/01-09-alte-spec.md'],
      last: { number: 3, url: `${REPOSITORY_URL}/-/merge_requests/3` },
    });

    expect(await within(section).findByText(/nicht mehr im Paket/)).toBeVisible();
    expect(within(section).getByText('context/feature-specs/01-09-alte-spec.md')).toBeVisible();
    expect(within(section).getByRole('link', { name: 'Merge Request !3' })).toHaveAttribute(
      'href',
      `${REPOSITORY_URL}/-/merge_requests/3`,
    );
  });

  it('says why there is no comparison', async () => {
    const problems: [NonNullable<GitMergeRequestPlan['problem']>, RegExp][] = [
      ['no_branch', /noch keinen Standard-Branch/],
      ['too_large', /zu groß für einen Merge Request/],
      ['unreachable', /konnte nicht gelesen werden/],
      ['no_plan', /Der Plan ist noch leer/],
    ];
    for (const [problem, text] of problems) {
      const { section } = renderSection({ ...PLAN, files: null, problem });
      expect(await within(section).findByText(text)).toBeVisible();
      expect(within(section).getByRole('button', { name: 'Merge Request anlegen' })).toBeDisabled();
      cleanup();
    }
  });

  it('only shows the comparison to viewers, and tells an approver without an account what is missing', async () => {
    const viewer = renderSection({ ...PLAN, canRequest: false, canApprove: false });
    expect(
      await within(viewer.section).findByText('Den Merge Request legen Owner und Editoren an.'),
    ).toBeVisible();
    expect(within(viewer.section).queryByRole('button')).toBeNull();
    cleanup();

    const approver = renderSection({ ...PLAN, hasAccount: false });
    expect(
      await within(approver.section).findByText(
        /Verbinde das für die Freigabe benötigte Repository-Konto/,
      ),
    ).toBeVisible();
    expect(
      within(approver.section).getByRole('button', { name: 'Zur Freigabe vorlegen' }),
    ).toBeEnabled();
  });

  it('points to the repository when the project has none, and tells when the comparison failed', async () => {
    const bare = renderSection({ ...PLAN, repository: null, files: null });
    expect(
      await within(bare.section).findByText(
        /Mit einem Repository kommt das Paket auch als Merge Request dorthin\./,
      ),
    ).toBeVisible();
    expect(within(bare.section).queryByRole('button')).toBeNull();
    cleanup();

    const failed = renderSection(null);
    expect(await within(failed.section).findByRole('alert')).toHaveTextContent(
      'Der Vergleich mit dem Repository hat nicht geklappt.',
    );
  });
});
