import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { throttle } from '@web/lib/throttle';

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the first call right away', () => {
    const fn = vi.fn();
    throttle(fn, 33)('a');

    expect(fn).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('delivers only the last call of an interval, at its end', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 33);
    throttled('a');
    throttled('b');
    throttled('c');

    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(33);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('c');
  });

  it('runs right away again once the interval has passed', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 33);
    throttled('a');
    vi.advanceTimersByTime(50);
    throttled('b');

    expect(fn).toHaveBeenLastCalledWith('b');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('drops a pending call on cancel', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 33);
    throttled('a');
    throttled('b');
    throttled.cancel();
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledExactlyOnceWith('a');
  });
});
