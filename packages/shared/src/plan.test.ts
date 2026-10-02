import { describe, expect, it } from 'vitest';

import {
  PLAN_SECTIONS,
  planDocumentName,
  planSectionHint,
  planSectionTitle,
  planTemplate,
  projectIdFromPlanDocumentName,
} from './plan';

const PROJECT = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';

describe('the name of a plan document', () => {
  it('carries the project id and reads it back', () => {
    expect(planDocumentName(PROJECT)).toBe(`plan:${PROJECT}`);
    expect(projectIdFromPlanDocumentName(`plan:${PROJECT}`)).toBe(PROJECT);
  });

  it('is nothing else', () => {
    expect(projectIdFromPlanDocumentName(`board:${PROJECT}`)).toBeUndefined();
    expect(projectIdFromPlanDocumentName('plan:demo')).toBeUndefined();
    expect(projectIdFromPlanDocumentName(`plan:${PROJECT}:x`)).toBeUndefined();
    expect(projectIdFromPlanDocumentName('')).toBeUndefined();
  });
});

describe('planTemplate', () => {
  it('has the five sections in order, each with its heading and an empty paragraph', () => {
    const template = planTemplate('de');

    expect(template.type).toBe('doc');
    const headings = (template.content ?? []).filter((node) => node.type === 'heading');
    expect(headings.map((node) => node.attrs)).toEqual(
      PLAN_SECTIONS.map((section) => ({ level: 2, section })),
    );
    expect(headings.map((node) => node.content?.[0]?.text)).toEqual([
      'MVP-Umfang',
      'Meilensteine und Aufgaben',
      'Tech-Empfehlung',
      'Risiken',
      'Kosten und Zeit',
    ]);
    // A heading is followed by an empty paragraph; the hints are no text of the plan.
    expect(template.content).toHaveLength(10);
    expect((template.content ?? []).filter((node) => node.type === 'paragraph')).toEqual(
      PLAN_SECTIONS.map(() => ({ type: 'paragraph' })),
    );
    expect((template.content ?? []).map((node) => node.type)).toEqual(
      PLAN_SECTIONS.flatMap(() => ['heading', 'paragraph']),
    );
  });

  it("is written in the project's language", () => {
    const headings = (planTemplate('en').content ?? []).filter((node) => node.type === 'heading');

    expect(headings.map((node) => node.content?.[0]?.text)).toEqual([
      'MVP scope',
      'Milestones and tasks',
      'Tech recommendation',
      'Risks',
      'Costs and time',
    ]);
    expect(planSectionTitle('costs', 'en')).toBe('Costs and time');
    expect(planSectionTitle('costs', 'de')).toBe('Kosten und Zeit');
    expect(planSectionHint('scope', 'de')).toBe(
      'Was gehört zur ersten Version, und was bewusst noch nicht?',
    );
    expect(planSectionHint('scope', 'en')).toBe(
      'What belongs to the first version, and what is left out on purpose?',
    );
  });
});
