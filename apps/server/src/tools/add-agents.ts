import { AGENT_KEYS, type AgentKey } from '@covibes/shared';
import { z } from 'zod';

import { findAgent } from '@server/agents/catalog';
import { defineTool, type AgentTool } from '@server/ai-gateway';
import { decide, type Intent } from '@server/rules/decide';
import type { TeamWriter } from '@server/tasks/run-team';

/** How the rule engine treats team changes of one run, like canvas changes (spec 13). */
export type TeamRules = {
  intent: Promise<Intent>;
  proposalsOnly: boolean;
};

function names(keys: readonly AgentKey[]): string {
  return keys.map((key) => findAgent(key)?.names.en ?? key).join(', ');
}

/**
 * `add_agents` (spec 14): the moderator puts the team together from the catalog. On an
 * instruction the agents join right away; otherwise the change becomes a team proposal. Agents that
 * are in the team or in an open proposal already are left out.
 */
export function addAgentsTool(options: { team: TeamWriter; rules?: TeamRules }): AgentTool {
  return defineTool({
    name: 'add_agents',
    description:
      'Adds specialists of the catalog to the project team, each with a short reason. On an instruction they join right away; otherwise the change becomes a proposal the team can apply or reject.',
    input: {
      agents: z
        .array(
          z.object({
            key: z
              .enum(AGENT_KEYS)
              .exclude(['moderator'])
              .describe('The key of a catalog agent that is not in the team yet'),
            reason: z
              .string()
              .max(200)
              .describe('Why the agent fits the project, in one short sentence'),
          }),
        )
        .min(1)
        .max(AGENT_KEYS.length - 1),
    },
    run: async ({ agents }) => {
      const intent = options.rules ? await options.rules.intent : 'instruction';
      const { members, proposed } = await options.team.load();
      const wanted = agents.filter(
        (agent, index) => agents.findIndex((other) => other.key === agent.key) === index,
      );
      const known = wanted.filter((agent) => members.has(agent.key) || proposed.has(agent.key));
      const fresh = wanted.filter((agent) => !known.includes(agent));
      const knownNote =
        known.length > 0
          ? ` Already in the team or proposed: ${names(known.map((agent) => agent.key))}.`
          : '';
      if (fresh.length === 0) return `Nothing changed.${knownNote}`;

      const outcome = decide({
        allowed: true,
        intent,
        proposalsOnly: options.rules?.proposalsOnly ?? false,
        lockedTarget: false,
      });
      const added = names(fresh.map((agent) => agent.key));
      if (outcome.kind === 'reject') throw new Error('This tool is not allowed for you.');
      if (outcome.kind === 'direct') {
        await options.team.add(fresh.map((agent) => agent.key));
        return `Added to the team: ${added}. They answer from now on when someone mentions them.${knownNote}`;
      }
      await options.team.propose(
        fresh.map((agent) => ({ op: 'add_agent', agentKey: agent.key, reason: agent.reason })),
        outcome.reason,
      );
      return `Proposed for the team: ${added}. This is a proposal: the agents join once someone in the team applies it.${knownNote}`;
    },
  });
}
