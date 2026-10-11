import { z } from 'zod';

import { agentKeySchema } from './agents/custom';
import type { CanvasNode } from './canvas/model';

// References from the chat to the canvas (spec 37). A message refers to an element by its name in
// square brackets, e.g. `[AI-Gateway]`. The server finds the element when the message is stored
// and keeps board and element with the message, so the reference still leads there after the
// element is renamed.

/** A message holds at most this many references. */
export const MESSAGE_REFERENCES_MAX = 20;

/** The longest name a reference is written with; a longer label is cut to it. */
export const REFERENCE_LABEL_MAX = 60;

export const messageReferenceSchema = z.object({
  /** The name as the message writes it between the brackets. */
  label: z.string().min(1).max(REFERENCE_LABEL_MAX),
  boardId: z.uuid(),
  nodeId: z.uuid(),
  /** Who made the element; the reference shows in their colors. */
  by: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('human') }),
    z.object({ kind: z.literal('agent'), agentKey: agentKeySchema }),
  ]),
});
export type MessageReference = z.infer<typeof messageReferenceSchema>;

export const messageReferencesSchema = z.array(messageReferenceSchema).max(MESSAGE_REFERENCES_MAX);

/** A name as it is compared: one line, single spaces, nothing around it. */
function plain(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Two names are the same whatever the case of their letters. */
function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The name an element is referred by: its label on one line and without square brackets, cut to
 * `REFERENCE_LABEL_MAX` characters with an ellipsis. Empty for an element without a label, which
 * nothing can refer to by name.
 */
export function referenceLabel(node: Pick<CanvasNode, 'label'>): string {
  const label = plain(node.label.replace(/[[\]]/g, ' '));
  return label.length > REFERENCE_LABEL_MAX
    ? `${label.slice(0, REFERENCE_LABEL_MAX - 1).trimEnd()}…`
    : label;
}

// A name in square brackets on one line. `[text](address)` is a Markdown link, not a reference.
const BRACKETS = /\[([^[\]\n]+)\](?!\()/g;

/**
 * The names a text puts in square brackets, each once, in their order. They are candidates: a
 * name is a reference only if an element of the canvas has it.
 */
export function referenceNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(BRACKETS)) {
    const name = plain(match[1] ?? '');
    if (name === '' || name.length > REFERENCE_LABEL_MAX) continue;
    if (!names.some((known) => sameName(known, name))) names.push(name);
  }
  return names;
}

/** The elements of one board, as the references are looked up in them. */
export type ReferenceBoard = {
  boardId: string;
  nodes: readonly Pick<CanvasNode, 'id' | 'label' | 'position' | 'createdBy'>[];
};

/**
 * The references of a text: for every name in square brackets the element that has this name, on
 * the first of `boards` that has one. Of several elements with the same name on a board the one
 * furthest up counts, then the one furthest left. A name no element has is no reference.
 */
export function findReferences(
  text: string,
  boards: readonly ReferenceBoard[],
): MessageReference[] {
  const references: MessageReference[] = [];
  for (const name of referenceNames(text)) {
    if (references.length >= MESSAGE_REFERENCES_MAX) break;
    for (const board of boards) {
      const node = board.nodes
        .filter((candidate) => sameName(referenceLabel(candidate), name))
        .sort(
          (a, b) =>
            a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id),
        )[0];
      if (!node) continue;
      references.push({
        label: name,
        boardId: board.boardId,
        nodeId: node.id,
        by:
          node.createdBy.kind === 'agent'
            ? { kind: 'agent', agentKey: node.createdBy.agentKey }
            : { kind: 'human' },
      });
      break;
    }
  }
  return references;
}

/** A piece of message text: plain text, or a reference as it is written, brackets included. */
export type ReferenceSegment =
  { kind: 'text'; text: string } | { kind: 'reference'; text: string; reference: MessageReference };

/**
 * Splits a text at the references a message holds. Only the names the server matched to an
 * element are references; every other bracket stays text exactly as it was written.
 */
export function splitReferences(
  text: string,
  references: readonly MessageReference[],
): ReferenceSegment[] {
  if (references.length === 0) return [{ kind: 'text', text }];
  const segments: ReferenceSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(BRACKETS)) {
    const name = plain(match[1] ?? '');
    const reference = references.find((candidate) => sameName(candidate.label, name));
    if (!reference) continue;
    if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) });
    segments.push({ kind: 'reference', text: match[0], reference });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}
