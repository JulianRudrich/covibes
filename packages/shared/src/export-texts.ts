import type { PlanLanguage } from './plan';

// The texts that exports add to what the team wrote (spec 27a). An export is in the project's
// language, like the plan, whatever language the person exporting reads the app in.

export type ExportTexts = {
  /** The title of the plan's exports, before the project's name. */
  plan: string;
  /** "Stand: 3. Oktober 2026" under the title of the PDF. */
  asOf: (date: string) => string;
  page: (current: number, total: number) => string;
  /** A milestone without a place on the scale, in the timeline of a roadmap. */
  milestone: (number: number) => string;
  /** The weeks of a milestone, e.g. "W1–3". */
  weeks: (from: number, to: number) => string;
  /** Headings of the Mermaid export of a board. */
  otherElements: string;
  connections: string;
  notes: string;
  emptyBoard: string;
};

const TEXTS: Readonly<Record<PlanLanguage, ExportTexts>> = {
  de: {
    plan: 'Projektplan',
    asOf: (date) => `Stand: ${date}`,
    page: (current, total) => `Seite ${String(current)} von ${String(total)}`,
    milestone: (number) => `Meilenstein ${String(number)}`,
    weeks: (from, to) => (from === to ? `W${String(from)}` : `W${String(from)}–${String(to)}`),
    otherElements: 'Weitere Elemente',
    connections: 'Verbindungen zwischen Diagrammen',
    notes: 'Notizen',
    emptyBoard: 'Dieses Board ist leer.',
  },
  en: {
    plan: 'Project plan',
    asOf: (date) => `As of ${date}`,
    page: (current, total) => `Page ${String(current)} of ${String(total)}`,
    milestone: (number) => `Milestone ${String(number)}`,
    weeks: (from, to) => (from === to ? `W${String(from)}` : `W${String(from)}–${String(to)}`),
    otherElements: 'Other elements',
    connections: 'Connections between diagrams',
    notes: 'Notes',
    emptyBoard: 'This board is empty.',
  },
};

export function exportTexts(language: PlanLanguage): ExportTexts {
  return TEXTS[language];
}

/** A name people gave as a part of a file name; empty if nothing of it can stand there. */
function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      // Other accents go and their letters stay: "é" is written as "e" and its accent mark.
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '')
  );
}

/**
 * A file name (without its ending) from the names people gave, e.g. "Vereins-App" and
 * "Projektplan" → "vereins-app-projektplan": lowercase letters and digits with single hyphens,
 * umlauts written out, at most 60 characters per name. Names that leave nothing are left out;
 * if none is left, the file is called "export".
 */
export function exportFileName(...names: string[]): string {
  return names.map(slug).filter(Boolean).join('-') || 'export';
}
