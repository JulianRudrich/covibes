import type { GitConnection, GitState } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gitQueryKey } from '@web/features/git/queries';
import { GIT_SYNC_INTERVAL_MS, useGitSync } from '@web/features/git/use-git-sync';

// An open project keeps the status of its tasks up to date (spec 30a).
const PROJECT_ID = '8b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const BASE = `/api/projects/${PROJECT_ID}/git`;

const connection = (repositoryId: number): GitConnection => ({
  baseUrl: 'https://gitlab.example.com',
  account: { username: 'olga.beispiel', name: 'Olga Beispiel' },
  connectedBy: { userId: '8b111111-1111-4111-8111-111111111111', name: 'Olga' },
  connectedAt: '2026-10-09T10:00:00.000Z',
  repository: {
    id: repositoryId,
    path: 'beispiel-verein/vereins-app',
    name: 'Vereins-App',
    url: 'https://gitlab.example.com/beispiel-verein/vereins-app',
    defaultBranch: 'main',
  },
});

function setUp(repositoryId: number | null) {
  const server: { state: GitState } = {
    state: {
      available: true,
      canManage: false,
      account: null,
      connection: repositoryId === null ? null : connection(repositoryId),
      sync: null,
    },
  };
  const asked: unknown[] = [];
  const loaded = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if ((init?.method ?? 'GET') === 'GET' && url === BASE) {
        loaded();
        return Promise.resolve(Response.json(server.state));
      }
      if (init?.method === 'POST' && url === `${BASE}/sync`) {
        asked.push(typeof init.body === 'string' ? JSON.parse(init.body) : undefined);
        return Promise.resolve(Response.json({ queued: true }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = renderHook(
    () => {
      useGitSync(PROJECT_ID);
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
  return {
    asked,
    loaded,
    view,
    /** The owner picks another repository; the live channel loads the state again. */
    pick: (id: number | null) => {
      server.state = { ...server.state, connection: id === null ? null : connection(id) };
      return queryClient.invalidateQueries({ queryKey: gitQueryKey(PROJECT_ID), exact: true });
    },
  };
}

function seen(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** A real moment, in which requests that are on their way arrive. */
const moment = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      }),
  );

/** Waits with the real clock; `waitFor` polls with the interval the tests hold still. */
async function until(check: () => boolean) {
  for (let turn = 0; turn < 200 && !check(); turn += 1) await moment();
  expect(check()).toBe(true);
}

/** Lets the faked clock run, and what that started arrive. */
async function pass(milliseconds: number) {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
  for (let turn = 0; turn < 3; turn += 1) await moment();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useGitSync', () => {
  it('asks for the state when a project with a repository opens, without force', async () => {
    const { asked } = setUp(101);

    await waitFor(() => {
      expect(asked).toEqual([{}]);
    });
  });

  it('asks nothing for a project without a repository, until it gets one', async () => {
    const { asked, loaded, pick } = setUp(null);
    await waitFor(() => {
      expect(loaded).toHaveBeenCalledTimes(1);
    });
    expect(asked).toEqual([]);

    await act(() => pick(101));

    await waitFor(() => {
      expect(asked).toEqual([{}]);
    });
  });

  it('asks at once for another repository', async () => {
    const { asked, pick } = setUp(101);
    await waitFor(() => {
      expect(asked).toHaveLength(1);
    });

    await act(() => pick(103));

    await waitFor(() => {
      expect(asked).toHaveLength(2);
    });
  });

  it('asks again every few minutes while the tab shows, and not while it is hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { asked } = setUp(101);
    await until(() => asked.length === 1);

    await pass(GIT_SYNC_INTERVAL_MS);
    expect(asked).toHaveLength(2);

    seen('hidden');
    await pass(3 * GIT_SYNC_INTERVAL_MS);
    expect(asked).toHaveLength(2);

    // Back in a tab that rested: the state is asked for at once.
    seen('visible');
    await pass(0);
    expect(asked).toHaveLength(3);
  });

  it('does not ask twice when the person only looked away for a moment', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { asked } = setUp(101);
    await until(() => asked.length === 1);

    seen('hidden');
    await pass(20_000);
    seen('visible');
    await pass(0);

    expect(asked).toHaveLength(1);
  });

  it('stops asking when the project closes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { asked, view } = setUp(101);
    await until(() => asked.length === 1);

    view.unmount();
    await pass(2 * GIT_SYNC_INTERVAL_MS);
    seen('visible');
    await pass(0);

    expect(asked).toHaveLength(1);
  });
});
