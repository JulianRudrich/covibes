import { describe, expect, it } from 'vitest';

import type { PlanNode } from './plan';
import {
  planInlineFromMarkdown,
  planNodesFromMarkdown,
  planNodesToMarkdown,
} from './plan-markdown';

const text = (value: string, ...marks: string[]): PlanNode =>
  marks.length > 0
    ? { type: 'text', text: value, marks: marks.map((type) => ({ type })) }
    : { type: 'text', text: value };
const paragraph = (...content: PlanNode[]): PlanNode => ({ type: 'paragraph', content });
const item = (...content: PlanNode[]): PlanNode => ({ type: 'listItem', content });

describe('planInlineFromMarkdown', () => {
  it('reads bold, italic and both, and leaves the rest as text', () => {
    expect(
      planInlineFromMarkdown('Erst **fett**, dann *kursiv* und ***beides***, 2 * 3 bleibt.'),
    ).toEqual([
      text('Erst '),
      text('fett', 'bold'),
      text(', dann '),
      text('kursiv', 'italic'),
      text(' und '),
      text('beides', 'bold', 'italic'),
      text(', 2 * 3 bleibt.'),
    ]);
  });

  it('drops the backticks of code and keeps names with underscores', () => {
    expect(planInlineFromMarkdown('Tabelle `project_members` und set_phase')).toEqual([
      text('Tabelle project_members und set_phase'),
    ]);
    expect(planInlineFromMarkdown('')).toEqual([]);
  });
});

describe('planNodesFromMarkdown', () => {
  it('reads headings, paragraphs and lists', () => {
    const nodes = planNodesFromMarkdown(
      [
        'Die erste Version deckt die',
        'Mitgliederverwaltung ab.',
        '',
        '### Meilenstein 1: Grundgerüst (4 Wochen)',
        '- Login per E-Mail-Link',
        '- **Mitgliederliste** mit Suche',
        '',
        '1. Erst das Datenmodell',
        '2) Dann die API',
      ].join('\n'),
    );

    expect(nodes).toEqual([
      paragraph(text('Die erste Version deckt die Mitgliederverwaltung ab.')),
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [text('Meilenstein 1: Grundgerüst (4 Wochen)')],
      },
      {
        type: 'bulletList',
        content: [
          item(paragraph(text('Login per E-Mail-Link'))),
          item(paragraph(text('Mitgliederliste', 'bold'), text(' mit Suche'))),
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          item(paragraph(text('Erst das Datenmodell'))),
          item(paragraph(text('Dann die API'))),
        ],
      },
    ]);
  });

  it('nests lists by their indentation and continues an item on the next line', () => {
    const nodes = planNodesFromMarkdown(
      [
        '- Backend',
        '  - API',
        '    die alles liefert',
        '  - Datenbank',
        '- Frontend',
        '  1. Login',
      ].join('\n'),
    );

    expect(nodes).toEqual([
      {
        type: 'bulletList',
        content: [
          item(paragraph(text('Backend')), {
            type: 'bulletList',
            content: [
              item(paragraph(text('API die alles liefert'))),
              item(paragraph(text('Datenbank'))),
            ],
          }),
          item(paragraph(text('Frontend')), {
            type: 'orderedList',
            attrs: { start: 1 },
            content: [item(paragraph(text('Login')))],
          }),
        ],
      },
    ]);
  });

  it('puts every heading on the level below the sections', () => {
    const levels = planNodesFromMarkdown('# Eins\n## Zwei\n#### Vier ##').map((node) => [
      node.attrs?.level,
      node.content?.[0]?.text,
    ]);

    expect(levels).toEqual([
      [3, 'Eins'],
      [3, 'Zwei'],
      [3, 'Vier'],
    ]);
  });

  it('never fails: what it does not know stays text', () => {
    expect(planNodesFromMarkdown('')).toEqual([]);
    expect(planNodesFromMarkdown('\n\n  \n')).toEqual([]);
    expect(planNodesFromMarkdown('| a | b |\r\n> Zitat')).toEqual([
      paragraph(text('| a | b | > Zitat')),
    ]);
    // Another kind of list on the same level starts a new list.
    expect(planNodesFromMarkdown('- a\n1. b').map((node) => node.type)).toEqual([
      'bulletList',
      'orderedList',
    ]);
  });
});

describe('planNodesToMarkdown', () => {
  it('writes the nodes back as the Markdown they were read from', () => {
    const markdown = [
      'Die erste Version deckt die **Mitgliederverwaltung** ab.',
      '',
      '### Meilenstein 1',
      '',
      '- Backend',
      '  - API',
      '  - Datenbank',
      '- *Frontend*',
      '',
      '1. Erst das Datenmodell',
      '2. Dann die API',
    ].join('\n');

    expect(planNodesToMarkdown(planNodesFromMarkdown(markdown))).toBe(markdown);
  });

  it('writes section headings on their level and skips empty blocks', () => {
    expect(
      planNodesToMarkdown([
        { type: 'heading', attrs: { level: 2, section: 'scope' }, content: [text('MVP-Umfang')] },
        { type: 'paragraph' },
        paragraph(text('Mitgliederliste')),
      ]),
    ).toBe('## MVP-Umfang\n\nMitgliederliste');
  });
});
