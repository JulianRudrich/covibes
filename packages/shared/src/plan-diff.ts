import type { PlanNode } from './plan';
import { planNodesToMarkdown } from './plan-markdown';

// Comparing two texts of the plan (spec 25c): what a suggestion would change in its section, and
// what differs between two versions. The comparison is by line: a paragraph, a heading or a list
// item is one line.

/** A line that both texts have, that only the earlier one has, or that only the later one has. */
export type PlanDiffLine = { kind: 'same' | 'removed' | 'added'; text: string };

/** The lines of a text of the plan: its Markdown without the empty lines. */
export function planLines(nodes: readonly PlanNode[]): string[] {
  return planNodesToMarkdown(nodes)
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/**
 * The lines of `after` compared with those of `before`, in the order of the texts: unchanged
 * lines, lines that go and lines that come. It keeps as many lines unchanged as possible.
 */
export function diffPlanLines(before: readonly string[], after: readonly string[]): PlanDiffLine[] {
  // The longest common subsequence, as a table of its lengths from each position to the end.
  const rows = before.length + 1;
  const columns = after.length + 1;
  const common = new Uint32Array(rows * columns);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      common[i * columns + j] =
        before[i] === after[j]
          ? (common[(i + 1) * columns + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * columns + j] ?? 0, common[i * columns + j + 1] ?? 0);
    }
  }

  const lines: PlanDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const removed = before[i];
    const added = after[j];
    if (removed !== undefined && removed === added) {
      lines.push({ kind: 'same', text: removed });
      i += 1;
      j += 1;
    } else if (
      added === undefined ||
      (removed !== undefined &&
        (common[(i + 1) * columns + j] ?? 0) >= (common[i * columns + j + 1] ?? 0))
    ) {
      lines.push({ kind: 'removed', text: removed ?? '' });
      i += 1;
    } else {
      lines.push({ kind: 'added', text: added });
      j += 1;
    }
  }
  return lines;
}

/** What turns the nodes `before` into the nodes `after`, line by line. */
export function diffPlan(before: readonly PlanNode[], after: readonly PlanNode[]): PlanDiffLine[] {
  return diffPlanLines(planLines(before), planLines(after));
}

/** A stretch of unchanged lines that a comparison leaves out until someone asks for it. */
export type PlanDiffFold = { kind: 'fold'; lines: PlanDiffLine[] };

/** The unchanged lines that stay next to a change, so it is read in its place. */
const FOLD_CONTEXT = 2;
/** Folding fewer lines than this saves no reading. */
const FOLD_MIN = 4;

/**
 * A comparison with its long unchanged stretches folded, so the changes of a long plan show at
 * once: the lines next to a change stay, and short stretches stay as they are.
 */
export function foldPlanDiff(lines: readonly PlanDiffLine[]): (PlanDiffLine | PlanDiffFold)[] {
  const parts: (PlanDiffLine | PlanDiffFold)[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    while (lines[end]?.kind === 'same') end += 1;
    if (end === start) {
      parts.push(...lines.slice(start, start + 1));
      start += 1;
      continue;
    }
    // Context only towards a change: the first and the last stretch of a text have one side.
    const from = start === 0 ? start : start + FOLD_CONTEXT;
    const to = end === lines.length ? end : end - FOLD_CONTEXT;
    if (to - from >= FOLD_MIN) {
      parts.push(
        ...lines.slice(start, from),
        { kind: 'fold', lines: lines.slice(from, to) },
        ...lines.slice(to, end),
      );
    } else {
      parts.push(...lines.slice(start, end));
    }
    start = end;
  }
  return parts;
}

/** Whether two texts of the plan say the same, whatever their nodes look like in detail. */
export function samePlanText(a: readonly PlanNode[], b: readonly PlanNode[]): boolean {
  return planNodesToMarkdown(a) === planNodesToMarkdown(b);
}
