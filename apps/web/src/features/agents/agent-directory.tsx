import type { CustomAgentSummary } from '@covibes/shared';
import { useMemo, type ReactNode } from 'react';

import { AgentDirectoryContext } from '@web/features/agents/agents';

/** Makes the custom agents of a project known to everything inside. */
export function AgentDirectoryProvider({
  agents,
  children,
}: {
  agents: readonly CustomAgentSummary[];
  children: ReactNode;
}) {
  const directory = useMemo(() => new Map(agents.map((agent) => [agent.key, agent])), [agents]);
  return (
    <AgentDirectoryContext.Provider value={directory}>{children}</AgentDirectoryContext.Provider>
  );
}
