import { Handle, Position, useConnection, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect } from 'react';

import { cn } from '@web/lib/cn';

const SIDES = [
  ['top', Position.Top],
  ['right', Position.Right],
  ['bottom', Position.Bottom],
  ['left', Position.Left],
] as const;

/**
 * React Flow only draws an arrow between nodes that have a source and a target handle. These two
 * are invisible and never start a connection; where an arrow really touches the block is computed
 * from the positions (`arrow-geometry.ts`). Every block has them, also for viewers.
 */
export function ArrowAnchors() {
  return (
    <>
      <Handle
        id="out"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!pointer-events-none !invisible"
      />
      <Handle
        id="in"
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!pointer-events-none !invisible"
      />
    </>
  );
}

/**
 * Where arrows start and end on a block (specs 09 and 10). Four small points at the edge centers
 * show on hover and on the selected block; dragging from one starts an arrow. In the mode
 * "Verbinden" (`anywhere`) the whole block starts an arrow instead, and the block does not move.
 * While an arrow is being drawn, the whole of every other block accepts it, so nobody has to hit
 * a point exactly. The arrow itself is anchored from the positions of the blocks, not at these
 * points.
 */
export function ConnectionHandles({
  nodeId,
  selected,
  anywhere,
}: {
  nodeId: string;
  selected: boolean;
  anywhere: boolean;
}) {
  const acceptsDrop = useConnection(
    (connection) => connection.inProgress && connection.fromNode.id !== nodeId,
  );
  const updateNodeInternals = useUpdateNodeInternals();

  // React Flow starts an arrow only from handles it has measured, and it measures a node again
  // only when its size changes; so the node is measured again whenever its handles change.
  useEffect(() => {
    updateNodeInternals(nodeId);
  }, [nodeId, anywhere, updateNodeInternals]);

  return (
    <>
      {anywhere ? (
        <Handle
          id="surface"
          type="source"
          position={Position.Bottom}
          className="!absolute !inset-0 !size-auto !transform-none !cursor-crosshair !rounded-panel !border-0 !bg-transparent"
        />
      ) : (
        SIDES.map(([side, position]) => (
          <Handle
            key={side}
            id={side}
            type="source"
            position={position}
            className={cn(
              '!size-2.5 !rounded-full !border-2 !border-bg-panel !bg-ink transition-opacity duration-150 group-hover:opacity-100',
              selected ? 'opacity-100' : 'opacity-0',
            )}
          />
        ))
      )}
      {/* After the start area, so it lies on top of it. */}
      {acceptsDrop ? (
        <Handle
          id="drop"
          type="target"
          position={Position.Top}
          isConnectableStart={false}
          className="!absolute !inset-0 !size-auto !transform-none !rounded-panel !border-0 !bg-transparent"
        />
      ) : null}
    </>
  );
}
