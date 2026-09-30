import type { ApiErrorBody } from '@covibes/shared';
import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

import { App } from '@web/app';
import { createQueryClient } from '@web/lib/query-client';
import { createAppRouter } from '@web/router';

type Handler = (init: RequestInit | undefined) => { status?: number; body: unknown };

/**
 * Replaces `fetch` for `/api` calls. Keys are `METHOD /api/path`; unknown routes answer 404 in the
 * server's error format. Returns the mock to inspect requests.
 */
export function stubApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const handler = routes[`${init?.method ?? 'GET'} ${url}`];
    const notFound: ApiErrorBody = { error: { code: 'not_found', message: 'Not found.' } };
    const { status = 200, body } = handler ? handler(init) : { status: 404, body: notFound };
    // "No content" answers must not have a body.
    if (status === 204) return Promise.resolve(new Response(null, { status }));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Renders the whole app at `path` with a fresh cache and an in-memory history. */
export function renderApp(path: string) {
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(<App router={router} queryClient={queryClient} />);
  return router;
}
