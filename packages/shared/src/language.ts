import { z } from 'zod';

// The languages Covibes speaks (spec 32): its interface in a person's own language, and what a
// project writes in the project's language.

export const LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const languageSchema = z.enum(LANGUAGES);

/** For someone who prefers neither: more people read English than German. */
export const FALLBACK_LANGUAGE: Language = 'en';

/** Each language by its own name, as a switch offers it. */
export const LANGUAGE_NAMES: Record<Language, string> = { de: 'Deutsch', en: 'English' };

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language === value);
}

/**
 * The language Covibes speaks to someone who prefers these, the most wanted first, as a browser
 * lists them ("de-CH", "en", "fr"): the first that is German or English, else English.
 */
export function pickLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const primary = tag.trim().toLowerCase().split('-')[0];
    if (isLanguage(primary)) return primary;
  }
  return FALLBACK_LANGUAGE;
}

/**
 * The languages an `Accept-Language` header names, the most wanted first: "en;q=0.8, de" is
 * German before English. What is refused (`q=0`) and the wildcard are left out.
 */
export function acceptedLanguages(header: string): string[] {
  return header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.split(';').map((piece) => piece.trim());
      const quality = params.find((param) => param.toLowerCase().startsWith('q='));
      const weight = quality === undefined ? 1 : Number(quality.slice(2));
      return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter(({ tag, weight }) => tag !== '' && tag !== '*' && weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map(({ tag }) => tag);
}
