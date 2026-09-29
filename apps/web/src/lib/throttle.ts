/**
 * Calls `fn` at most once per `intervalMs`. The last call within an interval is not dropped but
 * delivered at its end, so the final value (e.g. where the cursor stopped) always arrives.
 */
export function throttle<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  intervalMs: number,
): { (...args: TArgs): void; cancel: () => void } {
  let lastRun = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: TArgs | undefined;

  function run(args: TArgs) {
    lastRun = Date.now();
    fn(...args);
  }

  function throttled(...args: TArgs) {
    const wait = lastRun + intervalMs - Date.now();
    if (wait <= 0 && timer === undefined) {
      run(args);
      return;
    }
    pendingArgs = args;
    timer ??= setTimeout(
      () => {
        timer = undefined;
        if (pendingArgs) {
          const next = pendingArgs;
          pendingArgs = undefined;
          run(next);
        }
      },
      Math.max(wait, 0),
    );
  }

  throttled.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pendingArgs = undefined;
  };
  return throttled;
}
