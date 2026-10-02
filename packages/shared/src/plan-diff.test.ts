import { describe, expect, it } from 'vitest';

import { diffPlan, diffPlanLines, foldPlanDiff, planLines, samePlanText } from './plan-diff';
import { planNodesFromMarkdown } from './plan-markdown';

const kinds = (lines: { kind: string; text: string }[]) =>
  lines.map(
    (line) => `${line.kind === 'same' ? ' ' : line.kind === 'added' ? '+' : '-'} ${line.text}`,
  );

describe('planLines', () => {
  it('gives a line per paragraph, heading and list item', () => {
    expect(
      planLines(planNodesFromMarkdown('Erste Version:\n\n- Liste\n  - **Tief**\n\n### Titel')),
    ).toEqual(['Erste Version:', '- Liste', '  - **Tief**', '### Titel']);
    expect(planLines([])).toEqual([]);
  });
});

describe('diffPlanLines', () => {
  it('marks what goes and what comes, and keeps the rest', () => {
    expect(
      kinds(
        diffPlanLines(
          ['Hosting: eigener Server', '- Login', '- Mitgliederliste', 'Start im März'],
          [
            'Hosting: verwalteter Dienst',
            '- Login',
            '- Mitgliederliste',
            '- Export',
            'Start im März',
          ],
        ),
      ),
    ).toEqual([
      '- Hosting: eigener Server',
      '+ Hosting: verwalteter Dienst',
      '  - Login',
      '  - Mitgliederliste',
      '+ - Export',
      '  Start im März',
    ]);
  });

  it('handles empty texts and texts that are the same', () => {
    expect(diffPlanLines([], [])).toEqual([]);
    expect(kinds(diffPlanLines([], ['neu']))).toEqual(['+ neu']);
    expect(kinds(diffPlanLines(['alt'], []))).toEqual(['- alt']);
    expect(kinds(diffPlanLines(['a', 'b'], ['a', 'b']))).toEqual(['  a', '  b']);
  });

  it('keeps a line that only moved as little as it can', () => {
    const lines = diffPlanLines(['a', 'b', 'c'], ['c', 'a', 'b']);

    expect(lines.filter((line) => line.kind === 'same').map((line) => line.text)).toEqual([
      'a',
      'b',
    ]);
    expect(lines.filter((line) => line.kind !== 'same')).toHaveLength(2);
  });
});

describe('foldPlanDiff', () => {
  const same = (count: number, from = 1) =>
    Array.from({ length: count }, (_, index) => `Zeile ${String(from + index)}`);
  const folded = (before: string[], after: string[]) =>
    foldPlanDiff(diffPlanLines(before, after)).map((part) =>
      part.kind === 'fold' ? `… ${String(part.lines.length)}` : kinds([part])[0],
    );

  it('folds long unchanged stretches and keeps two lines next to each change', () => {
    const start = same(7);
    const middle = same(9, 20);
    const end = same(6, 40);

    expect(
      folded([...start, 'alt', ...middle, 'weg', ...end], [...start, 'neu', ...middle, ...end]),
    ).toEqual([
      // The start of the text has a change only after it, the end only before it.
      '… 5',
      '  Zeile 6',
      '  Zeile 7',
      '- alt',
      '+ neu',
      '  Zeile 20',
      '  Zeile 21',
      '… 5',
      '  Zeile 27',
      '  Zeile 28',
      '- weg',
      '  Zeile 40',
      '  Zeile 41',
      '… 4',
    ]);
  });

  it('keeps every line that a fold holds', () => {
    const lines = diffPlanLines([...same(12), 'alt'], [...same(12), 'neu']);
    const parts = foldPlanDiff(lines);

    expect(parts.flatMap((part) => (part.kind === 'fold' ? part.lines : [part]))).toEqual(lines);
  });

  it('leaves short stretches as they are', () => {
    // Three lines would be folded between two changes: that saves no reading.
    const between = same(7);
    expect(folded(['alt', ...between, 'weg'], ['neu', ...between])).toEqual([
      '- alt',
      '+ neu',
      ...between.map((line) => `  ${line}`),
      '- weg',
    ]);
    expect(folded(['a', 'b', 'c', 'alt'], ['a', 'b', 'c', 'neu'])).toEqual([
      '  a',
      '  b',
      '  c',
      '- alt',
      '+ neu',
    ]);
    expect(foldPlanDiff([])).toEqual([]);
  });
});

describe('diffPlan and samePlanText', () => {
  it('compare what the texts say', () => {
    const before = planNodesFromMarkdown('Drei Monate.\n\n- Login');
    const after = planNodesFromMarkdown('Vier Monate.\n\n- Login');

    expect(kinds(diffPlan(before, after))).toEqual([
      '- Drei Monate.',
      '+ Vier Monate.',
      '  - Login',
    ]);
    expect(samePlanText(before, after)).toBe(false);
    expect(samePlanText(before, planNodesFromMarkdown('Drei Monate.\n\n\n* Login'))).toBe(true);
    // An empty paragraph says nothing.
    expect(samePlanText([{ type: 'paragraph' }], [])).toBe(true);
  });
});
