import 'i18next';

import type de from './de.json';

// Makes t() keys type-checked against the German resource file.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof de };
  }
}
