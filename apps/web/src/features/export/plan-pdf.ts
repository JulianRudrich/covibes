import { exportTexts, withAssigneeNames, type PlanExport, type PlanNode } from '@covibes/shared';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

// The plan as a PDF (spec 27a), made in the browser with pdfmake: a document with title, sections,
// lists and page numbers, in the font the library brings (Roboto).

export type PlanPdf = PlanExport & {
  /** The day of the export as the project's language writes it, e.g. "3. Oktober 2026". */
  date: string;
  /** The colors of the text, from the design tokens. */
  colors: { text: string; muted: string };
};

type Run = { text: string; bold?: boolean; italics?: boolean };

/** The text of a paragraph or heading as runs with their emphasis. */
function runs(node: PlanNode): Run[] {
  return (node.content ?? []).flatMap((piece): Run[] => {
    if (piece.type !== 'text' || !piece.text) return [];
    const marks = new Set((piece.marks ?? []).map((mark) => mark.type));
    return [
      {
        text: piece.text,
        ...(marks.has('bold') ? { bold: true } : {}),
        ...(marks.has('italic') ? { italics: true } : {}),
      },
    ];
  });
}

const isList = (node: PlanNode) => node.type === 'bulletList' || node.type === 'orderedList';

function list(node: PlanNode): Content {
  const items = (node.content ?? [])
    .filter((item) => item.type === 'listItem')
    .map((item): Content => {
      const parts = (item.content ?? []).flatMap((child): Content[] => {
        if (isList(child)) return [list(child)];
        const text = runs(child);
        return text.length > 0 ? [{ text }] : [];
      });
      return parts.length === 1 && parts[0] !== undefined ? parts[0] : { stack: parts };
    });
  const margin: [number, number, number, number] = [0, 2, 0, 6];
  if (node.type === 'orderedList') {
    const start = node.attrs?.start;
    return { ol: items, margin, ...(typeof start === 'number' ? { start } : {}) };
  }
  return { ul: items, margin };
}

function blocks(nodes: readonly PlanNode[]): Content[] {
  return nodes.flatMap((node): Content[] => {
    if (isList(node)) return [list(node)];
    const text = runs(node);
    if (text.length === 0) return [];
    if (node.type === 'heading') {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 2;
      // A heading is marked, so it never stands alone at the end of a page.
      return [{ text, style: level <= 2 ? 'section' : 'subsection', headlineLevel: 1 }];
    }
    return [{ text, margin: [0, 0, 0, 6] }];
  });
}

/**
 * The document of the plan for pdfmake: A4 with the title, the project's name and the date, the
 * plan with its sections, lists and emphasis, the assignee after every task someone took, and the
 * page numbers. The texts it adds are in the project's language.
 */
export function planPdfDefinition({
  projectName,
  nodes,
  assignees,
  language,
  date,
  colors,
}: PlanPdf): TDocumentDefinitions {
  const texts = exportTexts(language);
  const name = projectName.replace(/\s+/g, ' ').trim();
  return {
    info: { title: name ? `${texts.plan}: ${name}` : texts.plan },
    pageSize: 'A4',
    pageMargins: [56, 60, 56, 64],
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.35, color: colors.text },
    styles: {
      kicker: { fontSize: 10, color: colors.muted, margin: [0, 0, 0, 2] },
      title: { fontSize: 22, bold: true, lineHeight: 1.15 },
      date: { fontSize: 9.5, color: colors.muted, margin: [0, 4, 0, 14] },
      section: { fontSize: 15, bold: true, lineHeight: 1.2, margin: [0, 16, 0, 6] },
      subsection: { fontSize: 12, bold: true, lineHeight: 1.25, margin: [0, 10, 0, 4] },
      footer: { fontSize: 8.5, color: colors.muted },
    },
    content: [
      { text: texts.plan, style: 'kicker' },
      ...(name ? [{ text: name, style: 'title' }] : []),
      { text: texts.asOf(date), style: 'date' },
      ...blocks(withAssigneeNames(nodes, assignees)),
    ],
    // A heading goes to the next page together with what it heads.
    pageBreakBefore: (node, queries) =>
      node.headlineLevel === 1 && queries.getFollowingNodesOnPage().length === 0,
    footer: (currentPage: number, pageCount: number): Content => ({
      text: texts.page(currentPage, pageCount),
      alignment: 'center',
      style: 'footer',
      margin: [0, 24, 0, 0],
    }),
  };
}

/** Makes the PDF. The library and its font are loaded when the first PDF is asked for. */
export async function planPdf(plan: PlanPdf): Promise<Blob> {
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  return await pdfMake.createPdf(planPdfDefinition(plan)).getBlob();
}
