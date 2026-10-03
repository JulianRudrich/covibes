import { PLAN_TASK_ATTRIBUTE, planNodesFromMarkdown, type PlanNode } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { planPdfDefinition } from '@web/features/export/plan-pdf';

const LOGIN = '7a000000-0000-4000-8000-000000000001';
const COLORS = { text: 'black', muted: 'gray' };

/** The plan as the editor holds it: a section heading of level 2, tasks with their ids. */
function plan(): PlanNode[] {
  const ids = [LOGIN];
  const withIds = (nodes: PlanNode[]): PlanNode[] =>
    nodes.map((node) => ({
      ...node,
      ...(node.type === 'listItem' ? { attrs: { [PLAN_TASK_ATTRIBUTE]: ids.shift() } } : {}),
      ...(node.content ? { content: withIds(node.content) } : {}),
    }));
  return [
    {
      type: 'heading',
      attrs: { level: 2, section: 'milestones' },
      content: [{ type: 'text', text: 'Meilensteine und Aufgaben' }],
    },
    ...withIds(
      planNodesFromMarkdown(
        [
          '### Meilenstein 1: Grundgerüst',
          '',
          'Die App *läuft* und ist **sicher**.',
          '',
          '- **Login** bauen',
          '  - per Link',
          '- Export',
          '',
          '1. Erst testen',
          '2. Dann starten',
        ].join('\n'),
      ),
    ),
    { type: 'paragraph' },
  ];
}

describe('planPdfDefinition', () => {
  it('builds a document with title, sections, lists, emphasis and assignees', () => {
    const definition = planPdfDefinition({
      projectName: 'Vereins-App',
      nodes: plan(),
      assignees: new Map([[LOGIN, 'Alex Berg']]),
      language: 'de',
      date: '3. Oktober 2026',
      colors: COLORS,
    });

    expect(definition.info).toEqual({ title: 'Projektplan: Vereins-App' });
    expect(definition.pageSize).toBe('A4');
    expect(definition.defaultStyle).toMatchObject({ font: 'Roboto', color: 'black' });
    expect(definition.content).toEqual([
      { text: 'Projektplan', style: 'kicker' },
      { text: 'Vereins-App', style: 'title' },
      { text: 'Stand: 3. Oktober 2026', style: 'date' },
      { text: [{ text: 'Meilensteine und Aufgaben' }], style: 'section', headlineLevel: 1 },
      { text: [{ text: 'Meilenstein 1: Grundgerüst' }], style: 'subsection', headlineLevel: 1 },
      {
        text: [
          { text: 'Die App ' },
          { text: 'läuft', italics: true },
          { text: ' und ist ' },
          { text: 'sicher', bold: true },
          { text: '.' },
        ],
        margin: [0, 0, 0, 6],
      },
      {
        ul: [
          {
            stack: [
              {
                text: [
                  { text: 'Login', bold: true },
                  { text: ' bauen' },
                  { text: ' ' },
                  { text: '(Alex Berg)', italics: true },
                ],
              },
              { ul: [{ text: [{ text: 'per Link' }] }], margin: [0, 2, 0, 6] },
            ],
          },
          { text: [{ text: 'Export' }] },
        ],
        margin: [0, 2, 0, 6],
      },
      {
        ol: [{ text: [{ text: 'Erst testen' }] }, { text: [{ text: 'Dann starten' }] }],
        margin: [0, 2, 0, 6],
        start: 1,
      },
    ]);
  });

  it('numbers the pages in the language of the project', () => {
    const footer = (language: 'de' | 'en') => {
      const { footer: build } = planPdfDefinition({
        projectName: 'Club app',
        nodes: [],
        language,
        date: 'October 3, 2026',
        colors: COLORS,
      });
      if (typeof build !== 'function') throw new Error('The footer is missing');
      return build(2, 5, { width: 595, height: 842, orientation: 'portrait' });
    };

    expect(footer('de')).toMatchObject({ text: 'Seite 2 von 5', alignment: 'center' });
    expect(footer('en')).toMatchObject({ text: 'Page 2 of 5' });
  });

  it('is a title page for an empty plan, also without a project name', () => {
    const definition = planPdfDefinition({
      projectName: '  ',
      nodes: [{ type: 'paragraph' }],
      language: 'en',
      date: 'October 3, 2026',
      colors: COLORS,
    });

    expect(definition.info).toEqual({ title: 'Project plan' });
    expect(definition.content).toEqual([
      { text: 'Project plan', style: 'kicker' },
      { text: 'As of October 3, 2026', style: 'date' },
    ]);
  });

  it('keeps a heading with what it heads when a page ends', () => {
    const { pageBreakBefore } = planPdfDefinition({
      projectName: 'Vereins-App',
      nodes: [],
      language: 'de',
      date: '3. Oktober 2026',
      colors: COLORS,
    });
    if (!pageBreakBefore) throw new Error('The rule for page breaks is missing');
    const queries = (following: number) =>
      ({ getFollowingNodesOnPage: () => Array.from({ length: following }) }) as Parameters<
        typeof pageBreakBefore
      >[1];
    const node = (headlineLevel?: number) =>
      ({ headlineLevel }) as Parameters<typeof pageBreakBefore>[0];

    // A heading with nothing after it on its page moves on; with something, it stays.
    expect(pageBreakBefore(node(1), queries(0))).toBe(true);
    expect(pageBreakBefore(node(1), queries(2))).toBe(false);
    // Text may end a page.
    expect(pageBreakBefore(node(), queries(0))).toBe(false);
  });
});
