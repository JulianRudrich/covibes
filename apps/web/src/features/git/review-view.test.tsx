import type {
  GitMergeRequests,
  GitOpenMergeRequest,
  GitRequest,
  GitRequests,
  GitReview,
  GitReviewSummary,
} from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { TooltipProvider } from '@web/components/ui/tooltip';
import { MergeRequestsDialog } from '@web/features/git/merge-requests-dialog';
import { deviatingReviews } from '@web/features/git/request-queries';
import { WaitingForYou } from '@web/features/proposals/waiting-for-you';

// Reviews of merge requests against the architecture (spec 30b): their state in the list of
// merge requests, the review itself, and the card under "Wartet auf dich".
const PROJECT = '9e6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const BASE = `/api/projects/${PROJECT}/git`;
const REPOSITORY_URL = 'https://gitlab.example.com/verein/vereins-app';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const FINDING = {
  title: 'Socket.io statt Server-Sent Events',
  detail: 'Der Merge Request bringt Socket.io mit; entschieden sind Server-Sent Events.',
  basis: 'Echtzeit: Server-Sent Events',
  file: 'src/realtime/socket.ts',
};

function review(fields: Partial<GitReview> = {}): GitReview {
  return {
    id: '9e000000-0000-4000-8000-000000000007',
    number: 7,
    sha: SHA,
    status: 'done',
    verdict: 'deviates',
    trigger: 'auto',
    createdAt: new Date(Date.now() - 4 * 60_000).toISOString(),
    finishedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    title: 'Login per Link',
    url: `${REPOSITORY_URL}/-/merge_requests/7`,
    sourceBranch: '4-login',
    author: 'Coder',
    issueNumber: 4,
    requestedBy: null,
    summary: 'Der Merge Request baut den Login, weicht aber bei der Echtzeit ab.',
    findings: [FINDING],
    open: true,
    comment: null,
    ...fields,
  };
}

const summary = (of: GitReview): GitReviewSummary => ({
  id: of.id,
  number: of.number,
  sha: of.sha,
  status: of.status,
  verdict: of.verdict,
  findings: of.findings.length,
  trigger: of.trigger,
  createdAt: of.createdAt,
  finishedAt: of.finishedAt,
});

function mergeRequest(fields: Partial<GitOpenMergeRequest> = {}): GitOpenMergeRequest {
  return {
    number: 7,
    title: 'Login per Link',
    url: `${REPOSITORY_URL}/-/merge_requests/7`,
    sourceBranch: '4-login',
    targetBranch: 'main',
    author: 'Coder',
    updatedAt: new Date().toISOString(),
    draft: false,
    conflicts: false,
    requested: false,
    issueNumber: 4,
    review: null,
    reviewCurrent: false,
    ...fields,
  };
}

function list(mergeRequests: GitOpenMergeRequest[], canReview = true): GitMergeRequests {
  return {
    repository: {
      id: 101,
      path: 'verein/vereins-app',
      name: 'Vereins-App',
      url: REPOSITORY_URL,
      defaultBranch: 'main',
    },
    canRequest: canReview,
    canApprove: canReview,
    hasAccount: canReview,
    canReview,
    mergeRequests,
  };
}

function renderDialog({
  mergeRequests = [mergeRequest()],
  reviews = [],
  canReview = true,
  access = { canApprove: true, hasAccount: true },
  reviewId,
  answers = {},
}: {
  mergeRequests?: GitOpenMergeRequest[];
  reviews?: GitReview[];
  /** Owners and editors: they start reviews and lay comments before the approvers. */
  canReview?: boolean;
  /** Whether the person approves Git requests, and has a GitLab account for it. */
  access?: Pick<GitRequests, 'canApprove' | 'hasAccount'>;
  reviewId?: string;
  answers?: Record<string, () => Response>;
} = {}) {
  const calls: string[] = [];
  const responses: Record<string, () => Response> = {
    [`GET ${BASE}/merge-requests`]: () => Response.json(list(mergeRequests, canReview)),
    [`GET ${BASE}/reviews`]: () => Response.json({ canRequest: canReview, reviews }),
    [`GET ${BASE}/requests`]: () => Response.json({ ...access, requests: [] }),
    ...answers,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push(key);
      const answer = responses[key];
      return Promise.resolve(answer ? answer() : new Response(null, { status: 404 }));
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Dialog open>
        <MergeRequestsDialog projectId={PROJECT} reviewId={reviewId} />
      </Dialog>
    </QueryClientProvider>,
  );
  return { calls, dialog: screen.getByRole('dialog') };
}

const refusal = (code: string, status: number) => () =>
  Response.json({ error: { code, message: 'x' } }, { status });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the review in the list of merge requests', () => {
  it('offers to review a merge request that has no review', async () => {
    const { dialog, calls } = renderDialog({
      answers: {
        [`POST ${BASE}/merge-requests/7/review`]: () =>
          Response.json({ reviewId: review().id }, { status: 201 }),
      },
    });

    const check = await within(dialog).findByRole('button', {
      name: '!7 gegen die Architektur prüfen',
    });
    expect(check).toHaveTextContent('Prüfen');
    fireEvent.click(check);

    await waitFor(() => {
      expect(calls).toContain(`POST ${BASE}/merge-requests/7/review`);
    });
    // The list is read again, so the review that started shows.
    await waitFor(() => {
      expect(calls.filter((call) => call === `GET ${BASE}/merge-requests`)).toHaveLength(2);
    });
  });

  it('shows what a review found, or that it runs', async () => {
    const fits = review({
      id: '9e000000-0000-4000-8000-000000000001',
      verdict: 'fits',
      findings: [],
    });
    const runs = review({
      id: '9e000000-0000-4000-8000-000000000002',
      status: 'running',
      verdict: null,
      summary: null,
      findings: [],
    });
    const { dialog } = renderDialog({
      mergeRequests: [
        mergeRequest({ review: summary(review()), reviewCurrent: true }),
        mergeRequest({
          number: 8,
          title: 'Mitgliederliste',
          review: summary(fits),
          reviewCurrent: true,
        }),
        mergeRequest({ number: 9, title: 'Export', review: summary(runs), reviewCurrent: true }),
      ],
    });

    const [deviating, fitting, running] = await within(dialog).findAllByRole('listitem');
    if (!deviating || !fitting || !running) throw new Error('The entries are missing');
    expect(
      within(deviating).getByRole('button', { name: 'Review von !7 ansehen' }),
    ).toHaveTextContent('1 Abweichung von der Architektur');
    expect(
      within(fitting).getByRole('button', { name: 'Review von !8 ansehen' }),
    ).toHaveTextContent('Passt zur Architektur');
    expect(within(running).getByRole('status')).toHaveTextContent('Review läuft …');
    // The commits as they are have their review: there is nothing to start.
    expect(
      within(dialog).queryByRole('button', { name: /gegen die Architektur prüfen/ }),
    ).toBeNull();
  });

  it('offers a new review when the commits changed or the review failed', async () => {
    const failed = review({ status: 'failed', verdict: null, summary: null, findings: [] });
    const { dialog } = renderDialog({
      mergeRequests: [
        mergeRequest({ review: summary(review()), reviewCurrent: false }),
        mergeRequest({ number: 8, title: 'Export', review: summary(failed), reviewCurrent: true }),
      ],
    });

    const [older, broken] = await within(dialog).findAllByRole('listitem');
    if (!older || !broken) throw new Error('The entries are missing');
    expect(within(older).getByRole('button', { name: 'Review von !7 ansehen' })).toHaveTextContent(
      'Älterer Stand:1 Abweichung von der Architektur',
    );
    expect(
      within(older).getByRole('button', { name: '!7 gegen die Architektur prüfen' }),
    ).toHaveTextContent('Erneut prüfen');
    expect(broken).toHaveTextContent('Das Review hat nicht geklappt.');
    expect(within(broken).queryByRole('button', { name: /ansehen/ })).toBeNull();
    expect(
      within(broken).getByRole('button', { name: '!8 gegen die Architektur prüfen' }),
    ).toBeEnabled();
  });

  it('shows viewers the reviews without a way to start one', async () => {
    const { dialog } = renderDialog({
      canReview: false,
      mergeRequests: [
        mergeRequest({ review: summary(review()), reviewCurrent: false }),
        mergeRequest({ number: 8, title: 'Export' }),
      ],
    });

    expect(
      await within(dialog).findByRole('button', { name: 'Review von !7 ansehen' }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole('button', { name: /gegen die Architektur prüfen/ }),
    ).toBeNull();
  });

  it('says why a review did not start', async () => {
    for (const [code, status, text] of [
      ['already_running', 409, 'Dieser Stand ist schon geprüft oder wird gerade geprüft.'],
      ['limit_reached', 429, 'Für heute sind die Reviews dieses Projekts aufgebraucht.'],
      ['internal', 500, 'Das Review konnte nicht gestartet werden.'],
    ] as const) {
      const { dialog } = renderDialog({
        answers: { [`POST ${BASE}/merge-requests/7/review`]: refusal(code, status) },
      });

      fireEvent.click(
        await within(dialog).findByRole('button', { name: '!7 gegen die Architektur prüfen' }),
      );

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(text);
      cleanup();
    }
  });
});

describe('the review itself', () => {
  it('opens from the list with the verdict, the summary and the findings, and leads back', async () => {
    const { dialog } = renderDialog({
      mergeRequests: [mergeRequest({ review: summary(review()), reviewCurrent: true })],
      reviews: [review()],
    });

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Review von !7 ansehen' }));

    const shown = await screen.findByRole('article', { name: 'Review von !7' });
    expect(screen.getByRole('dialog', { name: 'Review' })).toBeVisible();
    expect(within(shown).getByRole('link', { name: /!7 Login per Link/ })).toHaveAttribute(
      'href',
      `${REPOSITORY_URL}/-/merge_requests/7`,
    );
    expect(shown).toHaveTextContent(
      'Stand a1b2c3d4 · automatisch geprüft · vor 3 Minuten · gehört zu Issue #4',
    );
    expect(within(shown).getByRole('status')).toHaveTextContent('1 Abweichung von der Architektur');
    expect(shown).toHaveTextContent('weicht aber bei der Echtzeit ab.');
    const finding = within(within(shown).getByRole('list', { name: 'Abweichungen' })).getByRole(
      'listitem',
    );
    expect(within(finding).getByRole('heading')).toHaveTextContent(FINDING.title);
    expect(finding).toHaveTextContent(FINDING.detail);
    expect(finding).toHaveTextContent('ArchitekturEchtzeit: Server-Sent Events');
    expect(within(finding).getByText('src/realtime/socket.ts')).toHaveClass('font-mono');
    expect(shown).toHaveTextContent('Das Review hat ein Modell geschrieben');

    fireEvent.click(screen.getByRole('button', { name: 'Alle Merge Requests' }));
    expect(await screen.findByRole('dialog', { name: 'Merge Requests' })).toBeVisible();
  });

  it('says that a change fits, who asked for the review, and shows no list of findings', async () => {
    const fits = review({
      verdict: 'fits',
      trigger: 'manual',
      requestedBy: { userId: '9e111111-1111-4111-8111-111111111111', name: 'Olga' },
      issueNumber: null,
      summary: 'Der Merge Request folgt der Architektur.',
      findings: [],
    });
    renderDialog({ reviews: [fits], reviewId: fits.id });

    const shown = await screen.findByRole('article', { name: 'Review von !7' });
    expect(within(shown).getByRole('status')).toHaveTextContent('Passt zur Architektur');
    expect(shown).toHaveTextContent('geprüft auf Wunsch von Olga');
    expect(shown).not.toHaveTextContent('gehört zu Issue');
    expect(within(shown).queryByRole('list')).toBeNull();
  });

  it('shows what the model wrote as text, never as markup', async () => {
    const hostile = review({
      summary: '<img src=x onerror=alert(1)> **fett** [Link](https://example.com)',
      findings: [
        {
          title: '<script>alert(1)</script>',
          detail: 'Zeile eins\n<a href="https://example.com">hier klicken</a>',
          basis: '<b>Entscheidung</b>',
          file: '../../etc/passwd',
        },
      ],
    });
    renderDialog({ reviews: [hostile], reviewId: hostile.id });

    const shown = await screen.findByRole('article', { name: 'Review von !7' });
    expect(shown).toHaveTextContent(
      '<img src=x onerror=alert(1)> **fett** [Link](https://example.com)',
    );
    expect(shown).toHaveTextContent('<script>alert(1)</script>');
    expect(shown.querySelector('img, script, b')).toBeNull();
    // The only link is the one to the merge request, which the server read from GitLab.
    expect(within(shown).getAllByRole('link')).toHaveLength(1);
  });

  it('says when a review runs, failed, or is gone', async () => {
    const runs = review({ status: 'running', verdict: null, summary: null, findings: [] });
    renderDialog({ reviews: [runs], reviewId: runs.id });
    expect(
      within(await screen.findByRole('article', { name: 'Review von !7' })).getByRole('status'),
    ).toHaveTextContent('Review läuft …');
    cleanup();

    const failed = review({ status: 'failed', verdict: null, summary: null, findings: [] });
    renderDialog({ reviews: [failed], reviewId: failed.id });
    expect(
      within(await screen.findByRole('article', { name: 'Review von !7' })).getByRole('status'),
    ).toHaveTextContent('Das Review hat nicht geklappt.');
    cleanup();

    renderDialog({ reviews: [], reviewId: review().id });
    expect(await screen.findByText(/Dieses Review gibt es nicht mehr/)).toBeVisible();
    cleanup();

    renderDialog({
      reviewId: review().id,
      answers: { [`GET ${BASE}/reviews`]: refusal('internal', 500) },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Das Review konnte nicht geladen werden.',
    );
  });
});

describe('the review as a comment (spec 30c)', () => {
  const REQUEST = '9e000000-0000-4000-8000-0000000000c1';
  const created = () => Response.json({ requestId: REQUEST }, { status: 201 });
  const posts = (calls: string[]) => calls.filter((call) => call.startsWith('POST '));

  it('is posted in one step by who may approve and has a GitLab account', async () => {
    const { calls } = renderDialog({
      reviews: [review()],
      reviewId: review().id,
      answers: {
        [`POST ${BASE}/reviews/${review().id}/comment`]: created,
        [`POST ${BASE}/requests/approve`]: () => Response.json({ approved: 1 }),
      },
    });
    const shown = await screen.findByRole('article', { name: 'Review von !7' });
    expect(shown).toHaveTextContent('Gepostet wird erst nach Freigabe');

    // Until it is known that the person may approve, the button only lays the comment before
    // the approvers.
    fireEvent.click(
      await within(shown).findByRole('button', { name: 'Im Repository kommentieren' }),
    );

    await waitFor(() => {
      expect(posts(calls)).toEqual([
        `POST ${BASE}/reviews/${review().id}/comment`,
        `POST ${BASE}/requests/approve`,
      ]);
    });
  });

  it('is laid before the approvers by everyone else who may ask', async () => {
    for (const access of [
      { canApprove: false, hasAccount: true },
      { canApprove: true, hasAccount: false },
    ]) {
      const { calls } = renderDialog({
        reviews: [review()],
        reviewId: review().id,
        access,
        answers: { [`POST ${BASE}/reviews/${review().id}/comment`]: created },
      });

      fireEvent.click(await screen.findByRole('button', { name: 'Als Kommentar vorlegen' }));

      await waitFor(() => {
        expect(posts(calls)).toEqual([`POST ${BASE}/reviews/${review().id}/comment`]);
      });
      // The reviews are read again, so the comment that waits shows.
      await waitFor(() => {
        expect(calls.filter((call) => call === `GET ${BASE}/reviews`).length).toBeGreaterThan(1);
      });
      expect(posts(calls)).toHaveLength(1);
      cleanup();
    }
  });

  it('is not offered to viewers, and not for a review that is not written', async () => {
    renderDialog({ reviews: [review()], reviewId: review().id, canReview: false });
    await screen.findByRole('article', { name: 'Review von !7' });
    expect(screen.queryByRole('button', { name: /kommentieren|vorlegen/ })).toBeNull();
    cleanup();

    const runs = review({ status: 'running', verdict: null, summary: null, findings: [] });
    renderDialog({ reviews: [runs], reviewId: runs.id });
    await screen.findByRole('article', { name: 'Review von !7' });
    expect(screen.queryByRole('button', { name: /kommentieren|vorlegen/ })).toBeNull();
  });

  it('says what became of the comment, instead of offering it again', async () => {
    const states = [
      ['waiting', 'Der Kommentar wartet auf Freigabe.'],
      ['running', 'Der Kommentar wird gepostet …'],
      ['failed', 'Der Kommentar konnte nicht gepostet werden.'],
    ] as const;
    for (const [state, text] of states) {
      const waiting = review({ comment: { requestId: REQUEST, state, url: null } });
      renderDialog({ reviews: [waiting], reviewId: waiting.id });

      const shown = await screen.findByRole('article', { name: 'Review von !7' });
      expect(shown).toHaveTextContent(text);
      expect(screen.queryByRole('button', { name: /kommentieren|vorlegen/ })).toBeNull();
      cleanup();
    }

    const url = `${REPOSITORY_URL}/-/merge_requests/7#note_12`;
    const posted = review({ comment: { requestId: REQUEST, state: 'done', url } });
    renderDialog({ reviews: [posted], reviewId: posted.id });
    const shown = await screen.findByRole('article', { name: 'Review von !7' });
    expect(within(shown).getByRole('link', { name: 'Im Repository kommentiert' })).toHaveAttribute(
      'href',
      url,
    );
    expect(screen.queryByRole('button', { name: /kommentieren|vorlegen/ })).toBeNull();
  });

  it('says why the comment was not laid before the approvers', async () => {
    const cases = [
      [
        { [`POST ${BASE}/reviews/${review().id}/comment`]: refusal('already_running', 409) },
        'Dieses Review wartet schon auf Freigabe oder ist kommentiert.',
      ],
      [
        { [`POST ${BASE}/reviews/${review().id}/comment`]: refusal('internal', 500) },
        'Das hat nicht geklappt.',
      ],
      [
        {
          [`POST ${BASE}/reviews/${review().id}/comment`]: created,
          [`POST ${BASE}/requests/approve`]: refusal('forbidden', 403),
        },
        'Der Antrag ist angelegt, aber die Freigabe hat nicht geklappt.',
      ],
    ] as const;
    for (const [answers, text] of cases) {
      renderDialog({ reviews: [review()], reviewId: review().id, answers });

      fireEvent.click(await screen.findByRole('button', { name: 'Im Repository kommentieren' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      cleanup();
    }
  });
});

describe('the comment of a review under "Wartet auf dich"', () => {
  const REVIEW = review().id;
  const ACTION: GitRequest['actions'][number] = {
    id: '9e000000-0000-4000-8000-0000000000c3',
    kind: 'comment',
    title: 'Review von !7: 1 Abweichung',
    status: 'waiting',
    result: null,
    error: null,
    reviewId: REVIEW,
  };
  const comment = (fields: Partial<GitRequest> = {}): GitRequest => ({
    id: '9e000000-0000-4000-8000-0000000000c2',
    kind: 'comment',
    status: 'waiting',
    repository: { path: 'verein/vereins-app', url: REPOSITORY_URL },
    requestedBy: { userId: null, name: '' },
    agentKey: 'moderator',
    decidedBy: null,
    createdAt: new Date().toISOString(),
    decidedAt: null,
    finishedAt: null,
    actions: [ACTION],
    ...fields,
  });

  function renderWaiting(requests: GitRequest[], reviews: GitReview[] = []) {
    const onOpenReview = vi.fn();
    const onApprove = vi.fn();
    render(
      <TooltipProvider>
        <WaitingForYou
          proposals={[]}
          decided={[]}
          canDecide
          onDecide={vi.fn()}
          activeBoardId={null}
          onOpenBoard={vi.fn()}
          git={{
            canApprove: true,
            hasAccount: true,
            userId: '9e111111-1111-4111-8111-111111111111',
            busy: false,
            onApprove,
            onEnd: vi.fn(),
            onConnect: vi.fn(),
            onOpenReview,
            requests,
          }}
          reviews={deviatingReviews(reviews)}
          onOpenReview={onOpenReview}
        />
      </TooltipProvider>,
    );
    return {
      onOpenReview,
      onApprove,
      section: screen.getByRole('region', { name: 'Wartet auf dich' }),
    };
  }

  it('is the moderator’s card to approve, and shows the review it posts', () => {
    const waiting = comment();
    const { section, onOpenReview, onApprove } = renderWaiting([waiting]);

    const [card] = within(section).getAllByRole('listitem');
    if (!card) throw new Error('The card is missing');
    expect(card).toHaveTextContent('Moderator· Freigabe');
    expect(card).toHaveTextContent(
      'Review von !7: 1 Abweichung als Kommentar in vereins-app posten',
    );
    // It is something to decide, so it is counted.
    expect(within(section).getByLabelText('1 offen')).toHaveTextContent('1');

    fireEvent.click(within(card).getByRole('button', { name: 'Review ansehen' }));
    expect(onOpenReview).toHaveBeenCalledExactlyOnceWith(REVIEW);
    fireEvent.click(within(card).getByRole('button', { name: 'Freigeben' }));
    expect(onApprove).toHaveBeenCalledExactlyOnceWith([waiting.id]);
  });

  it('stands for its review while it waits, runs or failed', () => {
    for (const state of ['waiting', 'running', 'failed'] as const) {
      const { section } = renderWaiting(
        [comment()],
        [review({ comment: { requestId: comment().id, state, url: null } })],
      );

      // One card: the request's. The review's own card rests.
      expect(section).toHaveTextContent('als Kommentar in vereins-app posten');
      expect(section).not.toHaveTextContent('weicht von der Architektur ab');
      cleanup();
    }
  });

  it('gives way to the review’s card once the comment is posted, which says so', () => {
    const url = `${REPOSITORY_URL}/-/merge_requests/7#note_12`;
    const done = comment({
      status: 'done',
      finishedAt: new Date().toISOString(),
      actions: [{ ...ACTION, status: 'done', result: { number: 7, url, existed: false } }],
    });
    const { section } = renderWaiting(
      [done],
      [review({ comment: { requestId: done.id, state: 'done', url } })],
    );

    expect(section).toHaveTextContent('!7 Login per Link weicht von der Architektur ab');
    expect(section).toHaveTextContent('Im Repository kommentiert');
    // The request that is done is a line with a check, like every Git request.
    expect(section).toHaveTextContent('Review von !7: 1 Abweichung in vereins-app kommentiert');
  });
});

describe('reviews under "Wartet auf dich"', () => {
  function renderWaiting(reviews: GitReview[]) {
    const onOpenReview = vi.fn();
    render(
      <TooltipProvider>
        <WaitingForYou
          proposals={[]}
          decided={[]}
          canDecide
          onDecide={vi.fn()}
          activeBoardId={null}
          onOpenBoard={vi.fn()}
          reviews={deviatingReviews(reviews)}
          onOpenReview={onOpenReview}
        />
      </TooltipProvider>,
    );
    return { onOpenReview, section: screen.getByRole('region', { name: 'Wartet auf dich' }) };
  }

  it('shows a merge request that deviates as the moderator’s card, and opens its review', () => {
    const three = review({
      findings: [
        FINDING,
        { ...FINDING, title: 'Neuer bezahlter Dienst' },
        { ...FINDING, title: 'Frontend spricht direkt mit der Datenbank' },
      ],
    });
    const { section, onOpenReview } = renderWaiting([three]);

    // The card is the first entry; the findings it names are entries of a list inside it.
    const [card] = within(section).getAllByRole('listitem');
    if (!card) throw new Error('The card is missing');
    expect(card).toHaveTextContent('Moderator· Review');
    expect(card).toHaveTextContent(
      '!7 Login per Link weicht von der Architektur ab: 3 Abweichungen.',
    );
    expect(card).toHaveTextContent('Socket.io statt Server-Sent Events');
    expect(card).toHaveTextContent('Neuer bezahlter Dienst');
    expect(card).not.toHaveTextContent('Frontend spricht direkt');
    expect(card).toHaveTextContent('+ 1 weitere');
    // Nothing is to be decided in Covibes, so it is not counted.
    expect(within(section).getByLabelText('0 offen')).toHaveTextContent('0');

    fireEvent.click(within(card).getByRole('button', { name: 'Review von !7 ansehen' }));
    expect(onOpenReview).toHaveBeenCalledExactlyOnceWith(three.id);
  });

  it('shows only reviews of open merge requests that deviate', () => {
    const { section } = renderWaiting([
      review({ id: '9e000000-0000-4000-8000-00000000000a', verdict: 'fits', findings: [] }),
      review({ id: '9e000000-0000-4000-8000-00000000000b', status: 'running', verdict: null }),
      review({ id: '9e000000-0000-4000-8000-00000000000c', status: 'failed', verdict: null }),
      review({ id: '9e000000-0000-4000-8000-00000000000d', open: false }),
    ]);

    expect(within(section).queryByRole('listitem')).toBeNull();
  });
});
