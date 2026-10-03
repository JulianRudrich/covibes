import { describe, expect, it } from 'vitest';

import type { Roadmap } from '../plan-roadmap';
import { boardToMermaid } from './mermaid';
import type { Author, CanvasEdge, CanvasNode } from './model';

const OLGA: Author = { kind: 'human', userId: '11111111-1111-4111-8111-111111111111' };
const AT = '2026-10-03T10:00:00.000Z';

let counter = 0;
/** An id that reads well in a failing test and is a valid uuid. */
const id = () => `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, '0')}`;

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

const block = (label: string, x: number, y: number, fields: Partial<CanvasNode> = {}): CanvasNode =>
  node({ type: 'block', label, position: { x, y }, ...fields });

const frame = (label: string, diagramType: string | null, y: number): CanvasNode =>
  node({ type: 'frame', label, diagramType, position: { x: 0, y } });

const edge = (source: CanvasNode, target: CanvasNode, label = ''): CanvasEdge => ({
  id: id(),
  source: source.id,
  target: target.id,
  sourceHandle: null,
  targetHandle: null,
  label,
  createdBy: OLGA,
  lastChangedBy: OLGA,
  lastChangedAt: AT,
});

const mermaidOf = (
  nodes: CanvasNode[],
  edges: CanvasEdge[] = [],
  extra: { roadmap?: Roadmap; language?: 'de' | 'en' } = {},
) => boardToMermaid({ title: 'Haupt-Canvas', nodes, edges, language: 'de', ...extra });

describe('boardToMermaid', () => {
  it('writes an architecture as a flowchart, in reading order, with labels on its arrows', () => {
    const architecture = frame('Architektur', 'architecture', 0);
    const inFrame = { frameId: architecture.id };
    const api = block('API', 40, 200, { ...inFrame, subtitle: 'Logik und Login' });
    const browser = block('Browser', 40, 60, inFrame);
    const database = block('PostgreSQL', 40, 340, { ...inFrame, blockType: 'database' });

    expect(
      mermaidOf(
        [architecture, api, database, browser],
        [edge(browser, api, 'REST'), edge(api, database)],
      ),
    ).toBe(`# Haupt-Canvas

## Architektur

\`\`\`mermaid
flowchart TD
  n1["Browser"]
  n2["API<br/>Logik und Login"]
  n3[("PostgreSQL")]
  n1 -->|"REST"| n2
  n2 --> n3
\`\`\`
`);
  });

  it('keeps the shapes of a flow', () => {
    const flow = frame('Anmeldung', 'flow', 0);
    const inFrame = { frameId: flow.id };
    const start = block('Start', 0, 0, { ...inFrame, blockType: 'start' });
    const check = block('Link gültig?', 0, 100, { ...inFrame, blockType: 'decision' });
    const end = block('Angemeldet', 0, 200, { ...inFrame, blockType: 'end' });

    const lines = mermaidOf(
      [flow, start, check, end],
      [edge(start, check), edge(check, end, 'ja')],
    );

    expect(lines).toContain('  n1(["Start"])');
    expect(lines).toContain('  n2{"Link gültig?"}');
    expect(lines).toContain('  n3(["Angemeldet"])');
    expect(lines).toContain('  n2 -->|"ja"| n3');
  });

  it('writes a mind map as a tree from its topic, and as a flowchart when it is none', () => {
    const map = frame('Ideen', 'mindmap', 0);
    const inFrame = { frameId: map.id };
    const topic = block('Vereins-App', 0, 100, { ...inFrame, blockType: 'topic' });
    const members = block('Mitglieder', 300, 0, { ...inFrame, blockType: 'idea' });
    const times = block('Trainingszeiten', 300, 200, { ...inFrame, blockType: 'idea' });
    const list = block('Liste "aktiv"', 600, 0, { ...inFrame, blockType: 'idea' });
    const tree = [edge(topic, times), edge(topic, members), edge(members, list)];

    expect(mermaidOf([map, topic, members, times, list], tree)).toContain(`\`\`\`mermaid
mindmap
  root(("Vereins-App"))
    n2["Mitglieder"]
      n3["Liste 'aktiv'"]
    n4["Trainingszeiten"]
\`\`\``);

    // A block two arrows lead to makes it a graph.
    const graph = mermaidOf([map, topic, members, times, list], [...tree, edge(times, list)]);
    expect(graph).toContain('flowchart LR');
    expect(graph).not.toContain('mindmap');
  });

  it('writes a data model with its fields and the cardinality of its arrows', () => {
    const model = frame('Datenmodell', 'datamodel', 0);
    const inFrame = { frameId: model.id, blockType: 'entity' };
    const user = block('Mitglied', 0, 0, {
      ...inFrame,
      fields: [
        { name: 'id', type: 'uuid' },
        { name: 'E-Mail Adresse', type: '' },
        { name: '2fa', type: 'timestamp with time zone' },
      ],
    });
    const fee = block('Beitrag', 300, 0, inFrame);
    const group = block('Gruppe', 600, 0, inFrame);

    expect(
      mermaidOf(
        [model, user, fee, group],
        [edge(user, fee, '1:n zahlt'), edge(group, user, 'n:m'), edge(fee, group, 'gehört zu')],
      ),
    ).toContain(`erDiagram
  e1["Mitglied"] {
    uuid id
    _ E_Mail_Adresse
    timestamp_with_time_zone _2fa
  }
  e2["Beitrag"]
  e3["Gruppe"]
  e1 ||--o{ e2 : "zahlt"
  e3 }o--o{ e1 : ""
  e2 }o--o{ e3 : "gehört zu"`);
  });

  it('writes the roadmap as a timeline, with weeks when every milestone has a time', () => {
    const roadmapFrame = frame('Roadmap', 'roadmap', 0);
    const milestone = (number: number, title: string, weeks: number | null) => ({
      number,
      title,
      goal: '',
      duration: weeks === null ? null : { text: `${String(weeks)} Wochen`, weeks },
      tasks: [],
    });

    expect(
      mermaidOf([roadmapFrame], [], {
        roadmap: { milestones: [milestone(1, 'Grundgerüst: Login', 3), milestone(2, 'Start', 1)] },
      }),
    ).toContain(`timeline
  title Roadmap
  W1–3 : Grundgerüst Login
  W4 : Start`);

    expect(
      mermaidOf([roadmapFrame], [], {
        language: 'en',
        roadmap: { milestones: [milestone(1, 'Basics', 3), milestone(2, 'Launch', null)] },
      }),
    ).toContain(`  Milestone 1 : Basics : 3 Wochen
  Milestone 2 : Launch`);

    // Without a roadmap to read, or without milestones, the frame has nothing to draw.
    expect(mermaidOf([roadmapFrame])).toBe('# Haupt-Canvas\n\nDieses Board ist leer.\n');
  });

  it('adds the blocks outside of frames, the arrows between diagrams and the notes', () => {
    const architecture = frame('Architektur', 'architecture', 0);
    const api = block('API', 40, 60, { frameId: architecture.id });
    const hosting = block('Hosting', 900, 0, { subtitle: 'ca. 15 € pro Monat' });
    const mail = block('Versand', 900, 200);
    const note = node({
      type: 'sticky',
      label: 'Wer zahlt das *Hosting*?',
      position: { x: 0, y: 900 },
    });
    const empty = frame('Leer', null, 500);

    expect(
      mermaidOf(
        [architecture, api, hosting, mail, note, empty],
        [edge(hosting, mail), edge(api, hosting, 'läuft auf')],
      ),
    ).toBe(`# Haupt-Canvas

## Architektur

\`\`\`mermaid
flowchart TD
  n1["API"]
\`\`\`

## Weitere Elemente

\`\`\`mermaid
flowchart TD
  n1["Hosting<br/>ca. 15 € pro Monat"]
  n2["Versand"]
  n1 --> n2
\`\`\`

## Verbindungen zwischen Diagrammen

- API → Hosting: läuft auf

## Notizen

- Wer zahlt das \\*Hosting\\*?
`);
  });

  it('is one diagram without a heading when the board has no frames', () => {
    const a = block('A', 0, 0);
    const b = block('B', 0, 200);

    expect(mermaidOf([a, b], [edge(a, b)])).toBe(`# Haupt-Canvas

\`\`\`mermaid
flowchart TD
  n1["A"]
  n2["B"]
  n1 --> n2
\`\`\`
`);
  });

  it('keeps texts from breaking the diagram or the Markdown', () => {
    const tricky = block('Say "hi" <b>#1</b>\nnow', 0, 0, { subtitle: 'a  b' });
    const other = block('B', 0, 200);

    const output = boardToMermaid({
      title: 'Board [1] `x`',
      nodes: [tricky, other],
      edges: [edge(tricky, other, 'uses "API"'), { ...edge(tricky, tricky), target: id() }],
      language: 'en',
    });

    expect(output).toContain('# Board \\[1\\] \\`x\\`');
    expect(output).toContain('  n1["Say #quot;hi#quot; #lt;b#gt;#35;1#lt;/b#gt; now<br/>a b"]');
    expect(output).toContain('  n1 -->|"uses #quot;API#quot;"| n2');
    // An arrow to something that is no block of the board is left out.
    expect(output.match(/-->/g)).toHaveLength(1);
  });

  it('says so in the language of the project when the board is empty', () => {
    expect(boardToMermaid({ title: 'Board', nodes: [], edges: [], language: 'en' })).toBe(
      '# Board\n\nThis board is empty.\n',
    );
  });
});
