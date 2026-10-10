import type { GitMergeRequests, GitOpenMergeRequest } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { MergeRequestsDialog } from '@web/features/git/merge-requests-dialog';

const PROJECT = '9d6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const BASE = `/api/projects/${PROJECT}/git`;
const REQUEST = '9d000000-0000-4000-8000-000000000001';
const REPOSITORY_URL = 'https://gitlab.example.com/verein/vereins-app';

function mergeRequest(fields: Partial<GitOpenMergeRequest> = {}): GitOpenMergeRequest {
  return {
    number: 7,
    title: 'Projektplan, Feature-Specs und Diagramme aus Covibes',
    url: `${REPOSITORY_URL}/-/merge_requests/7`,
    sourceBranch: 'covibes/plan-2026-10-09-a1b2c3',
    targetBranch: 'main',
    author: 'Olga Beispiel',
    updatedAt: new Date().toISOString(),
    draft: false,
    conflicts: false,
    requested: false,
    issueNumber: null,
    review: null,
    reviewCurrent: false,
    ...fields,
  };
}

const LIST: GitMergeRequests = {
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
  canReview: true,
  mergeRequests: [
    mergeRequest(),
    mergeRequest({ number: 1, title: 'Login per E-Mail-Link', draft: true, conflicts: true }),
    mergeRequest({ number: 4, title: 'Mitgliederliste', requested: true, author: '' }),
  ],
};

type Call = { method: string; url: string };

function renderDialog(list: GitMergeRequests | null, answers: Record<string, () => Response> = {}) {
  const calls: Call[] = [];
  const responses: Record<string, () => Response> = {
    ...(list ? { [`GET ${BASE}/merge-requests`]: () => Response.json(list) } : {}),
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
      <Dialog open>
        <MergeRequestsDialog projectId={PROJECT} />
      </Dialog>
    </QueryClientProvider>,
  );
  return {
    posted: () => calls.filter((call) => call.method === 'POST').map((call) => call.url),
    dialog: screen.getByRole('dialog', { name: 'Merge Requests' }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MergeRequestsDialog', () => {
  it('lists the open merge requests with their branches, and what stands in the way', async () => {
    const { dialog } = renderDialog(LIST);

    const [plan, draft, waiting] = await within(dialog).findAllByRole('listitem');
    if (!plan || !draft || !waiting) throw new Error('The entries are missing');
    expect(within(plan).getByRole('link', { name: /!7 Projektplan/ })).toHaveAttribute(
      'href',
      `${REPOSITORY_URL}/-/merge_requests/7`,
    );
    expect(plan).toHaveTextContent('covibes/plan-2026-10-09-a1b2c3 → main · Olga Beispiel · ');
    expect(within(plan).getByRole('button', { name: 'Merge Request !7 mergen' })).toBeEnabled();
    // A draft is not merged; a merge request that waits is not asked for again.
    expect(draft).toHaveTextContent('Entwurf · Konflikte mit dem Zielbranch');
    expect(within(draft).queryByRole('button', { name: /mergen|vorlegen/ })).toBeNull();
    expect(waiting).toHaveTextContent('wartet auf Freigabe');
    expect(within(waiting).queryByRole('button', { name: /mergen|vorlegen/ })).toBeNull();
  });

  it('merges in one step for who may approve', async () => {
    const { dialog, posted } = renderDialog(LIST, {
      [`POST ${BASE}/merge-requests/7/merge`]: () =>
        Response.json({ requestId: REQUEST }, { status: 201 }),
      [`POST ${BASE}/requests/approve`]: () => Response.json({ approved: 1 }),
    });

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Merge Request !7 mergen' }));

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Wird gemergt.');
    expect(posted()).toEqual([`${BASE}/merge-requests/7/merge`, `${BASE}/requests/approve`]);
  });

  it('lays the request before the approvers for everyone else', async () => {
    const { dialog, posted } = renderDialog(
      { ...LIST, canApprove: false, hasAccount: false },
      {
        [`POST ${BASE}/merge-requests/7/merge`]: () =>
          Response.json({ requestId: REQUEST }, { status: 201 }),
      },
    );

    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Merge Request !7 zum Mergen vorlegen' }),
    );

    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Vorgelegt. Der Antrag wartet',
    );
    expect(posted()).toEqual([`${BASE}/merge-requests/7/merge`]);
  });

  it('says when a request waits already, something failed, or the approval did not follow', async () => {
    const answer = { status: 409, code: 'already_running' };
    const { dialog } = renderDialog(LIST, {
      [`POST ${BASE}/merge-requests/7/merge`]: () =>
        answer.status === 201
          ? Response.json({ requestId: REQUEST }, { status: 201 })
          : Response.json(
              { error: { code: answer.code, message: 'x' } },
              { status: answer.status },
            ),
    });
    const button = () => within(dialog).findByRole('button', { name: 'Merge Request !7 mergen' });

    fireEvent.click(await button());
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Dafür wartet schon ein Antrag.',
    );

    answer.status = 500;
    answer.code = 'internal';
    fireEvent.click(await button());
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Das hat nicht geklappt.');
    });

    answer.status = 201;
    fireEvent.click(await button());
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Der Antrag ist angelegt, aber die Freigabe hat nicht geklappt.',
      );
    });
  });

  it('only shows the list to viewers, and tells an approver without an account what is missing', async () => {
    const viewer = renderDialog({ ...LIST, canRequest: false, canApprove: false });
    expect(
      await within(viewer.dialog).findByText('Zum Mergen legen Owner und Editoren vor.'),
    ).toBeVisible();
    expect(within(viewer.dialog).queryByRole('button', { name: /mergen|vorlegen/ })).toBeNull();
    cleanup();

    const approver = renderDialog({ ...LIST, hasAccount: false });
    expect(
      await within(approver.dialog).findByText(/Zum Freigeben brauchst du dein GitLab-Konto\./),
    ).toBeVisible();
    expect(
      within(approver.dialog).getByRole('button', { name: 'Merge Request !7 zum Mergen vorlegen' }),
    ).toBeEnabled();
  });

  it('says what is missing: a repository, open merge requests, or the answer of GitLab', async () => {
    const bare = renderDialog({ ...LIST, repository: null, mergeRequests: null });
    expect(
      await within(bare.dialog).findByText(/Dieses Projekt hat noch kein Repository\./),
    ).toBeVisible();
    cleanup();

    const empty = renderDialog({ ...LIST, mergeRequests: [] });
    expect(
      await within(empty.dialog).findByText('Im Repository ist kein Merge Request offen.'),
    ).toBeVisible();
    cleanup();

    const unreachable = renderDialog({ ...LIST, mergeRequests: null });
    expect(await within(unreachable.dialog).findByRole('alert')).toHaveTextContent(
      'Das Repository konnte nicht gelesen werden.',
    );
    cleanup();

    const failed = renderDialog(null);
    expect(await within(failed.dialog).findByRole('alert')).toHaveTextContent(
      'Die Merge Requests konnten nicht geladen werden.',
    );
  });
});
