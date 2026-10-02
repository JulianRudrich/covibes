import type { PlanNode } from './plan';

// The small Markdown of the plan (spec 25b): what the moderator writes a section in, and what the
// agents read the plan as. Headings below the section level, paragraphs, bullet and numbered
// lists (nested), bold and italic; everything else is taken as plain text.

/** Headings inside a section; the level above belongs to the sections themselves. */
const CONTENT_HEADING_LEVEL = 3;
/** Lists nest this deep; deeper items stay on the last level. */
const MAX_LIST_DEPTH = 3;

type Mark = { type: string };

function textNode(text: string, marks: Mark[] = []): PlanNode[] {
  if (text === '') return [];
  return [marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text }];
}

/** `***both***`, `**bold**` and `*italic*`; a star that marks nothing stays a star. */
const INLINE = /\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;

/** The text of a line with its bold and italic parts. Backticks around code are dropped. */
export function planInlineFromMarkdown(line: string): PlanNode[] {
  const text = line.replace(/`([^`]*)`/g, '$1');
  const nodes: PlanNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    nodes.push(...textNode(text.slice(last, match.index)));
    const [whole, both, bold, italic] = match;
    if (both !== undefined) nodes.push(...textNode(both, [{ type: 'bold' }, { type: 'italic' }]));
    else if (bold !== undefined) nodes.push(...textNode(bold, [{ type: 'bold' }]));
    else if (italic !== undefined) nodes.push(...textNode(italic, [{ type: 'italic' }]));
    last = match.index + whole.length;
  }
  nodes.push(...textNode(text.slice(last)));
  return nodes;
}

function paragraph(text: string): PlanNode {
  const content = planInlineFromMarkdown(text.trim());
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
}

type Item = { indent: number; ordered: boolean; text: string };

/** The lists of consecutive items, nested by their indentation. */
function listsOf(items: readonly Item[]): PlanNode[] {
  const top: PlanNode[] = [];
  const open: { indent: number; list: PlanNode }[] = [];
  for (const item of items) {
    while (open.length > 0 && item.indent < (open.at(-1)?.indent ?? 0)) open.pop();
    const current = open.at(-1);
    const type = item.ordered ? 'orderedList' : 'bulletList';
    const deeper =
      current !== undefined && item.indent > current.indent && open.length < MAX_LIST_DEPTH;
    if (!current || deeper || (item.indent === current.indent && current.list.type !== type)) {
      const list: PlanNode = item.ordered
        ? { type, attrs: { start: 1 }, content: [] }
        : { type, content: [] };
      // Another kind of list on the same level ends the one before.
      if (current && !deeper && item.indent === current.indent) open.pop();
      const parent = open.at(-1)?.list.content?.at(-1);
      if (parent) (parent.content ??= []).push(list);
      else top.push(list);
      open.push({ indent: item.indent, list });
    }
    open.at(-1)?.list.content?.push({ type: 'listItem', content: [paragraph(item.text)] });
  }
  return top;
}

/**
 * Markdown as the nodes of the plan. It never fails: what it does not know becomes text, so
 * whatever a model writes ends up readable in the plan.
 */
export function planNodesFromMarkdown(markdown: string): PlanNode[] {
  const nodes: PlanNode[] = [];
  let text: string[] = [];
  let items: Item[] = [];
  const flush = () => {
    if (text.length > 0) nodes.push(paragraph(text.join(' ')));
    if (items.length > 0) nodes.push(...listsOf(items));
    text = [];
    items = [];
  };

  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\t/g, '  ');
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const content = planInlineFromMarkdown(heading[1] ?? '');
      if (content.length > 0) {
        nodes.push({ type: 'heading', attrs: { level: CONTENT_HEADING_LEVEL }, content });
      }
      continue;
    }
    const item = /^(\s*)(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/.exec(line);
    if (item) {
      if (text.length > 0) flush();
      items.push({
        indent: (item[1] ?? '').length,
        ordered: item[3] !== undefined,
        text: item[4] ?? '',
      });
      continue;
    }
    // A line right below an item continues it; otherwise it belongs to a paragraph.
    const lastItem = items.at(-1);
    if (lastItem) lastItem.text += ` ${line.trim()}`;
    else text.push(line.trim());
  }
  flush();
  return nodes;
}

function inlineToMarkdown(content: readonly PlanNode[] = []): string {
  return content
    .map((node) => {
      const text = node.text ?? '';
      const marks = new Set((node.marks ?? []).map((mark) => mark.type));
      const stars = (marks.has('bold') ? '**' : '') + (marks.has('italic') ? '*' : '');
      return stars === '' ? text : `${stars}${text}${stars}`;
    })
    .join('');
}

function listToMarkdown(list: PlanNode, depth: number): string[] {
  const lines: string[] = [];
  (list.content ?? []).forEach((item, index) => {
    const bullet = list.type === 'orderedList' ? `${String(index + 1)}.` : '-';
    const [first, ...rest] = item.content ?? [];
    lines.push(`${'  '.repeat(depth)}${bullet} ${inlineToMarkdown(first?.content)}`);
    for (const child of rest) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        lines.push(...listToMarkdown(child, depth + 1));
      } else {
        lines.push(`${'  '.repeat(depth + 1)}${inlineToMarkdown(child.content)}`);
      }
    }
  });
  return lines;
}

/** The nodes of the plan as Markdown, e.g. for the agents' context. */
export function planNodesToMarkdown(nodes: readonly PlanNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'heading') {
        const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 2;
        return `${'#'.repeat(level)} ${inlineToMarkdown(node.content)}`;
      }
      if (node.type === 'bulletList' || node.type === 'orderedList') {
        return listToMarkdown(node, 0).join('\n');
      }
      return inlineToMarkdown(node.content);
    })
    .filter((block) => block.trim() !== '')
    .join('\n\n');
}
