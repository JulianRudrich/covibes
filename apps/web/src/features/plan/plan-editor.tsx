import {
  PLAN_FIELD,
  planDocumentName,
  planSectionHint,
  planTemplate,
  type AwarenessUser,
  type PlanLanguage,
  type RoadmapAssignee,
  type RoadmapIssue,
} from '@covibes/shared';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Dialog, DialogContent } from '@web/components/ui/dialog';
import { TargetDecisionLinksContent } from '@web/features/decisions/decision-links';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import type { BoardConnection } from '@web/features/canvas/board-connection';
import { Sparkle } from '@web/features/canvas/node-chrome';
import { SaveStatus } from '@web/features/canvas/save-status';
import { useCollabDoc } from '@web/features/canvas/use-board-doc';
import { PlanSections } from '@web/features/plan/plan-sections';
import {
  NO_PLAN_TASKS,
  PlanTasks,
  planTasksKey,
  type PlanTasksState,
} from '@web/features/plan/plan-tasks';
import { PlanToolbar } from '@web/features/plan/plan-toolbar';
import { usePlanText, type PlanText } from '@web/features/plan/use-plan-text';
import { AssigneeItems } from '@web/features/roadmap/assignee-menu';
import type { TaskAssigning } from '@web/features/roadmap/roadmap-context';

/** The tasks of the plan (spec 26b): who took which, and for owners and editors how to assign. */
export type PlanTaskAssignments = {
  /** The tasks by their id; null: nobody took it. */
  assignees: ReadonlyMap<string, RoadmapAssignee | null>;
  /** The issues of tasks in the repository (spec 30a); missing where there are none. */
  issues?: ReadonlyMap<string, RoadmapIssue>;
  assigning?: TaskAssigning;
};

const NO_TASKS: PlanTaskAssignments['assignees'] = new Map();
const NO_ISSUES: ReadonlyMap<string, RoadmapIssue> = new Map();

type PlanEditorProps = {
  projectId: string;
  user: AwarenessUser;
  /** Viewers read the plan but cannot change it. */
  readOnly: boolean;
  /** The project's language, in which the template is written. */
  language: PlanLanguage;
  /**
   * Shown above the document, e.g. the moderator's suggestions (spec 25b). It gets the plan as it
   * stands, to compare with (spec 25c).
   */
  above?: (plan: PlanText) => ReactNode;
  /** At the right end of the toolbar, before "Plan erzeugen": e.g. "Versionen" (spec 25c). */
  toolbarEnd?: (plan: PlanText) => ReactNode;
  /**
   * "Plan erzeugen" (spec 25b), for owners and editors. `busy` says that the moderator writes or
   * that its suggestions wait; then the button rests and an empty plan needs no start help.
   */
  generation?: { busy: boolean; onGenerate: () => void };
  /** Shown at the tasks of the milestones; undefined until the roadmap is loaded. */
  tasks?: PlanTaskAssignments;
  decisionLinks?: { onOpenDecision: (id: string) => void };
  taskFocus?: string;
  onTaskFocused?: () => void;
  onTaskMissing?: () => void;
};

/** The caret of another person: a line in the human color with their name above it. */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'plan-caret';
  const label = document.createElement('span');
  label.className = 'plan-caret-label';
  label.textContent = typeof user.name === 'string' ? user.name : '';
  caret.append(label);
  return caret;
}

function Message({ children }: { children: string }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center text-ui text-text-3">
      {children}
    </div>
  );
}

/**
 * The plan of a project as a shared document (spec 25a): Tiptap on the plan's Y.Doc, connected
 * like a board. It loads the document, says so when the server refuses it, and shows the hint of
 * the canvas while the connection is interrupted.
 */
export function PlanEditor({ projectId, ...plan }: PlanEditorProps) {
  const { t } = useTranslation();
  const { connection, status, loaded, denied, persistence } = useCollabDoc(
    planDocumentName(projectId),
  );

  if (denied) return <Message>{t('plan.denied')}</Message>;
  if (!connection || !loaded) return <Message>{t('plan.loading')}</Message>;
  return (
    <>
      <PlanDocument key={projectId} projectId={projectId} connection={connection} {...plan} />
      <SaveStatus state={persistence} retry={connection.retryPersistence} />
      {status !== 'connected' ? (
        <div
          role="status"
          className="absolute top-3 left-1/2 z-10 flex h-[26px] -translate-x-1/2 items-center gap-2 rounded-[13px] bg-bg-muted px-3 text-status text-text-2 shadow-float"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-text-3" aria-hidden="true" />
          {t('canvas.reconnecting')}
        </div>
      ) : null}
    </>
  );
}

function PlanDocument({
  projectId,
  connection,
  user,
  readOnly,
  language,
  above,
  toolbarEnd,
  generation,
  tasks,
  decisionLinks,
  taskFocus,
  onTaskFocused,
  onTaskMissing,
}: PlanEditorProps & { connection: BoardConnection }) {
  const { t } = useTranslation();
  // The task whose menu is open, and where its button stands on the screen.
  const [picking, setPicking] = useState<{ taskId: string; at: DOMRect } | null>(null);
  const [decisionTask, setDecisionTask] = useState<string | null>(null);
  const pick = useCallback((taskId: string, anchor: HTMLElement) => {
    setPicking({ taskId, at: anchor.getBoundingClientRect() });
  }, []);
  // What the editor shows at its tasks; it reads this whenever it draws them.
  const taskState = useRef<PlanTasksState>(NO_PLAN_TASKS);
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // Undo follows the shared document, so it takes back one's own changes only.
          undoRedo: false,
          heading: { levels: [2, 3] },
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
          link: false,
          strike: false,
          underline: false,
        }),
        PlanSections.configure({ hint: (section) => planSectionHint(section, language) }),
        PlanTasks.configure({ read: () => taskState.current }),
        Collaboration.configure({ document: connection.doc, field: PLAN_FIELD }),
        CollaborationCaret.configure({
          provider: connection.provider,
          user: { id: user.id, name: user.name },
          render: renderCaret,
          selectionRender: () => ({ class: 'plan-selection' }),
        }),
      ],
      editable: !readOnly,
      editorProps: {
        attributes: {
          class: 'plan-doc',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': t('plan.label'),
        },
      },
    },
    [connection, language],
  );

  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // The tasks show who took them; the editor draws them anew whenever that changes.
  const assignees = tasks?.assignees ?? NO_TASKS;
  const issues = tasks?.issues ?? NO_ISSUES;
  const canAssign = tasks?.assigning !== undefined;
  useEffect(() => {
    if (editor.isDestroyed) return;
    taskState.current = {
      assignees,
      issues,
      onPick: canAssign ? pick : null,
      decisionLinks: decisionLinks
        ? { onOpen: setDecisionTask, label: t('decisionLinks.behindThis') }
        : undefined,
      labels: {
        assign: t('roadmap.assign.short'),
        assignedTo: (name) => t('roadmap.assign.assignedTo', { name }),
        teamMember: t('shareView.teamMember'),
        issue: (issue) =>
          t(issue.closed ? 'roadmap.issue.closed' : 'roadmap.issue.open', {
            number: issue.number,
          }),
      },
    };
    editor.view.dispatch(editor.state.tr.setMeta(planTasksKey, true));
  }, [editor, assignees, issues, canAssign, pick, t, decisionLinks]);

  useEffect(() => {
    if (!taskFocus || editor.isDestroyed) return;
    const element = [...editor.view.dom.querySelectorAll<HTMLElement>('[data-task-id]')].find(
      (candidate) => candidate.getAttribute('data-task-id') === taskFocus,
    );
    if (!element) {
      onTaskMissing?.();
      return;
    }
    element.tabIndex = -1;
    element.scrollIntoView({ block: 'center' });
    element.focus({ preventScroll: true });
    onTaskFocused?.();
  }, [editor, taskFocus, onTaskFocused, onTaskMissing]);

  const empty = useEditorState({ editor, selector: ({ editor: current }) => current.isEmpty });
  const plan = usePlanText(connection.doc);
  const extra = toolbarEnd?.(plan);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Dialog
        open={decisionTask !== null}
        onOpenChange={(open) => {
          if (!open) setDecisionTask(null);
        }}
      >
        {decisionTask && decisionLinks ? (
          <DialogContent
            title={t('decisionLinks.behindThis')}
            className="w-[min(480px,calc(100vw-32px))]"
          >
            <TargetDecisionLinksContent
              projectId={projectId}
              target={{ kind: 'task', id: decisionTask }}
              readOnly={readOnly}
              onNavigate={(id) => {
                setDecisionTask(null);
                decisionLinks.onOpenDecision(id);
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
      {readOnly ? (
        // Viewers format nothing, but read the versions.
        extra ? (
          <div className="mx-3 mt-3 flex h-11 shrink-0 items-center justify-end gap-1.5 rounded-full bg-bg-panel px-2 shadow-block">
            {extra}
          </div>
        ) : null
      ) : (
        <PlanToolbar
          editor={editor}
          end={
            <>
              {extra}
              {generation ? (
                <Button size="s" disabled={generation.busy} onClick={generation.onGenerate}>
                  <Sparkle />
                  {t('plan.generate')}
                </Button>
              ) : null}
            </>
          }
        />
      )}
      {picking && tasks?.assigning ? (
        // The button of a task belongs to the editor; the menu opens from where it stands.
        <DropdownMenu
          open
          onOpenChange={(open) => {
            if (!open) setPicking(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none fixed"
              style={{
                left: picking.at.left,
                top: picking.at.top,
                width: picking.at.width,
                height: picking.at.height,
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[220px]"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
            }}
          >
            <AssigneeItems
              current={assignees.get(picking.taskId) ?? null}
              assigning={tasks.assigning}
              onDone={(next) => {
                const current = assignees.get(picking.taskId) ?? null;
                if (next?.userId !== current?.userId) {
                  tasks.assigning?.onAssign(picking.taskId, next);
                }
              }}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-3 pt-3 pb-4">
          {above?.(plan)}
          {/* The document as a sheet on the canvas color (spec 36d). */}
          <div className="flex flex-col gap-4 rounded-surface bg-bg-panel px-12 py-10 shadow-panel">
            {empty && !generation?.busy ? (
              <div className="flex flex-col items-start gap-2.5 rounded-card bg-bg-subtle p-4">
                <div className="font-display text-display font-semibold text-text">
                  {t('plan.empty.title')}
                </div>
                <p className="m-0 text-body leading-normal text-text-body">
                  {t(
                    readOnly
                      ? 'plan.empty.readOnly'
                      : generation
                        ? 'plan.empty.textGenerate'
                        : 'plan.empty.text',
                  )}
                </p>
                {readOnly ? null : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      size="s"
                      onClick={() => {
                        editor
                          .chain()
                          .setContent(planTemplate(language))
                          // The caret goes below the first heading, where the writing starts.
                          .command(({ tr }) => {
                            const heading = tr.doc.firstChild;
                            if (heading) {
                              tr.setSelection(
                                TextSelection.near(tr.doc.resolve(heading.nodeSize + 1)),
                              );
                            }
                            return true;
                          })
                          .focus()
                          .run();
                      }}
                    >
                      {t('plan.empty.template')}
                    </Button>
                    {generation ? (
                      <Button size="s" onClick={generation.onGenerate}>
                        <Sparkle />
                        {t('plan.generate')}
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  );
}
