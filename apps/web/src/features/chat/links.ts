/** A piece of message text: plain text or a web address to show as a link. */
export type LinkSegment =
  { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

/**
 * A Markdown link `[text](address)`, or a bare web address. Agents write addresses plainly, but a
 * model or a person may still paste a Markdown link.
 */
const LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"`]+/gi;

/** Punctuation that ends a sentence rather than an address. */
const TRAILING = /[.,;:!?'"»“”„’…]+$/;

/** The address without the punctuation of the sentence around it. */
function trimAddress(address: string): string {
  let trimmed = address.replace(TRAILING, '');
  // A closing bracket belongs to the address only if it was opened in it, e.g. `…/Foo_(bar)`.
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
  ] as const) {
    while (trimmed.endsWith(close) && count(trimmed, close) > count(trimmed, open)) {
      trimmed = trimmed.slice(0, -1).replace(TRAILING, '');
    }
  }
  return trimmed;
}

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

/** The address as a link target, or undefined if it is no http(s) address with a host. */
function hrefOf(address: string): string | undefined {
  try {
    const url = new URL(address);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.hostname === '' ? undefined : url.href;
  } catch {
    return undefined;
  }
}

/**
 * Splits message text into plain text and web addresses (spec 20b). Only `http` and `https`
 * addresses become links; everything else stays text exactly as it was written.
 */
export function splitLinks(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, label, target] = match;
    const address = target ?? trimAddress(whole);
    const href = hrefOf(address);
    if (href === undefined) continue;
    const length = target === undefined ? address.length : whole.length;
    if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) });
    segments.push({ kind: 'link', text: label ?? address, href });
    last = match.index + length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}
