// A web page as plain text for an agent (spec 20b): what a person would read, without markup,
// scripts and styles. Good enough for articles and documentation; no layout survives.

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  middot: '·',
  bull: '•',
  rarr: '→',
  larr: '←',
  times: '×',
  deg: '°',
};

function codePoint(value: number): string {
  // Control characters and invalid code points become a space.
  if (!Number.isInteger(value) || value < 32 || value > 0x10ffff) return ' ';
  if (value >= 0xd800 && value <= 0xdfff) return ' ';
  return String.fromCodePoint(value);
}

/** Decodes numeric and the common named character references; unknown ones stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (reference, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return codePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) return codePoint(Number.parseInt(name.slice(1), 10));
    return NAMED_ENTITIES[name] ?? reference;
  });
}

/** Elements whose content is not text for a reader. */
const HIDDEN =
  /<(script|style|noscript|template|svg|iframe|canvas|select|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** Elements that start a new line. */
const BLOCK =
  /<\/?(p|div|section|article|header|footer|main|nav|aside|ul|ol|table|blockquote|pre|h[1-6]|dl|dt|dd|figure|figcaption|form|hr|address)\b[^>]*>/gi;

/**
 * The title and the readable text of an HTML page. Blocks become lines, list items start with
 * "- ", table cells are separated, and runs of spaces and empty lines are collapsed.
 */
export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title = titleMatch?.[1]
    ? decodeEntities(titleMatch[1].replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(HIDDEN, ' ')
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/(td|th)\s*>/gi, ' | ')
      .replace(/<\/tr\s*>/gi, '\n')
      .replace(BLOCK, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\r/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, text };
}
