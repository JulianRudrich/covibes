import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { PLAN_FIELD, planTemplate, type PlanNode } from './plan';
import {
  isPlanEmpty,
  planToMarkdown,
  readPlan,
  readPlanSections,
  writePlanSection,
} from './plan-doc';
import { planNodesFromMarkdown } from './plan-markdown';

/** A plan document that holds the template, written the way an accepted suggestion is. */
function planWithTemplate() {
  const doc = new Y.Doc();
  for (const node of planTemplate('de').content ?? []) {
    const key = node.attrs?.section;
    if (typeof key === 'string') writePlanSection(doc, key as 'scope', [], 'de');
  }
  return doc;
}

const xml = (doc: Y.Doc) => doc.getXmlFragment(PLAN_FIELD).toJSON();
const text = (value: string): PlanNode => ({ type: 'text', text: value });
const paragraph = (value: string): PlanNode => ({ type: 'paragraph', content: [text(value)] });

describe('writePlanSection', () => {
  it('builds the sections in their order, whatever the order of writing', () => {
    const doc = new Y.Doc();

    writePlanSection(doc, 'risks', [paragraph('Wenig Zeit')], 'de');
    writePlanSection(doc, 'scope', [paragraph('Mitgliederliste')], 'de');
    writePlanSection(doc, 'costs', [], 'de');
    writePlanSection(doc, 'tech', [paragraph('React')], 'de');

    expect(xml(doc)).toBe(
      [
        '<heading level="2" section="scope">MVP-Umfang</heading><paragraph>Mitgliederliste</paragraph>',
        '<heading level="2" section="tech">Tech-Empfehlung</heading><paragraph>React</paragraph>',
        '<heading level="2" section="risks">Risiken</heading><paragraph>Wenig Zeit</paragraph>',
        // A section without text gets a paragraph to write in.
        '<heading level="2" section="costs">Kosten und Zeit</heading><paragraph></paragraph>',
      ].join(''),
    );
  });

  it('replaces what a section holds and leaves the others and its heading alone', () => {
    const doc = planWithTemplate();
    writePlanSection(doc, 'scope', [paragraph('Alt'), paragraph('Auch alt')], 'de');
    writePlanSection(doc, 'milestones', [paragraph('Bleibt')], 'de');
    // The team rewords the heading; the section stays the same one.
    const heading = doc.getXmlFragment(PLAN_FIELD).get(0) as Y.XmlElement;
    (heading.get(0) as Y.XmlText).insert(0, 'Unser ');

    writePlanSection(doc, 'scope', planNodesFromMarkdown('Neu mit **Betonung**\n\n- a\n- b'), 'en');

    const sections = readPlanSections(doc);
    expect(sections.scope).toEqual([
      {
        type: 'paragraph',
        content: [text('Neu mit '), { type: 'text', text: 'Betonung', marks: [{ type: 'bold' }] }],
      },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph('a')] },
          { type: 'listItem', content: [paragraph('b')] },
        ],
      },
    ]);
    expect(sections.milestones).toEqual([paragraph('Bleibt')]);
    expect(xml(doc)).toContain('<heading level="2" section="scope">Unser MVP-Umfang</heading>');
    expect(xml(doc)).toContain('Neu mit <bold>Betonung</bold>');
    expect(xml(doc)).not.toContain('Alt');
  });

  it('writes the heading of a missing section in the language of the project', () => {
    const doc = new Y.Doc();

    writePlanSection(doc, 'milestones', [paragraph('M1')], 'en');

    expect(xml(doc)).toBe(
      '<heading level="2" section="milestones">Milestones and tasks</heading><paragraph>M1</paragraph>',
    );
  });

  it('keeps what stands before the first section and reaches everyone who has the plan open', () => {
    const doc = new Y.Doc();
    const other = new Y.Doc();
    doc.on('update', (update: Uint8Array) => {
      Y.applyUpdate(other, update);
    });
    const intro = new Y.XmlElement('paragraph');
    intro.insert(0, [new Y.XmlText('Vorwort des Teams')]);
    doc.getXmlFragment(PLAN_FIELD).push([intro]);

    writePlanSection(doc, 'scope', [paragraph('Mitgliederliste')], 'de');
    writePlanSection(doc, 'scope', [paragraph('Mitglieder und Beiträge')], 'de');

    expect(xml(other)).toBe(
      '<paragraph>Vorwort des Teams</paragraph><heading level="2" section="scope">MVP-Umfang</heading><paragraph>Mitglieder und Beiträge</paragraph>',
    );
  });

  it('takes a heading with a section key it does not know as text of the section', () => {
    const doc = new Y.Doc();
    writePlanSection(doc, 'scope', [paragraph('Mitgliederliste')], 'de');
    const stray = new Y.XmlElement('heading');
    stray.setAttribute('level', 2 as unknown as string);
    stray.setAttribute('section', 'launch');
    stray.insert(0, [new Y.XmlText('Start')]);
    doc.getXmlFragment(PLAN_FIELD).push([stray]);

    writePlanSection(doc, 'scope', [paragraph('Neu')], 'de');

    expect(xml(doc)).toBe(
      '<heading level="2" section="scope">MVP-Umfang</heading><paragraph>Neu</paragraph>',
    );
  });
});

describe('reading the plan', () => {
  it('gives the nodes with their attributes and marks', () => {
    const doc = new Y.Doc();
    writePlanSection(
      doc,
      'tech',
      planNodesFromMarkdown('### Frontend\n\n1. **React**, weil das Team es kennt'),
      'de',
    );

    expect(readPlan(doc)).toEqual([
      {
        type: 'heading',
        attrs: { level: 2, section: 'tech' },
        content: [text('Tech-Empfehlung')],
      },
      { type: 'heading', attrs: { level: 3 }, content: [text('Frontend')] },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'React', marks: [{ type: 'bold' }] },
                  text(', weil das Team es kennt'),
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('knows an empty plan and gives the plan as Markdown', () => {
    const empty = new Y.Doc();
    expect(isPlanEmpty(empty)).toBe(true);
    expect(planToMarkdown(empty)).toBe('');
    expect(readPlanSections(empty)).toEqual({});

    const template = planWithTemplate();
    expect(isPlanEmpty(template)).toBe(false);
    expect(Object.keys(readPlanSections(template))).toEqual([
      'scope',
      'milestones',
      'tech',
      'risks',
      'costs',
    ]);

    writePlanSection(template, 'scope', planNodesFromMarkdown('Mitgliederliste\n\n- Login'), 'de');
    expect(planToMarkdown(template)).toContain(
      '## MVP-Umfang\n\nMitgliederliste\n\n- Login\n\n## ',
    );
  });
});
