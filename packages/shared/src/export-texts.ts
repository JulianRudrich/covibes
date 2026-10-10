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
  /** The name of a project's main canvas. */
  mainBoard: string;
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
    mainBoard: 'Haupt-Canvas',
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
    mainBoard: 'Main canvas',
  },
};

export function exportTexts(language: PlanLanguage): ExportTexts {
  return TEXTS[language];
}

/**
 * The title of a board where Covibes writes it out (spec 32b): the main canvas is named in the
 * project's language, whatever it was called when the project was created; every other board
 * has the title its people gave it.
 */
export function boardExportTitle(
  board: { title: string; kind: string },
  language: PlanLanguage,
): string {
  return board.kind === 'main' ? TEXTS[language].mainBoard : board.title;
}

/**
 * A name people gave as a part of a file name: lowercase letters and digits with single hyphens,
 * at most 60 characters; empty if nothing of it can stand there.
 */
export function fileSlug(name: string): string {
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
  return names.map(fileSlug).filter(Boolean).join('-') || 'export';
}

/** A text in a line of Markdown, without what would start markup or a new line. */
export function markdownLine(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`*_[\]<>])/g, '\\$1');
}
