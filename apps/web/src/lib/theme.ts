// The theme of the interface on this device (spec 36a). It follows the system until someone
// picks light or dark; the choice stays on the device, not with the account, since one person
// may want different themes on different screens. `public/theme.js` applies it before the first
// paint and must read the same key.

export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type Theme = 'light' | 'dark';

const KEY = 'covibes.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.some((choice) => choice === value);
}

// A browser may refuse its storage (private mode, blocked site data); the choice then lasts as
// long as the page.
let unstored: ThemeChoice = 'system';

export function themeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(KEY);
    return isThemeChoice(stored) ? stored : 'system';
  } catch {
    return unstored;
  }
}

function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === 'system' ? systemTheme() : choice;
}

function apply() {
  document.documentElement.dataset.theme = resolveTheme(themeChoice());
}

/** Picks a theme on this device; `system` follows the system again. */
export function chooseTheme(choice: ThemeChoice) {
  unstored = choice;
  try {
    if (choice === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, choice);
  } catch {
    // Nothing to do: see above.
  }
  apply();
}

/** At the start of the app: applies the theme and follows the system while nothing is picked. */
export function startTheme() {
  apply();
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (themeChoice() === 'system') apply();
  });
}
