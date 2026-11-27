import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { GithubAccountSection } from '@web/features/git/github-account-section';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('connects a GitHub account and returns to the project', async () => {
  const goTo = vi.fn();
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/github/account')
      return Promise.resolve(Response.json({ available: true, account: null, installUrl: null }));
    if (url === '/api/github/account/connect' && init?.method === 'POST')
      return Promise.resolve(
        Response.json({ url: 'https://github.com/login/oauth/authorize?state=signed' }),
      );
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <GithubAccountSection projectId="8b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de" goTo={goTo} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Mit GitHub verbinden' }));
  await waitFor(() => {
    expect(goTo).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?state=signed');
  });
  const call = fetcher.mock.calls.find(([url]) => url === '/api/github/account/connect');
  const body = call?.[1]?.body;
  expect(typeof body).toBe('string');
  if (typeof body !== 'string') throw new Error('Expected a JSON request body');
  expect(JSON.parse(body)).toEqual({
    origin: 'account',
    projectId: '8b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de',
  });
});
