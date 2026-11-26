import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { GitDialog } from '@web/features/git/git-dialog';

const projectId = '8b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const base = `/api/projects/${projectId}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitHub repository connection', () => {
  it('lets an owner choose an installation and repository', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString();
        const method = init?.method ?? 'GET';
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
        calls.push({ url, method, body });
        if (url === `${base}/git`)
          return Promise.resolve(
            Response.json({
              available: true,
              canManage: true,
              account: null,
              connection: null,
              sync: null,
            }),
          );
        if (url === '/api/github/account')
          return Promise.resolve(
            Response.json({
              available: true,
              account: { username: 'maya', name: 'Maya', baseUrl: 'https://github.com' },
              installUrl: 'https://github.com/apps/covibes/installations/new',
            }),
          );
        if (url === `${base}/github/installations?page=1`)
          return Promise.resolve(
            Response.json({
              installations: [{ id: 12, account: 'northstar', permissions: {} }],
              more: true,
            }),
          );
        if (url === `${base}/github/installations?page=2`)
          return Promise.resolve(
            Response.json({
              installations: [{ id: 13, account: 'second-team', permissions: {} }],
              more: false,
            }),
          );
        if (url.startsWith(`${base}/github/repositories?`))
          return Promise.resolve(
            Response.json([
              {
                id: 42,
                name: 'studio',
                path: 'northstar/studio',
                url: 'https://github.com/northstar/studio',
                defaultBranch: 'main',
                provider: 'github',
              },
            ]),
          );
        if (url === `${base}/github/repository` && method === 'PUT')
          return Promise.resolve(new Response(null, { status: 204 }));
        return Promise.resolve(new Response(null, { status: 404 }));
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Dialog open>
          <GitDialog projectId={projectId} />
        </Dialog>
      </QueryClientProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Repository' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'GitHub' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Weiter' }));
    expect(await within(dialog).findByRole('button', { name: 'second-team' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zurück' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'northstar' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /northstar\/studio/ }));
    await waitFor(() => {
      expect(calls).toContainEqual({
        url: `${base}/github/repository`,
        method: 'PUT',
        body: { installationId: 12, repositoryId: 42 },
      });
    });
  });

  it('offers GitHub authorization after returning to the repository dialog', async () => {
    const goTo = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url === `${base}/git`)
          return Promise.resolve(
            Response.json({
              available: false,
              canManage: true,
              account: null,
              connection: null,
              sync: null,
            }),
          );
        if (url === '/api/github/account')
          return Promise.resolve(
            Response.json({ available: true, account: null, installUrl: null }),
          );
        if (url === '/api/github/account/connect')
          return Promise.resolve(
            Response.json({ url: 'https://github.com/login/oauth/authorize?state=test' }),
          );
        return Promise.resolve(new Response(null, { status: 404 }));
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Dialog open>
          <GitDialog projectId={projectId} githubReturned="connected" goTo={goTo} />
        </Dialog>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Mit GitHub verbinden' }));
    await waitFor(() => {
      expect(goTo).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?state=test');
    });
  });
});
