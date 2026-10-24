import {
  CUSTOM_AGENT_COLORS,
  type CustomAgent,
  type CustomAgentColor,
  type ProjectDetails,
} from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@web/components/ui/dialog';
import { AgentEditor } from '@web/features/agents/agent-editor';
import { customAgentsQuery } from '@web/features/agents/queries';
import { useTeamMutations } from '@web/features/team/queries';
import { TeamMenu } from '@web/features/team/team-menu';

type ProjectTeamProps = {
  project: Pick<ProjectDetails, 'id' | 'name' | 'role' | 'agents'>;
  userId: string;
  /** Shows a short note, e.g. when the team could not be changed. */
  onNotice: (text: string) => void;
  /** The agent writing in the chat and those raising a hand, shown on their marks. */
  writing?: string | null;
  raising?: ReadonlySet<string>;
};

/** The custom color the fewest of the user's agents have, so new agents are told apart. */
function leastUsedColor(agents: readonly CustomAgent[]): CustomAgentColor {
  const count = (color: number) => agents.filter((agent) => agent.color === color).length;
  return CUSTOM_AGENT_COLORS.reduce((best, color) => (count(color) < count(best) ? color : best));
}

/**
 * The team of the open project in the header with everything around it (specs 14 and 19): adding
 * and removing agents, choosing models, and the agent editor for custom agents.
 */
export function ProjectTeam({ project, userId, onNotice, writing, raising }: ProjectTeamProps) {
  const { t } = useTranslation();
  const readOnly = project.role === 'viewer';
  const team = useTeamMutations(project.id, (reason) => {
    onNotice(t(reason === 'name_taken' ? 'team.nameTaken' : 'team.failed'));
  });
  // Viewers neither add agents nor edit them, so they need no list.
  const customAgents = useQuery({ ...customAgentsQuery(project.id), enabled: !readOnly }).data;
  /** The agent the editor shows; `null` inside is a new agent. */
  const [editing, setEditing] = useState<{ agent: CustomAgent | null } | null>(null);

  return (
    <>
      <TeamMenu
        agents={project.agents}
        writing={writing}
        raising={raising}
        canEdit={!readOnly}
        canChooseModel={project.role === 'owner'}
        customAgents={customAgents}
        userId={userId}
        onAdd={(agentKey) => {
          team.add.mutate(agentKey);
        }}
        onRemove={(agentKey) => {
          team.remove.mutate(agentKey);
        }}
        onModelChange={(agentKey, model) => {
          team.setModel.mutate({ agentKey, model });
        }}
        onCreateAgent={
          readOnly
            ? undefined
            : () => {
                setEditing({ agent: null });
              }
        }
        onEditAgent={(agent) => {
          setEditing({ agent });
        }}
      />
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing ? (
          <AgentEditor
            agent={editing.agent}
            project={{ id: project.id, name: project.name }}
            userId={userId}
            defaultColor={leastUsedColor(customAgents ?? [])}
            onCreated={(agent) => {
              // A new agent joins the team of the project it was created in.
              team.add.mutate(agent.key);
            }}
            onDone={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
