import { isLanguage, pickLanguage, type Language } from '@covibes/shared';

import { DEFAULT_LANGUAGE, i18n } from '@web/i18n';

// The language of the interface on this device (spec 32a). Signed in, it is the language of the
// account; signed out, what the device showed last, else what its browser prefers. A language
// someone picks while signed out is a decision: the account takes it at the next sign-in.

const SHOWN_KEY = 'covibes.language';
const CHOSEN_KEY = 'covibes.language.chosen';

// A browser may refuse its storage (private mode, blocked site data); the language then lasts
// as long as the page.
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: see above.
  }
}

/** The language the interface shows right now. */
export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}

/** The language of this device: what it showed last, else what its browser prefers. */
export function deviceLanguage(): Language {
  const shown = read(SHOWN_KEY);
  return isLanguage(shown) ? shown : pickLanguage(navigator.languages);
}

function apply(language: Language) {
  document.documentElement.lang = language;
  if (i18n.language !== language) void i18n.changeLanguage(language);
}

/** At the start of the app, before anything is drawn. */
export function startLanguage() {
  // Not remembered: a device nobody chose on keeps following its browser.
  apply(deviceLanguage());
}

/** Shows the interface in a language and remembers it on this device. */
export function showLanguage(language: Language) {
  write(SHOWN_KEY, language);
  apply(language);
}

/** Someone picked a language that no account holds yet. */
export function keepChoice(language: Language) {
  showLanguage(language);
  write(CHOSEN_KEY, '1');
}

/** The language picked on this device that no account holds yet, or null. */
export function openChoice(): Language | null {
  const shown = read(SHOWN_KEY);
  return read(CHOSEN_KEY) === '1' && isLanguage(shown) ? shown : null;
}

/** The choice is the account's now, or the account's language holds. */
export function settleChoice() {
  write(CHOSEN_KEY, null);
}
