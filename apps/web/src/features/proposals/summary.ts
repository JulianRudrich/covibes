import type { CanvasOperation, Proposal } from '@covibes/shared';

/** One change of a proposal in words: an i18n key under `proposals.summary` and its values. */
export type OperationSummary = {
  key: 'addBlock' | 'addNote' | 'addFrame' | 'addEdge' | 'updateNode' | 'arrangeFrame' | 'move';
  values: { name?: string; from?: string; to?: string };
};

/** Names of elements: the ones a proposal adds, and the existing ones it stored. */
function namesOf(proposal: Proposal): Map<string, string> {
  const names = new Map(Object.entries(proposal.names));
  for (const operation of proposal.operations) {
    if (operation.op === 'add_block') names.set(operation.block.id, operation.block.label);
    if (operation.op === 'add_note') names.set(operation.note.id, operation.note.text);
    if (operation.op === 'add_frame') names.set(operation.frame.id, operation.frame.title);
  }
  return names;
}

export function summarizeOperation(
  operation: CanvasOperation,
  names: ReadonlyMap<string, string>,
): OperationSummary {
  const name = (id: string) => names.get(id) ?? '…';
  switch (operation.op) {
    case 'add_block':
      return { key: 'addBlock', values: { name: operation.block.label } };
    case 'add_note':
      return { key: 'addNote', values: { name: operation.note.text } };
    case 'add_frame':
      return { key: 'addFrame', values: { name: operation.frame.title } };
    case 'add_edge':
      return {
        key: 'addEdge',
        values: { from: name(operation.edge.source), to: name(operation.edge.target) },
      };
    case 'update_node':
      return { key: 'updateNode', values: { name: name(operation.id) } };
    case 'arrange':
      return operation.frame
        ? { key: 'arrangeFrame', values: { name: name(operation.frame.id) } }
        : { key: 'move', values: {} };
  }
}

/**
 * A proposal in one line (handoff "Waiting for you": "Add block **Cost limits**"): its main change
 * (the first new block, else the first change), how many more there are, and the name of what it
 * is about, for "… übernommen".
 */
export function proposalSummary(proposal: Proposal): {
  main: OperationSummary;
  more: number;
  name: string;
} {
  const names = namesOf(proposal);
  const operations = proposal.operations.filter(
    // Growing a frame around a new block is part of adding the block, not a change of its own.
    (operation) => !(operation.op === 'arrange' && operation.moves.length === 0),
  );
  const first =
    operations.find((operation) => operation.op === 'add_block') ??
    operations[0] ??
    proposal.operations[0];
  if (!first) return { main: { key: 'move', values: {} }, more: 0, name: '' };
  const main = summarizeOperation(first, names);
  return {
    main,
    more: Math.max(0, operations.length - 1),
    name: main.values.name ?? main.values.to ?? '',
  };
}
