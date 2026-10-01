import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { agentClass, useAgents } from '@web/features/agents/agents';
import { AGENT_BACKGROUND } from '@web/features/canvas/agent-look';
import { cn } from '@web/lib/cn';

// Parts that blocks, notes, frames and arrows share: the markers for "just drawn" and "locked".

/** The AI marker from the handoff: a filled four-pointed star, 12 px. */
export function Sparkle() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3c.5 4.8 3.2 7.5 8 8-4.8.5-7.5 3.2-8 8-.5-4.8-3.2-7.5-8-8 4.8-.5 7.5-3.2 8-8z" />
    </svg>
  );
}

/**
 * The pill "Gerade gezeichnet" right above an element an agent changed. It stays mounted after
 * the change, so it can fade out together with border and ring.
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
      className={cn(
        'absolute -top-[27px] -right-[1.5px] flex h-[22px] items-center gap-[5px] rounded-sm pr-2 pl-1.5 text-meta font-medium whitespace-nowrap text-on-ink transition-[opacity,visibility] duration-200 motion-reduce:transition-none',
        agentClass(AGENT_BACKGROUND, agents(agent)),
        !visible && 'invisible opacity-0',
      )}
    >
      <Sparkle />
      {t('canvas.justDrawn')}
    </div>
  );
}

/** The pill "{name} bearbeitet" left above an element someone else edits (spec 08). */
export function LockPill({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <div className="absolute -top-[27px] -left-[1.5px] flex h-[22px] items-center gap-1.5 rounded-sm bg-human pr-2 pl-1.5 text-meta font-medium whitespace-nowrap text-on-ink">
      <Lock size={11} strokeWidth={2.4} aria-hidden="true" />
      {t('canvas.isEditing', { name })}
    </div>
  );
}

/** The blinking text caret of the person who edits an element (handoff, locked state). */
export function EditCaret() {
  return (
    <span
      className="ml-0.5 inline-block h-[15px] w-0.5 shrink-0 animate-caret-blink bg-human"
      aria-hidden="true"
    />
  );
}
