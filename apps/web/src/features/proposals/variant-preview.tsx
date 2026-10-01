import { BLOCK_SIZE, type CanvasOperation } from '@covibes/shared';
import { useMemo } from 'react';

import { arrowGeometries, type Rect } from '@web/features/canvas/arrow-geometry';
import { proposalOverlay } from '@web/features/proposals/proposal-overlay';

/** Room around the diagram in the preview. */
const MARGIN = 10;
/** Longest title shown on a block; the preview is small. */
const LABEL_LENGTH = 20;

function shortened(text: string): string {
  return text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH - 1).trimEnd()}…` : text;
}

/**
 * A small static picture of what a variant draws (spec 17, derived look): its frame, blocks,
 * notes and arrows at their arranged places. It shows a variant before it is adopted and keeps
 * the discarded ones visible as a snapshot with the decision.
 */
export function VariantPreview({
  operations,
  label,
}: {
  operations: readonly CanvasOperation[];
  /** Accessible name, e.g. "Variante A · Monolith". */
  label: string;
}) {
  const { elements, arrows, viewBox } = useMemo(() => {
    // The overlay of proposals already knows where proposed elements end up.
    const overlay = proposalOverlay(
      [
        {
          id: 'preview',
          projectId: 'preview',
          kind: 'canvas',
          boardId: 'preview',
          agentKey: 'moderator',
          status: 'open',
          reason: 'variants',
          names: {},
          operations: [...operations],
          createdAt: '',
          updatedAt: '',
        },
      ],
      'preview',
      new Set(),
    );
    // Blocks at their real size, not at the size of a proposal card.
    const sized = overlay.elements.map((element) =>
      element.kind === 'block' ? { ...element, size: BLOCK_SIZE } : element,
    );
    const rects = new Map<string, Rect>(
      sized.map((element) => [element.id, { ...element.position, ...element.size }]),
    );
    const geometries = arrowGeometries(overlay.arrows, rects);
    const left = Math.min(...sized.map((element) => element.position.x));
    const top = Math.min(...sized.map((element) => element.position.y));
    const right = Math.max(...sized.map((element) => element.position.x + element.size.width));
    const bottom = Math.max(...sized.map((element) => element.position.y + element.size.height));
    return {
      elements: sized,
      arrows: overlay.arrows.flatMap((arrow) => {
        const geometry = geometries.get(arrow.id);
        return geometry ? [{ id: arrow.id, path: geometry.path }] : [];
      }),
      viewBox:
        sized.length > 0
          ? `${String(left - MARGIN)} ${String(top - MARGIN)} ${String(right - left + 2 * MARGIN)} ${String(bottom - top + 2 * MARGIN)}`
          : '0 0 1 1',
    };
  }, [operations]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="block h-auto max-h-[150px] w-full rounded-md border border-border-subtle bg-bg-canvas"
    >
      {elements.map((element) =>
        element.kind === 'frame' ? (
          <rect
            key={element.id}
            x={element.position.x}
            y={element.position.y}
            width={element.size.width}
            height={element.size.height}
            rx={14}
            strokeWidth={2}
            className="fill-bg-panel/60 stroke-frame-border"
          />
        ) : null,
      )}
      {arrows.map((arrow) => (
        <path key={arrow.id} d={arrow.path} strokeWidth={2.5} className="fill-none stroke-edge" />
      ))}
      {elements.map((element) =>
        element.kind === 'frame' ? null : (
          <g key={element.id}>
            <rect
              x={element.position.x}
              y={element.position.y}
              width={element.size.width}
              height={element.size.height}
              rx={element.kind === 'note' ? 4 : 12}
              strokeWidth={2}
              className={
                element.kind === 'note'
                  ? 'fill-note stroke-note-border'
                  : 'fill-bg-panel stroke-border-block'
              }
            />
            <text
              x={element.position.x + element.size.width / 2}
              y={element.position.y + element.size.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={17}
              fontWeight={600}
              className="fill-text"
            >
              {shortened(element.label)}
            </text>
          </g>
        ),
      )}
    </svg>
  );
}
