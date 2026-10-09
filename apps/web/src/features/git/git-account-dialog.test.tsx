import type { GitAccountState, GitReturn } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { GitAccountDialog } from '@web/features/git/git-account-dialog';

const ACCOUNT = '/api/git/account';
const PROJECT_ID = '8b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';

const CONNECTED: GitAccountState = {
  available: true,
  account: {
    baseUrl: 'https://gitlab.example.com',
    username: 'olga.beispiel',
    name: 'Olga Beispiel',
  },
};

type Call = { method: string; url: string; body: unknown };

/** A server that keeps the person's account; `fail` names the calls that fail instead. */
function stubAccount(initial: GitAccountState, fail: string[] = []) {
  const server = { state: initial };
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      const key = `${method} ${url}`;
      calls.push({
        method,
        url,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      if (fail.includes(key)) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'internal', message: 'Broken.' } }), {
            status: 500,
          }),
        );
      }
      if (key === `GET ${ACCOUNT}`) return Promise.resolve(Response.json(server.state));
      if (key === `POST ${ACCOUNT}/connect`) {
        return Promise.resolve(
          Response.json({ url: 'https://gitlab.example.com/oauth/authorize?state=signed' }),
        );
      }
      if (key === `DELETE ${ACCOUNT}`) {
        server.state = { ...server.state, account: null };
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
  return calls;
}

function renderDialog(
  state: GitAccountState = { available: true, account: null },
  {
    returned,
    projectId,
    fail = [],
  }: { returned?: GitReturn; projectId?: string; fail?: string[] } = {},
) {
  const calls = stubAccount(state, fail);
  const goTo = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Dialog open>
        <GitAccountDialog projectId={projectId} returned={returned} goTo={goTo} />
      </Dialog>
    </QueryClientProvider>,
  );
  return { calls, goTo, dialog: screen.getByRole('dialog', { name: 'GitLab-Konto' }) };
}

const posted = (calls: Call[]) => calls.find((call) => call.method === 'POST')?.body;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitAccountDialog', () => {
  it('sends someone without an account to GitLab, and back to this dialog', async () => {
    const { calls, goTo, dialog } = renderDialog();

    expect(
      await within(dialog).findByText(/Git-Aktionen, die du freigibst, laufen unter deinem Namen/),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mit GitLab verbinden' }));

    await waitFor(() => {
      expect(goTo).toHaveBeenCalledWith('https://gitlab.example.com/oauth/authorize?state=signed');
    });
    expect(posted(calls)).toEqual({ origin: 'account' });
  });

  it('comes back to the project the person is in', async () => {
    const { calls, goTo, dialog } = renderDialog(undefined, { projectId: PROJECT_ID });

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Mit GitLab verbinden' }));

    await waitFor(() => {
      expect(goTo).toHaveBeenCalledTimes(1);
    });
    expect(posted(calls)).toEqual({ origin: 'account', projectId: PROJECT_ID });
  });

  it('names the account that is connected', async () => {
    const { dialog } = renderDialog(CONNECTED, { returned: 'connected' });

    expect(await within(dialog).findByText('Olga Beispiel')).toBeVisible();
    expect(within(dialog).getByText('@olga.beispiel · gitlab.example.com')).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Mit GitLab verbinden' })).toBeNull();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('disconnects the account after a second click, and says what goes with it', async () => {
    const { calls, dialog } = renderDialog(CONNECTED);

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Konto trennen' }));
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    expect(
      within(dialog).getByText('Projekte, deren Repository du gewählt hast, verlieren es.'),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wirklich trennen' }));

    expect(
      await within(dialog).findByRole('button', { name: 'Mit GitLab verbinden' }),
    ).toBeVisible();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('tells when the account could not be disconnected, or the way to GitLab not started', async () => {
    const stuck = renderDialog(CONNECTED, { fail: [`DELETE ${ACCOUNT}`] });
    fireEvent.click(await within(stuck.dialog).findByRole('button', { name: 'Konto trennen' }));
    fireEvent.click(within(stuck.dialog).getByRole('button', { name: 'Wirklich trennen' }));

    expect(await within(stuck.dialog).findByRole('alert')).toHaveTextContent(
      'Das Konto konnte nicht getrennt werden.',
    );
    expect(within(stuck.dialog).getByText('Olga Beispiel')).toBeVisible();
  });

  it('tells when the way to GitLab could not be started', async () => {
    const { goTo, dialog } = renderDialog(undefined, { fail: [`POST ${ACCOUNT}/connect`] });

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Mit GitLab verbinden' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Der Weg zu GitLab hat nicht geklappt.',
    );
    expect(goTo).not.toHaveBeenCalled();
  });

  it('says how the way back from GitLab ended when nothing was connected', async () => {
    const { dialog } = renderDialog(undefined, { returned: 'failed' });

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Die Verbindung mit GitLab hat nicht geklappt.',
    );
    expect(
      await within(dialog).findByRole('button', { name: 'Mit GitLab verbinden' }),
    ).toBeVisible();
  });

  it('says when the server is not set up for GitLab, or the account could not be loaded', async () => {
    const off = renderDialog({ available: false, account: null });
    expect(
      await within(off.dialog).findByText(/Dieser Server ist nicht für GitLab eingerichtet\./),
    ).toBeVisible();
    expect(within(off.dialog).queryByRole('button', { name: 'Mit GitLab verbinden' })).toBeNull();
  });

  it('tells when the account could not be loaded', async () => {
    const { dialog } = renderDialog(undefined, { fail: [`GET ${ACCOUNT}`] });

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Das Konto konnte nicht geladen werden.',
    );
  });
});
