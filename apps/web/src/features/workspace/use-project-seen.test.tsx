import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectSeen } from '@web/features/workspace/use-project-seen';

const PROJECT_ID = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';

let visibility: DocumentVisibilityState = 'visible';
const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

function Harness({ projectId }: { projectId: string }) {
  useProjectSeen(projectId);
  return null;
}

/** Brings the tab to the front or sends it to the background. */
function show(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
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
    render(<Harness projectId={PROJECT_ID} />);

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
    render(<Harness projectId={PROJECT_ID} />);
    vi.advanceTimersByTime(10 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();

    show('visible');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    show('hidden');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops with the project and survives a server that does not answer', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { unmount } = render(<Harness projectId={PROJECT_ID} />);
    // The failed report is swallowed: nothing is thrown, the next one is tried as usual.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();
    vi.advanceTimersByTime(10 * 60_000);
    show('visible');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
