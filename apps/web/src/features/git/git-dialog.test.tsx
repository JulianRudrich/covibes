import type { GitConnection, GitRepository, GitReturn, GitState } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { GitDialog } from '@web/features/git/git-dialog';

const PROJECT_ID = '8b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const BASE = `/api/projects/${PROJECT_ID}/git`;

const REPOSITORIES: GitRepository[] = [
  {
    id: 101,
    path: 'beispiel-verein/vereins-app',
    name: 'Vereins-App',
    url: 'https://gitlab.example.com/beispiel-verein/vereins-app',
    defaultBranch: 'main',
  },
  {
    id: 103,
    path: 'olga.beispiel/notizen',
    name: 'Notizen',
    url: 'https://gitlab.example.com/olga.beispiel/notizen',
    defaultBranch: null,
  },
];

const CONNECTION: GitConnection = {
  baseUrl: 'https://gitlab.example.com',
  account: { username: 'olga.beispiel', name: 'Olga Beispiel' },
  connectedBy: { userId: '8b111111-1111-4111-8111-111111111111', name: 'Olga' },
  connectedAt: '2026-10-04T10:00:00.000Z',
  repository: null,
};

type Call = { method: string; url: string; body: unknown };

/**
 * A server that keeps the connection of the project: it answers the state, starts the flow, lists
 * and picks repositories and disconnects. `fail` names the calls that fail instead.
 */
function stubGit(initial: GitState, fail: string[] = []) {
  const server = { state: initial };
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      const path = url.split('?')[0] ?? url;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, url, body });
      const key = `${method} ${path}`;
      if (fail.includes(key)) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'internal', message: 'Broken.' } }), {
            status: 500,
          }),
        );
      }
      if (key === `GET ${BASE}`) return Promise.resolve(Response.json(server.state));
      if (key === `POST ${BASE}/connect`) {
        return Promise.resolve(
          Response.json({ url: 'https://gitlab.example.com/oauth/authorize?state=signed' }),
        );
      }
      if (key === `GET ${BASE}/repositories`) {
        const search = new URL(url, 'http://localhost').searchParams.get('search') ?? '';
        return Promise.resolve(
          Response.json(
            REPOSITORIES.filter((repository) => repository.path.includes(search.toLowerCase())),
          ),
        );
      }
      if (key === `PUT ${BASE}/repository`) {
        const { repositoryId } = body as { repositoryId: number };
        const repository = REPOSITORIES.find((entry) => entry.id === repositoryId) ?? null;
        if (server.state.connection) {
          server.state = {
            ...server.state,
            connection: { ...server.state.connection, repository },
          };
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (key === `DELETE ${BASE}`) {
        server.state = { ...server.state, connection: null };
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
  return calls;
}

function renderDialog(
  state: Partial<GitState> = {},
  { returned, fail = [] }: { returned?: GitReturn; fail?: string[] } = {},
) {
  const calls = stubGit({ available: true, canManage: true, connection: null, ...state }, fail);
  const goTo = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Dialog open>
        <GitDialog projectId={PROJECT_ID} returned={returned} goTo={goTo} />
      </Dialog>
    </QueryClientProvider>,
  );
  return { calls, goTo, dialog: screen.getByRole('dialog', { name: 'Repository' }) };
}

const changes = (calls: Call[]) =>
  calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.url}`);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitDialog without a connection', () => {
  it('sends an owner to GitLab to connect', async () => {
    const { calls, goTo, dialog } = renderDialog();

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Mit GitLab verbinden' }));

    await waitFor(() => {
      expect(goTo).toHaveBeenCalledWith('https://gitlab.example.com/oauth/authorize?state=signed');
    });
    expect(changes(calls)).toEqual([`POST ${BASE}/connect`]);
    expect(dialog).toHaveTextContent('Die Agents lesen es mit deinem Zugriff für alle Mitglieder');
  });

  it('tells when the way to GitLab could not be started', async () => {
    const { goTo, dialog } = renderDialog({}, { fail: [`POST ${BASE}/connect`] });

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Mit GitLab verbinden' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Der Weg zu GitLab hat nicht geklappt.',
    );
    expect(goTo).not.toHaveBeenCalled();
  });

  it('tells everyone else that an owner can connect', async () => {
    const { dialog } = renderDialog({ canManage: false });

    expect(
      await within(dialog).findByText(
        'Es ist noch kein Repository verbunden. Das kann ein Owner des Projekts tun.',
      ),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Mit GitLab verbinden' })).toBeNull();
  });

  it('says when the server is not set up for GitLab', async () => {
    const { dialog } = renderDialog({ available: false });

    expect(
      await within(dialog).findByText(/Dieser Server ist nicht für GitLab eingerichtet\./),
    ).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Mit GitLab verbinden' })).toBeNull();
  });

  it('says how the way back from GitLab ended when nothing was connected', async () => {
    const denied = renderDialog({}, { returned: 'denied' });
    expect(await within(denied.dialog).findByRole('alert')).toHaveTextContent(
      'Du hast den Zugriff in GitLab abgelehnt. Es wurde nichts verbunden.',
    );
  });

  it('tells when the connection could not be loaded', async () => {
    const { dialog } = renderDialog({}, { fail: [`GET ${BASE}`] });

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Die Verbindung konnte nicht geladen werden.',
    );
  });
});

describe('GitDialog with a connection', () => {
  it('lets the owner pick the repository from the account’s repositories', async () => {
    const { calls, dialog } = renderDialog({ connection: CONNECTION }, { returned: 'connected' });

    expect(
      await within(dialog).findByText('Verbunden als Olga Beispiel (@olga.beispiel), von Olga.'),
    ).toBeVisible();
    const picker = await within(dialog).findByRole('region', { name: 'Repository wählen' });
    const options = await within(picker).findAllByRole('button');
    expect(options.map((option) => option.textContent)).toEqual([
      'Vereins-Appbeispiel-verein/vereins-app',
      'Notizenolga.beispiel/notizen',
    ]);

    fireEvent.click(options[0] as HTMLElement);

    // The connection now names the repository, with a link to it.
    const link = await within(dialog).findByRole('link', { name: /beispiel-verein\/vereins-app/ });
    expect(link).toHaveAttribute('href', REPOSITORIES[0]?.url);
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(within(dialog).getByText('Vereins-App')).toBeVisible();
    expect(changes(calls)).toEqual([`PUT ${BASE}/repository`]);
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ repositoryId: 101 });
    expect(within(dialog).queryByRole('region', { name: 'Repository wählen' })).toBeNull();
  });

  it('narrows the repositories by a search', async () => {
    const { calls, dialog } = renderDialog({ connection: CONNECTION });
    const search = await within(dialog).findByRole('searchbox', { name: 'Repository suchen' });
    await within(dialog).findByText('Vereins-App');

    fireEvent.change(search, { target: { value: ' notiz ' } });

    await waitFor(() => {
      expect(within(dialog).queryByText('Vereins-App')).not.toBeInTheDocument();
    });
    expect(await within(dialog).findByText('Notizen')).toBeVisible();
    expect(calls.at(-1)?.url).toBe(`${BASE}/repositories?search=notiz`);

    fireEvent.change(search, { target: { value: 'gibtesnicht' } });
    expect(await within(dialog).findByText('Kein Repository gefunden.')).toBeVisible();
  });

  it('offers to connect again when the repositories cannot be loaded', async () => {
    const { goTo, dialog } = renderDialog(
      { connection: CONNECTION },
      { fail: [`GET ${BASE}/repositories`] },
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Die Repositories konnten nicht geladen werden.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Neu verbinden' }));

    await waitFor(() => {
      expect(goTo).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the repository and lets the owner change it', async () => {
    const { dialog } = renderDialog({
      connection: { ...CONNECTION, repository: REPOSITORIES[0] ?? null },
    });
    await within(dialog).findByRole('link', { name: /beispiel-verein\/vereins-app/ });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Ändern' }));

    const picker = await within(dialog).findByRole('region', { name: 'Repository wählen' });
    const current = await within(picker).findByRole('button', { name: /Vereins-App/ });
    expect(current).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(picker).getByRole('button', { name: /Notizen/ }));

    expect(
      await within(dialog).findByRole('link', { name: /olga\.beispiel\/notizen/ }),
    ).toBeVisible();
  });

  it('ends the connection after a second click', async () => {
    const { calls, dialog } = renderDialog({
      connection: { ...CONNECTION, repository: REPOSITORIES[0] ?? null },
    });

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Verbindung trennen' }));
    expect(changes(calls)).toEqual([]);
    expect(
      within(dialog).getByText('Die Agents können das Repository dann nicht mehr lesen.'),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wirklich trennen' }));

    expect(
      await within(dialog).findByRole('button', { name: 'Mit GitLab verbinden' }),
    ).toBeVisible();
    expect(changes(calls)).toEqual([`DELETE ${BASE}`]);
  });

  it('tells when the connection could not be ended', async () => {
    const { dialog } = renderDialog({ connection: CONNECTION }, { fail: [`DELETE ${BASE}`] });

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Verbindung trennen' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wirklich trennen' }));

    expect(
      await within(dialog).findByText(/Die Verbindung konnte nicht getrennt werden\./),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Verbindung trennen' })).toBeVisible();
  });

  it('shows everyone else what is connected, without anything to change', async () => {
    const { calls, dialog } = renderDialog({
      canManage: false,
      connection: { ...CONNECTION, repository: REPOSITORIES[0] ?? null },
    });

    await within(dialog).findByRole('link', { name: /beispiel-verein\/vereins-app/ });

    expect(within(dialog).getByText(/Verbunden als Olga Beispiel/)).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Ändern' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Verbindung trennen' })).toBeNull();
    // The repositories of the account are the owner's to see.
    expect(calls.some((call) => call.url.includes('/repositories'))).toBe(false);
  });

  it('tells everyone else that the owner still picks the repository', async () => {
    const { calls, dialog } = renderDialog({ canManage: false, connection: CONNECTION });

    expect(await within(dialog).findByText('Olga wählt noch das Repository aus.')).toBeVisible();
    expect(within(dialog).queryByRole('region', { name: 'Repository wählen' })).toBeNull();
    expect(calls.some((call) => call.url.includes('/repositories'))).toBe(false);
  });
});
