import type { PlanNode } from '@covibes/shared';
import { Fragment, type ReactNode } from 'react';

function inline(nodes: readonly PlanNode[] = []): ReactNode {
  return nodes.map((node, index) => {
    const marks = new Set((node.marks ?? []).map((mark) => mark.type));
    let content: ReactNode = node.text ?? '';
    if (marks.has('italic')) content = <em>{content}</em>;
    if (marks.has('bold')) content = <strong>{content}</strong>;
    // The pieces of a paragraph only grow at the end, so their position is a stable key.
    return <Fragment key={index}>{content}</Fragment>;
  });
}

function block(node: PlanNode, key: number): ReactNode {
  switch (node.type) {
    case 'heading':
      // The headings of the sections are one level above the headings inside them.
      return node.attrs?.level === 2 ? (
        <h2 key={key}>{inline(node.content)}</h2>
      ) : (
        <h3 key={key}>{inline(node.content)}</h3>
      );
    case 'bulletList':
      return <ul key={key}>{(node.content ?? []).map(block)}</ul>;
    case 'orderedList':
      return <ol key={key}>{(node.content ?? []).map(block)}</ol>;
    case 'listItem':
      return <li key={key}>{(node.content ?? []).map(block)}</li>;
    default:
      return <p key={key}>{inline(node.content)}</p>;
  }
}

/**
 * Text of the plan outside the editor, in the look of the plan's document: a suggestion before
 * anyone accepts it (spec 25b), or a version of the whole plan with its sections (spec 25c).
 */
export function PlanContent({ nodes }: { nodes: readonly PlanNode[] }) {
  return <div className="plan-doc plan-doc-preview">{nodes.map(block)}</div>;
}
