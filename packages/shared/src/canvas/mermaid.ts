import { exportTexts, markdownLine, type ExportTexts } from '../export-texts';
import type { PlanLanguage } from '../plan';
import { roadmapLayout, type Roadmap } from '../plan-roadmap';
import { isRoadmap, type CanvasEdge, type CanvasNode } from './model';

// A board as diagram code (spec 27a): one Markdown file with a Mermaid diagram per frame, so
// GitLab, GitHub and every Markdown viewer with Mermaid show the board as diagrams. The output is
// stable: frames and blocks come in reading order, top to bottom and left to right.

type Block = CanvasNode & { type: 'block' };

/** Reading order: by row, then from the left. */
function byPosition(a: CanvasNode, b: CanvasNode): number {
  return a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id);
}

/** A text inside a quoted Mermaid label: one line, without what ends the label or starts markup. */
function label(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/#/g, '#35;')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;');
}

/** Title and subtitle of a block as one label; the subtitle goes on a line of its own. */
function blockLabel(block: Block): string {
  const title = label(block.label);
  const subtitle = label(block.subtitle);
  return subtitle ? `${title}<br/>${subtitle}` : title;
}

/** The shape of a block in a flowchart, by its type. */
function flowNode(id: string, block: Block): string {
  const text = `"${blockLabel(block)}"`;
  switch (block.blockType) {
    case 'database':
      return `${id}[(${text})]`;
    case 'start':
    case 'end':
      return `${id}([${text}])`;
    case 'decision':
      return `${id}{${text}}`;
    default:
      return `${id}[${text}]`;
  }
}

function flowchart(
  blocks: readonly Block[],
  edges: readonly CanvasEdge[],
  direction: 'TD' | 'LR',
): string[] {
  const ids = new Map(blocks.map((block, index) => [block.id, `n${String(index + 1)}`]));
  const lines = [`flowchart ${direction}`];
  for (const block of blocks) lines.push(`  ${flowNode(ids.get(block.id) ?? '', block)}`);
  for (const edge of edges) {
    const text = label(edge.label);
    const arrow = text ? `-->|"${text}"|` : '-->';
    lines.push(`  ${ids.get(edge.source) ?? ''} ${arrow} ${ids.get(edge.target) ?? ''}`);
  }
  return lines;
}

/**
 * A mind map as Mermaid's `mindmap`, which is a tree written by indentation: one root, every other
 * block reached by exactly one arrow. Null if the diagram is no such tree.
 */
function mindmap(blocks: readonly Block[], edges: readonly CanvasEdge[]): string[] | null {
  const incoming = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
  }
  const roots = blocks.filter((block) => !incoming.has(block.id));
  const [root] = roots;
  if (!root || roots.length !== 1) return null;
  if (blocks.some((block) => (incoming.get(block.id) ?? 0) > 1)) return null;

  const byId = new Map(blocks.map((block) => [block.id, block]));
  const lines = ['mindmap'];
  const seen = new Set<string>();
  const visit = (block: Block, depth: number) => {
    seen.add(block.id);
    const text = label(block.label).replace(/#quot;/g, "'");
    const indent = '  '.repeat(depth + 1);
    lines.push(
      depth === 0 ? `${indent}root(("${text}"))` : `${indent}n${String(seen.size)}["${text}"]`,
    );
    const below = (children.get(block.id) ?? [])
      .flatMap((id) => byId.get(id) ?? [])
      .sort(byPosition);
    for (const child of below) if (!seen.has(child.id)) visit(child, depth + 1);
  };
  visit(root, 0);
  // A block no arrow leads to from the root would be lost.
  return seen.size === blocks.length ? lines : null;
}

/** A name or type of a field as one word, as `erDiagram` needs it. */
function word(text: string, fallback: string): string {
  const cleaned = text
    .trim()
    .replace(/[^\p{L}\p{N}_]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback;
  // A word starts with a letter or an underscore.
  return /^[\p{L}_]/u.test(cleaned) ? cleaned : `_${cleaned}`;
}

/** "1:n hat" → the cardinality as Mermaid writes it, and what is left as the label. */
function relation(text: string): { link: string; label: string } {
  const match = /^\s*([1nm])\s*:\s*([1nm])(?![\p{L}\p{N}])\s*(.*)$/iu.exec(text);
  if (!match) return { link: '}o--o{', label: text };
  const one = (side: string | undefined) => side === '1';
  const [, from, to, rest = ''] = match;
  return {
    link: `${one(from) ? '||' : '}o'}--${one(to) ? '||' : 'o{'}`,
    label: rest,
  };
}

function erDiagram(blocks: readonly Block[], edges: readonly CanvasEdge[]): string[] {
  const ids = new Map(blocks.map((block, index) => [block.id, `e${String(index + 1)}`]));
  const lines = ['erDiagram'];
  for (const block of blocks) {
    const head = `  ${ids.get(block.id) ?? ''}["${label(block.label)}"]`;
    if (block.fields.length === 0) {
      lines.push(head);
      continue;
    }
    lines.push(`${head} {`);
    for (const field of block.fields) {
      lines.push(`    ${word(field.type, '_')} ${word(field.name, 'field')}`);
    }
    lines.push('  }');
  }
  for (const edge of edges) {
    const { link, label: text } = relation(edge.label);
    lines.push(
      `  ${ids.get(edge.source) ?? ''} ${link} ${ids.get(edge.target) ?? ''} : "${label(text)}"`,
    );
  }
  return lines;
}

/** A text between the colons of a `timeline`, which split its lines. */
function period(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[:#;]/g, ' ').replace(/ +/g, ' ').trim();
}

function timeline(title: string, roadmap: Roadmap, texts: ExportTexts): string[] {
  const { columns } = roadmapLayout(roadmap);
  const lines = ['timeline', `  title ${period(title)}`];
  roadmap.milestones.slice(0, columns.length).forEach((milestone, index) => {
    const weeks = columns[index]?.weeks;
    const when = weeks ? texts.weeks(weeks.from, weeks.to) : texts.milestone(milestone.number);
    const time = !weeks && milestone.duration ? ` : ${period(milestone.duration.text)}` : '';
    lines.push(`  ${when} : ${period(milestone.title)}${time}`);
  });
  return lines;
}

const code = (lines: readonly string[]) => ['```mermaid', ...lines, '```'].join('\n');

const plain = markdownLine;

export type BoardExport = {
  /** The title of the board, the heading of the file. */
  title: string;
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
  /** The roadmap of the plan, if the board shows one. */
  roadmap?: Roadmap | null;
  language: PlanLanguage;
};

/**
 * A board as Markdown with Mermaid diagrams (spec 27a): one diagram per frame in the form of its
 * diagram type, one for the blocks outside of frames, then the arrows between diagrams and the
 * notes as lists.
 */
export function boardToMermaid({ title, nodes, edges, roadmap, language }: BoardExport): string {
  const texts = exportTexts(language);
  const blocks = nodes.filter((node): node is Block => node.type === 'block').sort(byPosition);
  const frames = nodes.filter((node) => node.type === 'frame').sort(byPosition);
  const frameIds = new Set(frames.map((frame) => frame.id));
  const blockIds = new Set(blocks.map((block) => block.id));
  /** The diagram a block belongs to: its frame, or '' for the blocks outside of frames. */
  const diagramOf = new Map(
    blocks.map((block) => [
      block.id,
      block.frameId && frameIds.has(block.frameId) ? block.frameId : '',
    ]),
  );
  const drawn = edges.filter((edge) => blockIds.has(edge.source) && blockIds.has(edge.target));
  const inside = (diagram: string) =>
    drawn.filter(
      (edge) => diagramOf.get(edge.source) === diagram && diagramOf.get(edge.target) === diagram,
    );

  const sections: string[] = [`# ${plain(title)}`];
  for (const frame of frames) {
    const heading = `## ${plain(frame.label)}`;
    if (isRoadmap(frame)) {
      if (roadmap && roadmap.milestones.length > 0) {
        sections.push(`${heading}\n\n${code(timeline(frame.label, roadmap, texts))}`);
      }
      continue;
    }
    const members = blocks.filter((block) => diagramOf.get(block.id) === frame.id);
    if (members.length === 0) continue;
    const links = inside(frame.id);
    const lines =
      frame.diagramType === 'datamodel'
        ? erDiagram(members, links)
        : frame.diagramType === 'mindmap'
          ? (mindmap(members, links) ?? flowchart(members, links, 'LR'))
          : flowchart(members, links, 'TD');
    sections.push(`${heading}\n\n${code(lines)}`);
  }

  const free = blocks.filter((block) => diagramOf.get(block.id) === '');
  if (free.length > 0) {
    // Without frames the board is one diagram and needs no heading of its own.
    const heading = sections.length > 1 ? `## ${texts.otherElements}\n\n` : '';
    sections.push(`${heading}${code(flowchart(free, inside(''), 'TD'))}`);
  }

  const between = drawn.filter((edge) => diagramOf.get(edge.source) !== diagramOf.get(edge.target));
  if (between.length > 0) {
    const names = new Map(blocks.map((block) => [block.id, plain(block.label)]));
    const list = between.map((edge) => {
      const text = edge.label.trim() ? `: ${plain(edge.label)}` : '';
      return `- ${names.get(edge.source) ?? ''} → ${names.get(edge.target) ?? ''}${text}`;
    });
    sections.push(`## ${texts.connections}\n\n${list.join('\n')}`);
  }

  const notes = nodes.filter((node) => node.type === 'sticky').sort(byPosition);
  if (notes.length > 0) {
    sections.push(
      `## ${texts.notes}\n\n${notes.map((note) => `- ${plain(note.label)}`).join('\n')}`,
    );
  }

  if (sections.length === 1) sections.push(texts.emptyBoard);
  return `${sections.join('\n\n')}\n`;
}
