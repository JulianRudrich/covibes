import { describe, expect, it } from 'vitest';

import { exportFileName, exportTexts } from './export-texts';
import { PLAN_TASK_ATTRIBUTE, type PlanNode } from './plan';
import { planExportMarkdown, planExportTitle, withAssigneeNames } from './plan-export';
import { planNodesFromMarkdown } from './plan-markdown';

const LOGIN = '7a000000-0000-4000-8000-000000000001';
const EXPORT = '7a000000-0000-4000-8000-000000000002';

/** The plan as the editor holds it: sections as headings of level 2, tasks with their ids. */
function plan(): PlanNode[] {
  const ids = [LOGIN, EXPORT];
  const withIds = (nodes: PlanNode[]): PlanNode[] =>
    nodes.map((node) => ({
      ...node,
      ...(node.type === 'listItem' ? { attrs: { [PLAN_TASK_ATTRIBUTE]: ids.shift() } } : {}),
      ...(node.content ? { content: withIds(node.content) } : {}),
    }));
  const section = (title: string): PlanNode => ({
    type: 'heading',
    attrs: { level: 2, section: 'milestones' },
    content: [{ type: 'text', text: title }],
  });
  return [
    section('Meilensteine und Aufgaben'),
    ...withIds(
      planNodesFromMarkdown(
        '### Meilenstein 1: Grundgerüst (3 Wochen)\n\nDie App läuft.\n\n- **Login** bauen\n  - per Link\n- Export',
      ),
    ),
  ];
}

describe('planExportMarkdown', () => {
  it('gives the plan with a title that names the project, and who took which task', () => {
    const markdown = planExportMarkdown({
      projectName: 'Vereins-App',
      nodes: plan(),
      assignees: new Map([[LOGIN, 'Alex Berg']]),
      language: 'de',
    });

    expect(markdown).toBe(`# Projektplan: Vereins-App

## Meilensteine und Aufgaben

### Meilenstein 1: Grundgerüst (3 Wochen)

Die App läuft.

- **Login** bauen *(Alex Berg)*
  - per Link
- Export
`);
  });

  it('is the title alone for an empty plan, in the language of the project', () => {
    expect(planExportMarkdown({ projectName: ' Club  app ', nodes: [], language: 'en' })).toBe(
      '# Project plan: Club app\n',
    );
    expect(planExportTitle('  ', 'de')).toBe('Projektplan');
  });
});

describe('withAssigneeNames', () => {
  it('leaves the nodes it was given as they are', () => {
    const nodes = plan();
    const copy = structuredClone(nodes);

    const named = withAssigneeNames(nodes, new Map([[EXPORT, 'Sam']]));

    expect(nodes).toEqual(copy);
    expect(JSON.stringify(named)).toContain('(Sam)');
    // Without anyone on a task, nothing is added.
    expect(withAssigneeNames(nodes, new Map())).toEqual(copy);
    expect(withAssigneeNames(nodes, undefined)).toEqual(copy);
  });
});

describe('exportFileName', () => {
  it('makes a file name from the names of a project and what is exported', () => {
    expect(exportFileName('Vereins-App', 'Projektplan')).toBe('vereins-app-projektplan');
    expect(exportFileName('Club app', 'Project plan')).toBe('club-app-project-plan');
    expect(exportFileName('  Büro & Straße: Größe ÄÖÜ  ', 'Haupt-Canvas')).toBe(
      'buero-strasse-groesse-aeoeue-haupt-canvas',
    );
    expect(exportFileName('Café Crème')).toBe('cafe-creme');
    // A name that leaves nothing is left out; without any, the file still has a name.
    expect(exportFileName('!!!', 'Board')).toBe('board');
    expect(exportFileName('???', '')).toBe('export');
    expect(exportFileName('x'.repeat(200), 'Plan')).toBe(`${'x'.repeat(60)}-plan`);
    // Nothing a path could be built from.
    expect(exportFileName('../../etc/passwd', 'plan')).toBe('etc-passwd-plan');
  });
});

describe('exportTexts', () => {
  it('speaks the language of the project', () => {
    expect(exportTexts('de').page(1, 3)).toBe('Seite 1 von 3');
    expect(exportTexts('en').page(1, 3)).toBe('Page 1 of 3');
    expect(exportTexts('de').weeks(4, 4)).toBe('W4');
    expect(exportTexts('en').weeks(1, 3)).toBe('W1–3');
    expect(exportTexts('de').asOf('3. Oktober 2026')).toBe('Stand: 3. Oktober 2026');
  });
});
