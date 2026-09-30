import {
  applyOperations,
  canvasOperationSchema,
  changedNodeIds,
  readNodes,
  withOperations,
  type CanvasOperationInput,
  type ProposalReason,
} from '@covibes/shared';
import type * as Y from 'yjs';

import type { BoardSession } from '@server/collab/board-client';
import { decide, type Intent } from '@server/rules/decide';
import type { CanvasToolOptions } from '@server/tools/placement';

/** Where the operations an agent proposes in one run go (spec 13); the worker stores them. */
export type ProposalSink = {
  /** What this run proposed so far; later tool calls build on it. */
  readonly operations: readonly CanvasOperationInput[];
  add: (
    operations: readonly CanvasOperationInput[],
    reason: ProposalReason,
    /** Titles of the existing elements the operations refer to. */
    names: Readonly<Record<string, string>>,
  ) => Promise<void>;
};

/** The titles of the existing elements that operations change, move or connect. */
function namesFor(
  operations: readonly CanvasOperationInput[],
  view: Y.Doc,
): Record<string, string> {
  const labels = new Map(readNodes(view).map((node) => [node.id, node.label]));
  const names: Record<string, string> = {};
  for (const input of operations) {
    const operation = canvasOperationSchema.parse(input);
    const ids =
      operation.op === 'add_edge'
        ? [operation.edge.source, operation.edge.target]
        : operation.op === 'add_frame'
          ? operation.members
          : changedNodeIds(operation);
    for (const id of ids) {
      const label = labels.get(id);
      if (label !== undefined) names[id] = label;
    }
  }
  return names;
}

/** How the rule engine treats the canvas tools of one run. */
export type CanvasRules = {
  /** The intent of the triggering message; tools wait for it. */
  intent: Promise<Intent>;
  proposalsOnly: boolean;
  proposal: ProposalSink;
};

/** What a canvas tool wants to do, and what it tells the model in either case. */
export type CanvasPlan = {
  operations: CanvasOperationInput[];
  /** The tool changes an element that a human is editing. */
  lockedTarget?: boolean;
  /** The answer when the change was made. */
  done: string;
  /** The answer when it became a proposal. */
  proposed: string;
};

/** Tells the model what a proposal means, so it can say so in its reply. */
export function proposedNote(what: string): string {
  return `Proposed: ${what}. This is a proposal: it is not on the canvas until someone in the team applies it.`;
}

/**
 * Runs a canvas tool under the rule engine (spec 13). The tool plans on a view of the board: as a
 * proposal the board plus what this run proposed so far, so e.g. an arrow can lead to a proposed
 * block. Then the operations either change the board directly or go into the run's proposal.
 * Without rules (e.g. in tests of the tools) every change runs directly.
 */
export async function writeCanvas(
  options: CanvasToolOptions,
  plan: (view: Y.Doc, session: BoardSession) => CanvasPlan | Promise<CanvasPlan>,
): Promise<string> {
  const { rules } = options;
  const intent = rules ? await rules.intent : 'instruction';
  const situation = {
    allowed: true,
    intent,
    proposalsOnly: rules?.proposalsOnly ?? false,
  };
  return await options.boards.withBoard(options.boardId, async (doc, session) => {
    const asProposal = decide({ ...situation, lockedTarget: false }).kind === 'proposal';
    const pending = rules?.proposal.operations ?? [];
    const view =
      asProposal && pending.length > 0 ? withOperations(doc, pending, options.author) : doc;
    const planned = await plan(view, session);
    // Nothing to change (e.g. an empty frame to arrange): no proposal either.
    if (planned.operations.length === 0) return planned.done;
    const outcome = decide({ ...situation, lockedTarget: planned.lockedTarget ?? false });

    if (outcome.kind === 'reject') throw new Error('This tool is not allowed for you.');
    if (outcome.kind === 'direct') {
      applyOperations(doc, planned.operations, options.author);
      return planned.done;
    }
    if (!rules) throw new Error('This change can only be made as a proposal right now.');
    await rules.proposal.add(
      planned.operations,
      outcome.reason,
      namesFor(planned.operations, view),
    );
    return planned.proposed;
  });
}
