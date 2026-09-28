import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import de from './de.json';
import en from './en.json';

export const resources = {
  de: { translation: de },
  en: { translation: en },
} as const;

export const DEFAULT_LANGUAGE = 'de';

// Resources are bundled, so initialization completes synchronously before the first render.
void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

export { i18n };
