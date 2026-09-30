import * as Y from 'yjs';
import { z } from 'zod';

import {
  authorOrigin,
  authorSchema,
  getEdgesMap,
  getNodesMap,
  type Author,
  type CanvasEdge,
} from './model';

// Connections between blocks (spec 09). A connection is a real relationship between two blocks
// (glossary in project-overview.md), so notes and frames are never connected.

export const EDGE_LABEL_MAX_LENGTH = 40;
export const edgeLabelSchema = z.string().trim().max(EDGE_LABEL_MAX_LENGTH);

export const addEdgeInputSchema = z.object({
  id: z.uuid(),
  source: z.uuid(),
  target: z.uuid(),
  label: edgeLabelSchema.default(''),
});
export type AddEdgeInput = z.input<typeof addEdgeInputSchema>;

/** Why two nodes cannot be connected (in this direction). */
export type EdgeProblem = 'missing' | 'not_block' | 'self' | 'duplicate';

export class EdgeRuleError extends Error {
  override name = 'EdgeRuleError';
  readonly problem: EdgeProblem;

  constructor(problem: EdgeProblem) {
    super(
      {
        missing: 'One of the blocks does not exist',
        not_block: 'Only blocks can be connected',
        self: 'A block cannot be connected to itself',
        duplicate: 'These blocks are already connected in this direction',
      }[problem],
    );
    this.problem = problem;
  }
}

/** The reason why `source` cannot be connected to `target`, or null if it can. */
export function edgeProblem(doc: Y.Doc, source: string, target: string): EdgeProblem | null {
  const nodes = getNodesMap(doc);
  const from = nodes.get(source);
  const to = nodes.get(target);
  if (!from || !to) return 'missing';
  if (from.get('type') !== 'block' || to.get('type') !== 'block') return 'not_block';
  if (source === target) return 'self';
  for (const edge of getEdgesMap(doc).values()) {
    if (edge.get('source') === source && edge.get('target') === target) return 'duplicate';
  }
  return null;
}

/** Connects two blocks; throws `EdgeRuleError` if the rules above forbid it. */
export function addEdge(doc: Y.Doc, input: AddEdgeInput, author: Author): CanvasEdge {
  const data = addEdgeInputSchema.parse(input);
  const createdBy = authorSchema.parse(author);
  const edges = getEdgesMap(doc);
  if (edges.has(data.id)) throw new Error(`Edge ${data.id} already exists`);
  const problem = edgeProblem(doc, data.source, data.target);
  if (problem) throw new EdgeRuleError(problem);

  const edge: CanvasEdge = {
    id: data.id,
    source: data.source,
    target: data.target,
    // Arrows are anchored from the positions of the blocks (spec 09), not at fixed handles.
    sourceHandle: null,
    targetHandle: null,
    label: data.label,
    createdBy,
    lastChangedBy: createdBy,
    lastChangedAt: new Date().toISOString(),
  };
  doc.transact(() => {
    const fields = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(edge)) fields.set(key, value);
    edges.set(edge.id, fields);
  }, authorOrigin(createdBy));
  return edge;
}

/** Changes the label of an edge; an empty label hides the pill. False if the edge is gone. */
export function updateEdgeLabel(doc: Y.Doc, id: string, label: string, author: Author): boolean {
  const text = edgeLabelSchema.parse(label);
  const changedBy = authorSchema.parse(author);
  const fields = getEdgesMap(doc).get(id);
  if (!fields) return false;

  doc.transact(() => {
    fields.set('label', text);
    fields.set('lastChangedBy', changedBy);
    fields.set('lastChangedAt', new Date().toISOString());
  }, authorOrigin(changedBy));
  return true;
}

export function removeEdges(doc: Y.Doc, ids: readonly string[], author: Author): void {
  const removedBy = authorSchema.parse(author);
  const edges = getEdgesMap(doc);
  const removed = ids.filter((id) => edges.has(id));
  if (removed.length === 0) return;

  doc.transact(() => {
    for (const id of removed) edges.delete(id);
  }, authorOrigin(removedBy));
}
