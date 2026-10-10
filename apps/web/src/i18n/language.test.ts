import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@web/i18n';
import {
  currentLanguage,
  deviceLanguage,
  keepChoice,
  openChoice,
  settleChoice,
  showLanguage,
  startLanguage,
} from '@web/i18n/language';

// The language of the interface on a device (spec 32a).
function browserPrefers(...languages: string[]) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deviceLanguage', () => {
  it('is what the browser prefers: German or English, else English', () => {
    browserPrefers('de-CH', 'en');
    expect(deviceLanguage()).toBe('de');
    browserPrefers('en-US', 'de');
    expect(deviceLanguage()).toBe('en');
    browserPrefers('fr-FR', 'it');
    expect(deviceLanguage()).toBe('en');
  });

  it('is what the device showed last, whatever the browser prefers', () => {
    browserPrefers('de');
    showLanguage('en');

    expect(deviceLanguage()).toBe('en');
  });

  it('does not trust what it finds in the storage', () => {
    browserPrefers('de');
    window.localStorage.setItem('covibes.language', 'fr');

    expect(deviceLanguage()).toBe('de');
  });
});

describe('startLanguage', () => {
  it('shows the language of the device and names it to the page', () => {
    browserPrefers('en-GB');

    startLanguage();

    expect(currentLanguage()).toBe('en');
    expect(i18n.t('account.signOut')).toBe('Sign out');
    expect(document.documentElement.lang).toBe('en');
  });

  it('keeps following the browser on a device nobody chose on', () => {
    browserPrefers('en-GB');
    startLanguage();

    expect(window.localStorage.getItem('covibes.language')).toBeNull();
    browserPrefers('de');
    startLanguage();
    expect(currentLanguage()).toBe('de');
  });
});

describe('showLanguage', () => {
  it('switches the interface and remembers the language on the device', () => {
    showLanguage('en');

    expect(currentLanguage()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem('covibes.language')).toBe('en');

    showLanguage('de');
    expect(i18n.t('account.signOut')).toBe('Abmelden');
    expect(document.documentElement.lang).toBe('de');
  });

  it('works without a storage, for as long as the page lasts', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    browserPrefers('de');

    showLanguage('en');

    expect(currentLanguage()).toBe('en');
    expect(deviceLanguage()).toBe('de');
    expect(openChoice()).toBeNull();
  });
});

describe('a choice no account holds yet', () => {
  it('is open from the moment someone picks a language until it is settled', () => {
    expect(openChoice()).toBeNull();

    keepChoice('en');

    expect(currentLanguage()).toBe('en');
    expect(openChoice()).toBe('en');

    settleChoice();
    expect(openChoice()).toBeNull();
    // The device still shows the language.
    expect(deviceLanguage()).toBe('en');
  });

  it('is not a language the device merely showed', () => {
    showLanguage('en');

    expect(openChoice()).toBeNull();
  });
});
