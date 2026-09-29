import { useStore } from '@xyflow/react';

import type { RemoteCursor } from '@web/features/canvas/awareness';

/** The arrow's tip in its own 16 × 18 box; it has to sit exactly on the reported position. */
const TIP = { x: 2, y: 1.5 };

/**
 * Live cursor of another person (handoff: graphite arrow with a name pill). Rendered in flow
 * coordinates inside the viewport, but scaled back so it keeps its size at every zoom level.
 */
export function LiveCursor({ cursor }: { cursor: RemoteCursor }) {
  const zoom = useStore((state) => state.transform[2]);
  const { x, y } = cursor.position;

  return (
    <div
      className="pointer-events-none absolute top-0 left-0 z-10 flex origin-top-left flex-col items-start transition-transform duration-75 ease-linear"
      style={{
        transform: `translate(${String(x)}px, ${String(y)}px) scale(${String(1 / zoom)}) translate(-${String(TIP.x)}px, -${String(TIP.y)}px)`,
      }}
      data-testid="live-cursor"
    >
      <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
        <path
          d="M2 1.5 L2 14.5 L5.6 11.2 L8 16.5 L10.2 15.5 L7.9 10.4 L12.8 10.2 Z"
          className="fill-human stroke-bg-panel"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
      <div className="-mt-[3px] ml-[11px] flex h-5 items-center rounded-sm bg-human px-[7px] text-meta font-medium whitespace-nowrap text-on-ink">
        {cursor.name}
      </div>
    </div>
  );
}
