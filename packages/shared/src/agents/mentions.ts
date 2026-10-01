import { AGENT_MENTION_NAMES } from './keys';

/**
 * `@name`, where the name is letters, digits, `_` and inner hyphens. Trailing punctuation such as
 * `,` `.` `!` `?` or `:` is not part of it. It is no mention when the `@` sits inside a word, an
 * email address or a link (right after a letter, combining mark, digit, `@` or one of `._%+-/:`),
 * or when the name continues as a domain (`@data.io`). The lookahead also keeps the name from
 * being cut short to a known agent (`@databases` is not `@data`).
 */
const MENTION =
  /(?<![\p{L}\p{M}\p{N}._%+@/:-])@([\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*)(?![\p{L}\p{M}\p{N}_]|-[\p{L}\p{N}_]|\.[\p{L}\p{N}])/gu;

/** Inline code and code blocks: an `@name` in there is an example, not a call. */
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;

/** The text with code replaced by spaces of the same length, so positions stay the same. */
function withoutCode(text: string): string {
  return text.replace(CODE, (code) => ' '.repeat(code.length));
}

/** The lowercase names every agent answers to, by agent key (catalog or custom, spec 19). */
export type MentionNames = Readonly<Record<string, readonly string[]>>;

export type MessageSegment =
  { kind: 'text'; text: string } | { kind: 'mention'; text: string; key: string };

function keyForName(names: MentionNames, name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.keys(names).find((key) => names[key]?.includes(lower));
}

/**
 * Splits a message into plain text and mentions of known agents, for rendering mention chips.
 * Unknown `@names` stay plain text.
 */
export function splitMentions(
  text: string,
  names: MentionNames = AGENT_MENTION_NAMES,
): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let last = 0;
  for (const match of withoutCode(text).matchAll(MENTION)) {
    const key = keyForName(names, match[1] ?? '');
    if (key === undefined) continue;
    if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) });
    segments.push({ kind: 'mention', text: match[0], key });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/**
 * The agents mentioned in a message, each once, in the order of their first mention.
 * Case does not matter: `@Moderator` and `@moderator` are the same.
 */
export function parseMentions(text: string, names: MentionNames = AGENT_MENTION_NAMES): string[] {
  const keys: string[] = [];
  for (const segment of splitMentions(text, names)) {
    if (segment.kind === 'mention' && !keys.includes(segment.key)) keys.push(segment.key);
  }
  return keys;
}
