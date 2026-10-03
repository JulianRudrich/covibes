import { describe, expect, it } from 'vitest';

import { ROADMAP_DIAGRAM, type CanvasEdge, type CanvasNode } from './canvas/model';
import {
  buildCodingPackage,
  codingPackageSummary,
  MAX_PACKAGE_SPECS,
  PACKAGE_PATHS,
  packageTextInputSchema,
  type CodingPackageInput,
} from './coding-package';
import { PLAN_SECTIONS, PLAN_TASK_ATTRIBUTE, planTemplate, type PlanNode } from './plan';
import { planNodesFromMarkdown } from './plan-markdown';

const OLGA = { kind: 'human' as const, userId: '7b000000-0000-4000-8000-000000000001' };
const SETUP = '7b000000-0000-4000-8000-000000000011';
const LOGIN = '7b000000-0000-4000-8000-000000000012';
const AT = '2026-10-02T09:00:00.000Z';

const SECTIONS: Record<(typeof PLAN_SECTIONS)[number], string> = {
  scope: 'MVP-Umfang',
  milestones: 'Meilensteine und Aufgaben',
  tech: 'Tech-Empfehlung',
  risks: 'Risiken',
  costs: 'Kosten und Zeit',
};

/** A plan as the editor holds it: sections as headings of level 2, tasks with the ids given. */
function plan(
  sections: Partial<Record<(typeof PLAN_SECTIONS)[number], string>>,
  ids: string[] = [],
): PlanNode[] {
  const left = [...ids];
  const withIds = (nodes: PlanNode[]): PlanNode[] =>
    nodes.map((node) => {
      const id = node.type === 'listItem' ? left.shift() : undefined;
      return {
        ...node,
        ...(id ? { attrs: { [PLAN_TASK_ATTRIBUTE]: id } } : {}),
        ...(node.content ? { content: withIds(node.content) } : {}),
      };
    });
  return PLAN_SECTIONS.flatMap((section): PlanNode[] => {
    const text = sections[section];
    if (text === undefined) return [];
    return [
      {
        type: 'heading',
        attrs: { level: 2, section },
        content: [{ type: 'text', text: SECTIONS[section] }],
      },
      ...(section === 'milestones'
        ? withIds(planNodesFromMarkdown(text))
        : planNodesFromMarkdown(text)),
    ];
  });
}

let counter = 0;
const id = () => `7b000000-0000-4000-9000-${String((counter += 1)).padStart(12, '0')}`;

function node(fields: Partial<CanvasNode> & Pick<CanvasNode, 'type' | 'label'>): CanvasNode {
  return {
    id: id(),
    blockType: null,
    position: { x: 0, y: 0 },
    size: { width: 180, height: 96 },
    subtitle: '',
    frameId: null,
    diagramType: null,
    fields: [],
    createdBy: OLGA,
    lastChangedBy: OLGA,
    lastChangedAt: AT,
    ...fields,
  };
}

function edge(source: CanvasNode, target: CanvasNode): CanvasEdge {
  return {
    id: id(),
    source: source.id,
    target: target.id,
    sourceHandle: null,
    targetHandle: null,
    label: '',
    createdBy: OLGA,
    lastChangedBy: OLGA,
    lastChangedAt: AT,
  };
}

function vereinsApp(overrides: Partial<CodingPackageInput> = {}): CodingPackageInput {
  const app = node({ type: 'block', label: 'Web-App' });
  const database = node({
    type: 'block',
    label: 'PostgreSQL',
    blockType: 'database',
    position: { x: 0, y: 200 },
  });
  return {
    projectName: 'Vereins-App',
    language: 'de',
    date: new Date('2026-10-03T12:00:00.000Z'),
    timeZone: 'UTC',
    plan: plan(
      {
        scope: 'Mitglieder verwalten und Beiträge einziehen.',
        milestones:
          '### Meilenstein 1: Grundgerüst (2 Wochen)\n\nDie App läuft.\n\n- Projekt aufsetzen\n- **Login** per Link\n\n### Meilenstein 2: Beiträge\n\n- Beiträge & Mahnungen',
        tech: 'React und PostgreSQL.',
        risks: 'Wenig Zeit.',
        costs: 'Meilenstein 2: 3 Wochen.',
      },
      [SETUP, LOGIN],
    ),
    assignees: new Map([[LOGIN, 'Alex Berg']]),
    decisions: [
      {
        topic: 'Datenbank',
        status: 'decided',
        value: 'PostgreSQL',
        reasoning: 'Relationale Daten, EU-Hosting möglich.',
        alternatives: [
          { name: 'MongoDB', note: 'kein Schema' },
          { name: 'SQLite', note: '' },
        ],
        decidedBy: 'Olga',
        decidedAt: AT,
        reopenReason: null,
      },
      {
        topic: 'Hosting',
        status: 'open',
        value: null,
        reasoning: '',
        alternatives: [],
        decidedBy: null,
        decidedAt: null,
        reopenReason: 'Preise haben sich geändert',
      },
    ],
    criteria: ['EU-Hosting', 'Open Source'],
    boards: [
      { title: 'Haupt-Canvas', nodes: [app, database], edges: [edge(app, database)] },
      { title: 'Ideen', nodes: [], edges: [] },
    ],
    texts: { code_standards: 'TypeScript strict, keine `any`.', ui_direction: '' },
    ...overrides,
  };
}

const contentOf = (input: CodingPackageInput, path: string) =>
  buildCodingPackage(input).find((entry) => entry.path === path)?.content;

describe('buildCodingPackage', () => {
  it('holds the instructions, the context, a spec per task and a file per board with content', () => {
    expect(buildCodingPackage(vereinsApp()).map((entry) => entry.path)).toEqual([
      'CLAUDE.md',
      'AGENTS.md',
      'context/project-overview.md',
      'context/architecture.md',
      'context/decisions.md',
      'context/code-standards.md',
      'context/ui-context.md',
      'context/project-plan.md',
      'context/progress-tracker.md',
      'context/feature-specs/00-overview.md',
      'context/feature-specs/01-01-projekt-aufsetzen.md',
      'context/feature-specs/01-02-login-per-link.md',
      'context/feature-specs/02-01-beitraege-mahnungen.md',
      'docs/diagrams/haupt-canvas.md',
    ]);
  });

  it('says in CLAUDE.md and AGENTS.md alike what to read and how to work', () => {
    const claude = contentOf(vereinsApp(), PACKAGE_PATHS.claude);

    expect(claude).toBe(contentOf(vereinsApp(), PACKAGE_PATHS.agents));
    expect(claude).toBe(`# Vereins-App

Das Team hat dieses Projekt in Covibes geplant: Umfang, Entscheidungen, Architektur und Projektplan. Dieses Paket ist der Stand vom 3. Oktober 2026. Du baust das Projekt danach, Spec für Spec.

## Vor jeder Aufgabe lesen, in dieser Reihenfolge

1. \`context/project-overview.md\`: was gebaut wird und in welchem Umfang
2. \`context/architecture.md\`: Technik, Werkzeuge und Diagramme
3. \`context/decisions.md\`: was das Team entschieden hat und warum
4. \`context/code-standards.md\`: Konventionen für den Code
5. \`context/ui-context.md\`: Richtung für die Oberfläche (noch offen)
6. \`context/project-plan.md\`: der vollständige Projektplan
7. \`context/progress-tracker.md\`: wo das Projekt steht

Die Diagramme des Teams liegen als Mermaid in \`docs/diagrams/\`.

## Arbeitsweise

- Gearbeitet wird Spec für Spec, in der Reihenfolge der Dateien in \`context/feature-specs/\`. Ohne Spec kein Code.
- Die Specs sind ein Gerüst aus dem Projektplan. Arbeite eine Spec aus, bevor du sie baust (Ziel, Vorgehen, Abgrenzung, Checkliste), und lass sie vom Team bestätigen.
- Vor dem Start einer Spec markierst du sie in \`context/progress-tracker.md\` als „in Arbeit“. Danach hakst du ihre Checkliste ab und aktualisierst den Tracker.
- Die Entscheidungen in \`context/decisions.md\` gelten. Spricht etwas gegen eine Entscheidung, frag das Team, bevor du anders baust.
- Was als „noch offen“ markiert ist, klärst du mit dem Team vor dem ersten Code und trägst es in die Datei ein.
- Fehlt eine Angabe, rate nicht, sondern frag.

\`CLAUDE.md\` und \`AGENTS.md\` haben denselben Inhalt. Wer eine der beiden ändert, ändert beide.
`);
  });

  it('names nothing as open once the team gave both texts, and no diagrams without any', () => {
    const claude = contentOf(
      vereinsApp({
        texts: { code_standards: 'Strict.', ui_direction: 'Ruhig und hell.' },
        boards: [],
      }),
      PACKAGE_PATHS.claude,
    );

    expect(claude).not.toContain('noch offen');
    expect(claude).not.toContain('docs/diagrams');
  });

  it('gives the scope and the criteria as the overview', () => {
    expect(contentOf(vereinsApp(), PACKAGE_PATHS.overview)).toBe(`# Projektübersicht: Vereins-App

## MVP-Umfang

Mitglieder verwalten und Beiträge einziehen.

## Kriterien

Das Team bewertet Lösungen nach diesen Kriterien:

- EU-Hosting
- Open Source

Meilensteine, Risiken, Kosten und Zeit stehen in \`project-plan.md\`.
`);
  });

  it('gives the tech and the diagrams as the architecture', () => {
    expect(contentOf(vereinsApp(), PACKAGE_PATHS.architecture)).toBe(`# Architektur: Vereins-App

## Tech-Empfehlung

React und PostgreSQL.

## Diagramme

- [Haupt-Canvas](../docs/diagrams/haupt-canvas.md)

Die Entscheidungen hinter der Technik stehen mit ihrer Begründung in \`decisions.md\`.
`);
  });

  it('says what a section of the plan does not say yet', () => {
    const architecture = contentOf(
      vereinsApp({ plan: plan({ scope: 'Mitglieder verwalten.' }), boards: [] }),
      PACKAGE_PATHS.architecture,
    );

    expect(architecture).toContain('Der Projektplan sagt dazu noch nichts.');
    expect(architecture).toContain('Das Team hat keine Diagramme gezeichnet.');
  });

  it('lists the decisions with value, reasoning and alternatives, and the open ones apart', () => {
    expect(contentOf(vereinsApp(), PACKAGE_PATHS.decisions)).toBe(`# Entscheidungen: Vereins-App

Was das Team entschieden hat, die älteste Entscheidung zuerst. Diese Entscheidungen gelten.

## Entschieden

### Datenbank

**Entscheidung:** PostgreSQL

Relationale Daten, EU-Hosting möglich.

**Alternativen:**
- MongoDB: kein Schema
- SQLite

Entschieden am 2. Oktober 2026 von Olga.

## Offen

Diese Themen hat das Team noch nicht entschieden. Bau nichts, was eines davon vorwegnimmt, ohne zu fragen.

- Hosting (wieder geöffnet: Preise haben sich geändert)
`);
  });

  it('says that nothing is decided yet', () => {
    const decisions = contentOf(vereinsApp({ decisions: [] }), PACKAGE_PATHS.decisions);

    expect(decisions).toContain('## Entschieden\n\nDas Team hat noch keine Entscheidung');
    expect(decisions).not.toContain('## Offen');
  });

  it("carries the team's texts, and a note to settle what is open", () => {
    expect(contentOf(vereinsApp(), PACKAGE_PATHS.codeStandards)).toBe(
      '# Code-Standards: Vereins-App\n\nTypeScript strict, keine `any`.\n',
    );
    expect(contentOf(vereinsApp(), PACKAGE_PATHS.ui)).toMatch(
      /^# UI-Richtung: Vereins-App\n\n\*\*Noch offen\.\*\* Das Team hat keine Richtung/,
    );
  });

  it('holds the whole plan with who took which task', () => {
    const projectPlan = contentOf(vereinsApp(), PACKAGE_PATHS.plan);

    expect(projectPlan).toMatch(/^# Projektplan: Vereins-App\n\n## MVP-Umfang\n/);
    expect(projectPlan).toContain('- **Login** per Link *(Alex Berg)*');
    expect(projectPlan).toContain('## Kosten und Zeit');
  });

  it('tracks every task as open, with its spec and who took it', () => {
    expect(contentOf(vereinsApp(), PACKAGE_PATHS.tracker)).toBe(`# Fortschritt: Vereins-App

Stand: 3. Oktober 2026, aus Covibes exportiert. Gebaut ist noch nichts.

## In Arbeit

Nichts.

## Meilensteine und Aufgaben

### Meilenstein 1: Grundgerüst (2 Wochen)

- [ ] [01-01 Projekt aufsetzen](feature-specs/01-01-projekt-aufsetzen.md)
- [ ] [01-02 Login per Link](feature-specs/01-02-login-per-link.md) (Alex Berg)

### Meilenstein 2: Beiträge (3 Wochen)

- [ ] [02-01 Beiträge & Mahnungen](feature-specs/02-01-beitraege-mahnungen.md)

## Notizen

Hier steht nach jeder Spec, was entschieden und gelernt wurde.
`);
  });

  it('lists the specs by milestone with its time and goal', () => {
    expect(contentOf(vereinsApp(), PACKAGE_PATHS.specs)).toBe(`# Feature-Specs: Vereins-App

Eine Spec pro Aufgabe des Projektplans, in der Reihenfolge der Meilensteine. Jede Spec ist ein Gerüst und wird vor dem Bauen ausgearbeitet.

## Meilenstein 1: Grundgerüst (2 Wochen)

Die App läuft.

- [01-01 Projekt aufsetzen](01-01-projekt-aufsetzen.md)
- [01-02 Login per Link](01-02-login-per-link.md)

## Meilenstein 2: Beiträge (3 Wochen)

- [02-01 Beiträge & Mahnungen](02-01-beitraege-mahnungen.md)
`);
  });

  it('writes a spec as a skeleton: task, milestone, assignee, context and a checklist', () => {
    expect(contentOf(vereinsApp(), 'context/feature-specs/01-02-login-per-link.md'))
      .toBe(`# 01-02 Login per Link

> Gerüst aus dem Projektplan. Vor dem Bauen ausarbeiten (Ziel, Vorgehen, Abgrenzung, Checkliste) und vom Team bestätigen lassen.

## Aufgabe

Login per Link

## Meilenstein

Meilenstein 1: Grundgerüst (2 Wochen)

Die App läuft.

## Zuständig

Alex Berg

## Kontext

- [Projektübersicht](../project-overview.md)
- [Architektur](../architecture.md)
- [Entscheidungen](../decisions.md)
- [Code-Standards](../code-standards.md)
- [UI-Richtung](../ui-context.md)
- [Projektplan](../project-plan.md)

## Checkliste

- [ ] Die Spec ist ausgearbeitet und vom Team bestätigt.
- [ ] Die Aufgabe ist umgesetzt und getestet.
- [ ] \`context/progress-tracker.md\` ist aktualisiert.
`);
  });

  it('leaves the assignee out of a spec nobody took', () => {
    expect(
      contentOf(vereinsApp(), 'context/feature-specs/01-01-projekt-aufsetzen.md'),
    ).not.toContain('## Zuständig');
  });

  it('shortens a long task in titles and file names and keeps it whole in the spec', () => {
    const long = `Mitglieder ${'sehr '.repeat(30)}gründlich verwalten`;
    const files = buildCodingPackage(
      vereinsApp({ plan: plan({ milestones: `### Meilenstein 1\n\n- ${long}\n- !!!` }) }),
    );
    const spec = files.find((entry) => entry.path.startsWith('context/feature-specs/01-01-'));

    // The name ends with a whole word.
    expect(spec?.path).toBe(`context/feature-specs/01-01-mitglieder${'-sehr'.repeat(7)}.md`);
    expect(spec?.content.split('\n')[0]?.length).toBeLessThanOrEqual('# 01-01 '.length + 80);
    expect(spec?.content).toContain(`## Aufgabe\n\n${long}\n`);
    // A task whose text gives no name is still a file.
    expect(files.map((entry) => entry.path)).toContain('context/feature-specs/01-02-aufgabe.md');
  });

  it('says where to start when the plan names no tasks', () => {
    const input = vereinsApp({ plan: plan({ scope: 'Mitglieder verwalten.' }) });

    expect(contentOf(input, PACKAGE_PATHS.specs)).toBe(
      '# Feature-Specs: Vereins-App\n\nDer Projektplan nennt noch keine Aufgaben. Leite die Specs mit dem Team aus `project-plan.md` ab, bevor du baust.\n',
    );
    expect(contentOf(input, PACKAGE_PATHS.tracker)).toContain(
      '## Meilensteine und Aufgaben\n\nDer Projektplan nennt noch keine Aufgaben.',
    );
  });

  it('holds at most MAX_PACKAGE_SPECS specs', () => {
    const tasks = Array.from({ length: 260 }, (_, index) => `- Aufgabe ${String(index + 1)}`);
    const milestones = `### Meilenstein 1\n\n${tasks.join('\n')}\n\n### Meilenstein 2\n\n${tasks.join('\n')}`;
    const specs = buildCodingPackage(vereinsApp({ plan: plan({ milestones }) })).filter((entry) =>
      /feature-specs\/\d\d-\d/.test(entry.path),
    );

    expect(specs).toHaveLength(MAX_PACKAGE_SPECS);
    expect(specs.at(-1)?.path).toBe('context/feature-specs/02-240-aufgabe-240.md');
  });

  it('gives boards with the same name files of their own, and the roadmap to the board that shows it', () => {
    const note = () => node({ type: 'sticky', label: 'Idee' });
    const roadmap = node({ type: 'frame', label: 'Roadmap', diagramType: ROADMAP_DIAGRAM });
    const files = buildCodingPackage(
      vereinsApp({
        boards: [
          { title: 'Skizze', nodes: [note()], edges: [] },
          { title: 'Skizze', nodes: [note()], edges: [] },
          { title: '???', nodes: [roadmap], edges: [] },
        ],
      }),
    );

    expect(files.map((entry) => entry.path).filter((path) => path.startsWith('docs/'))).toEqual([
      'docs/diagrams/skizze.md',
      'docs/diagrams/skizze-2.md',
      'docs/diagrams/board.md',
    ]);
    expect(files.at(-1)?.content).toContain('timeline');
  });

  it('keeps what people wrote from becoming markup', () => {
    const files = buildCodingPackage(
      vereinsApp({
        projectName: 'App *neu* <b>',
        criteria: ['[Link](http://example.com)'],
      }),
    );
    const overview = files.find((entry) => entry.path === PACKAGE_PATHS.overview)?.content;

    expect(overview).toContain('# Projektübersicht: App \\*neu\\* \\<b\\>');
    expect(overview).toContain('- \\[Link\\](http://example.com)');
  });

  it('writes an English package for an English project', () => {
    const input = vereinsApp({ language: 'en', projectName: 'Club app' });

    expect(contentOf(input, PACKAGE_PATHS.claude)).toContain(
      'This package is the state of October 3, 2026.',
    );
    expect(contentOf(input, PACKAGE_PATHS.decisions)).toContain(
      'Decided on October 2, 2026 by Olga.',
    );
    expect(contentOf(input, PACKAGE_PATHS.tracker)).toContain('## In progress\n\nNothing.');
    expect(contentOf(input, 'context/feature-specs/01-01-projekt-aufsetzen.md')).toContain(
      '- [Project plan](../project-plan.md)',
    );
  });

  it('is empty without a plan: the template alone is none', () => {
    expect(buildCodingPackage(vereinsApp({ plan: [] }))).toEqual([]);
    expect(buildCodingPackage(vereinsApp({ plan: planTemplate('de').content ?? [] }))).toEqual([]);
  });
});

describe('codingPackageSummary', () => {
  it('counts what the package holds and lists its files', () => {
    const summary = codingPackageSummary(vereinsApp());

    expect(summary).toMatchObject({
      hasPlan: true,
      milestones: 2,
      tasks: 3,
      decisions: { decided: 1, open: 1 },
      diagrams: 1,
    });
    expect(summary.files).toEqual(buildCodingPackage(vereinsApp()).map((entry) => entry.path));
  });

  it('has no files without a plan', () => {
    expect(codingPackageSummary(vereinsApp({ plan: [] }))).toEqual({
      hasPlan: false,
      milestones: 0,
      tasks: 0,
      decisions: { decided: 1, open: 1 },
      diagrams: 1,
      files: [],
    });
  });
});

describe('packageTextInputSchema', () => {
  it('trims a text and takes an empty one', () => {
    expect(packageTextInputSchema.parse({ content: '  Strict.\n' })).toEqual({
      content: 'Strict.',
    });
    expect(packageTextInputSchema.parse({ content: '   ' })).toEqual({ content: '' });
  });

  it('refuses a text that is too long, and anything else', () => {
    expect(packageTextInputSchema.safeParse({ content: 'x'.repeat(8001) }).success).toBe(false);
    expect(packageTextInputSchema.safeParse({ content: 'x', kind: 'y' }).success).toBe(false);
    expect(packageTextInputSchema.safeParse({}).success).toBe(false);
  });
});
