import { useCallback, useSyncExternalStore } from 'react';

/** Below this width the workspace takes the phone layout (spec 36e); Tailwind's `max-md:`. */
export const PHONE_QUERY = '(width < 48rem)';

/** Whether a media query matches, following it as it changes; false where there is no
 * `matchMedia` (e.g. in tests). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () =>
    typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false,
  );
}

/** Whether the screen is as narrow as a phone. */
export function usePhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
