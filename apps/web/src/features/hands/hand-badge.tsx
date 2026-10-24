import { Hand } from 'lucide-react';

import { agentClass, type AgentInfo } from '@web/features/agents/agents';
import { AGENT_BACKGROUND } from '@web/features/canvas/agent-look';
import { cn } from '@web/lib/cn';

/**
 * The hand of an agent that raises it (handoff "Im Raum" and "Raised hand"): a 16 px circle in
 * its base color at the corner of its mark.
 */
export function HandBadge({ agent, className }: { agent: AgentInfo; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute -top-[5px] -right-[5px] grid size-4 animate-pop place-items-center rounded-full text-on-ink ring-2 ring-bg-panel',
        agentClass(AGENT_BACKGROUND, agent),
        className,
      )}
    >
      <Hand size={9} strokeWidth={2.8} />
    </span>
  );
}
