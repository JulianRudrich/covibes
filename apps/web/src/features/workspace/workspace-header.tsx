import type { Phase } from '@covibes/shared';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@web/components/logo';
import { Avatar } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import { Tooltip } from '@web/components/ui/tooltip';
import { DEMO_AGENTS, DEMO_MEMBERS } from '@web/features/workspace/demo-workspace';
import { PhaseIndicator } from '@web/features/workspace/phase-indicator';

type WorkspaceHeaderProps = { projectName: string; activePhase: Phase };

export function WorkspaceHeader({ projectName, activePhase }: WorkspaceHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="grid grid-cols-[380px_minmax(0,1fr)_300px] items-center gap-2 px-2">
      <div className="flex min-w-0 items-center gap-2.5 pl-2">
        <Logo />
        <span className="text-display font-semibold tracking-[-0.02em]">
          {t('common.wordmark')}
        </span>
        <span aria-hidden="true" className="text-display text-text-faint">
          /
        </span>
        <button
          type="button"
          aria-label={`${projectName}, ${t('workspace.projectMenu')}`}
          className="flex h-[30px] min-w-0 cursor-pointer items-center gap-1.5 rounded-btn-s px-2 text-ui font-medium whitespace-nowrap hover:bg-bg-hover-app"
        >
          <span className="truncate">{projectName}</span>
          <ChevronDown size={14} className="shrink-0 text-text-3" aria-hidden="true" />
        </button>
      </div>

      <div className="justify-self-center">
        <PhaseIndicator active={activePhase} />
      </div>

      <div className="flex items-center justify-end gap-2.5 pr-1">
        <div role="group" aria-label={t('workspace.humansLabel')} className="flex items-center">
          {DEMO_MEMBERS.map((member, index) => {
            const name = member.isCurrentUser ? t('common.you') : member.name;
            const initials = member.isCurrentUser ? t('common.you') : member.initials;
            return (
              <Tooltip key={member.id} content={name}>
                <span className={index > 0 ? '-ml-1.5' : undefined}>
                  <Avatar
                    kind="human"
                    tone="strong"
                    size={26}
                    label={name}
                    initials={initials}
                    className="border-2 border-bg-app"
                  />
                </span>
              </Tooltip>
            );
          })}
        </div>
        <span aria-hidden="true" className="h-5 w-px bg-divider-strong" />
        <div
          role="group"
          aria-label={t('workspace.agentsLabel')}
          className="flex items-center gap-[3px]"
        >
          {DEMO_AGENTS.map((agent) => (
            <Tooltip key={agent.key} content={t(`agents.${agent.key}`)}>
              <span>
                <Avatar
                  kind="agent"
                  agent={agent.key}
                  size={24}
                  label={t(`agents.${agent.key}`)}
                  initials={agent.initials}
                />
              </span>
            </Tooltip>
          ))}
        </div>
        <Button variant="primary" className="px-3.5">
          {t('common.share')}
        </Button>
      </div>
    </header>
  );
}
