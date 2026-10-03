import { randomUUID } from 'node:crypto';

import {
  findFreeSpot,
  isRoadmap,
  readNodes,
  ROADMAP_DIAGRAM,
  ROADMAP_TITLE,
  roadmapLayout,
  roadmapWeeks,
  type Roadmap,
} from '@covibes/shared';

import { defineTool, type AgentTool } from '@server/ai-gateway';
import { proposedNote, writeCanvas } from '@server/tools/canvas-writer';
import { centerOfNodes, describePosition, type CanvasToolOptions } from '@server/tools/placement';

export type RoadmapToolOptions = CanvasToolOptions & {
  /** The roadmap of the project's plan, as the plan was last stored. */
  loadRoadmap: () => Promise<Roadmap>;
};

/** What a new roadmap shows, for the model to tell the team. */
function describeContent(roadmap: Roadmap): string {
  const count = roadmap.milestones.length;
  if (count === 0) {
    return 'The plan has no milestones yet, so the roadmap stays empty until the section on milestones of the plan is generated or written.';
  }
  const weeks = roadmapWeeks(roadmap);
  const milestones = `${String(count)} ${count === 1 ? 'milestone' : 'milestones'}`;
  return `It shows ${milestones} of the plan${weeks === null ? '' : ` over ${String(weeks)} weeks`}.`;
}

/**
 * `add_roadmap` (spec 26a): an agent adds the roadmap of the plan to the main canvas, a frame that
 * shows the plan's milestones and follows the plan by itself. It starts with the size of what the
 * plan holds now. A project has one roadmap: if the main canvas has it already, the tool says
 * where it is and changes nothing.
 */
export function addRoadmapTool(options: RoadmapToolOptions): AgentTool {
  return defineTool({
    name: 'add_roadmap',
    description:
      "Adds the roadmap of the project plan to the main canvas: a frame that shows the plan's milestones with their times and tasks on a timeline and follows the plan by itself. It holds no blocks, and it is changed by changing the plan, not on the canvas. A project has one roadmap; if the canvas has it already, the tool says where it is.",
    input: {},
    run: async () => {
      const roadmap = await options.loadRoadmap();
      return writeCanvas(options, (view) => {
        const nodes = readNodes(view);
        const existing = nodes.find(isRoadmap);
        if (existing) {
          const there = `The main canvas already has the roadmap "${existing.label}" (id ${existing.id}) at ${describePosition(existing.position)}; a project has one, and it follows the plan by itself.`;
          return { operations: [], done: there, proposed: there };
        }

        const { size } = roadmapLayout(roadmap);
        const position = findFreeSpot(nodes, centerOfNodes(nodes), size);
        const id = randomUUID();
        const what = `the roadmap "${ROADMAP_TITLE}" (id ${id})`;
        const content = describeContent(roadmap);
        return {
          operations: [
            {
              op: 'add_frame',
              frame: { id, position, title: ROADMAP_TITLE, diagramType: ROADMAP_DIAGRAM, size },
            },
          ],
          done: `Added ${what} at ${describePosition(position)}. ${content}`,
          proposed: `${proposedNote(`to add ${what}`)} ${content}`,
        };
      });
    },
  });
}
