import { phaseStatuses, PHASES, type Phase, type ProjectAgent } from '@covibes/shared';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, MessageSquare, SquareCheckBig, Workflow } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { MobileTabs, type MobileTab } from '@web/components/ui/mobile-tabs';
import { PhaseSegment } from '@web/components/ui/phase-segments';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentColor, useAgents } from '@web/features/agents/agents';
import { HandBadge } from '@web/features/hands/hand-badge';
import { cn } from '@web/lib/cn';

type Area = 'chat' | 'canvas' | 'overview';

/** The header shows this many marks of the team, then "+N". */
const MAX_MARKS = 2;

type MobileWorkspaceProps = {
  projectName: string;
  activePhase: Phase;
  /** The team in the header, with the agent that writes and those that raise a hand. */
  agents: readonly ProjectAgent[];
  writing?: string | null;
  raising?: ReadonlySet<string>;
  /** What waits for the user, as the count on "Überblick". */
  waiting: number;
  /** The short note of the workspace; the canvas shows it itself. */
  notice: string | null;
  /** The address names a board, the plan or an element: the canvas comes first. */
  startOnCanvas: boolean;
  /** Grows whenever the chat or the overview opens something on the canvas. */
  canvasRequest: number;
  chat: ReactNode;
  canvas: ReactNode;
  overview: ReactNode;
};

/**
 * The workspace on a phone (spec 36e, draft H-Mobile): a compact header with the way back, the
 * project, its phase and the team; one area at a time; the tabs at the bottom. Chat and overview
 * stay mounted while another area is open, so a draft and the scroll position stay; the canvas is
 * mounted only while it is shown, since it needs its size.
 */
export function MobileWorkspace({
  projectName,
  activePhase,
  agents,
  writing = null,
  raising,
  waiting,
  notice,
  startOnCanvas,
  canvasRequest,
  chat,
  canvas,
  overview,
}: MobileWorkspaceProps) {
  const { t } = useTranslation();
  const [area, setArea] = useState<Area>(startOnCanvas ? 'canvas' : 'chat');
  const seenRequest = useRef(canvasRequest);
  useEffect(() => {
    if (seenRequest.current === canvasRequest) return;
    seenRequest.current = canvasRequest;
    setArea('canvas');
  }, [canvasRequest]);

  const tabs: MobileTab<Area>[] = [
    { id: 'chat', label: t('panels.chat'), icon: MessageSquare },
    { id: 'canvas', label: t('panels.canvas'), icon: Workflow },
    {
      id: 'overview',
      label: t('panels.overview'),
      icon: SquareCheckBig,
      count: waiting,
      countLabel: t('projects.waiting', { count: waiting }),
    },
  ];

  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] bg-bg-panel text-text">
      <header className="flex items-center gap-1 bg-bg-app px-3 pt-3.5 pb-3">
        <Link
          to="/"
          aria-label={t('workspace.toProjects')}
          className="grid size-11 shrink-0 place-items-center rounded-full text-text transition-colors hover:bg-bg-hover-app hover:text-text"
        >
          <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate font-display text-[18px] font-semibold tracking-[-0.015em]">
            {projectName}
          </h1>
          <p className="m-0 mt-[3px] flex min-w-0 items-center gap-2 text-small text-text-3">
            <span aria-hidden="true" className="flex shrink-0 gap-[3px]">
              {phaseStatuses(activePhase).map(({ phase, status }) => (
                <PhaseSegment key={phase} status={status} className="h-1 w-4" />
              ))}
            </span>
            <span className="truncate tabular-nums">
              {t(`phases.${activePhase}`)} ·{' '}
              {t('workspace.step', {
                step: PHASES.indexOf(activePhase) + 1,
                total: PHASES.length,
              })}
            </span>
          </p>
        </div>
        <TeamMarks agents={agents} writing={writing} raising={raising} />
      </header>

      <main className="relative min-h-0">
        <Area shown={area === 'chat'} label={t('panels.chat')}>
          {chat}
        </Area>
        {area === 'canvas' ? (
          <Area shown label={t('panels.canvas')}>
            {canvas}
          </Area>
        ) : null}
        <Area
          shown={area === 'overview'}
          label={t('panels.overview')}
          className="flex flex-col gap-[22px] overflow-y-auto p-4"
          aside
        >
          {overview}
        </Area>
        {notice && area !== 'canvas' ? (
          <div
            role="status"
            className="absolute inset-x-3 bottom-3 z-10 mx-auto w-fit max-w-full animate-pop rounded-[14px] bg-bg-panel px-3.5 py-2 text-center text-status text-text-body shadow-float"
          >
            {notice}
          </div>
        ) : null}
      </main>

      <MobileTabs tabs={tabs} active={area} onSelect={setArea} />
    </div>
  );
}

function Area({
  shown,
  label,
  className,
  aside = false,
  children,
}: {
  shown: boolean;
  label: string;
  className?: string;
  aside?: boolean;
  children: ReactNode;
}) {
  const Element = aside ? 'aside' : 'section';
  return (
    <Element
      aria-label={label}
      hidden={!shown}
      className={cn(
        'absolute inset-0 min-w-0',
        !aside && 'grid grid-rows-[minmax(0,1fr)]',
        className,
      )}
    >
      {children}
    </Element>
  );
}

/** The team in the header: overlapping marks, the writing one glowing, then "+N". */
function TeamMarks({
  agents,
  writing,
  raising,
}: {
  agents: readonly ProjectAgent[];
  writing: string | null;
  raising?: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  const resolve = useAgents();
  // The agent that writes and those raising a hand come first, so the few marks show them.
  const busy = (key: string) => key === writing || (raising?.has(key) ?? false);
  const team = agents
    .map((agent) => resolve(agent.key))
    .sort((a, b) => Number(busy(b.key)) - Number(busy(a.key)));
  if (team.length === 0) return null;
  const shown = team.slice(0, MAX_MARKS);
  const more = team.length - shown.length;
  return (
    <span
      role="img"
      aria-label={t('mobile.team', { names: team.map((agent) => agent.name).join(', ') })}
      className="flex shrink-0 items-center pr-1.5"
    >
      {shown.map((agent, index) => {
        const isWriting = agent.key === writing;
        return (
          <span key={agent.key} className={cn('relative flex', index > 0 && '-ml-1.5')}>
            <AgentAvatar
              agent={agent}
              size={28}
              className={cn(
                'ring-2 ring-bg-app',
                isWriting && 'animate-glow motion-reduce:animate-none',
              )}
              style={
                isWriting
                  ? ({
                      '--glow': `color-mix(in srgb, ${agentColor(agent)} 55%, transparent)`,
                      '--glow-gap': 'var(--color-bg-app)',
                    } as CSSProperties)
                  : undefined
              }
            />
            {raising?.has(agent.key) ? <HandBadge agent={agent} className="ring-bg-app" /> : null}
          </span>
        );
      })}
      {more > 0 ? (
        <span className="-ml-1.5 grid size-7 place-items-center rounded-[9px] bg-bg-panel text-[10.5px] font-bold text-text-2 ring-2 ring-bg-app inset-ring inset-ring-border tabular-nums">
          {t('projects.more', { count: more })}
        </span>
      ) : null}
    </span>
  );
}
