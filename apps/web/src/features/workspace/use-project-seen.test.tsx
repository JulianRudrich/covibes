import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { awayQueryKey } from '@web/features/away/queries';
import { useProjectSeen } from '@web/features/workspace/use-project-seen';

const PROJECT_ID = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';

let visibility: DocumentVisibilityState = 'visible';
/** What the server answers: whether the person is back from an absence. */
let returned = false;
const fetchMock = vi.fn(() =>
  Promise.resolve(
    new Response(JSON.stringify({ returned }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ),
);

function Harness({ projectId }: { projectId: string }) {
  useProjectSeen(projectId);
  return null;
}

function renderHarness() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const cancel = vi.spyOn(queryClient, 'cancelQueries');
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness projectId={PROJECT_ID} />
    </QueryClientProvider>,
  );
  return { ...view, invalidate, cancel };
}

/** Brings the tab to the front or sends it to the background. */
function show(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  returned = false;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useProjectSeen', () => {
  it('reports an open project as seen at once and every two minutes', () => {
    renderHarness();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `/api/projects/${PROJECT_ID}/seen`,
      expect.objectContaining({ method: 'POST' }),
    );
    vi.advanceTimersByTime(119_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports nothing from a tab in the background, and again when it comes back', () => {
    visibility = 'hidden';
    renderHarness();
    vi.advanceTimersByTime(10 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();

    show('visible');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    show('hidden');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops with the project and survives a server that does not answer', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { unmount, invalidate } = renderHarness();
    // The failed report is swallowed: nothing is thrown, the next one is tried as usual.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invalidate).not.toHaveBeenCalled();

    unmount();
    vi.advanceTimersByTime(10 * 60_000);
    show('visible');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loads "Seit du weg warst" again when the server says the person is back (spec 23)', async () => {
    const { invalidate, cancel } = renderHarness();
    await vi.advanceTimersByTimeAsync(0);
    expect(invalidate).not.toHaveBeenCalled();

    // Hours later the tab comes to the front again.
    show('hidden');
    returned = true;
    show('visible');
    await vi.advanceTimersByTimeAsync(0);

    // A question still on its way is dropped first: its answer may be from before the return.
    const summary = { queryKey: awayQueryKey(PROJECT_ID), exact: true };
    expect(cancel).toHaveBeenCalledExactlyOnceWith(summary);
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(summary);
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
      invalidate.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
