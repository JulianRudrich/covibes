import { Avatar } from '@web/components/ui/avatar';
import { UNKNOWN_AGENT_COLOR, type AgentInfo } from '@web/features/agents/agents';
import { cn } from '@web/lib/cn';

/** The square avatar of an agent with its initials, in its color. */
export function AgentAvatar({
  agent,
  size,
  className,
}: {
  agent: AgentInfo;
  size?: 16 | 24 | 26 | 28;
  className?: string;
}) {
  return (
    <Avatar
      kind="agent"
      agent={agent.look}
      label={agent.name}
      initials={agent.initials}
      size={size}
      className={cn(
        agent.look === 'custom' && `agent-color-${String(agent.color ?? UNKNOWN_AGENT_COLOR)}`,
        className,
      )}
    />
  );
}
