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

/** Small label such as "Agent" (18 px high, radius 5). */
export function Badge({ children, agent, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center rounded-xs px-1.5 text-badge font-medium whitespace-nowrap',
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
        'inline-flex h-[26px] items-center gap-2 rounded-[13px] bg-bg-muted px-2.5 text-status whitespace-nowrap text-text-2',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Chip for short values such as criteria (26 px high, radius 7). */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[26px] items-center rounded-btn-s border border-border-soft bg-bg-muted px-[9px] text-small whitespace-nowrap text-human-avatar-fg',
        className,
      )}
    >
      {children}
    </span>
  );
}
