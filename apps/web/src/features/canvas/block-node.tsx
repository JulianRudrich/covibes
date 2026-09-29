import type { AgentKey } from '@covibes/shared';
import type { NodeProps } from '@xyflow/react';
import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  justDrawnRemainingMs,
  type BlockFlowNode,
  type BlockNodeData,
} from '@web/features/canvas/flow-mapping';
import { cn } from '@web/lib/cn';
import { aiRing } from '@web/lib/styles';

const AGENT_BORDER: Record<AgentKey, string> = {
  moderator: 'border-agent-moderator',
  backend: 'border-agent-backend',
  critic: 'border-agent-critic',
  data: 'border-agent-data',
};

const AGENT_BACKGROUND: Record<AgentKey, string> = {
  moderator: 'bg-agent-moderator',
  backend: 'bg-agent-backend',
  critic: 'bg-agent-critic',
  data: 'bg-agent-data',
};

/**
 * A block on the canvas, kept simple for now: white card with title and subtitle in the handoff's
 * size. Right after an agent changed it, it shows the state "just changed by AI" (spec 07): border
 * and ring in the agent's color and the pill "Just drawn". Icon tile, author line and the remaining
 * states (including selection) follow with spec 08.
 */
export function BlockNode({ data }: NodeProps<BlockFlowNode>) {
  const { t } = useTranslation();
  const justDrawnBy = useJustDrawnBy(data);
  const pillAgent = data.changedByAgent;

  return (
    <div
      className={cn(
        'relative flex h-[96px] w-[180px] flex-col justify-center gap-0.5 rounded-panel bg-bg-panel px-3 transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none',
        justDrawnBy
          ? cn('border-[1.5px]', AGENT_BORDER[justDrawnBy])
          : 'border border-border-block shadow-block',
      )}
      style={justDrawnBy ? { boxShadow: aiRing(justDrawnBy) } : undefined}
    >
      {/* Stays mounted after an agent change, so it can fade out together with border and ring. */}
      {pillAgent ? (
        <div
          className={cn(
            'absolute -top-[27px] -right-[1.5px] flex h-[22px] items-center gap-[5px] rounded-sm pr-2 pl-1.5 text-meta font-medium whitespace-nowrap text-on-ink transition-[opacity,visibility] duration-200 motion-reduce:transition-none',
            AGENT_BACKGROUND[pillAgent],
            !justDrawnBy && 'invisible opacity-0',
          )}
        >
          <Sparkle />
          {t('canvas.justDrawn')}
        </div>
      ) : null}
      <div className="truncate text-body leading-snug font-semibold text-text">{data.label}</div>
      {data.subtitle ? <div className="truncate text-meta text-text-3">{data.subtitle}</div> : null}
    </div>
  );
}

/**
 * The agent whose change the block currently shows as "just drawn", or null. A timer ends the
 * state once the rest of the 5 s has passed; a change that ran out stays over, so a later check
 * cannot bring it back. The layout effect runs before paint, so an agent change that arrives
 * already old (e.g. after a reconnect) never flashes up.
 */
function useJustDrawnBy(data: BlockNodeData): AgentKey | null {
  const { changedByAgent, lastChangedAt } = data;
  const [overAt, setOverAt] = useState(() =>
    justDrawnRemainingMs(data, Date.now()) > 0 ? null : lastChangedAt,
  );

  useLayoutEffect(() => {
    if (changedByAgent === null) return;
    const remaining = justDrawnRemainingMs({ changedByAgent, lastChangedAt }, Date.now());
    if (remaining === 0) {
      setOverAt(lastChangedAt);
      return;
    }
    const timer = setTimeout(() => {
      setOverAt(lastChangedAt);
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [changedByAgent, lastChangedAt]);

  return overAt === lastChangedAt ? null : changedByAgent;
}

/** The AI marker from the handoff: a filled four-pointed star, 12 px. */
function Sparkle() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3c.5 4.8 3.2 7.5 8 8-4.8.5-7.5 3.2-8 8-.5-4.8-3.2-7.5-8-8 4.8-.5 7.5-3.2 8-8z" />
    </svg>
  );
}
