import * as Y from 'yjs';
import { z } from 'zod';

import {
  PLAN_FIELD,
  PLAN_SECTION_ATTRIBUTE,
  PLAN_SECTIONS,
  PLAN_TASK_ATTRIBUTE,
  type PlanNode,
} from './plan';

// The identity of tasks (spec 26b). A task is a list item of the plan; it carries an id in the
// document, so its assignment stays with it whatever its text becomes. Every list item of the
// section "milestones" gets one, also those that are no task: which items are tasks follows from
// how the section is read (`readRoadmap`), and that may change with the next edit.

const idSchema = z.uuid();

/** The id of a list item, if it has a valid one. */
export function taskIdOf(node: PlanNode): string | null {
  const id = idSchema.safeParse(node.attrs?.[PLAN_TASK_ATTRIBUTE]);
  return node.type === 'listItem' && id.success ? id.data : null;
}

function textOf(node: PlanNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

/** The text of a list item: its first paragraph, without the lists nested in it. */
export function listItemText(item: PlanNode): string {
  const paragraph = (item.content ?? []).find((child) => child.type === 'paragraph');
  return (paragraph ? textOf(paragraph) : '').replace(/\s+/g, ' ').trim();
}

/** The transaction origin of giving ids: the server's change, not a person's. */
export const TASK_IDS_ORIGIN = 'task-ids';

/**
 * An id that is not taken yet, and takes it. A source that keeps giving taken ids is a mistake of
 * the caller; it fails instead of trying forever.
 */
function freshId(newId: () => string, taken: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = newId();
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
  throw new Error('The source of task ids keeps giving ids that are taken');
}

/**
 * The list items of the section "milestones" that need an id: those without one, with an invalid
 * one, or with one that an item before them has too (e.g. a pasted copy; the first keeps it).
 */
function itemsWithoutId(doc: Y.Doc): { missing: Y.XmlElement[]; seen: Set<string> } {
  const seen = new Set<string>();
  const missing: Y.XmlElement[] = [];
  const visit = (node: Y.XmlElement | Y.XmlText | Y.XmlHook) => {
    if (!(node instanceof Y.XmlElement)) return;
    if (node.nodeName === 'listItem') {
      const id = idSchema.safeParse(node.getAttribute(PLAN_TASK_ATTRIBUTE));
      if (id.success && !seen.has(id.data)) seen.add(id.data);
      else missing.push(node);
    }
    node.toArray().forEach(visit);
  };

  // The section as `readPlanSections` reads it: a section starts at the first heading with its
  // key; a second heading with a key that was there already is content of the section it is in.
  const started = new Set<string>();
  let inMilestones = false;
  for (const node of doc.getXmlFragment(PLAN_FIELD).toArray()) {
    if (node instanceof Y.XmlElement && node.nodeName === 'heading') {
      const section: unknown = node.getAttribute(PLAN_SECTION_ATTRIBUTE);
      if (
        typeof section === 'string' &&
        (PLAN_SECTIONS as readonly string[]).includes(section) &&
        !started.has(section)
      ) {
        started.add(section);
        inMilestones = section === 'milestones';
        continue;
      }
    }
    if (inMilestones) visit(node);
  }
  return { missing, seen };
}

/** Whether `ensureTaskIds` would change the plan; it reads only. */
export function needsTaskIds(doc: Y.Doc): boolean {
  return itemsWithoutId(doc).missing.length > 0;
}

/**
 * Gives every list item of the section "milestones" an id that needs one. Only the server calls
 * this, after it stored a plan: one writer, so two clients never give a task different ids.
 * Returns how many items got a new id.
 */
export function ensureTaskIds(doc: Y.Doc, newId: () => string = () => crypto.randomUUID()): number {
  const { missing, seen } = itemsWithoutId(doc);
  if (missing.length === 0) return 0;

  doc.transact(() => {
    for (const item of missing) item.setAttribute(PLAN_TASK_ATTRIBUTE, freshId(newId, seen));
  }, TASK_IDS_ORIGIN);
  return missing.length;
}

/** The words of a task, to compare two wordings of it. */
function wordsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** The share of words two texts have in common, of the longer one. */
function similarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common += 1;
  return common / Math.max(a.size, b.size);
}

/** A reworded task is the same task when at least this share of its words stayed. */
const SAME_TASK = 0.5;

function listItems(nodes: readonly PlanNode[]): PlanNode[] {
  return nodes.flatMap((node) => [
    ...(node.type === 'listItem' ? [node] : []),
    ...listItems(node.content ?? []),
  ]);
}

/**
 * The nodes of a rewritten section with the ids of the tasks it replaces (spec 26b): a list item
 * that reads the same as one before keeps that id; a reworded one takes the id of the most
 * similar item before, if at least half of their words match; every other item gets a new id.
 * An id goes to one item only. `after` is not changed.
 */
export function carryTaskIds(
  before: readonly PlanNode[],
  after: readonly PlanNode[],
  newId: () => string = () => crypto.randomUUID(),
): PlanNode[] {
  const old = listItems(before).flatMap((item) => {
    const id = taskIdOf(item);
    const text = listItemText(item);
    return id ? [{ id, text, words: wordsOf(text), used: false }] : [];
  });
  const copy = structuredClone(after) as PlanNode[];
  const items = listItems(copy).map((item) => ({ item, text: listItemText(item), id: '' }));

  // The same text first, in the order of the document.
  for (const entry of items) {
    const same = old.find((candidate) => !candidate.used && candidate.text === entry.text);
    if (!same) continue;
    same.used = true;
    entry.id = same.id;
  }
  // Then the most similar pairs of what is left, the best first.
  const pairs = items
    .filter((entry) => entry.id === '')
    .flatMap((entry) => {
      const words = wordsOf(entry.text);
      return old
        .filter((candidate) => !candidate.used)
        .map((candidate) => ({
          entry,
          candidate,
          score: similarity(words, candidate.words),
        }));
    })
    .filter((pair) => pair.score >= SAME_TASK)
    .sort((a, b) => b.score - a.score);
  for (const { entry, candidate } of pairs) {
    if (entry.id !== '' || candidate.used) continue;
    candidate.used = true;
    entry.id = candidate.id;
  }

  const taken = new Set(old.map((candidate) => candidate.id));
  for (const entry of items) {
    if (entry.id === '') entry.id = freshId(newId, taken);
    entry.item.attrs = { ...entry.item.attrs, [PLAN_TASK_ATTRIBUTE]: entry.id };
  }
  return copy;
}

/** The nodes without the ids of their tasks, e.g. for a version of the plan, which holds text. */
export function withoutTaskIds(nodes: readonly PlanNode[]): PlanNode[] {
  return nodes.map((node) => {
    const { attrs, content, ...rest } = node;
    const kept = Object.fromEntries(
      Object.entries(attrs ?? {}).filter(([key]) => key !== PLAN_TASK_ATTRIBUTE),
    );
    return {
      ...rest,
      ...(Object.keys(kept).length > 0 ? { attrs: kept } : {}),
      ...(content ? { content: withoutTaskIds(content) } : {}),
    };
  });
}
