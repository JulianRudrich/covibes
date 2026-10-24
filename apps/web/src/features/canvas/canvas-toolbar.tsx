import { useReactFlow, useViewport } from '@xyflow/react';
import {
  Frame,
  LayoutGrid,
  Minus,
  MousePointer2,
  Plus,
  Spline,
  Square,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip } from '@web/components/ui/tooltip';
import type { CanvasTool } from '@web/features/canvas/canvas-actions';
import { nextZoom, ZOOM_MAX, ZOOM_MIN } from '@web/features/canvas/zoom';
import { cn } from '@web/lib/cn';

const TOOLS: readonly { tool: CanvasTool; icon: LucideIcon }[] = [
  { tool: 'block', icon: Square },
  { tool: 'note', icon: StickyNote },
  { tool: 'frame', icon: Frame },
  { tool: 'connect', icon: Spline },
];

type CanvasToolbarProps = {
  tool: CanvasTool | null;
  onToolChange: (tool: CanvasTool | null) => void;
  onAutoLayout: () => void;
  layoutBusy: boolean;
  /** Viewers only get the zoom. */
  readOnly: boolean;
  /** At the right end, after the zoom: e.g. "Exportieren" (spec 27a). */
  end?: ReactNode;
};

/**
 * The floating toolbar of the handoff (spec 10, looks of spec 36b): a pill with round icon tools
 * for selecting, block, note, frame and arrow, the auto-layout and the zoom from 30 to 200 %. A
 * tool is a mode; clicking it again ends it, and "Auswählen" is pressed while no other tool is.
 */
export function CanvasToolbar({
  tool,
  onToolChange,
  onAutoLayout,
  layoutBusy,
  readOnly,
  end,
}: CanvasToolbarProps) {
  const { t } = useTranslation();
  const { zoomTo } = useReactFlow();
  const { zoom } = useViewport();

  return (
    <div
      role="toolbar"
      aria-label={t('canvas.toolbar')}
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-bg-panel p-1.5 whitespace-nowrap shadow-float"
    >
      {readOnly ? null : (
        <>
          <ToolButton
            icon={MousePointer2}
            label={t('canvas.tools.select')}
            active={tool === null}
            onClick={() => {
              onToolChange(null);
            }}
          />
          {TOOLS.map(({ tool: option, icon }) => (
            <ToolButton
              key={option}
              icon={icon}
              label={t(`canvas.tools.${option}`)}
              active={tool === option}
              onClick={() => {
                onToolChange(tool === option ? null : option);
              }}
            />
          ))}
          <ToolButton
            icon={LayoutGrid}
            label={t('canvas.tools.autoLayout')}
            busy={layoutBusy}
            onClick={onAutoLayout}
          />
          <span className="mx-1.5 h-6 w-px bg-border-strong" aria-hidden="true" />
        </>
      )}
      <ZoomButton
        label={t('canvas.zoomOut')}
        disabled={zoom <= ZOOM_MIN + 0.001}
        onClick={() => void zoomTo(nextZoom(zoom, -1), { duration: 150 })}
      >
        <Minus size={16} strokeWidth={2} aria-hidden="true" />
      </ZoomButton>
      <span className="min-w-12 text-center text-ui font-semibold text-text tabular-nums">
        {Math.round(zoom * 100)} %
      </span>
      <ZoomButton
        label={t('canvas.zoomIn')}
        disabled={zoom >= ZOOM_MAX - 0.001}
        onClick={() => void zoomTo(nextZoom(zoom, 1), { duration: 150 })}
      >
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
      </ZoomButton>
      {end ? (
        <>
          <span className="mx-1.5 h-6 w-px bg-border-strong" aria-hidden="true" />
          {end}
        </>
      ) : null}
    </div>
  );
}

/** The class of a round 40 px button of the toolbar; the export menu uses it too. */
export const TOOLBAR_BUTTON =
  'grid size-10 cursor-pointer place-items-center rounded-full text-text-2 transition-colors hover:bg-wash hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

function ToolButton({
  icon: Icon,
  label,
  active,
  busy = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  /** Only for modes; an action such as auto-layout is not a toggle. */
  active?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} side="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={busy}
        onClick={onClick}
        className={cn(
          TOOLBAR_BUTTON,
          'disabled:cursor-wait disabled:opacity-60',
          active && 'bg-ink text-on-ink hover:bg-ink hover:text-on-ink',
        )}
      >
        <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function ZoomButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-10 w-9 cursor-pointer place-items-center rounded-full text-text-2 transition-colors hover:bg-wash hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
