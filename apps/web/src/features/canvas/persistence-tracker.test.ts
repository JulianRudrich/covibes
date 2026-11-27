import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersistenceTracker } from '@web/features/canvas/persistence-tracker';

const receipt = () => Response.json({ status: 'saved', savedAt: '2026-11-26T08:00:00.000Z' });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('document persistence', () => {
  it('waits for transport sync and a database receipt', async () => {
    const fetcher = vi.fn().mockResolvedValue(receipt());
    vi.stubGlobal('fetch', fetcher);
    const states = vi.fn();
    const tracker = new PersistenceTracker('board:test', states);
    tracker.connection(true, false);
    tracker.changed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(states).toHaveBeenLastCalledWith('syncing');
    tracker.connection(true, true);
    await vi.advanceTimersByTimeAsync(600);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(states).toHaveBeenLastCalledWith('saved');
    tracker.destroy();
  });

  it('does not acknowledge edits made while a save is in flight', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(receipt());
    vi.stubGlobal('fetch', fetcher);
    const states = vi.fn();
    const tracker = new PersistenceTracker('board:test', states);
    tracker.connection(true, true);
    await vi.advanceTimersByTimeAsync(600);
    tracker.changed();
    finish(receipt());
    await vi.advanceTimersByTimeAsync(0);
    expect(states).not.toHaveBeenCalledWith('saved');
    await vi.advanceTimersByTimeAsync(600);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(states).toHaveBeenLastCalledWith('saved');
    tracker.destroy();
  });

  it('reports errors and retries only after an explicit retry', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(receipt());
    vi.stubGlobal('fetch', fetcher);
    const states = vi.fn();
    const tracker = new PersistenceTracker('board:test', states);
    tracker.connection(true, true);
    await vi.advanceTimersByTimeAsync(600);
    expect(states).toHaveBeenLastCalledWith('error');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledOnce();
    tracker.retry();
    await vi.advanceTimersByTimeAsync(600);
    expect(states).toHaveBeenLastCalledWith('saved');
    tracker.destroy();
  });

  it('requires a fresh receipt after a disconnect during a save', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(receipt());
    vi.stubGlobal('fetch', fetcher);
    const states = vi.fn();
    const tracker = new PersistenceTracker('board:test', states);
    tracker.connection(true, true);
    await vi.advanceTimersByTimeAsync(600);
    tracker.connection(false, false);
    finish(receipt());
    await vi.advanceTimersByTimeAsync(0);
    expect(states).not.toHaveBeenCalledWith('saved');
    tracker.connection(true, true);
    await vi.advanceTimersByTimeAsync(600);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(states).toHaveBeenLastCalledWith('saved');
    tracker.destroy();
  });
});
