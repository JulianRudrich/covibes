import type { GitConnection, GitState, GitSync, GitWebhook } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { GitDialog } from '@web/features/git/git-dialog';
import { gitQueryKey } from '@web/features/git/queries';

// The state from GitLab in the dialog "Repository" (spec 30a): when it was last read, reading
// now, and the webhook for owners.
const PROJECT_ID = '8b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const BASE = `/api/projects/${PROJECT_ID}/git`;

const CONNECTION: GitConnection = {
  baseUrl: 'https://gitlab.example.com',
  account: { username: 'olga.beispiel', name: 'Olga Beispiel' },
  connectedBy: { userId: '8b111111-1111-4111-8111-111111111111', name: 'Olga' },
  connectedAt: '2026-10-09T10:00:00.000Z',
  repository: {
    id: 101,
    path: 'beispiel-verein/vereins-app',
    name: 'Vereins-App',
    url: 'https://gitlab.example.com/beispiel-verein/vereins-app',
    defaultBranch: 'main',
  },
};

const WEBHOOK: GitWebhook = {
  url: `https://covibes.example.com/api/git/webhook/${PROJECT_ID}`,
  secret: 'first-secret-of-the-webhook',
};

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

type Call = { method: string; path: string; body: unknown };

function renderDialog({
  sync = null,
  canManage = true,
  available = true,
  queued = true,
  fail = [],
}: {
  sync?: GitSync | null;
  canManage?: boolean;
  available?: boolean;
  queued?: boolean;
  fail?: string[];
} = {}) {
  const server: { state: GitState; webhook: GitWebhook } = {
    state: { available, canManage, account: null, connection: CONNECTION, sync },
    webhook: WEBHOOK,
  };
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, path: url, body });
      const key = `${method} ${url}`;
      if (fail.includes(key)) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'internal', message: 'Broken.' } }), {
            status: 500,
          }),
        );
      }
      if (key === `GET ${BASE}`) return Promise.resolve(Response.json(server.state));
      if (key === `POST ${BASE}/sync`) return Promise.resolve(Response.json({ queued }));
      if (key === `GET ${BASE}/webhook`) return Promise.resolve(Response.json(server.webhook));
      if (key === `POST ${BASE}/webhook/renew`) {
        server.webhook = { ...WEBHOOK, secret: 'second-secret-of-the-webhook' };
        return Promise.resolve(Response.json(server.webhook));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Dialog open>
        <GitDialog projectId={PROJECT_ID} />
      </Dialog>
    </QueryClientProvider>,
  );
  return {
    calls,
    dialog: screen.getByRole('dialog', { name: 'Repository' }),
    /** The worker read the repository; the live channel loads the state again. */
    arrive: (read: GitSync) => {
      server.state = { ...server.state, sync: read };
      return queryClient.invalidateQueries({ queryKey: gitQueryKey(PROJECT_ID), exact: true });
    },
  };
}

const posts = (calls: Call[]) =>
  calls.filter((call) => call.method === 'POST').map((call) => call.path);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the state from GitLab', () => {
  it('says that nothing was read yet, and then when it was last read', async () => {
    const { dialog, arrive } = renderDialog();
    const section = await within(dialog).findByRole('region', { name: 'Stand aus GitLab' });

    expect(within(section).getByRole('status')).toHaveTextContent('Noch nicht abgeglichen.');

    await arrive({ syncedAt: ago(3), failed: false });

    await waitFor(() => {
      expect(within(section).getByRole('status')).toHaveTextContent(
        'Zuletzt abgeglichen: vor 3 Minuten.',
      );
    });
  });

  it('says when reading failed, and from when the state is', async () => {
    const { dialog, arrive } = renderDialog({ sync: { syncedAt: null, failed: true } });
    const section = await within(dialog).findByRole('region', { name: 'Stand aus GitLab' });

    expect(within(section).getByRole('alert')).toHaveTextContent(
      'Der Abgleich hat nicht geklappt. Vielleicht ist der Zugriff auf das Repository abgelaufen.',
    );

    await arrive({ syncedAt: ago(120), failed: true });

    await waitFor(() => {
      expect(within(section).getByRole('alert')).toHaveTextContent(
        'Der letzte Abgleich hat nicht geklappt. Der Stand ist von vor 2 Stunden.',
      );
    });
  });

  it('reads now on a click, and rests until the reading arrived', async () => {
    const { dialog, calls, arrive } = renderDialog({ sync: { syncedAt: ago(4), failed: false } });
    const section = await within(dialog).findByRole('region', { name: 'Stand aus GitLab' });
    const button = within(section).getByRole('button', { name: 'Jetzt abgleichen' });

    fireEvent.click(button);

    await waitFor(() => {
      expect(posts(calls)).toEqual([`${BASE}/sync`]);
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ force: true });
    await waitFor(() => {
      expect(within(section).getByRole('status')).toHaveTextContent('Wird abgeglichen …');
    });
    expect(button).toBeDisabled();

    await arrive({ syncedAt: ago(0), failed: false });

    await waitFor(() => {
      expect(within(section).getByRole('status')).toHaveTextContent('Zuletzt abgeglichen: jetzt.');
    });
    expect(button).toBeEnabled();
  });

  it('says so when the state was read a moment ago', async () => {
    const { dialog } = renderDialog({ sync: { syncedAt: ago(0), failed: false }, queued: false });
    const section = await within(dialog).findByRole('region', { name: 'Stand aus GitLab' });

    fireEvent.click(within(section).getByRole('button', { name: 'Jetzt abgleichen' }));

    expect(
      await within(section).findByText('Der Stand wurde gerade erst abgeglichen.'),
    ).toBeVisible();
    expect(within(section).getByRole('button', { name: 'Jetzt abgleichen' })).toBeEnabled();
  });

  it('tells when the reading could not be started', async () => {
    const { dialog } = renderDialog({ fail: [`POST ${BASE}/sync`] });
    const section = await within(dialog).findByRole('region', { name: 'Stand aus GitLab' });

    fireEvent.click(within(section).getByRole('button', { name: 'Jetzt abgleichen' }));

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Der Abgleich konnte nicht gestartet werden.',
    );
  });
});

describe('the webhook', () => {
  it('is for owners on a server that is set up for GitLab', async () => {
    const member = renderDialog({ canManage: false });
    const section = await within(member.dialog).findByRole('region', {
      name: 'Stand aus GitLab',
    });

    // Every member reads the state and may read it anew.
    expect(within(section).getByRole('button', { name: 'Jetzt abgleichen' })).toBeEnabled();
    expect(within(section).queryByRole('button', { name: 'Webhook einrichten …' })).toBeNull();
  });

  it('is not offered where the server has no GitLab set up', async () => {
    const { dialog } = renderDialog({ available: false });
    const section = await within(dialog).findByRole('region', { name: 'Stand aus GitLab' });

    expect(within(section).queryByRole('button', { name: 'Webhook einrichten …' })).toBeNull();
  });

  it('shows the address and keeps the secret hidden until the owner wants to see it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { dialog, calls } = renderDialog();
    // The secret is only asked for once the owner sets the webhook up.
    await within(dialog).findByRole('region', { name: 'Stand aus GitLab' });
    expect(calls.some((call) => call.path.endsWith('/webhook'))).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Webhook einrichten …' }));

    const webhook = await within(dialog).findByRole('region', { name: 'Webhook' });
    const address = await within(webhook).findByLabelText('Adresse');
    const secret = within(webhook).getByLabelText('Secret-Token');
    expect(address).toHaveValue(WEBHOOK.url);
    expect(secret).not.toHaveValue(WEBHOOK.secret);
    expect(dialog).not.toHaveTextContent(WEBHOOK.secret);

    // Copying works without showing it.
    fireEvent.click(within(webhook).getByRole('button', { name: 'Secret-Token kopieren' }));
    await within(webhook).findByRole('button', { name: 'Secret-Token kopiert' });
    expect(writeText).toHaveBeenCalledWith(WEBHOOK.secret);

    fireEvent.click(within(webhook).getByRole('button', { name: 'Secret-Token anzeigen' }));
    expect(secret).toHaveValue(WEBHOOK.secret);
    fireEvent.click(within(webhook).getByRole('button', { name: 'Secret-Token verbergen' }));
    expect(secret).not.toHaveValue(WEBHOOK.secret);
  });

  it('makes a new secret after asking again', async () => {
    const { dialog, calls } = renderDialog();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Webhook einrichten …' }));
    const webhook = await within(dialog).findByRole('region', { name: 'Webhook' });
    fireEvent.click(await within(webhook).findByRole('button', { name: 'Secret-Token anzeigen' }));
    expect(within(webhook).getByLabelText('Secret-Token')).toHaveValue(WEBHOOK.secret);

    fireEvent.click(within(webhook).getByRole('button', { name: 'Secret-Token neu erzeugen' }));

    // Nothing changed yet: the old secret stops working, so the owner confirms.
    expect(posts(calls)).toEqual([]);
    expect(webhook).toHaveTextContent('Das alte gilt dann nicht mehr.');
    fireEvent.click(within(webhook).getByRole('button', { name: 'Wirklich neu erzeugen' }));

    await waitFor(() => {
      expect(within(webhook).getByLabelText('Secret-Token')).toHaveValue(
        'second-secret-of-the-webhook',
      );
    });
    expect(posts(calls)).toEqual([`${BASE}/webhook/renew`]);
    expect(
      within(webhook).getByRole('button', { name: 'Secret-Token neu erzeugen' }),
    ).toBeVisible();
  });

  it('tells when it could not be loaded or renewed', async () => {
    const broken = renderDialog({ fail: [`GET ${BASE}/webhook`] });
    fireEvent.click(
      await within(broken.dialog).findByRole('button', { name: 'Webhook einrichten …' }),
    );

    expect(
      await within(broken.dialog).findByText('Der Webhook konnte nicht geladen werden.', {
        exact: false,
      }),
    ).toBeVisible();
  });
});
