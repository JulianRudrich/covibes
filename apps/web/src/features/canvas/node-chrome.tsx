import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { agentClass, agentColor, useAgents } from '@web/features/agents/agents';
import { AGENT_BACKGROUND } from '@web/features/canvas/agent-look';
import { cn } from '@web/lib/cn';

// Parts that blocks, notes, frames and arrows share: the markers for "just drawn" and "locked".

/** The AI marker from the handoff: a filled four-pointed star, 12 px. */
export function Sparkle({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 3c.5 4.8 3.2 7.5 8 8-4.8.5-7.5 3.2-8 8-.5-4.8-3.2-7.5-8-8 4.8-.5 7.5-3.2 8-8z" />
    </svg>
  );
}

/**
 * The pill "Gerade gezeichnet" right above an element an agent changed, with a twinkling
 * sparkle. It stays mounted after the change, so it can fade out together with the ring.
 */
export function JustDrawnPill({
  agent,
  visible,
}: {
  /** The key of the agent that changed the element. */
  agent: string;
  visible: boolean;
}) {
  const { t } = useTranslation();
  const agents = useAgents();
  return (
    <div
      // A mark of the moment, no part of the board (spec 27a: an image leaves it out).
      data-no-export=""
      className={cn(
        'absolute -top-[34px] right-0 flex h-[26px] items-center gap-[5px] rounded-full pr-[11px] pl-[9px] text-status font-semibold whitespace-nowrap text-on-ink transition-[opacity,visibility] duration-300 motion-reduce:transition-none',
        agentClass(AGENT_BACKGROUND, agents(agent)),
        !visible && 'invisible opacity-0',
      )}
    >
      <Sparkle className="animate-twinkle motion-reduce:animate-none" />
      {t('canvas.justDrawn')}
    </div>
  );
}

/**
 * The outline of an element an agent just changed, which widens and fades again and again while
 * the change is fresh (handoff `cvring`). It takes the radius of the element it lies on.
 */
export function JustDrawnOutline({ agent, visible }: { agent: string; visible: boolean }) {
  const agents = useAgents();
  if (!visible) return null;
  return (
    <span
      aria-hidden="true"
      data-no-export=""
      className="pointer-events-none absolute inset-0 animate-ring rounded-[inherit] motion-reduce:hidden"
      style={{ boxShadow: `0 0 0 2px ${agentColor(agents(agent))}` }}
    />
  );
}

/** The pill "{name} bearbeitet" left above an element someone else edits (spec 08). */
export function LockPill({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <div
      // Who edits right now is no part of the board (spec 27a: an image leaves it out).
      data-no-export=""
      className="absolute -top-[34px] left-0 flex h-[26px] items-center gap-1.5 rounded-full bg-human pr-[11px] pl-[9px] text-status font-semibold whitespace-nowrap text-on-ink"
    >
      <Lock size={12} strokeWidth={2.2} aria-hidden="true" />
      {t('canvas.isEditing', { name })}
    </div>
  );
}

/** The blinking text caret of the person who edits an element (handoff, locked state). */
export function EditCaret() {
  return (
    <span
      className="ml-px inline-block h-[15px] w-0.5 shrink-0 animate-caret-blink bg-human motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}
