import type { ReactNode } from 'react';

import { cn } from '@web/lib/cn';
import { agentClass, type AgentInfo } from '@web/features/agents/agents';
import { AGENT_TONE } from '@web/lib/styles';

type BadgeProps = {
  children: ReactNode;
  /** Colors the badge like the agent. */
  agent?: Pick<AgentInfo, 'look' | 'color'>;
  className?: string;
};

/** Small label such as "Agent" (18 px high, round). */
export function Badge({ children, agent, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center rounded-full px-2 text-badge font-semibold whitespace-nowrap',
        agent ? agentClass(AGENT_TONE, agent) : 'bg-bg-subtle text-text-2',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Rounded status pill, e.g. the chat status "Backend is typing · 1 waiting". */
export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-2 rounded-full bg-bg-subtle px-3 text-status whitespace-nowrap text-text-2',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Chip for short values such as criteria: an outlined pill (handoff "Kriterien"). */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center rounded-full border border-border-strong px-3 text-small whitespace-nowrap text-text-2',
        className,
      )}
    >
      {children}
    </span>
  );
}
