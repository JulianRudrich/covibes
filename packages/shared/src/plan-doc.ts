import * as Y from 'yjs';

import {
  PLAN_FIELD,
  PLAN_SECTION_ATTRIBUTE,
  PLAN_SECTION_LEVEL,
  PLAN_SECTIONS,
  planSectionTitle,
  type PlanLanguage,
  type PlanNode,
  type PlanSection,
} from './plan';
import { planNodesToMarkdown } from './plan-markdown';

// The plan's Y.Doc as nodes (spec 25b). Tiptap stores a document as XML in the Y.Doc: an element
// per node with the node's type as its name and its attributes, and one Y.XmlText per run of text
// whose formats are the marks. The server reads and writes that form here, without an editor.

function isSection(value: unknown): value is PlanSection {
  return typeof value === 'string' && (PLAN_SECTIONS as readonly string[]).includes(value);
}

function fromY(node: Y.XmlElement | Y.XmlText | Y.XmlHook): PlanNode[] {
  if (node instanceof Y.XmlText) {
    const delta = node.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[];
    return delta.flatMap((piece): PlanNode[] => {
      if (typeof piece.insert !== 'string' || piece.insert === '') return [];
      const marks = Object.keys(piece.attributes ?? {}).map((type) => ({ type }));
      return [
        marks.length > 0
          ? { type: 'text', text: piece.insert, marks }
          : { type: 'text', text: piece.insert },
      ];
    });
  }
  if (!(node instanceof Y.XmlElement)) return [];
  const attrs = node.getAttributes() as Record<string, unknown>;
  const content = node.toArray().flatMap((child) => fromY(child));
  return [
    {
      type: node.nodeName,
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      ...(content.length > 0 ? { content } : {}),
    },
  ];
}

function toY(node: PlanNode): Y.XmlElement {
  const element = new Y.XmlElement(node.type);
  for (const [key, value] of Object.entries(node.attrs ?? {})) {
    // An attribute without a value is left out, as Tiptap leaves out its defaults.
    if (value !== null && value !== undefined) element.setAttribute(key, value as string);
  }
  const children: (Y.XmlElement | Y.XmlText)[] = [];
  let run: PlanNode[] = [];
  const endRun = () => {
    if (run.length === 0) return;
    const text = new Y.XmlText();
    text.applyDelta(
      run.map((piece) => ({
        insert: piece.text ?? '',
        attributes: Object.fromEntries((piece.marks ?? []).map((mark) => [mark.type, {}])),
      })),
    );
    children.push(text);
    run = [];
  };
  for (const child of node.content ?? []) {
    if (child.type === 'text') {
      if (child.text) run.push(child);
    } else {
      endRun();
      children.push(toY(child));
    }
  }
  endRun();
  if (children.length > 0) element.insert(0, children);
  return element;
}

/** The plan as nodes, in the order of the document. */
export function readPlan(doc: Y.Doc): PlanNode[] {
  return doc
    .getXmlFragment(PLAN_FIELD)
    .toArray()
    .flatMap((node) => fromY(node));
}

/** The key of the section a top-level node starts, if it is a section heading. */
function sectionOf(node: PlanNode): PlanSection | undefined {
  const key = node.attrs?.[PLAN_SECTION_ATTRIBUTE];
  return node.type === 'heading' && isSection(key) ? key : undefined;
}

/** What every section of the plan holds below its heading; a section without a heading is missing. */
export function readPlanSections(doc: Y.Doc): Partial<Record<PlanSection, PlanNode[]>> {
  const sections: Partial<Record<PlanSection, PlanNode[]>> = {};
  let current: PlanNode[] | undefined;
  for (const node of readPlan(doc)) {
    const section = sectionOf(node);
    if (section && !(section in sections)) {
      current = [];
      sections[section] = current;
    } else {
      current?.push(node);
    }
  }
  return sections;
}

/** Whether the plan holds any text at all. */
export function isPlanEmpty(doc: Y.Doc): boolean {
  const hasText = (node: PlanNode): boolean =>
    (node.text ?? '').trim() !== '' || (node.content ?? []).some(hasText);
  return !readPlan(doc).some(hasText);
}

/** The whole plan as Markdown, for the agents' context; empty for an empty plan. */
export function planToMarkdown(doc: Y.Doc): string {
  return isPlanEmpty(doc) ? '' : planNodesToMarkdown(readPlan(doc));
}

/**
 * Writes the text of a section into the plan (spec 25b: an accepted suggestion). What stood below
 * the section's heading is replaced; the heading itself stays as the team worded it. A section
 * whose heading is gone comes back at its place in the order of the sections, with its heading in
 * the project's language. Everyone who has the plan open sees the change at once.
 */
export function writePlanSection(
  doc: Y.Doc,
  section: PlanSection,
  content: readonly PlanNode[],
  language: PlanLanguage,
): void {
  const fragment = doc.getXmlFragment(PLAN_FIELD);
  // A section never stays without a paragraph to write in.
  const nodes = content.length > 0 ? content : [{ type: 'paragraph' }];
  doc.transact(() => {
    const keys = fragment.toArray().map((node) => {
      if (!(node instanceof Y.XmlElement) || node.nodeName !== 'heading') return undefined;
      const key: unknown = node.getAttribute(PLAN_SECTION_ATTRIBUTE);
      return isSection(key) ? key : undefined;
    });
    const heading = keys.indexOf(section);
    if (heading >= 0) {
      const next = keys.findIndex((key, index) => index > heading && key !== undefined);
      const end = next < 0 ? keys.length : next;
      if (end > heading + 1) fragment.delete(heading + 1, end - heading - 1);
      fragment.insert(heading + 1, nodes.map(toY));
      return;
    }
    // Before the first section that comes later in the order, or at the end.
    const later = PLAN_SECTIONS.slice(PLAN_SECTIONS.indexOf(section) + 1);
    const before = keys.findIndex((key) => key !== undefined && later.includes(key));
    fragment.insert(before < 0 ? keys.length : before, [
      toY({
        type: 'heading',
        attrs: { level: PLAN_SECTION_LEVEL, [PLAN_SECTION_ATTRIBUTE]: section },
        content: [{ type: 'text', text: planSectionTitle(section, language) }],
      }),
      ...nodes.map(toY),
    ]);
  });
}
