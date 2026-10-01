import { randomUUID } from 'node:crypto';

import type { Comparison, DecisionOperation, ProposalReason } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import type { Intent } from '@server/rules/decide';
import type { DecisionContext, DecisionWriter } from '@server/tasks/run-decisions';
import {
  compareOptionsTool,
  recordDecisionTool,
  startVoteTool,
  updateCriteriaTool,
} from '@server/tools/decision-tools';

const OLGA = randomUUID();

/** A decision writer that keeps everything in memory, like the database would. */
function memoryWriter(initial: Partial<DecisionContext> = {}) {
  const context: DecisionContext = {
    criteria: [...(initial.criteria ?? [])],
    decisions: [...(initial.decisions ?? [])],
    pending: [...(initial.pending ?? [])],
    votes: [...(initial.votes ?? [])],
  };
  const decided: { operation: DecisionOperation; userId: string | null }[] = [];
  const proposed: { operation: DecisionOperation; reason: ProposalReason }[] = [];
  const compared: Comparison[] = [];
  const writer: DecisionWriter = {
    load: () => Promise.resolve(context),
    addCriteria: (texts) => {
      context.criteria.push(...texts.map((text) => ({ id: randomUUID(), text })));
      return Promise.resolve();
    },
    removeCriteria: (ids) => {
      const before = context.criteria.length;
      context.criteria = context.criteria.filter((criterion) => !ids.includes(criterion.id));
      return Promise.resolve(before - context.criteria.length);
    },
    open: (topic) => {
      context.decisions.push({
        id: randomUUID(),
        topic,
        status: 'open',
        value: null,
        reasoning: '',
      });
      return Promise.resolve(true);
    },
    decide: (operation, userId) => {
      decided.push({ operation, userId });
      return Promise.resolve(true);
    },
    propose: (operation, reason) => {
      proposed.push({ operation, reason });
      context.pending.push(operation);
      return Promise.resolve();
    },
    compare: (comparison) => {
      compared.push(comparison);
      return Promise.resolve();
    },
    startVote: (topic, options) => {
      context.votes.push({ topic, options: [...options] });
      return Promise.resolve(true);
    },
  };
  return { writer, context, decided, proposed, compared };
}

const rules = (intent: Intent, proposalsOnly = false) => ({
  intent: Promise.resolve(intent),
  proposalsOnly,
});

describe('update_criteria', () => {
  it('adds what is new and removes by id', async () => {
    const hosting = { id: randomUUID(), text: 'EU-Hosting' };
    const budget = { id: randomUUID(), text: 'Budget: klein' };
    const { writer, context } = memoryWriter({ criteria: [hosting, budget] });
    const tool = updateCriteriaTool({ decisions: writer });

    const answer = await tool.run({
      add: ['Team: 3 Devs', 'eu-hosting', 'Team: 3 Devs'],
      remove: [budget.id],
    });

    expect(context.criteria.map((criterion) => criterion.text)).toEqual([
      'EU-Hosting',
      'Team: 3 Devs',
    ]);
    expect(answer).toBe('Added: Team: 3 Devs. Removed: 1. The others were there already.');
  });

  it('keeps to the limit of criteria per project', async () => {
    const criteria = Array.from({ length: 19 }, (_, index) => ({
      id: randomUUID(),
      text: `Kriterium ${String(index)}`,
    }));
    const { writer, context } = memoryWriter({ criteria });
    const tool = updateCriteriaTool({ decisions: writer });

    const answer = await tool.run({ add: ['Erstes', 'Zweites'] });

    expect(context.criteria).toHaveLength(20);
    expect(answer).toContain('Added: Erstes.');
    expect(answer).toContain('Not added, a project has at most 20 criteria: Zweites.');
  });

  it('rejects criteria that are too long', async () => {
    const tool = updateCriteriaTool({ decisions: memoryWriter().writer });
    await expect(tool.run({ add: ['x'.repeat(81)] })).rejects.toThrow();
  });
});

describe('record_decision', () => {
  const canvas = {
    topic: 'Canvas',
    value: 'React Flow',
    reasoning: 'Strukturierte Blöcke, MIT-Lizenz',
    alternatives: [{ name: 'tldraw', note: 'Lizenz' }],
  };

  it('records directly on an instruction, confirmed by the person who asked', async () => {
    const { writer, decided, proposed } = memoryWriter();
    const tool = recordDecisionTool({
      decisions: writer,
      rules: rules('instruction'),
      actorUserId: OLGA,
    });

    const answer = await tool.run(canvas);

    expect(decided).toEqual([{ operation: { op: 'decide', ...canvas }, userId: OLGA }]);
    expect(proposed).toEqual([]);
    expect(answer).toBe('Recorded the decision "Canvas: React Flow" in the decision log.');
  });

  it('proposes the decision on a question, on its own initiative and in the proposals-only mode', async () => {
    for (const [given, reason] of [
      [rules('question'), 'question'],
      [rules('initiative'), 'initiative'],
      [rules('instruction', true), 'proposals_only'],
    ] as const) {
      const { writer, decided, proposed } = memoryWriter();
      const tool = recordDecisionTool({ decisions: writer, rules: given, actorUserId: OLGA });

      const answer = await tool.run({ topic: 'Canvas', value: 'React Flow' });

      expect(decided).toEqual([]);
      expect(proposed).toEqual([
        {
          operation: {
            op: 'decide',
            topic: 'Canvas',
            value: 'React Flow',
            reasoning: '',
            alternatives: [],
          },
          reason,
        },
      ]);
      expect(answer).toContain('It is not recorded until someone in the team confirms it');
    }
  });

  it('notes a topic without a value as open, once', async () => {
    const { writer, context } = memoryWriter();
    const tool = recordDecisionTool({
      decisions: writer,
      rules: rules('question'),
      actorUserId: null,
    });

    expect(await tool.run({ topic: 'Hosting' })).toBe('Noted "Hosting" as an open decision.');
    expect(await tool.run({ topic: 'hosting' })).toBe(
      '"hosting" is noted as an open decision already.',
    );
    expect(context.decisions).toMatchObject([{ topic: 'Hosting', status: 'open' }]);
  });

  it('decides an open topic under its existing name', async () => {
    const { writer, decided } = memoryWriter({
      decisions: [
        { id: randomUUID(), topic: 'Hosting', status: 'open', value: null, reasoning: '' },
      ],
    });
    const tool = recordDecisionTool({
      decisions: writer,
      rules: rules('instruction'),
      actorUserId: OLGA,
    });

    await tool.run({ topic: 'hosting', value: 'Frankfurt' });

    expect(decided[0]?.operation).toMatchObject({ topic: 'Hosting', value: 'Frankfurt' });
  });

  it('leaves a decided topic alone and does not propose twice', async () => {
    const { writer, decided, proposed } = memoryWriter({
      decisions: [
        {
          id: randomUUID(),
          topic: 'Canvas',
          status: 'decided',
          value: 'React Flow',
          reasoning: '',
        },
      ],
      pending: [{ op: 'decide', topic: 'Backend', value: 'Hono', reasoning: '', alternatives: [] }],
    });
    const tool = recordDecisionTool({
      decisions: writer,
      rules: rules('instruction'),
      actorUserId: OLGA,
    });

    expect(await tool.run({ topic: 'canvas', value: 'tldraw' })).toContain(
      '"Canvas" is decided already: React Flow. Nothing changed. Someone in the team has to reopen',
    );
    expect(await tool.run({ topic: 'Backend', value: 'Express' })).toBe(
      'A decision on "Backend" waits for confirmation already. Nothing changed.',
    );
    expect(decided).toEqual([]);
    expect(proposed).toEqual([]);
  });
});

describe('record_decision by decision process (spec 16b)', () => {
  const backend = { topic: 'Backend', value: 'Hono' };

  it('lets the owner decide: direct for an owner, a proposal for everyone else', async () => {
    const byEditor = memoryWriter();
    const forEditor = recordDecisionTool({
      decisions: byEditor.writer,
      rules: rules('instruction'),
      actorUserId: OLGA,
      process: 'owner',
      actorIsOwner: false,
    });
    expect(await forEditor.run(backend)).toContain('In this project the owner decides');
    expect(byEditor.decided).toEqual([]);
    expect(byEditor.proposed).toMatchObject([{ reason: 'owner_decides' }]);

    const byOwner = memoryWriter();
    const forOwner = recordDecisionTool({
      decisions: byOwner.writer,
      rules: rules('instruction'),
      actorUserId: OLGA,
      process: 'owner',
      actorIsOwner: true,
    });
    await forOwner.run(backend);
    expect(byOwner.decided).toMatchObject([{ userId: OLGA }]);
  });

  it('records informally without confirmation, except in the proposals-only mode', async () => {
    const informal = memoryWriter();
    const tool = recordDecisionTool({
      decisions: informal.writer,
      rules: rules('question'),
      actorUserId: OLGA,
      process: 'informal',
    });
    await tool.run(backend);
    expect(informal.decided).toMatchObject([{ userId: OLGA }]);

    const strict = memoryWriter();
    const guarded = recordDecisionTool({
      decisions: strict.writer,
      rules: rules('question', true),
      actorUserId: OLGA,
      process: 'informal',
    });
    await guarded.run(backend);
    expect(strict.decided).toEqual([]);
    expect(strict.proposed).toMatchObject([{ reason: 'proposals_only' }]);
  });

  it('records nothing where the project votes, but still notes open topics', async () => {
    const { writer, decided, proposed, context } = memoryWriter();
    const tool = recordDecisionTool({
      decisions: writer,
      rules: rules('instruction'),
      actorUserId: OLGA,
      process: 'vote',
    });

    expect(await tool.run(backend)).toContain('This project decides by vote');
    expect(decided).toEqual([]);
    expect(proposed).toEqual([]);
    await tool.run({ topic: 'Hosting' });
    expect(context.decisions).toMatchObject([{ topic: 'Hosting', status: 'open' }]);
  });
});

describe('compare_options', () => {
  const input = {
    topic: 'Canvas',
    options: ['React Flow', 'tldraw'],
    rows: [
      {
        criterion: 'Kleines Budget',
        ratings: [
          { option: 'tldraw', rating: 'bad', note: 'Lizenz kostet' },
          { option: 'react flow', rating: 'good', note: 'MIT' },
        ],
      },
    ],
    recommendation: { option: 'react flow', reason: 'Passt zum Budget.' },
  };

  it('shows the comparison with the cells in the order of the options', async () => {
    const { writer, compared } = memoryWriter();
    const tool = compareOptionsTool({ decisions: writer, stance: 'criteria' });

    const answer = await tool.run(input);

    expect(compared).toEqual([
      {
        topic: 'Canvas',
        options: ['React Flow', 'tldraw'],
        rows: [
          {
            criterion: 'Kleines Budget',
            cells: [
              { rating: 'good', note: 'MIT' },
              { rating: 'bad', note: 'Lizenz kostet' },
            ],
          },
        ],
        recommendation: { option: 'React Flow', reason: 'Passt zum Budget.' },
      },
    ]);
    expect(answer).toContain('is shown as a card in your answer');
  });

  it('drops the recommendation when the moderator is strictly neutral', async () => {
    const { writer, compared } = memoryWriter();
    const tool = compareOptionsTool({ decisions: writer, stance: 'strict' });

    const answer = await tool.run(input);

    expect(compared[0]?.recommendation).toBeNull();
    expect(answer).toContain('Your stance is strictly neutral');
  });

  it('refuses rows that leave out an option and recommendations of unknown options', async () => {
    const { writer, compared } = memoryWriter();
    const tool = compareOptionsTool({ decisions: writer });

    await expect(
      tool.run({
        ...input,
        rows: [{ criterion: 'Budget', ratings: [{ option: 'tldraw', rating: 'ok' }] }],
      }),
    ).rejects.toThrow('has no rating for "React Flow"');
    await expect(
      tool.run({ ...input, recommendation: { option: 'Excalidraw', reason: 'x' } }),
    ).rejects.toThrow('is none of the options');
    expect(compared).toEqual([]);
  });
});

describe('start_vote', () => {
  it('starts a vote on a topic that is neither decided nor being voted on', async () => {
    const { writer, context } = memoryWriter({
      decisions: [
        {
          id: randomUUID(),
          topic: 'Canvas',
          status: 'decided',
          value: 'React Flow',
          reasoning: '',
        },
        { id: randomUUID(), topic: 'Hosting', status: 'open', value: null, reasoning: '' },
      ],
      votes: [{ topic: 'Backend', options: ['Hono', 'Express'] }],
    });
    const tool = startVoteTool({ decisions: writer });

    expect(await tool.run({ topic: 'canvas', options: ['A', 'B'] })).toContain(
      '"Canvas" is decided already',
    );
    expect(await tool.run({ topic: 'backend', options: ['A', 'B'] })).toContain('is open already');
    expect(
      await tool.run({ topic: 'hosting', options: ['Frankfurt', 'Paris', 'frankfurt'] }),
    ).toContain('Started the vote on "hosting"');
    expect(context.votes.at(-1)).toEqual({ topic: 'Hosting', options: ['Frankfurt', 'Paris'] });
    await expect(tool.run({ topic: 'Sprache', options: ['TS', 'ts'] })).rejects.toThrow(
      'at least two different options',
    );
  });
});
