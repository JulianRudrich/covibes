import { isAgentKey } from '@covibes/shared';

import { CATALOG_MARKS, customMark } from '@web/components/ui/agent-marks';
import { Avatar } from '@web/components/ui/avatar';
import { UNKNOWN_AGENT_COLOR, type AgentInfo } from '@web/features/agents/agents';
import { cn } from '@web/lib/cn';

/** The mark of an agent in its color (spec 36a). */
export function AgentAvatar({
  agent,
  size,
  className,
}: {
  agent: AgentInfo;
  size?: 16 | 20 | 24 | 26 | 28 | 30 | 32;
  className?: string;
}) {
  return (
    <Avatar
      kind="agent"
      agent={agent.look}
      label={agent.name}
      mark={isAgentKey(agent.key) ? CATALOG_MARKS[agent.key] : customMark(agent.key)}
      size={size}
      className={cn(
        agent.look === 'custom' && `agent-color-${String(agent.color ?? UNKNOWN_AGENT_COLOR)}`,
        className,
      )}
    />
  );
}
