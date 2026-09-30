/** Zoom range of the canvas (handoff: 30 to 200 % in steps of 10). */
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

/**
 * The next zoom step from `zoom` in `direction`. A zoom between two steps (e.g. after the mouse
 * wheel) goes to the nearest step in that direction.
 */
export function nextZoom(zoom: number, direction: 1 | -1): number {
  const steps = zoom / ZOOM_STEP;
  const onStep = Math.abs(steps - Math.round(steps)) < 0.01;
  const target = onStep
    ? Math.round(steps) + direction
    : direction === 1
      ? Math.ceil(steps)
      : Math.floor(steps);
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(target) / 10));
}
