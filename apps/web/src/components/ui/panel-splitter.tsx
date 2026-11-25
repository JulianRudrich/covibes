import { useRef } from 'react';

const clampPanel = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type PanelSplitterProps = {
  label: string;
  controls: string;
  value: number;
  min: number;
  max: number;
  reverse?: boolean;
  onChange: (value: number) => void;
};
/** A Studio hairline with pointer capture and the ARIA window-splitter keyboard pattern. */
export function PanelSplitter({
  label,
  controls,
  value,
  min,
  max,
  reverse = false,
  onChange,
}: PanelSplitterProps) {
  const drag = useRef<{ x: number; value: number } | null>(null);
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className="studio-panel-splitter"
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        const direction = reverse ? -1 : 1;
        const next =
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : event.key === 'ArrowLeft'
                ? value - step * direction
                : event.key === 'ArrowRight'
                  ? value + step * direction
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        onChange(clampPanel(next, min, max));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { x: event.clientX, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onChange(
          clampPanel(
            drag.current.value + (event.clientX - drag.current.x) * (reverse ? -1 : 1),
            min,
            max,
          ),
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    >
      <span aria-hidden="true" />
    </div>
  );
}
