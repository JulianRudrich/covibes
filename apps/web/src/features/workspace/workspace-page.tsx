import {
  boardExportTitle,
  exportFileName,
  type HandRaise,
  type MessageReference,
  type NamedElement,
  type OpenVote,
  type ProjectDetails,
  type Proposal,
  type RoadmapAssignee,
} from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AgentDirectoryProvider } from '@web/features/agents/agent-directory';

import { PageMessage } from '@web/components/page-message';
import { Dialog } from '@web/components/ui/dialog';
import { sessionQuery, type SessionUser } from '@web/features/auth/session';
import { awayQuery, useDismissAway } from '@web/features/away/queries';
import { SinceYouWereAway } from '@web/features/away/since-you-were-away';
import { BoardHistoryDialog } from '@web/features/canvas/board-history';
import { BoardTabs } from '@web/features/canvas/board-tabs';
import { CanvasPanel, type BoardExports } from '@web/features/canvas/canvas-panel';
import { ChatPanel } from '@web/features/chat/chat-panel';
import { messagesQuery } from '@web/features/chat/queries';
import { chatStatus, runsQuery } from '@web/features/chat/runs';
import { DecisionsOverview } from '@web/features/decisions/decisions-overview';
import { openVotesQuery, useVoteActions } from '@web/features/decisions/queries';
import type { PlanTaskAssignments } from '@web/features/plan/plan-editor';
import { PlanPanel } from '@web/features/plan/plan-panel';
import { planStateQuery, usePlanActions } from '@web/features/plan/queries';
import { handsQuery, useHandDecisions } from '@web/features/hands/queries';
import { useConnectGitAccount } from '@web/features/git/queries';
import { useGitSync } from '@web/features/git/use-git-sync';
import {
  deviatingReviews,
  gitRequestsQuery,
  gitReviewsQuery,
  useApproveGitRequests,
  useEndGitRequest,
} from '@web/features/git/request-queries';
import { gitRequestsToDecide } from '@web/features/git/request-progress';
import { notificationsQuery, useMarkNotificationsRead } from '@web/features/notifications/queries';
import { projectQuery, useSetPhase, useUpdateProject } from '@web/features/projects/queries';
import {
  decidedQueryKey,
  proposalsQuery,
  useProposalDecisions,
  type DecidedProposal,
} from '@web/features/proposals/queries';
import { waitingCount } from '@web/features/proposals/waiting-count';
import { WaitingForYou } from '@web/features/proposals/waiting-for-you';
import { roadmapQuery, useAssignTask, useOpenRoadmap } from '@web/features/roadmap/queries';
import {
  RoadmapProvider,
  type RoadmapSource,
  type TaskAssigning,
} from '@web/features/roadmap/roadmap-context';
import { ProjectShare } from '@web/features/share/project-share';
import { ProjectTeam } from '@web/features/team/project-team';
import { useAskNextStep } from '@web/features/workspace/use-ask-next-step';
import { useProjectLive } from '@web/features/workspace/use-project-live';
import { useProjectSeen } from '@web/features/workspace/use-project-seen';
import { WorkspaceShell, type WorkspaceMember } from '@web/features/workspace/workspace-shell';
import { ApiError } from '@web/lib/api';

const route = getRouteApi('/_authed/p/$projectId');

/** Route component for `/p/$projectId`. */
export function WorkspacePage() {
  const { t } = useTranslation();
  const { projectId } = route.useParams();
  const user = useQuery(sessionQuery).data;
  const project = useQuery(projectQuery(projectId));

  if (project.isPending) {
    return (
      <PageMessage title={t('workspace.loading')}>
        <span className="sr-only">{t('common.loading')}</span>
      </PageMessage>
    );
  }
  if (project.isError) {
    const notFound = project.error instanceof ApiError && project.error.code === 'not_found';
    // The project was open and is gone now: someone took the access away (spec 21a).
    const lost = notFound && project.data !== undefined;
    return (
      <PageMessage
        title={
          lost
            ? t('workspace.accessLost.title')
            : notFound
              ? t('workspace.notFound.title')
              : t('workspace.loadError')
        }
      >
        {notFound ? (
          <p className="m-0 text-ui text-text-3">
            {lost
              ? t('workspace.accessLost.text', { project: project.data.name })
              : t('workspace.notFound.text')}
          </p>
        ) : null}
        <Link to="/" className="mt-2 text-ui">
          {t('workspace.notFound.back')}
        </Link>
      </PageMessage>
    );
  }

  return <Workspace project={project.data} user={user ?? null} />;
}

/** How long a note over the canvas stays. */
const NOTICE_MS = 5_000;

/** A short note that disappears by itself; a new one starts the time again. */
function useNotice() {
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice(null);
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);
  const show = useCallback((text: string) => {
    setNotice({ text, at: Date.now() });
  }, []);
  return { notice: notice?.text ?? null, show };
}

function Workspace({ project, user }: { project: ProjectDetails; user: SessionUser | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { board: requested, view, focus, git: gitReturned } = route.useSearch();
  // The project plan takes the place of the canvas while it is open (spec 25a).
  const planOpen = view === 'plan';
  const { notice, show: showNotice } = useNotice();
  useProjectLive(project.id, user?.id);
  // The status of the tasks comes from the repository (spec 30a).
  useGitSync(project.id);
  useProjectSeen(project.id);

  // The main canvas comes first; it is open unless the address names another board.
  const activeBoard =
    project.boards.find((board) => board.id === requested) ??
    project.boards.find((board) => board.kind === 'main');

  const selectBoard = useCallback(
    (boardId: string, replace = false) =>
      navigate({
        to: '/p/$projectId',
        params: { projectId: project.id },
        search: boardId === mainBoardId(project) ? {} : { board: boardId },
        replace,
      }),
    [navigate, project],
  );

  // What the moderator has for the plan (spec 25b): its suggestions wait in the plan and count
  // under "Wartet auf dich".
  const planState = useQuery(planStateQuery(project.id)).data;
  const planFailed = useCallback(() => {
    showNotice(t('plan.actionFailed'));
  }, [showNotice, t]);
  const planActions = usePlanActions(project.id, planFailed);
  const openPlan = useCallback(
    () =>
      navigate({
        to: '/p/$projectId',
        params: { projectId: project.id },
        search: { view: 'plan' },
      }),
    [navigate, project.id],
  );

  // "Roadmap" in the plan (spec 26a) opens the board that shows it and brings it into view; for
  // owners and editors the server adds one when there is none.
  const roadmapOpening = useOpenRoadmap(project.id);
  const openRoadmap = useCallback(() => {
    roadmapOpening.mutate(undefined, {
      onSuccess: (place) =>
        void navigate({
          to: '/p/$projectId',
          params: { projectId: project.id },
          search:
            place.boardId === mainBoardId(project)
              ? { focus: place.nodeId }
              : { board: place.boardId, focus: place.nodeId },
        }),
      onError: (error) => {
        showNotice(
          error instanceof ApiError && error.code === 'not_found'
            ? t('roadmap.none')
            : t('plan.actionFailed'),
        );
      },
    });
  }, [roadmapOpening, navigate, project, showNotice, t]);
  // "Im Chat fragen" at an element of the canvas (spec 37b): its name goes into the composer,
  // and the message will say which element is meant.
  const [ask, setAsk] = useState<NamedElement & { label: string }>();
  // A reference in a message (spec 37a) opens the canvas at its element: the board it is on,
  // also from the plan, with the element in view.
  const openElement = useCallback(
    (boardId: string, nodeId: string) =>
      void navigate({
        to: '/p/$projectId',
        params: { projectId: project.id },
        search:
          boardId === mainBoardId(project) ? { focus: nodeId } : { board: boardId, focus: nodeId },
      }),
    [navigate, project],
  );
  const openReference = useCallback(
    (reference: MessageReference) => {
      openElement(reference.boardId, reference.nodeId);
    },
    [openElement],
  );
  // The history of the open board (spec 38a), opened from the canvas toolbar.
  const [historyOpen, setHistoryOpen] = useState(false);
  const openHistory = useCallback(() => {
    setHistoryOpen(true);
  }, []);
  const clearFocus = useCallback(
    () =>
      void navigate({
        to: '/p/$projectId',
        params: { projectId: project.id },
        search: (previous) => ({ ...previous, focus: undefined }),
        replace: true,
      }),
    [navigate, project.id],
  );
  // An element that is asked for and is not on the board: it was deleted since, e.g. after a
  // message referred to it (spec 37a).
  const focusMissing = useCallback(() => {
    showNotice(t('canvas.elementGone'));
    clearFocus();
  }, [showNotice, t, clearFocus]);
  // How the way back from GitLab ended is said once (spec 28a); then the address is clean again.
  const clearGitReturn = useCallback(
    () =>
      void navigate({
        to: '/p/$projectId',
        params: { projectId: project.id },
        search: (previous) => ({ ...previous, git: undefined }),
        replace: true,
      }),
    [navigate, project.id],
  );
  // Exports (spec 27a): the open board and the plan as files, named after the project.
  const exportFailed = useCallback(() => {
    showNotice(t('export.failed'));
  }, [showNotice, t]);
  const boardExports = useMemo<BoardExports | undefined>(
    () =>
      activeBoard && {
        // The main canvas by its name in the project's language (spec 32b).
        title: boardExportTitle(activeBoard, project.language),
        fileName: exportFileName(project.name, boardExportTitle(activeBoard, project.language)),
        language: project.language,
        onFailed: exportFailed,
      },
    [activeBoard, project.name, project.language, exportFailed],
  );

  // Tasks (spec 26b): owners and editors give them to members, on the roadmap and in the plan.
  const assignFailed = useCallback(() => {
    showNotice(t('roadmap.assign.failed'));
  }, [showNotice, t]);
  const { mutate: assignTask } = useAssignTask(project.id, assignFailed);
  const canAssign = project.role !== 'viewer';
  const assigning = useMemo<TaskAssigning | undefined>(
    () =>
      canAssign
        ? {
            members: project.members.map((member) => ({
              userId: member.userId,
              name: member.name,
            })),
            onAssign: (taskId: string, assignee: RoadmapAssignee | null) => {
              assignTask({ taskId, assignee });
            },
          }
        : undefined,
    [canAssign, project.members, assignTask],
  );
  const roadmapSource = useMemo<RoadmapSource>(
    () => ({ projectId: project.id, onOpenPlan: () => void openPlan(), assigning }),
    [project.id, openPlan, assigning],
  );
  // The plan shows who took which of its tasks; the roadmap knows which list items are tasks.
  const planRoadmap = useQuery({ ...roadmapQuery(project.id), enabled: planOpen }).data;
  const planTasks = useMemo<PlanTaskAssignments | undefined>(
    () =>
      planRoadmap && {
        assignees: new Map(
          planRoadmap.milestones.flatMap((milestone) =>
            milestone.tasks.flatMap((task) => (task.id ? [[task.id, task.assignee] as const] : [])),
          ),
        ),
        issues: new Map(
          planRoadmap.milestones.flatMap((milestone) =>
            milestone.tasks.flatMap((task) =>
              task.id && task.issue ? [[task.id, task.issue] as const] : [],
            ),
          ),
        ),
        assigning,
      },
    [planRoadmap, assigning],
  );

  // A board that disappears while it is open was deleted by someone else; unknown boards in the
  // address (e.g. an old link) just open the main canvas.
  const knownBoards = useRef(new Set<string>());
  useEffect(() => {
    if (requested !== undefined && !project.boards.some((board) => board.id === requested)) {
      if (knownBoards.current.has(requested)) showNotice(t('canvas.boards.deleted'));
      const main = mainBoardId(project);
      if (main) void selectBoard(main, true);
    }
    for (const board of project.boards) knownBoards.current.add(board.id);
  }, [project, requested, selectBoard, showNotice, t]);

  // The signed-in user comes first and is shown as "you".
  const members: WorkspaceMember[] = project.members
    .map((member) => ({
      id: member.userId,
      name: member.name,
      isCurrentUser: member.userId === user?.id,
    }))
    .sort((a, b) => Number(b.isCurrentUser) - Number(a.isCurrentUser));

  const readOnly = project.role === 'viewer';

  // Proposals of agents (spec 13): on the canvas of their board and under "Wartet auf dich".
  const proposals = useQuery(proposalsQuery(project.id)).data ?? NO_PROPOSALS;
  const decided = useQuery({
    queryKey: decidedQueryKey(project.id),
    queryFn: () => NO_DECISIONS,
    initialData: NO_DECISIONS,
    staleTime: Infinity,
  }).data;
  const { decide } = useProposalDecisions(project.id, (failure) => {
    showNotice(
      failure.reason === 'being_edited'
        ? t('proposals.errors.beingEdited', { name: failure.name })
        : failure.reason === 'already_decided'
          ? t('proposals.errors.alreadyDecided')
          : t('proposals.errors.failed'),
    );
  });
  // While the owner decides (spec 16b), only owners confirm decisions and adopt variants.
  const canConfirmDecisions =
    !readOnly && (project.decisionProcess !== 'owner' || project.role === 'owner');
  // Topics whose variants wait for the team (spec 17): "Vergleich A/B läuft".
  const comparing = useMemo(
    () =>
      proposals.flatMap((proposal) =>
        proposal.kind === 'variants' ? (proposal.operations[0]?.topic.toLowerCase() ?? []) : [],
      ),
    [proposals],
  );
  const updateProject = useUpdateProject(project.id);

  // What else waits for the user (spec 22a): raised hands, and votes without their vote. Nothing
  // waits for someone who only reads.
  const hands = useQuery(handsQuery(project.id)).data ?? NO_HANDS;
  const openVotes = useQuery({ ...openVotesQuery(project.id), enabled: !readOnly }).data;
  const userId = user?.id ?? '';
  const votesToCast = useMemo(
    () =>
      (openVotes ?? NO_VOTES).filter(
        (vote) => !vote.ballots.some((ballot) => ballot.userId === userId),
      ),
    [openVotes, userId],
  );
  const decideHand = useHandDecisions(project.id, (reason) => {
    showNotice(t(reason === 'already_decided' ? 'hands.alreadyDecided' : 'hands.failed'));
  });
  const { cast: castVote } = useVoteActions(project.id, userId, (reason) => {
    showNotice(t(reason === 'already_decided' ? 'votes.alreadyClosed' : 'votes.failed'));
  });
  const waitingHands = readOnly ? NO_HANDS : hands;

  // "Im Raum" (spec 36b): who else is on the open board, which agent writes in the chat and
  // which ones raise a hand. Runs and messages are only read here; the chat loads them.
  const [present, setPresent] = useState<ReadonlySet<string>>(NOBODY);
  const showPresence = useCallback((users: readonly string[]) => {
    setPresent(new Set(users));
  }, []);
  const runs = useQuery({ ...runsQuery(project.id), enabled: false }).data;
  const messages = useQuery({ ...messagesQuery(project.id), enabled: false }).data;
  const writing = useMemo(
    () => chatStatus(runs ?? [], messages ?? [])?.typing ?? null,
    [runs, messages],
  );
  const raising = useMemo(() => new Set(hands.map((hand) => hand.agentKey)), [hands]);

  // Git requests (spec 29b): what waits for approval, runs or failed. Who may approve does so
  // here, with their own GitLab account; without one, the way leads to GitLab and back.
  const gitRequests = useQuery(gitRequestsQuery(project.id)).data;
  // Merge requests that go against the architecture (spec 30b), and the review that is open.
  const reviewList = useQuery(gitReviewsQuery(project.id)).data?.reviews;
  const reviews = useMemo(() => deviatingReviews(reviewList), [reviewList]);
  const [openReview, setOpenReview] = useState<string | null>(null);
  const closeReview = useCallback(() => {
    setOpenReview(null);
  }, []);
  const approveGit = useApproveGitRequests(project.id);
  const endGit = useEndGitRequest(project.id);
  const connectGit = useConnectGitAccount();
  const gitFailed = useCallback(
    (error: unknown) => {
      showNotice(
        t(
          error instanceof ApiError && error.code === 'already_decided'
            ? 'git.requests.alreadyDecided'
            : 'git.requests.actionFailed',
        ),
      );
    },
    [showNotice, t],
  );
  const git = gitRequests && {
    requests: gitRequests.requests,
    canApprove: gitRequests.canApprove,
    hasAccount: gitRequests.hasAccount,
    userId,
    busy: approveGit.isPending || endGit.isPending || connectGit.isPending,
    onApprove: (requestIds: string[]) => {
      approveGit.mutate({ requestIds }, { onError: gitFailed });
    },
    onEnd: (requestId: string, how: 'reject' | 'withdraw') => {
      endGit.mutate({ requestId, how }, { onError: gitFailed });
    },
    onConnect: () => {
      connectGit.mutate(
        { origin: 'account', projectId: project.id },
        {
          onSuccess: ({ url }) => {
            window.location.assign(url);
          },
          onError: gitFailed,
        },
      );
    },
    // The card of a comment shows its review: what will stand in the repository (spec 30c).
    onOpenReview: setOpenReview,
  };
  // Suggestions for the plan wait for owners and editors, like proposals.
  const planSuggestions = readOnly ? 0 : (planState?.suggestions.length ?? 0);

  // A mention in the project that is open and visible is read: the person is looking at it.
  const notifications = useQuery(notificationsQuery).data;
  const { mutate: markRead } = useMarkNotificationsRead();
  const mentionedHere =
    notifications?.notifications.some(
      (notification) =>
        !notification.read &&
        notification.kind === 'mention' &&
        notification.projectId === project.id,
    ) ?? false;
  useEffect(() => {
    if (!mentionedHere) return;
    const read = () => {
      if (document.visibilityState === 'visible') markRead({ projectId: project.id });
    };
    read();
    document.addEventListener('visibilitychange', read);
    return () => {
      document.removeEventListener('visibilitychange', read);
    };
  }, [mentionedHere, markRead, project.id]);
  const teamKeys = useMemo(() => project.agents.map((agent) => agent.key), [project.agents]);

  // "Seit du weg warst" (spec 23): what happened while the user did not have the project open.
  // A decision it lists opens in the decisions section.
  const away = useQuery(awayQuery(project.id)).data ?? null;
  const { mutate: dismissAway } = useDismissAway(project.id);
  const [openDecisionId, setOpenDecisionId] = useState<string | null>(null);

  // The phase of the project (spec 24): owners and editors jump from the phase bar, and everyone
  // gets a note when it changes, whoever changed it.
  const { mutate: setPhase } = useSetPhase(project.id);
  const askFailed = useCallback(() => {
    showNotice(t('phases.askFailed'));
  }, [showNotice, t]);
  const askNextStep = useAskNextStep(project.id, askFailed);
  const shownPhase = useRef({ projectId: project.id, phase: project.phase });
  useEffect(() => {
    const shown = shownPhase.current;
    shownPhase.current = { projectId: project.id, phase: project.phase };
    if (shown.projectId === project.id && shown.phase !== project.phase) {
      showNotice(t('phases.changed', { phase: t(`phases.${project.phase}`) }));
    }
  }, [project.id, project.phase, showNotice, t]);

  // The tabs head the canvas and the plan alike.
  const boardTabs = (activeBoardId: string) => (
    <BoardTabs
      projectId={project.id}
      boards={project.boards}
      activeBoardId={activeBoardId}
      readOnly={readOnly}
      onSelect={(boardId) => selectBoard(boardId)}
      onNotice={showNotice}
      planOpen={planOpen}
      onOpenPlan={() => void openPlan()}
      onOpenHistory={openHistory}
      planOutdated={
        planState !== undefined &&
        planState.outdated !== null &&
        !planState.generating &&
        planState.suggestions.length === 0
      }
    />
  );

  return (
    <AgentDirectoryProvider agents={project.customAgents}>
      <WorkspaceShell
        projectName={project.name}
        settings={{
          stance: project.stance,
          decisionProcess: project.decisionProcess,
          proposalsOnly: project.proposalsOnly,
          observer: project.observer,
          webAccess: project.webAccess,
          language: project.language,
          canChange: project.role === 'owner',
          onChange: (change) => {
            updateProject.mutate(change);
          },
        }}
        repository={{
          projectId: project.id,
          returned: gitReturned,
          onReturnSeen: clearGitReturn,
          reviewId: openReview,
          onReviewClosed: closeReview,
        }}
        showUsage={project.role === 'owner'}
        activePhase={project.phase}
        onSelectPhase={
          readOnly
            ? undefined
            : (phase) => {
                setPhase(phase, {
                  onError: () => {
                    showNotice(t('phases.changeFailed'));
                  },
                });
              }
        }
        onAskNextStep={readOnly ? undefined : askNextStep}
        members={members}
        present={planOpen ? NOBODY : present}
        user={user}
        team={
          <ProjectTeam
            project={project}
            userId={user?.id ?? ''}
            onNotice={showNotice}
            writing={writing}
            raising={raising}
          />
        }
        share={<ProjectShare project={project} userId={user?.id ?? ''} />}
        chat={
          user ? (
            <ChatPanel
              key={project.id}
              projectId={project.id}
              user={{ id: user.id, name: user.name }}
              readOnly={readOnly}
              team={teamKeys}
              members={project.members}
              role={project.role}
              moderatorNeutral={project.stance !== 'opinion'}
              onNotice={showNotice}
              onOpenReference={openReference}
              ask={ask}
            />
          ) : null
        }
        canvas={
          activeBoard && user ? (
            planOpen ? (
              <PlanPanel
                projectId={project.id}
                tabs={boardTabs(activeBoard.id)}
                notice={notice}
                user={{ id: user.id, name: user.name }}
                readOnly={readOnly}
                language={project.language}
                plan={planState}
                onGenerate={readOnly ? undefined : planActions.generate}
                onDecide={readOnly ? undefined : planActions.decide}
                onUpdate={readOnly ? undefined : planActions.update}
                onOpenRoadmap={openRoadmap}
                roadmapBusy={roadmapOpening.isPending}
                tasks={planTasks}
                projectName={project.name}
                onExportFailed={exportFailed}
              />
            ) : (
              <RoadmapProvider value={roadmapSource}>
                <CanvasPanel
                  boardId={activeBoard.id}
                  tabs={boardTabs(activeBoard.id)}
                  notice={notice}
                  user={{ id: user.id, name: user.name }}
                  members={project.members}
                  readOnly={readOnly}
                  proposals={proposals}
                  onDecide={decide}
                  canAdoptVariants={canConfirmDecisions}
                  focusId={focus}
                  onFocused={clearFocus}
                  onFocusMissing={focusMissing}
                  onAsk={readOnly ? undefined : setAsk}
                  exports={boardExports}
                  onPresence={showPresence}
                />
              </RoadmapProvider>
            )
          ) : null
        }
        overview={
          <>
            {away ? (
              <SinceYouWereAway
                summary={away}
                waiting={waitingCount({
                  proposals,
                  hands: waitingHands,
                  votes: votesToCast,
                  planSuggestions,
                  gitRequests: gitRequestsToDecide(git),
                  canDecide: !readOnly,
                  canConfirmDecisions,
                })}
                onOpenDecision={setOpenDecisionId}
                onOpenBoard={(boardId) => void selectBoard(boardId)}
                onOpenPlan={planOpen ? undefined : () => void openPlan()}
                onDismiss={() => {
                  dismissAway();
                }}
              />
            ) : null}
            {proposals.length > 0 ||
            decided.length > 0 ||
            waitingHands.length > 0 ||
            votesToCast.length > 0 ||
            planSuggestions > 0 ||
            (git?.requests.length ?? 0) > 0 ||
            reviews.length > 0 ? (
              <WaitingForYou
                git={git}
                reviews={reviews}
                onOpenReview={setOpenReview}
                planSuggestions={planSuggestions}
                onOpenPlan={planOpen ? undefined : () => void openPlan()}
                proposals={proposals}
                decided={decided}
                hands={waitingHands}
                onHand={decideHand}
                votes={votesToCast}
                onVote={castVote}
                voters={project.members.filter((member) => member.role !== 'viewer').length}
                canDecide={!readOnly}
                canConfirmDecisions={canConfirmDecisions}
                onDecide={decide}
                activeBoardId={activeBoard?.id ?? null}
                onOpenBoard={(boardId) => void selectBoard(boardId)}
              />
            ) : null}
            <DecisionsOverview
              key={project.id}
              projectId={project.id}
              comparing={comparing}
              readOnly={readOnly}
              onNotice={showNotice}
              openDecisionId={openDecisionId}
              onOpenDecision={setOpenDecisionId}
            />
          </>
        }
      />
      <Dialog open={historyOpen && activeBoard !== undefined} onOpenChange={setHistoryOpen}>
        {/* Mounted only while open: the history is loaded then. */}
        {historyOpen && activeBoard ? (
          <BoardHistoryDialog
            projectId={project.id}
            boardId={activeBoard.id}
            onOpenElement={(nodeId) => {
              setHistoryOpen(false);
              openElement(activeBoard.id, nodeId);
            }}
          />
        ) : null}
      </Dialog>
    </AgentDirectoryProvider>
  );
}

const NO_PROPOSALS: Proposal[] = [];
const NO_HANDS: HandRaise[] = [];
const NO_VOTES: OpenVote[] = [];
const NO_DECISIONS: DecidedProposal[] = [];
const NOBODY: ReadonlySet<string> = new Set();

function mainBoardId(project: ProjectDetails): string | undefined {
  return project.boards.find((board) => board.kind === 'main')?.id;
}
