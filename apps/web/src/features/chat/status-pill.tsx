import { useTranslation } from 'react-i18next';

import { Pill } from '@web/components/ui/badge';
import { agentClass, useAgents, type AgentInfo, type AgentLook } from '@web/features/agents/agents';
import { cn } from '@web/lib/cn';

/** What the chat header reports about the agents: who is typing and how many wait. */
export type ChatStatus = { typing: string | null; waiting: number };

const DOT_COLOR: Record<AgentLook, string> = {
  moderator: 'bg-agent-moderator',
  backend: 'bg-agent-backend',
  critic: 'bg-agent-critic',
  data: 'bg-agent-data',
  product: 'bg-agent-product',
  frontend: 'bg-agent-frontend',
  devops: 'bg-agent-devops',
  security: 'bg-agent-security',
  ml: 'bg-agent-ml',
  content: 'bg-agent-content',
  custom: 'bg-agent-custom',
};

const DOT_DELAYS = ['[animation-delay:0s]', '[animation-delay:0.16s]', '[animation-delay:0.32s]'];

/** Three 4 px dots in the agent's color that bounce one after the other while it types. */
export function TypingDots({ agent }: { agent: Pick<AgentInfo, 'look' | 'color'> }) {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden="true">
      {DOT_DELAYS.map((delay) => (
        <span
          key={delay}
          className={cn(
            'size-1 animate-typing-dot rounded-full motion-reduce:animate-none',
            agentClass(DOT_COLOR, agent),
            delay,
          )}
        />
      ))}
    </span>
  );
}

/**
 * Status pill in the chat header (handoff: "Backend is typing · 1 waiting"), derived from the
 * agent runs. Without anything to report it renders nothing.
 */
export function ChatStatusPill({ status }: { status: ChatStatus | null }) {
  const { t } = useTranslation();
  const agents = useAgents();
  if (!status || (status.typing === null && status.waiting === 0)) return null;
  const { waiting } = status;
  const typing = status.typing === null ? null : agents(status.typing);

  const parts = [
    typing === null ? null : t('chat.typing', { name: typing.name }),
    waiting > 0 ? t('chat.waiting', { count: waiting }) : null,
  ].filter((part) => part !== null);

  return (
    <Pill>
      {typing === null ? null : <TypingDots agent={typing} />}
      <span role="status">{parts.join(' · ')}</span>
    </Pill>
  );
}
