import type { Position } from '@covibes/shared';
import { useReactFlow } from '@xyflow/react';
import { useRef, useState, type PointerEvent } from 'react';

/** Below this distance a press is a click, above it a drag. */
const DRAG_THRESHOLD = 6;

export type Placement =
  { kind: 'point'; at: Position } | { kind: 'area'; from: Position; to: Position };

type Screen = { x: number; y: number };

/**
 * Catches the pointer on the canvas while the tool Block, Notiz or Rahmen is active (spec 10): a
 * click places the element there, and with the tool Rahmen a drag draws the frame, previewed as a
 * dashed outline. Positions are handed over in flow coordinates.
 */
export function PlacementLayer({
  drawsArea,
  onPlace,
}: {
  /** Whether a drag draws an area (frames) or only a click counts (blocks, notes). */
  drawsArea: boolean;
  onPlace: (placement: Placement) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const layer = useRef<HTMLDivElement>(null);
  // A ref, so a release right after the press still finds where it started.
  const start = useRef<Screen | null>(null);
  const [preview, setPreview] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  function showPreview(from: Screen, to: Screen) {
    const rect = layer.current?.getBoundingClientRect();
    if (!drawsArea || !rect) return;
    setPreview({
      left: Math.min(from.x, to.x) - rect.left,
      top: Math.min(from.y, to.y) - rect.top,
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    });
  }

  function reset() {
    start.current = null;
    setPreview(null);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    try {
      // Keeps the drag of a frame going when the pointer leaves the canvas.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointers that are not active (e.g. synthesized by assistive tools) cannot be captured.
    }
    start.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (start.current) showPreview(start.current, { x: event.clientX, y: event.clientY });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const from = start.current;
    if (!from) return;
    reset();
    const end = { x: event.clientX, y: event.clientY };
    const dragged = Math.hypot(end.x - from.x, end.y - from.y) > DRAG_THRESHOLD;
    if (drawsArea && dragged) {
      onPlace({
        kind: 'area',
        from: screenToFlowPosition({ x: Math.min(from.x, end.x), y: Math.min(from.y, end.y) }),
        to: screenToFlowPosition({ x: Math.max(from.x, end.x), y: Math.max(from.y, end.y) }),
      });
    } else {
      onPlace({ kind: 'point', at: screenToFlowPosition(end) });
    }
  }

  return (
    <div
      ref={layer}
      data-testid="placement-layer"
      className="absolute inset-0 z-[5] cursor-crosshair"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
    >
      {preview ? (
        <div
          className="pointer-events-none absolute rounded-frame border border-dashed border-ink bg-bg-panel/40"
          style={preview}
        />
      ) : null}
    </div>
  );
}
