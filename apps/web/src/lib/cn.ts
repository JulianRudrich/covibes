import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge must know the project's font-size tokens, otherwise it treats
// e.g. `text-ui` as a text color and drops it next to `text-text-2`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['badge', 'meta', 'status', 'small', 'ui', 'body', 'title', 'display'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
