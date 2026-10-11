import { describe, expect, it } from 'vitest';

import {
  findReferences,
  MESSAGE_REFERENCES_MAX,
  referenceLabel,
  referenceNames,
  REFERENCE_LABEL_MAX,
  splitReferences,
  type MessageReference,
  type ReferenceBoard,
} from './canvas-references';

const MAIN = '11111111-1111-4111-8111-111111111111';
const EXTRA = '22222222-2222-4222-8222-222222222222';
const OLGA = '33333333-3333-4333-8333-333333333333';

let next = 0;
function node(
  label: string,
  by: 'human' | 'moderator' | 'backend' = 'human',
  position = { x: 0, y: 0 },
) {
  next += 1;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(next).padStart(12, '0')}`,
    label,
    position,
    createdBy:
      by === 'human'
        ? ({ kind: 'human', userId: OLGA } as const)
        : ({ kind: 'agent', agentKey: by } as const),
  };
}

describe('referenceLabel', () => {
  it('is the label on one line, without the brackets a reference is written with', () => {
    expect(referenceLabel({ label: 'AI-Gateway' })).toBe('AI-Gateway');
    expect(referenceLabel({ label: '  Echtzeit\n\tund  Chat ' })).toBe('Echtzeit und Chat');
    expect(referenceLabel({ label: 'Queue [intern]' })).toBe('Queue intern');
  });

  it('cuts a long label, so a note can be referred to by how it starts', () => {
    const label = referenceLabel({ label: 'a'.repeat(REFERENCE_LABEL_MAX + 40) });

    expect(label).toHaveLength(REFERENCE_LABEL_MAX);
    expect(label.endsWith('…')).toBe(true);
    expect(referenceLabel({ label: 'b'.repeat(REFERENCE_LABEL_MAX) })).toBe(
      'b'.repeat(REFERENCE_LABEL_MAX),
    );
  });

  it('is empty for an element nobody named', () => {
    expect(referenceLabel({ label: '  ' })).toBe('');
    expect(referenceLabel({ label: '[]' })).toBe('');
  });
});

describe('referenceNames', () => {
  it('finds the names in square brackets, each once, in their order', () => {
    expect(
      referenceNames('Hängt [Web-App] an [ AI-Gateway ]? Und [web-app] an [Postgres]?'),
    ).toEqual(['Web-App', 'AI-Gateway', 'Postgres']);
  });

  it('leaves Markdown links, empty brackets and brackets over several lines alone', () => {
    expect(referenceNames('Siehe [die Doku](https://example.com/a) und [Block].')).toEqual([
      'Block',
    ]);
    expect(referenceNames('[] [ ] [a\nb]')).toEqual([]);
    expect(referenceNames(`[${'x'.repeat(REFERENCE_LABEL_MAX + 1)}]`)).toEqual([]);
  });

  it('reads the inner brackets of nested ones', () => {
    expect(referenceNames('[[AI-Gateway]]')).toEqual(['AI-Gateway']);
  });
});

describe('findReferences', () => {
  it('matches a name to the element that has it, whatever the case of its letters', () => {
    const gateway = node('AI-Gateway', 'moderator');
    const boards: ReferenceBoard[] = [{ boardId: MAIN, nodes: [node('Web-App'), gateway] }];

    expect(findReferences('Was macht das [ai-gateway] genau?', boards)).toEqual([
      {
        label: 'ai-gateway',
        boardId: MAIN,
        nodeId: gateway.id,
        by: { kind: 'agent', agentKey: 'moderator' },
      },
    ]);
  });

  it('says only that a person made an element, not who', () => {
    const boards: ReferenceBoard[] = [{ boardId: MAIN, nodes: [node('Web-App')] }];

    const [reference] = findReferences('[Web-App]', boards);

    expect(reference?.by).toEqual({ kind: 'human' });
    expect(JSON.stringify(reference)).not.toContain(OLGA);
  });

  it('looks on the boards in their order and takes the first that has the name', () => {
    const onMain = node('Datenbank');
    const onExtra = node('Datenbank', 'backend');
    const onlyExtra = node('Ablauf');
    const boards: ReferenceBoard[] = [
      { boardId: MAIN, nodes: [onMain] },
      { boardId: EXTRA, nodes: [onExtra, onlyExtra] },
    ];

    expect(findReferences('[Datenbank] und [Ablauf]', boards).map((found) => found.nodeId)).toEqual(
      [onMain.id, onlyExtra.id],
    );
    expect(findReferences('[Ablauf]', boards)[0]?.boardId).toBe(EXTRA);
  });

  it('takes the element furthest up, then furthest left, of several with one name', () => {
    const low = node('Service', 'human', { x: 0, y: 400 });
    const right = node('Service', 'human', { x: 300, y: 100 });
    const left = node('Service', 'human', { x: 20, y: 100 });
    const boards: ReferenceBoard[] = [{ boardId: MAIN, nodes: [low, right, left] }];

    expect(findReferences('[Service]', boards)[0]?.nodeId).toBe(left.id);
  });

  it('keeps a name no element has as text, and an element without a name out of it', () => {
    const boards: ReferenceBoard[] = [{ boardId: MAIN, nodes: [node('Web-App'), node('')] }];

    expect(findReferences('[Gibt es nicht] [1] []', boards)).toEqual([]);
    expect(findReferences('Kein Verweis.', boards)).toEqual([]);
    expect(findReferences('[Web-App]', [])).toEqual([]);
  });

  it('finds a long note by how it starts', () => {
    const note = node(`Echtzeit ist uns wichtig, weil ${'das Team verteilt arbeitet '.repeat(5)}`);
    const boards: ReferenceBoard[] = [{ boardId: MAIN, nodes: [note] }];

    expect(findReferences(`[${referenceLabel(note)}]`, boards)[0]?.nodeId).toBe(note.id);
  });

  it('stops at the most references a message holds', () => {
    const nodes = Array.from({ length: MESSAGE_REFERENCES_MAX + 5 }, (_, index) =>
      node(`Block ${String(index + 1)}`),
    );
    const text = nodes.map((entry) => `[${entry.label}]`).join(' ');

    const found = findReferences(text, [{ boardId: MAIN, nodes }]);

    expect(found).toHaveLength(MESSAGE_REFERENCES_MAX);
    expect(found.at(-1)?.label).toBe(`Block ${String(MESSAGE_REFERENCES_MAX)}`);
  });
});

describe('splitReferences', () => {
  const gateway: MessageReference = {
    label: 'AI-Gateway',
    boardId: MAIN,
    nodeId: '44444444-4444-4444-8444-444444444444',
    by: { kind: 'agent', agentKey: 'moderator' },
  };

  it('splits a text at its references and keeps everything else as written', () => {
    expect(
      splitReferences('Das [AI-Gateway] hängt an [Postgres], siehe [ ai-gateway ].', [gateway]),
    ).toEqual([
      { kind: 'text', text: 'Das ' },
      { kind: 'reference', text: '[AI-Gateway]', reference: gateway },
      { kind: 'text', text: ' hängt an [Postgres], siehe ' },
      { kind: 'reference', text: '[ ai-gateway ]', reference: gateway },
      { kind: 'text', text: '.' },
    ]);
  });

  it('is the text alone for a message without references', () => {
    expect(splitReferences('Das [AI-Gateway] gibt es nicht.', [])).toEqual([
      { kind: 'text', text: 'Das [AI-Gateway] gibt es nicht.' },
    ]);
    expect(splitReferences('', [gateway])).toEqual([]);
  });

  it('leaves a Markdown link with the same words to the links', () => {
    expect(splitReferences('[AI-Gateway](https://example.com)', [gateway])).toEqual([
      { kind: 'text', text: '[AI-Gateway](https://example.com)' },
    ]);
  });
});
