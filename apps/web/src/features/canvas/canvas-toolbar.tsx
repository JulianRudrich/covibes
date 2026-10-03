import { useReactFlow, useViewport } from '@xyflow/react';
import {
  Frame,
  LayoutGrid,
  Minus,
  Plus,
  Spline,
  Square,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
 * The floating toolbar of the handoff (spec 10): tools for block, note, frame and arrow, the
 * auto-layout and the zoom from 30 to 200 %. A tool is a mode; clicking it again ends it.
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
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-panel border border-border-float bg-bg-panel p-[5px] whitespace-nowrap shadow-float"
    >
      {readOnly ? null : (
        <>
          {TOOLS.map(({ tool: option, icon: Icon }) => (
            <ToolButton
              key={option}
              icon={Icon}
              active={tool === option}
              onClick={() => {
                onToolChange(tool === option ? null : option);
              }}
            >
              {t(`canvas.tools.${option}`)}
            </ToolButton>
          ))}
          <ToolButton icon={LayoutGrid} busy={layoutBusy} onClick={onAutoLayout}>
            {t('canvas.tools.autoLayout')}
          </ToolButton>
          <span className="mx-1 h-[22px] w-px bg-border-soft" aria-hidden="true" />
        </>
      )}
      <ZoomButton
        label={t('canvas.zoomOut')}
        disabled={zoom <= ZOOM_MIN + 0.001}
        onClick={() => void zoomTo(nextZoom(zoom, -1), { duration: 150 })}
      >
        <Minus size={14} strokeWidth={2.2} aria-hidden="true" />
      </ZoomButton>
      <span className="min-w-[46px] text-center text-small font-medium text-text-body tabular-nums">
        {Math.round(zoom * 100)} %
      </span>
      <ZoomButton
        label={t('canvas.zoomIn')}
        disabled={zoom >= ZOOM_MAX - 0.001}
        onClick={() => void zoomTo(nextZoom(zoom, 1), { duration: 150 })}
      >
        <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
      </ZoomButton>
      {end ? (
        <>
          <span className="mx-1 h-[22px] w-px bg-border-soft" aria-hidden="true" />
          {end}
        </>
      ) : null}
    </div>
  );
}

function ToolButton({
  icon: Icon,
  active,
  busy = false,
  onClick,
  children,
}: {
  icon: LucideIcon;
  /** Only for modes; an action such as auto-layout is not a toggle. */
  active?: boolean;
  busy?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={busy}
      onClick={onClick}
      className={cn(
        'flex h-[34px] cursor-pointer items-center gap-1.5 rounded-md pr-2.5 pl-2 text-small font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-wait disabled:opacity-60',
        active ? 'bg-ink text-on-ink' : 'text-text-body hover:bg-bg-subtle',
      )}
    >
      <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
      {children}
    </button>
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
      className="grid h-[34px] w-[30px] cursor-pointer place-items-center rounded-md text-text-body hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
