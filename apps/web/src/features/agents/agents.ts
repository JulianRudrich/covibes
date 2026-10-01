import {
  AGENT_MENTION_NAMES,
  agentInitials,
  isAgentKey,
  mentionHandle,
  type AgentKey,
  type CustomAgentSummary,
  type MentionNames,
} from '@covibes/shared';
import { createContext, useCallback, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

// Every agent the app shows is resolved here (spec 19): catalog agents by their key from the
// translations, custom agents from the directory of the project.

/** How an agent looks: a catalog agent has its own colors, custom agents share the custom look. */
export type AgentLook = AgentKey | 'custom';

export type AgentInfo = {
  /** A catalog key or the id of a custom agent. */
  key: string;
  name: string;
  /** One letter for catalog agents, two for custom agents. */
  initials: string;
  role: string;
  /** What mentions the agent, without the `@`. */
  mention: string;
  look: AgentLook;
  /** For the custom look: which of the six custom colors. */
  color: number | null;
  /** The directory entry of a custom agent; null for catalog agents and unknown keys. */
  custom: CustomAgentSummary | null;
};

/** The color of a custom agent nobody knows any more: graphite. */
export const UNKNOWN_AGENT_COLOR = 5;

const NO_AGENTS: ReadonlyMap<string, CustomAgentSummary> = new Map();
/** The custom agents of the open project by key; `AgentDirectoryProvider` fills it. */
export const AgentDirectoryContext = createContext(NO_AGENTS);

/**
 * Resolves an agent key to what the UI shows. Outside a project (or for a key the directory does
 * not know, e.g. after the agent's owner deleted their account) a custom agent is "Agent".
 */
export function useAgents(): (key: string) => AgentInfo {
  const { t } = useTranslation();
  const directory = useContext(AgentDirectoryContext);
  return useCallback(
    (key: string): AgentInfo => {
      if (isAgentKey(key)) {
        const name = t(`agents.${key}`);
        return {
          key,
          name,
          initials: t(`agentInitials.${key}`),
          role: t(`agentRoles.${key}`),
          mention: name,
          look: key,
          color: null,
          custom: null,
        };
      }
      const custom = directory.get(key) ?? null;
      return {
        key,
        name: custom?.name ?? t('agents.unknown'),
        initials: custom ? agentInitials(custom.name) : '?',
        role: custom?.role ?? '',
        mention: custom ? mentionHandle(custom.name) : '',
        look: 'custom',
        color: custom?.color ?? UNKNOWN_AGENT_COLOR,
        custom,
      };
    },
    [t, directory],
  );
}

/**
 * The names the agents of a team answer to, like the server resolves them: catalog agents to their
 * fixed names, custom agents to their handle.
 */
export function useMentionNames(team: readonly string[]): MentionNames {
  const agents = useAgents();
  return useMemo(() => {
    const names: Record<string, readonly string[]> = {};
    for (const key of team) {
      if (isAgentKey(key)) names[key] = AGENT_MENTION_NAMES[key];
      else {
        const { mention } = agents(key);
        if (mention !== '') names[key] = [mention.toLowerCase()];
      }
    }
    return names;
  }, [team, agents]);
}

type Looks = Pick<AgentInfo, 'look' | 'color'>;

/**
 * The classes of an agent from a map of complete class names. For a custom agent the class
 * `agent-color-N` sets which color the `agent-custom` utilities of the map resolve to.
 */
export function agentClass(map: Readonly<Record<AgentLook, string>>, agent: Looks): string {
  return agent.look === 'custom'
    ? `${map.custom} agent-color-${String(agent.color ?? UNKNOWN_AGENT_COLOR)}`
    : map[agent.look];
}

/** The agent's base color as a CSS value, for SVG strokes, arrowheads and shadows. */
export function agentColor(agent: Looks): string {
  return agent.look === 'custom'
    ? `var(--color-agent-custom-${String(agent.color ?? UNKNOWN_AGENT_COLOR)})`
    : `var(--color-agent-${agent.look})`;
}
