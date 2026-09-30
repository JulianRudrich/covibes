import {
  changedNodeIds,
  NOTE_SIZE,
  type AgentKey,
  type Position,
  type Proposal,
  type Size,
} from '@covibes/shared';

// What open proposals show on the canvas (spec 13): new elements as dashed cards, new arrows dashed
// without head, and a dashed outline around existing elements they change or move.

/** The proposal card of the handoff: 216 px wide; with its buttons it is taller. */
export const GHOST_BLOCK_WIDTH = 216;
const GHOST_BLOCK_HEIGHT = { withActions: 124, plain: 86 };

export type GhostElement = {
  id: string;
  proposalId: string;
  agentKey: AgentKey;
  kind: 'block' | 'note' | 'frame';
  label: string;
  subtitle: string;
  blockType: string | null;
  position: Position;
  size: Size;
  /** The first new element of a proposal carries its buttons. */
  anchor: boolean;
};

export type GhostArrow = {
  id: string;
  proposalId: string;
  agentKey: AgentKey;
  source: string;
  target: string;
  label: string;
};

export type ProposalOverlay = {
  elements: GhostElement[];
  arrows: GhostArrow[];
  /** Existing elements that a proposal changes or moves, by the proposing agent. */
  changed: Map<string, AgentKey>;
};

/**
 * The overlay of the open proposals of one board. `existing` holds the ids of the elements on the
 * board; arrows whose ends are neither existing nor proposed are left out.
 */
export function proposalOverlay(
  proposals: readonly Proposal[],
  boardId: string,
  existing: ReadonlySet<string>,
): ProposalOverlay {
  const overlay: ProposalOverlay = { elements: [], arrows: [], changed: new Map() };
  for (const proposal of proposals) {
    // Team proposals (spec 14) change no board.
    if (proposal.kind !== 'canvas' || proposal.boardId !== boardId) continue;
    const own = new Map<string, GhostElement>();
    const base = { proposalId: proposal.id, agentKey: proposal.agentKey, anchor: false };

    for (const operation of proposal.operations) {
      switch (operation.op) {
        case 'add_block':
          own.set(operation.block.id, {
            ...base,
            id: operation.block.id,
            kind: 'block',
            label: operation.block.label,
            subtitle: operation.block.subtitle,
            blockType: operation.block.blockType,
            position: operation.block.position,
            size: { width: GHOST_BLOCK_WIDTH, height: GHOST_BLOCK_HEIGHT.plain },
          });
          break;
        case 'add_note':
          own.set(operation.note.id, {
            ...base,
            id: operation.note.id,
            kind: 'note',
            label: operation.note.text,
            subtitle: '',
            blockType: null,
            position: operation.note.position,
            size: NOTE_SIZE,
          });
          break;
        case 'add_frame':
          own.set(operation.frame.id, {
            ...base,
            id: operation.frame.id,
            kind: 'frame',
            label: operation.frame.title,
            subtitle: '',
            blockType: null,
            position: operation.frame.position,
            size: operation.frame.size,
          });
          break;
        case 'add_edge':
          overlay.arrows.push({
            id: operation.edge.id,
            proposalId: proposal.id,
            agentKey: proposal.agentKey,
            source: operation.edge.source,
            target: operation.edge.target,
            label: operation.edge.label,
          });
          break;
        case 'update_node':
          break;
        case 'arrange':
          // Proposed elements that are arranged in the same proposal show where they will be.
          for (const move of operation.moves) {
            const element = own.get(move.id);
            if (element) element.position = move.position;
          }
          if (operation.frame) {
            const frame = own.get(operation.frame.id);
            if (frame) {
              frame.position = operation.frame.position;
              frame.size = operation.frame.size;
            }
          }
          break;
      }
      for (const id of changedNodeIds(operation)) {
        if (existing.has(id)) overlay.changed.set(id, proposal.agentKey);
      }
    }

    const elements = [...own.values()];
    const [first] = elements;
    if (first) {
      first.anchor = true;
      if (first.kind === 'block') {
        first.size = { width: GHOST_BLOCK_WIDTH, height: GHOST_BLOCK_HEIGHT.withActions };
      }
    }
    // Frames lie below the other proposed elements, like on the board.
    overlay.elements.push(
      ...elements.filter((element) => element.kind === 'frame'),
      ...elements.filter((element) => element.kind !== 'frame'),
    );
  }

  const shown = new Set([...existing, ...overlay.elements.map((element) => element.id)]);
  overlay.arrows = overlay.arrows.filter(
    (arrow) => shown.has(arrow.source) && shown.has(arrow.target),
  );
  return overlay;
}
