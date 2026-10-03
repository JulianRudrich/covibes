import { randomUUID } from 'node:crypto';

import {
  addBlock,
  addFrame,
  isRoadmap,
  planNodesFromMarkdown,
  readNodes,
  readRoadmap,
  ROADMAP_DIAGRAM,
  roadmapLayout,
  type CanvasNode,
  type Roadmap,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import type { Intent } from '@server/rules/decide';
import { memoryBoards, memoryRules } from '@server/test-boards';
import { addRoadmapTool } from '@server/tools/add-roadmap';

const BOARD_ID = randomUUID();
const OLGA = { kind: 'human', userId: randomUUID() } as const;
const MODERATOR = { kind: 'agent', agentKey: 'moderator' } as const;

const ROADMAP: Roadmap = readRoadmap({
  milestones: planNodesFromMarkdown(
    [
      '### Meilenstein 1: Grundgerüst (2 Wochen)',
      'Die App läuft.',
      '- Login\n- Projekt anlegen',
      '### Meilenstein 2: Mitglieder (3 Wochen)',
      '- Mitgliederliste',
    ].join('\n\n'),
  ),
});

/** A board with the block "API", and the tool as the moderator uses it in a run. */
function setup({ intent, roadmap = ROADMAP }: { intent?: Intent; roadmap?: Roadmap } = {}) {
  const { boards, doc } = memoryBoards();
  const board = doc(BOARD_ID);
  addBlock(board, { id: randomUUID(), position: { x: 100, y: 100 }, label: 'API' }, OLGA);
  const run = intent ? memoryRules(intent) : undefined;
  const tool = addRoadmapTool({
    boards,
    boardId: BOARD_ID,
    author: MODERATOR,
    ...(run ? { rules: run.rules } : {}),
    loadRoadmap: () => Promise.resolve(roadmap),
  });
  return { board, tool, operations: run?.operations ?? [] };
}

function overlap(a: CanvasNode, b: CanvasNode) {
  return (
    a.position.x < b.position.x + b.size.width &&
    b.position.x < a.position.x + a.size.width &&
    a.position.y < b.position.y + b.size.height &&
    b.position.y < a.position.y + a.size.height
  );
}

describe('add_roadmap', () => {
  it('adds the roadmap of the plan at a free spot, with the size of its content', async () => {
    const { board, tool } = setup();

    const answer = await tool.run({});

    const roadmap = readNodes(board).find(isRoadmap);
    expect(roadmap).toMatchObject({
      type: 'frame',
      diagramType: ROADMAP_DIAGRAM,
      label: 'Roadmap',
      size: roadmapLayout(ROADMAP).size,
      createdBy: MODERATOR,
    });
    expect(answer).toBe(
      `Added the roadmap "Roadmap" (id ${roadmap?.id ?? ''}) at ${String(roadmap?.position.x)}, ${String(roadmap?.position.y)}. It shows 2 milestones of the plan over 5 weeks.`,
    );
    const block = readNodes(board).find((node) => node.type === 'block');
    if (!roadmap || !block) throw new Error('A node is missing');
    expect(overlap(roadmap, block)).toBe(false);
  });

  it('says where the roadmap is when the main canvas has one', async () => {
    const { board, tool } = setup();
    const id = randomUUID();
    addFrame(
      board,
      {
        id,
        position: { x: 600, y: 40 },
        title: 'Zeitplan',
        diagramType: ROADMAP_DIAGRAM,
        size: { width: 800, height: 300 },
      },
      OLGA,
    );

    const answer = await tool.run({});

    expect(answer).toBe(
      `The main canvas already has the roadmap "Zeitplan" (id ${id}) at 600, 40; a project has one, and it follows the plan by itself.`,
    );
    expect(readNodes(board).filter(isRoadmap)).toHaveLength(1);
  });

  it("becomes a proposal on the agent's own initiative, once per run", async () => {
    const { board, tool, operations } = setup({ intent: 'initiative' });

    const answer = await tool.run({});

    expect(answer).toMatch(
      /^Proposed: to add the roadmap "Roadmap" \(id [0-9a-f-]{36}\)\. This is a proposal: .+ It shows 2 milestones/,
    );
    expect(operations).toMatchObject([
      {
        op: 'add_frame',
        frame: {
          title: 'Roadmap',
          diagramType: ROADMAP_DIAGRAM,
          size: roadmapLayout(ROADMAP).size,
        },
      },
    ]);
    expect(readNodes(board).filter(isRoadmap)).toEqual([]);
    // The proposal of this run counts: a second call proposes no second roadmap.
    expect(await tool.run({})).toMatch(/^The main canvas already has the roadmap "Roadmap"/);
    expect(operations).toHaveLength(1);
  });

  it('tells the model that a plan without milestones shows an empty roadmap', async () => {
    const { board, tool } = setup({ roadmap: { milestones: [] } });

    const answer = await tool.run({});

    expect(answer).toContain(
      'The plan has no milestones yet, so the roadmap stays empty until the section on milestones of the plan is generated or written.',
    );
    expect(readNodes(board).find(isRoadmap)?.size).toEqual(roadmapLayout({ milestones: [] }).size);
  });
});
