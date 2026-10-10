import { describe, expect, it } from 'vitest';

import { acceptedLanguages, isLanguage, languageSchema, pickLanguage } from './language';

describe('pickLanguage', () => {
  it('takes the first of the preferred languages that Covibes speaks', () => {
    expect(pickLanguage(['de-CH', 'en'])).toBe('de');
    expect(pickLanguage(['en-US', 'de'])).toBe('en');
    expect(pickLanguage(['fr', 'it', 'de-AT', 'en'])).toBe('de');
    expect(pickLanguage([' EN-gb '])).toBe('en');
  });

  it('speaks English to someone who prefers neither', () => {
    expect(pickLanguage(['fr-FR', 'es'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
    // "den" is no German.
    expect(pickLanguage(['den', 'x-de'])).toBe('en');
  });
});

describe('acceptedLanguages', () => {
  it('lists the languages of a header, the most wanted first', () => {
    expect(acceptedLanguages('de-DE,de;q=0.9,en;q=0.8')).toEqual(['de-DE', 'de', 'en']);
    expect(acceptedLanguages('en;q=0.8, de')).toEqual(['de', 'en']);
    expect(acceptedLanguages('fr;q=0.5, en;Q=0.5, de;q=0.4')).toEqual(['fr', 'en', 'de']);
  });

  it('leaves out what is refused, the wildcard and what is no language', () => {
    expect(acceptedLanguages('de;q=0, en;q=0.1, *;q=0.5')).toEqual(['en']);
    expect(acceptedLanguages('de;q=abc, , en')).toEqual(['en']);
    expect(acceptedLanguages('')).toEqual([]);
  });

  it('gives a new account the language of its browser', () => {
    expect(pickLanguage(acceptedLanguages('en-US,en;q=0.9,de;q=0.8'))).toBe('en');
    expect(pickLanguage(acceptedLanguages('fr-FR,fr;q=0.9,de;q=0.3,en;q=0.2'))).toBe('de');
    expect(pickLanguage(acceptedLanguages('ja'))).toBe('en');
  });
});

describe('languageSchema', () => {
  it('knows the two languages and nothing else', () => {
    expect(languageSchema.safeParse('de').success).toBe(true);
    expect(languageSchema.safeParse('en').success).toBe(true);
    expect(languageSchema.safeParse('fr').success).toBe(false);
    expect(languageSchema.safeParse('DE').success).toBe(false);
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage(undefined)).toBe(false);
  });
});
