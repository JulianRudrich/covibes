import type { NodeProps } from '@xyflow/react';

import type { BlockFlowNode } from '@web/features/canvas/flow-mapping';

/**
 * A block on the canvas, kept simple for now: white card with title and subtitle in the handoff's
 * size. Icon tile, author line and the four states (including selection) follow with spec 08.
 */
export function BlockNode({ data }: NodeProps<BlockFlowNode>) {
  return (
    <div className="flex h-[96px] w-[180px] flex-col justify-center gap-0.5 rounded-panel border border-border-block bg-bg-panel px-3 shadow-block">
      <div className="truncate text-body leading-snug font-semibold text-text">{data.label}</div>
      {data.subtitle ? <div className="truncate text-meta text-text-3">{data.subtitle}</div> : null}
    </div>
  );
}
