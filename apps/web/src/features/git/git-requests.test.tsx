import type { GitAction, GitIssuePlan, GitLog, GitRequest } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { TooltipProvider } from '@web/components/ui/tooltip';
import { GitLogDialog } from '@web/features/git/git-log-dialog';
import type { GitRequestActions } from '@web/features/git/git-request-view';
import { IssuesDialog } from '@web/features/git/issues-dialog';
import { gitRequestsToDecide, requestProgress } from '@web/features/git/request-progress';
import { waitingCount } from '@web/features/proposals/waiting-count';
import { WaitingForYou } from '@web/features/proposals/waiting-for-you';

const PROJECT = '9b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const OLGA = '9b000000-0000-4000-8000-000000000001';
const EDGAR = '9b000000-0000-4000-8000-000000000002';
const SETUP = '9b000000-0000-4000-8000-000000000011';
const LOGIN = '9b000000-0000-4000-8000-000000000012';
const LIST = '9b000000-0000-4000-8000-000000000021';
const BASE = `/api/projects/${PROJECT}/git`;
const REPOSITORY_URL = 'https://gitlab.example.com/verein/vereins-app';

let counter = 0;
const id = () => `9b000000-0000-4000-9000-${String((counter += 1)).padStart(12, '0')}`;

function action(fields: Partial<GitAction> & Pick<GitAction, 'kind' | 'title'>): GitAction {
  return { id: id(), status: 'waiting', result: null, error: null, ...fields };
}

function request(fields: Partial<GitRequest> = {}): GitRequest {
  return {
    id: id(),
    kind: 'issues',
    status: 'waiting',
    repository: { path: 'verein/vereins-app', url: REPOSITORY_URL },
    requestedBy: { userId: EDGAR, name: 'Edgar Editor' },
    decidedBy: null,
    createdAt: new Date().toISOString(),
    decidedAt: null,
    finishedAt: null,
    actions: [
      action({ kind: 'milestone', title: 'Meilenstein 1: Grundgerüst' }),
      action({ kind: 'issue', title: 'Projekt aufsetzen' }),
      action({ kind: 'issue', title: 'Login per Link' }),
    ],
    ...fields,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Git requests under "Wartet auf dich"', () => {
  function renderWaiting(requests: GitRequest[], access: Partial<GitRequestActions> = {}) {
    const git: GitRequestActions = {
      canApprove: true,
      hasAccount: true,
      userId: OLGA,
      busy: false,
      onApprove: vi.fn(),
      onEnd: vi.fn(),
      onConnect: vi.fn(),
      ...access,
    };
    render(
      <TooltipProvider>
        <WaitingForYou
          proposals={[]}
          decided={[]}
          canDecide
          onDecide={vi.fn()}
          activeBoardId={null}
          onOpenBoard={vi.fn()}
          git={{ ...git, requests }}
        />
      </TooltipProvider>,
    );
    return { git, section: screen.getByRole('region', { name: 'Wartet auf dich' }) };
  }

  it('shows a waiting request as a card that who may approve approves, views and rejects', () => {
    const waiting = request();
    const { git, section } = renderWaiting([waiting]);

    expect(within(section).getByLabelText('1 offen')).toHaveTextContent('1');
    const card = within(section).getByRole('listitem');
    expect(card).toHaveTextContent('Edgar Editor· Freigabe');
    expect(card).toHaveTextContent('2 Issues in vereins-app anlegen');
    expect(within(card).getByText('vereins-app').tagName).toBe('CODE');

    // "Ansehen" unfolds the actions and reads "Schließen" then.
    expect(within(card).queryByText('Projekt aufsetzen')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Ansehen' }));
    expect(within(card).getByText('Projekt aufsetzen')).toBeVisible();
    expect(within(card).getByText('Meilenstein 1: Grundgerüst')).toBeVisible();
    fireEvent.click(within(card).getByRole('button', { name: 'Schließen' }));
    expect(within(card).queryByText('Projekt aufsetzen')).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'Freigeben' }));
    expect(git.onApprove).toHaveBeenCalledWith([waiting.id]);
    fireEvent.click(within(card).getByRole('button', { name: 'Ablehnen' }));
    expect(git.onEnd).toHaveBeenCalledWith(waiting.id, 'reject');
  });

  it('approves several waiting requests at once', () => {
    const first = request();
    const second = request();
    const running = request({ status: 'approved' });
    const { git, section } = renderWaiting([first, second, running]);

    expect(within(section).getByText('2 Freigaben warten.')).toBeVisible();
    fireEvent.click(within(section).getByRole('button', { name: 'Alle freigeben' }));

    expect(git.onApprove).toHaveBeenCalledWith([first.id, second.id]);
  });

  it('leads someone who may approve to their GitLab account first', () => {
    const { git, section } = renderWaiting([request(), request()], { hasAccount: false });

    expect(
      within(section).getAllByText('Zum Freigeben brauchst du dein GitLab-Konto.'),
    ).toHaveLength(2);
    expect(within(section).queryByRole('button', { name: 'Freigeben' })).toBeNull();
    expect(within(section).queryByRole('button', { name: 'Alle freigeben' })).toBeNull();
    const [connect] = within(section).getAllByRole('button', { name: 'Verbinden' });
    if (!connect) throw new Error('The button is missing');
    fireEvent.click(connect);
    expect(git.onConnect).toHaveBeenCalledTimes(1);
  });

  it('lets everyone else see the request, and its maker take it back', () => {
    const own = request();
    const other = request({ requestedBy: { userId: OLGA, name: 'Olga' } });
    const { git, section } = renderWaiting([own, other], { canApprove: false, userId: EDGAR });

    // Nothing waits for someone who cannot approve.
    expect(within(section).getByLabelText('0 offen')).toHaveTextContent('0');
    const [first, second] = within(section).getAllByRole('listitem');
    if (!first || !second) throw new Error('The cards are missing');
    expect(first).toHaveTextContent('Wartet auf jemanden, der Git-Aktionen freigeben darf.');
    expect(within(first).queryByRole('button', { name: 'Freigeben' })).toBeNull();
    expect(within(first).queryByRole('button', { name: 'Ablehnen' })).toBeNull();
    expect(within(first).getByRole('button', { name: 'Ansehen' })).toBeVisible();
    expect(within(second).queryByRole('button', { name: 'Zurückziehen' })).toBeNull();

    fireEvent.click(within(first).getByRole('button', { name: 'Zurückziehen' }));
    expect(git.onEnd).toHaveBeenCalledWith(own.id, 'withdraw');
  });

  it('shows how far a running request is, without a way to decide it again', () => {
    const [milestone, first, second] = request().actions;
    if (!milestone || !first || !second) throw new Error('The actions are missing');
    const { section } = renderWaiting([
      request({
        status: 'approved',
        actions: [
          { ...milestone, status: 'done', result: { number: null, url: null, existed: true } },
          {
            ...first,
            status: 'done',
            result: { number: 4, url: `${REPOSITORY_URL}/-/issues/4`, existed: false },
          },
          { ...second, status: 'started' },
        ],
      }),
    ]);

    const card = within(section).getByRole('listitem');
    expect(within(card).getByRole('status')).toHaveTextContent('Wird ausgeführt … 2 von 3');
    expect(within(card).queryByRole('button', { name: 'Freigeben' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Ablehnen' })).toBeNull();
    // What is done links to what it made; a milestone that was there says so.
    fireEvent.click(within(card).getByRole('button', { name: 'Ansehen' }));
    expect(within(card).getByRole('link', { name: '#4' })).toHaveAttribute(
      'href',
      `${REPOSITORY_URL}/-/issues/4`,
    );
    expect(within(card).getByText('gab es schon')).toBeVisible();
    expect(within(card).getByLabelText('Läuft')).toBeInTheDocument();
    expect(within(section).getByLabelText('0 offen')).toBeInTheDocument();
  });

  it('says what went wrong in a failed request, and tries it again or discards it', () => {
    const [milestone, first, second] = request().actions;
    if (!milestone || !first || !second) throw new Error('The actions are missing');
    const failed = request({
      status: 'failed',
      actions: [
        { ...milestone, status: 'done', result: { number: null, url: null, existed: false } },
        { ...first, status: 'failed', error: { code: 'forbidden', detail: '403 Forbidden' } },
        second,
      ],
    });
    const { git, section } = renderWaiting([failed]);

    expect(within(section).getByLabelText('1 offen')).toBeInTheDocument();
    const card = within(section).getByRole('listitem');
    expect(within(card).getByRole('alert')).toHaveTextContent(
      '2 von 3 nicht ausgeführt. GitLab hat den Zugriff abgelehnt.',
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Ansehen' }));
    expect(card).toHaveTextContent('GitLab hat den Zugriff abgelehnt. (403 Forbidden)');

    fireEvent.click(within(card).getByRole('button', { name: 'Wiederholen' }));
    expect(git.onApprove).toHaveBeenCalledWith([failed.id]);
    fireEvent.click(within(card).getByRole('button', { name: 'Verwerfen' }));
    expect(git.onEnd).toHaveBeenCalledWith(failed.id, 'reject');
  });

  it('lists a request that was just done as a line with a check', () => {
    const { section } = renderWaiting([request({ status: 'done' })]);

    expect(within(section).getByLabelText('0 offen')).toBeInTheDocument();
    expect(section).toHaveTextContent('2 Issues in vereins-app angelegt');
    expect(within(section).queryByRole('button')).toBeNull();
  });

  it('names the plan package as a merge request, and links what it opened', () => {
    const packaged = request({
      kind: 'merge_request',
      actions: [
        action({
          kind: 'commit',
          title: 'Plan-Paket auf dem Branch covibes/plan-2026-10-09-a1b2c3 (45 Dateien)',
          status: 'done',
          result: { number: null, url: `${REPOSITORY_URL}/-/commit/abc`, existed: false },
        }),
        action({
          kind: 'merge_request',
          title: 'Projektplan, Feature-Specs und Diagramme aus Covibes',
          status: 'done',
          result: { number: 3, url: `${REPOSITORY_URL}/-/merge_requests/3`, existed: false },
        }),
      ],
    });
    const { section } = renderWaiting([
      { ...packaged, id: id(), status: 'waiting' },
      { ...packaged, status: 'done' },
    ]);

    const [card] = within(section).getAllByRole('listitem');
    if (!card) throw new Error('The card is missing');
    expect(card).toHaveTextContent('Merge Request mit dem Plan-Paket in vereins-app anlegen');
    expect(section).toHaveTextContent('Merge Request mit dem Plan-Paket in vereins-app angelegt');
    fireEvent.click(within(card).getByRole('button', { name: 'Ansehen' }));
    // A merge request is written with "!", and a commit links to itself.
    expect(within(card).getByRole('link', { name: '!3' })).toHaveAttribute(
      'href',
      `${REPOSITORY_URL}/-/merge_requests/3`,
    );
    expect(within(card).getByRole('link', { name: 'angelegt' })).toHaveAttribute(
      'href',
      `${REPOSITORY_URL}/-/commit/abc`,
    );
  });

  it('counts what the person can decide', () => {
    const requests = [
      request(),
      request({ status: 'failed' }),
      request({ status: 'approved' }),
      request({ status: 'done' }),
    ];

    expect(gitRequestsToDecide({ canApprove: true, requests })).toBe(2);
    expect(gitRequestsToDecide({ canApprove: false, requests })).toBe(0);
    expect(gitRequestsToDecide(undefined)).toBe(0);
    expect(
      waitingCount({
        proposals: [],
        hands: [],
        votes: [],
        gitRequests: 2,
        canDecide: true,
        canConfirmDecisions: true,
      }),
    ).toBe(2);
    expect(requestProgress(request({ actions: [] }))).toEqual({
      issues: 0,
      total: 0,
      done: 0,
      error: null,
    });
  });
});

type Call = { method: string; url: string; body: unknown };

/** A server that answers the dialogs; `answers` gives a response by "METHOD url". */
function stubServer(answers: Record<string, () => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        url,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      const answer = answers[`${method} ${url}`];
      return Promise.resolve(answer ? answer() : new Response(null, { status: 404 }));
    }),
  );
  return calls;
}

function inDialog(content: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Dialog open>{content}</Dialog>
    </QueryClientProvider>,
  );
}

const PLAN: GitIssuePlan = {
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
  milestones: [
    {
      number: 1,
      title: 'Grundgerüst',
      tasks: [
        {
          id: SETUP,
          text: 'Projekt aufsetzen',
          state: 'done',
          issue: { number: 4, url: `${REPOSITORY_URL}/-/issues/4` },
        },
        { id: LOGIN, text: 'Login per Link', state: 'free', issue: null },
      ],
    },
    {
      number: 2,
      title: 'Mitglieder',
      tasks: [
        { id: LIST, text: 'Mitgliederliste', state: 'free', issue: null },
        { id: id(), text: 'Beitragsstatus', state: 'requested', issue: null },
        { id: null, text: 'Noch ohne Kennung', state: 'free', issue: null },
      ],
    },
  ],
};

describe('IssuesDialog', () => {
  function renderDialog(plan: GitIssuePlan | null, answers: Record<string, () => Response> = {}) {
    const calls = stubServer({
      ...(plan ? { [`GET ${BASE}/issues`]: () => Response.json(plan) } : {}),
      ...answers,
    });
    inDialog(<IssuesDialog projectId={PROJECT} />);
    return { calls, dialog: screen.getByRole('dialog', { name: 'Issues aus dem Plan' }) };
  }

  const posted = (calls: Call[]) => calls.filter((call) => call.method === 'POST');

  it('lists the tasks by milestone, with what has an issue or waits, and all free ones ticked', async () => {
    const { dialog } = renderDialog(PLAN);

    expect(await within(dialog).findByText('verein/vereins-app')).toBeVisible();
    const first = within(dialog).getByRole('region', { name: 'Meilenstein 1: Grundgerüst' });
    const second = within(dialog).getByRole('region', { name: 'Meilenstein 2: Mitglieder' });
    expect(first).toHaveTextContent('1 von 2 angelegt');
    expect(within(first).getByRole('link', { name: '#4' })).toHaveAttribute(
      'href',
      `${REPOSITORY_URL}/-/issues/4`,
    );
    expect(within(first).getByRole('checkbox', { name: 'Projekt aufsetzen' })).toBeDisabled();
    expect(within(first).getByRole('checkbox', { name: 'Login per Link' })).toBeChecked();
    expect(within(second).getByRole('checkbox', { name: 'Mitgliederliste' })).toBeChecked();
    // A task that waits, and one the server gave no id yet, cannot be chosen.
    expect(within(second).getByText('wartet')).toBeVisible();
    expect(within(second).getByRole('checkbox', { name: 'Beitragsstatus' })).toBeDisabled();
    expect(within(second).getByRole('checkbox', { name: 'Noch ohne Kennung' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '2 Issues anlegen' })).toBeEnabled();
  });

  it('creates the issues of the ticked tasks in one step for who may approve', async () => {
    const requestId = id();
    const { calls, dialog } = renderDialog(PLAN, {
      [`POST ${BASE}/issues`]: () => Response.json({ requestId }, { status: 201 }),
      [`POST ${BASE}/requests/approve`]: () => Response.json({ approved: 1 }),
    });

    // Unticking a whole milestone leaves one task.
    fireEvent.click(
      await within(dialog).findByRole('checkbox', { name: 'Alle Aufgaben von Mitglieder' }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '1 Issue anlegen' }));

    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Die Issues werden angelegt.',
    );
    expect(posted(calls)).toEqual([
      { method: 'POST', url: `${BASE}/issues`, body: { taskIds: [LOGIN] } },
      { method: 'POST', url: `${BASE}/requests/approve`, body: { requestIds: [requestId] } },
    ]);
  });

  it('lays the request before the approvers for everyone else', async () => {
    const { calls, dialog } = renderDialog(
      { ...PLAN, canApprove: false, hasAccount: false },
      { [`POST ${BASE}/issues`]: () => Response.json({ requestId: id() }, { status: 201 }) },
    );

    fireEvent.click(
      await within(dialog).findByRole('button', { name: '2 Issues zur Freigabe vorlegen' }),
    );

    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Vorgelegt. Der Antrag wartet unter „Wartet auf dich“ auf die Freigabe.',
    );
    expect(posted(calls).map((call) => call.url)).toEqual([`${BASE}/issues`]);
    expect(posted(calls)[0]?.body).toEqual({ taskIds: [LOGIN, LIST] });
  });

  it('tells an approver without a GitLab account that approving needs it', async () => {
    const { dialog } = renderDialog({ ...PLAN, hasAccount: false });

    expect(
      await within(dialog).findByText(/Zum Freigeben brauchst du dein GitLab-Konto\./),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: '2 Issues zur Freigabe vorlegen' }),
    ).toBeEnabled();
  });

  it('needs a ticked task, and says when a task was taken or something failed', async () => {
    const answer = { status: 409, code: 'already_running' };
    const { dialog } = renderDialog(PLAN, {
      [`POST ${BASE}/issues`]: () =>
        Response.json({ error: { code: answer.code, message: 'x' } }, { status: answer.status }),
    });

    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Login per Link' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Mitgliederliste' }));
    expect(within(dialog).getByRole('button', { name: 'Issues anlegen' })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Mitgliederliste' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '1 Issue anlegen' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Für eine der Aufgaben gibt es schon ein Issue.',
    );

    answer.status = 500;
    answer.code = 'internal';
    fireEvent.click(within(dialog).getByRole('button', { name: '1 Issue anlegen' }));
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Das hat nicht geklappt.');
    });
  });

  it('says when the approval did not follow the request', async () => {
    const { dialog } = renderDialog(PLAN, {
      [`POST ${BASE}/issues`]: () => Response.json({ requestId: id() }, { status: 201 }),
      [`POST ${BASE}/requests/approve`]: () =>
        Response.json({ error: { code: 'forbidden', message: 'x' } }, { status: 403 }),
    });

    fireEvent.click(await within(dialog).findByRole('button', { name: '2 Issues anlegen' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Der Antrag ist angelegt, aber die Freigabe hat nicht geklappt.',
    );
  });

  it('only shows the tasks to viewers', async () => {
    const { dialog } = renderDialog({ ...PLAN, canRequest: false, canApprove: false });

    expect(await within(dialog).findByText('Issues legen Owner und Editoren an.')).toBeVisible();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /anlegen|vorlegen/ })).toBeNull();
    expect(within(dialog).getByRole('link', { name: '#4' })).toBeVisible();
  });

  it('says what is missing: a repository, tasks, or the answer of the server', async () => {
    const bare = renderDialog({ ...PLAN, repository: null });
    expect(
      await within(bare.dialog).findByText(/Dieses Projekt hat noch kein Repository\./),
    ).toBeVisible();
  });

  it('says that the plan names no tasks', async () => {
    const { dialog } = renderDialog({
      ...PLAN,
      milestones: [{ number: 1, title: 'Leer', tasks: [] }],
    });

    expect(await within(dialog).findByText('Der Plan nennt noch keine Aufgaben.')).toBeVisible();
  });

  it('tells when the tasks could not be loaded', async () => {
    const { dialog } = renderDialog(null);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Die Aufgaben konnten nicht geladen werden.',
    );
  });
});

describe('GitLogDialog', () => {
  function renderLog(log: GitLog | null) {
    stubServer(log ? { [`GET ${BASE}/log`]: () => Response.json(log) } : {});
    inDialog(<GitLogDialog projectId={PROJECT} />);
    return screen.getByRole('dialog', { name: 'Git-Protokoll' });
  }

  it('lists every request with who asked, who decided, and what became of it', async () => {
    const [milestone, first, second] = request().actions;
    if (!milestone || !first || !second) throw new Error('The actions are missing');
    const at = '2026-10-09T12:30:00.000Z';
    const dialog = renderLog({
      requests: [
        request({
          status: 'done',
          decidedBy: { userId: OLGA, name: 'Olga' },
          decidedAt: at,
          finishedAt: at,
          actions: [
            { ...milestone, status: 'done', result: { number: null, url: null, existed: false } },
            {
              ...first,
              status: 'done',
              result: { number: 4, url: `${REPOSITORY_URL}/-/issues/4`, existed: false },
            },
            {
              ...second,
              status: 'done',
              result: { number: 5, url: `${REPOSITORY_URL}/-/issues/5`, existed: false },
            },
          ],
        }),
        request({
          status: 'rejected',
          decidedBy: { userId: null, name: '' },
          decidedAt: at,
          actions: [{ ...first, id: id(), status: 'dropped' }],
        }),
        request({ status: 'withdrawn', requestedBy: { userId: null, name: '' } }),
      ],
    });

    const [done, rejected, withdrawn] = await within(dialog).findAllByRole('listitem');
    if (!done || !rejected || !withdrawn) throw new Error('The entries are missing');
    expect(done).toHaveTextContent('2 Issues in vereins-app angelegt');
    expect(done).toHaveTextContent('Ausgeführt');
    expect(done).toHaveTextContent(
      /Vorgelegt von Edgar Editor, .+ · Freigegeben von Olga, .+ · via Covibes/,
    );
    // The actions unfold, with links to what they made.
    fireEvent.click(within(done).getByRole('button', { name: '3 Aktionen ansehen' }));
    expect(within(done).getByRole('link', { name: '#5' })).toHaveAttribute(
      'href',
      `${REPOSITORY_URL}/-/issues/5`,
    );
    expect(within(done).getByText('angelegt')).toBeVisible();
    fireEvent.click(within(done).getByRole('button', { name: 'Aktionen ausblenden' }));
    expect(within(done).queryByRole('link', { name: '#5' })).toBeNull();

    expect(rejected).toHaveTextContent('1 Issue in vereins-app anlegen');
    expect(rejected).toHaveTextContent('Abgelehnt');
    // Someone whose account is gone is still someone.
    expect(rejected).toHaveTextContent(/Abgelehnt von Jemand, /);
    expect(rejected).not.toHaveTextContent('via Covibes');
    fireEvent.click(within(rejected).getByRole('button', { name: '1 Aktion ansehen' }));
    expect(within(rejected).getByText('nicht ausgeführt')).toBeVisible();

    expect(withdrawn).toHaveTextContent('Zurückgezogen');
    expect(withdrawn).toHaveTextContent(/Vorgelegt von Jemand, /);
    expect(withdrawn).not.toHaveTextContent('Freigegeben');
  });

  it('says how far a failed request came', async () => {
    const [milestone, first] = request().actions;
    if (!milestone || !first) throw new Error('The actions are missing');
    const dialog = renderLog({
      requests: [
        request({
          status: 'failed',
          actions: [
            { ...milestone, status: 'done', result: { number: null, url: null, existed: true } },
            { ...first, status: 'failed', error: { code: 'unreachable', detail: '' } },
          ],
        }),
      ],
    });

    const entry = await within(dialog).findByRole('listitem');
    expect(entry).toHaveTextContent('Fehlgeschlagen · 1 von 2');
    fireEvent.click(within(entry).getByRole('button', { name: '2 Aktionen ansehen' }));
    expect(entry).toHaveTextContent('GitLab war nicht erreichbar.');
  });

  it('says when there is nothing yet, or the log could not be loaded', async () => {
    const empty = renderLog({ requests: [] });
    expect(await within(empty).findByText('Noch keine Git-Aktionen.')).toBeVisible();
  });

  it('tells when the log could not be loaded', async () => {
    const dialog = renderLog(null);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Das Protokoll konnte nicht geladen werden.',
    );
  });
});
