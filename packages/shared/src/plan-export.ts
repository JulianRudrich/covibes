import { exportTexts } from './export-texts';
import type { PlanLanguage, PlanNode } from './plan';
import { planNodesToMarkdown } from './plan-markdown';
import { taskIdOf } from './plan-tasks';

// The plan as a file (spec 27a): the plan as it stands, with a title that names the project. A
// task someone took names them in parentheses, since the file has no avatars to show it.

export type PlanExport = {
  projectName: string;
  /** The plan as nodes, in the order of the document. */
  nodes: readonly PlanNode[];
  /** Who took which task, by the id of the task: the name to print. */
  assignees?: ReadonlyMap<string, string>;
  language: PlanLanguage;
};

/**
 * The nodes with the assignee after every task someone took: " (Alex Berg)" in italics at the end
 * of the task's first paragraph. The nodes it was given stay as they are.
 */
export function withAssigneeNames(
  nodes: readonly PlanNode[],
  assignees: ReadonlyMap<string, string> | undefined,
): PlanNode[] {
  if (!assignees || assignees.size === 0) return [...nodes];
  return nodes.map((node): PlanNode => {
    const content = node.content ? withAssigneeNames(node.content, assignees) : undefined;
    const id = taskIdOf(node);
    const name = id ? assignees.get(id) : undefined;
    const first = content?.[0];
    if (!name || !content || first?.type !== 'paragraph') {
      return content ? { ...node, content } : node;
    }
    const named: PlanNode = {
      ...first,
      content: [
        ...(first.content ?? []),
        // The space stays outside of the emphasis, or Markdown would not read it as one.
        { type: 'text', text: ' ' },
        { type: 'text', text: `(${name})`, marks: [{ type: 'italic' }] },
      ],
    };
    return { ...node, content: [named, ...content.slice(1)] };
  });
}

/** The title of the plan's exports: "Projektplan: Vereins-App". */
export function planExportTitle(projectName: string, language: PlanLanguage): string {
  const name = projectName.replace(/\s+/g, ' ').trim();
  const { plan } = exportTexts(language);
  return name ? `${plan}: ${name}` : plan;
}

/** The plan as a Markdown file: the title, then the plan with its sections as headings. */
export function planExportMarkdown({
  projectName,
  nodes,
  assignees,
  language,
}: PlanExport): string {
  const body = planNodesToMarkdown(withAssigneeNames(nodes, assignees));
  const title = `# ${planExportTitle(projectName, language)}`;
  return `${body ? `${title}\n\n${body}` : title}\n`;
}
