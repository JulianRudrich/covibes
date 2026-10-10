import type { UsageState } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsageLimitNote } from '@web/features/usage/limit-note';
import { usageStateQueryKey } from '@web/features/usage/queries';
import { formatUntil } from '@web/lib/format';

// The note above the composer while a limit of the AI is reached (spec 31a).
const PROJECT_ID = '0c6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const STATE_URL = `/api/projects/${PROJECT_ID}/usage/state`;

const FREE = { reached: false, resetsAt: null };
const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();

function renderNote(state: UsageState | null) {
  const server = { state };
  const asked = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      asked(url);
      return Promise.resolve(
        url === STATE_URL && server.state
          ? Response.json(server.state)
          : new Response(JSON.stringify({ error: { code: 'internal', message: 'x' } }), {
              status: 500,
            }),
      );
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <UsageLimitNote projectId={PROJECT_ID} />
    </QueryClientProvider>,
  );
  return {
    asked,
    container: view.container,
    /** The usage changed; the live channel loads the state again. */
    arrive: (next: UsageState) => {
      server.state = next;
      return queryClient.invalidateQueries({ queryKey: usageStateQueryKey(PROJECT_ID) });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UsageLimitNote', () => {
  it('shows nothing while no limit is reached, and nothing while it is not known', async () => {
    const free = renderNote({ project: FREE, user: FREE });
    await waitFor(() => {
      expect(free.asked).toHaveBeenCalledWith(STATE_URL);
    });
    expect(free.container).toBeEmptyDOMElement();

    const unknown = renderNote(null);
    await waitFor(() => {
      expect(unknown.asked).toHaveBeenCalledWith(STATE_URL);
    });
    expect(unknown.container).toBeEmptyDOMElement();
  });

  it('says that the project’s month is used up, when the agents answer again, and what goes on', async () => {
    const resetsAt = inDays(20);
    renderNote({ project: { reached: true, resetsAt }, user: FREE });

    const note = await screen.findByRole('status');

    expect(note).toHaveTextContent(
      `Das KI-Limit dieses Projekts für diesen Monat ist erreicht. Die Agents antworten wieder ab ${formatUntil(resetsAt, 'de')}; alles andere geht weiter.`,
    );
  });

  it('says to a person that their own day is used up', async () => {
    const resetsAt = inDays(0.3);
    renderNote({ project: FREE, user: { reached: true, resetsAt } });

    expect(await screen.findByRole('status')).toHaveTextContent(
      `Dein KI-Limit für heute ist erreicht. Die Agents antworten dir wieder ab ${formatUntil(resetsAt, 'de')}; alles andere geht weiter.`,
    );
  });

  it('names the project’s limit when both are reached: it holds for everyone', async () => {
    renderNote({
      project: { reached: true, resetsAt: inDays(20) },
      user: { reached: true, resetsAt: inDays(0.3) },
    });

    const note = await screen.findByRole('status');

    expect(note).toHaveTextContent('Das KI-Limit dieses Projekts');
    expect(note).not.toHaveTextContent('Dein KI-Limit');
  });

  it('comes and goes with the state', async () => {
    const { arrive, container } = renderNote({ project: FREE, user: FREE });
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });

    await arrive({ project: { reached: true, resetsAt: inDays(3) }, user: FREE });
    expect(await screen.findByRole('status')).toHaveTextContent('Das KI-Limit dieses Projekts');

    // A new month: the limit is free again.
    await arrive({ project: FREE, user: FREE });
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });
});
