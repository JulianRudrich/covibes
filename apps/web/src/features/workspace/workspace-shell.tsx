import type { GitReturn, Phase, ProjectAgent } from '@covibes/shared';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Maximize2, Minimize2, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@web/components/ui/icon-button';
import { PanelSplitter } from '@web/components/ui/panel-splitter';
import { Tooltip } from '@web/components/ui/tooltip';
import {
  CHAT_LIMITS,
  OVERVIEW_LIMITS,
  clampPanel,
  usePanelPreferences,
} from '@web/features/workspace/use-panel-preferences';
import { Panel } from '@web/components/ui/panel';
import type { SessionUser } from '@web/features/auth/session';
import type { ProjectSettings } from '@web/features/workspace/project-settings-dialog';
import { MobileWorkspace } from '@web/features/workspace/mobile-workspace';
import { WorkspaceHeader } from '@web/features/workspace/workspace-header';
import { useMediaQuery, usePhone } from '@web/lib/use-media-query';

export type WorkspaceMember = { id: string; name: string; isCurrentUser: boolean };

/** The dialog "Repository" of the project's menu (spec 28a). */
export type WorkspaceRepository = {
  projectId: string;
  /** How the way back from GitLab ended; the dialog opens with it once. */
  returned: GitReturn | undefined;
  /** The dialog showed how it ended and was closed. */
  onReturnSeen: () => void;
  /** The review to show (spec 30b): the dialog "Merge Requests" opens with it. */
  reviewId?: string | null;
  /** That dialog was closed. */
  onReviewClosed?: () => void;
};

type WorkspaceShellProps = {
  projectName: string;
  settings: ProjectSettings;
  repository: WorkspaceRepository;
  /** The project's menu offers the usage (spec 31b): for owners. */
  showUsage?: boolean;
  activePhase: Phase;
  /** Jumping to a phase and asking for the next step (spec 24); missing for viewers. */
  onSelectPhase?: (phase: Phase) => void;
  onAskNextStep?: () => void;
  members: WorkspaceMember[];
  /** The members who have the open board open right now ("Im Raum"). */
  present: ReadonlySet<string>;
  user: SessionUser | null;
  /** The agents of the project in the header (spec 14). */
  team: ReactNode;
  /** "Teilen" in the header (spec 21a). */
  share: ReactNode;
  /** Content of the chat panel: its header row and the chat. */
  chat: ReactNode;
  /** Content of the canvas panel: its header row and the canvas. */
  canvas: ReactNode;
  /** Sections of the overview: what waits for the user, decisions and criteria. */
  overview: ReactNode;
  /** For the phone layout (spec 36e): the team's marks in its header. */
  agents: readonly ProjectAgent[];
  writing?: string | null;
  raising?: ReadonlySet<string>;
  /** What waits for the user, counted on the tab "Überblick". */
  waiting: number;
  /** The note of the workspace, shown by the phone layout while the canvas is not. */
  notice: string | null;
  /** The address names a board, the plan or an element. */
  startOnCanvas: boolean;
  /** Grows whenever the chat or the overview opens something on the canvas. */
  canvasRequest: number;
};

/**
 * Main screen layout (handoff "Covibes Studio", "Layout"): the top bar on the app background
 * plus the chat, canvas and overview panels. On a phone one area at a time (spec 36e).
 */
export function WorkspaceShell({
  projectName,
  settings,
  repository,
  showUsage,
  activePhase,
  onSelectPhase,
  onAskNextStep,
  members,
  present,
  user,
  team,
  share,
  chat,
  canvas,
  overview,
  agents,
  writing,
  raising,
  waiting,
  notice,
  startOnCanvas,
  canvasRequest,
}: WorkspaceShellProps) {
  const { t } = useTranslation();
  const phone = usePhone();
  const tablet = useMediaQuery('(48rem <= width < 80rem)');
  const [preferences, updatePreferences] = usePanelPreferences();
  const [focused, setFocused] = useState(false);
  const [width, setWidth] = useState(1440);
  const main = useRef<HTMLElement>(null);
  const canvasPanel = useRef<HTMLElement>(null);
  const overviewPanel = useRef<HTMLElement>(null);
  const overviewToggle = useRef<HTMLButtonElement>(null);
  const chatId = useId();
  const canvasId = useId();
  const overviewId = useId();
  const overviewOpen = !focused && (tablet ? preferences.tabletOverview : preferences.wideOverview);
  const overviewWidth = preferences.overview;
  const chatMax = Math.max(
    CHAT_LIMITS.min,
    Math.min(
      CHAT_LIMITS.max,
      width - 24 - 12 - 340 - (!tablet && overviewOpen ? overviewWidth + 12 : 0),
    ),
  );
  const chatWidth = clampPanel(
    tablet ? preferences.tabletChat : preferences.chat,
    CHAT_LIMITS.min,
    chatMax,
  );
  const overviewMax = Math.max(
    OVERVIEW_LIMITS.min,
    Math.min(OVERVIEW_LIMITS.max, width - 24 - 24 - 340 - chatWidth),
  );
  const closeOverview = useCallback(() => {
    updatePreferences(tablet ? { tabletOverview: false } : { wideOverview: false });
    overviewToggle.current?.focus();
  }, [tablet, updatePreferences]);
  useEffect(() => {
    if (phone || !main.current) return;
    const element = main.current;
    const measure = () => {
      setWidth(element.clientWidth || window.innerWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [phone]);
  useEffect(() => {
    if (!tablet || !overviewOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        (event.target instanceof Element && event.target.closest('[role="dialog"],[role="menu"]'))
      )
        return;
      event.preventDefault();
      closeOverview();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [tablet, overviewOpen, closeOverview]);
  const toggleFocus = () => {
    setFocused((previous) => !previous);
    if (!focused) requestAnimationFrame(() => canvasPanel.current?.focus());
  };
  const geometry = {
    '--studio-chat-width': `${String(chatWidth)}px`,
    '--studio-overview-width': `${String(clampPanel(overviewWidth, OVERVIEW_LIMITS.min, overviewMax))}px`,
  } as CSSProperties;

  if (phone) {
    return (
      <MobileWorkspace
        projectName={projectName}
        activePhase={activePhase}
        agents={agents}
        writing={writing}
        raising={raising}
        waiting={waiting}
        notice={notice}
        startOnCanvas={startOnCanvas}
        canvasRequest={canvasRequest}
        chat={chat}
        canvas={canvas}
        overview={overview}
      />
    );
  }

  return (
    <div
      className="studio-workspace grid h-dvh min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-bg-app text-text"
      data-tablet={tablet}
      data-focused={focused}
      data-overview={overviewOpen}
      style={geometry}
    >
      <WorkspaceHeader
        projectName={projectName}
        settings={settings}
        repository={repository}
        showUsage={showUsage}
        activePhase={activePhase}
        onSelectPhase={onSelectPhase}
        onAskNextStep={onAskNextStep}
        members={members}
        present={present}
        user={user}
        team={team}
        share={share}
        layout={
          <div className="flex items-center gap-1">
            <Tooltip content={t(focused ? 'layout.restorePanels' : 'layout.focusCanvas')}>
              <IconButton
                aria-label={t(focused ? 'layout.restorePanels' : 'layout.focusCanvas')}
                aria-pressed={focused}
                onClick={toggleFocus}
              >
                {focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </IconButton>
            </Tooltip>
            <Tooltip content={t(overviewOpen ? 'layout.hideOverview' : 'layout.showOverview')}>
              <IconButton
                ref={overviewToggle}
                aria-label={t(overviewOpen ? 'layout.hideOverview' : 'layout.showOverview')}
                aria-controls={overviewId}
                aria-expanded={overviewOpen}
                onClick={() => {
                  setFocused(false);
                  updatePreferences(
                    tablet ? { tabletOverview: !overviewOpen } : { wideOverview: !overviewOpen },
                  );
                  if (tablet && !overviewOpen)
                    requestAnimationFrame(() =>
                      overviewPanel.current?.querySelector<HTMLButtonElement>('button')?.focus(),
                    );
                }}
              >
                {overviewOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </IconButton>
            </Tooltip>
          </div>
        }
      />

      <main ref={main} className="studio-workspace-panels min-h-0 min-w-0 px-3 pb-3">
        <Panel
          id={chatId}
          hidden={focused}
          className="studio-chat-panel"
          aria-label={t('panels.chat')}
        >
          {chat}
        </Panel>
        {!focused ? (
          <PanelSplitter
            label={t('layout.resizeChat')}
            controls={chatId}
            value={chatWidth}
            min={CHAT_LIMITS.min}
            max={chatMax}
            onChange={(next) => {
              updatePreferences(tablet ? { tabletChat: next } : { chat: next });
            }}
          />
        ) : null}
        <Panel
          id={canvasId}
          ref={canvasPanel}
          tabIndex={-1}
          className="studio-canvas-panel"
          aria-label={t('panels.canvas')}
        >
          {canvas}
        </Panel>
        {!tablet && overviewOpen ? (
          <PanelSplitter
            label={t('layout.resizeOverview')}
            controls={overviewId}
            value={clampPanel(overviewWidth, OVERVIEW_LIMITS.min, overviewMax)}
            min={OVERVIEW_LIMITS.min}
            max={overviewMax}
            reverse
            onChange={(next) => {
              updatePreferences({ overview: next });
            }}
          />
        ) : null}

        {/* The overview has no title of its own: its sections head themselves. */}
        <aside
          id={overviewId}
          ref={overviewPanel}
          hidden={!overviewOpen}
          aria-label={t('panels.overview')}
          className="studio-overview-panel flex min-h-0 min-w-0 flex-col gap-[22px] overflow-y-auto rounded-surface bg-bg-panel p-[18px] shadow-panel"
        >
          {tablet ? (
            <div className="flex items-center justify-between gap-3">
              <h2 className="m-0 font-display text-heading font-semibold">
                {t('panels.overview')}
              </h2>
              <IconButton aria-label={t('layout.hideOverview')} onClick={closeOverview}>
                <X size={16} />
              </IconButton>
            </div>
          ) : null}
          {overview}
        </aside>
      </main>
    </div>
  );
}
