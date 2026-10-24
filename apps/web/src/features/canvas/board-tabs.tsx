import {
  BOARD_TITLE_MAX_LENGTH,
  boardTitleSchema,
  MAX_BOARDS_PER_PROJECT,
  type ProjectBoard,
} from '@covibes/shared';
import { ChevronDown, FileText, History, Plus } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@web/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { Tooltip } from '@web/components/ui/tooltip';
import { BOARD_PANEL_ID, boardTabId } from '@web/features/canvas/board-ids';
import { useFocusOnMount } from '@web/features/canvas/in-place-editing';
import { PLAN_PANEL_ID } from '@web/features/plan/plan-ids';
import { useBoardMutations } from '@web/features/projects/queries';
import { ApiError } from '@web/lib/api';
import { cn } from '@web/lib/cn';

type BoardTabsProps = {
  projectId: string;
  /** In their order, the main canvas first. */
  boards: readonly ProjectBoard[];
  activeBoardId: string;
  /** Viewers only switch between the boards. */
  readOnly: boolean;
  /** Opens a board; resolves once the address shows it. */
  onSelect: (boardId: string) => Promise<void>;
  /** A short note over the canvas, e.g. why something did not work. */
  onNotice: (text: string) => void;
  /** The project plan is open in place of a board (spec 25a). */
  planOpen?: boolean;
  /** Opens the project plan; without it there is no button for it. */
  onOpenPlan?: () => void;
  /** Decisions changed since the plan was written (spec 25c): the button carries a dot. */
  planOutdated?: boolean;
  /** Opens the history of the open board (spec 38a); without it there is no button for it. */
  onOpenHistory?: () => void;
};

const FOCUS_RING =
  'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink';

/**
 * The board tabs in the canvas header (spec 11; handoff "Canvas", header). The main canvas comes
 * first and stays as it is. Editors add boards with "+ Board", rename them by double-click and
 * open a menu with "Umbenennen" and "Löschen" by right-click or the chevron of the open board.
 * At the end of the row, "Projektplan" opens the plan in place of the canvas (spec 25a).
 */
export function BoardTabs({
  projectId,
  boards,
  activeBoardId,
  readOnly,
  onSelect,
  onNotice,
  planOpen = false,
  onOpenPlan,
  onOpenHistory,
  planOutdated = false,
}: BoardTabsProps) {
  const { t } = useTranslation();
  const { create, rename, remove } = useBoardMutations(projectId);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProjectBoard | null>(null);
  const tabList = useRef<HTMLDivElement>(null);
  // Set when a menu item hands the focus on (to the title field or the dialog), so the closing
  // menu does not take it back to its trigger.
  const focusHandedOver = useRef(false);

  const limitNote = t('canvas.boards.limit', { max: MAX_BOARDS_PER_PROJECT });
  const failed = () => {
    onNotice(t('canvas.boards.failed'));
  };

  function add() {
    if (boards.length >= MAX_BOARDS_PER_PROJECT) {
      onNotice(limitNote);
      return;
    }
    create.mutate(undefined, {
      onSuccess: (board) => void onSelect(board.id),
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'limit_reached') onNotice(limitNote);
        else failed();
      },
    });
  }

  function saveTitle(board: ProjectBoard, value: string) {
    setRenamingId(null);
    const title = boardTitleSchema.safeParse(value);
    // An empty title keeps the old one.
    if (!title.success || title.data === board.title) return;
    rename.mutate({ boardId: board.id, title: title.data }, { onError: failed });
  }

  async function deleteBoard(board: ProjectBoard) {
    setDeleting(null);
    // The main canvas opens first, so the board does not vanish under the person deleting it.
    const main = boards.find((entry) => entry.kind === 'main');
    if (!planOpen && board.id === activeBoardId && main) await onSelect(main.id);
    remove.mutate(board.id, { onError: failed });
  }

  // Arrow keys, Home and End move between the tabs; Enter or Space opens one (WAI-ARIA tabs with
  // manual activation, since opening a board connects to its canvas).
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = [...(tabList.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    if (current < 0) return;
    const next =
      event.key === 'ArrowRight'
        ? (current + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (current - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    tabs[next]?.focus();
  }

  return (
    <>
      <div
        ref={tabList}
        role="tablist"
        aria-label={t('canvas.boards.label')}
        // The padding keeps the shadow of the open tab from being cut off by the scrolling.
        className="-mx-2 -my-3 flex min-w-0 items-center gap-1 overflow-x-auto px-2 py-3 [scrollbar-width:none]"
        onKeyDown={onKeyDown}
      >
        {boards.map((board, index) => {
          // While the plan is open no board is: its tab opens the board again.
          const active = !planOpen && board.id === activeBoardId;
          const editable = !readOnly && board.kind === 'extra';
          const title = board.kind === 'main' ? t('workspace.mainCanvas') : board.title;
          if (editable && renamingId === board.id) {
            return (
              <TitleField
                key={board.id}
                initial={board.title}
                label={t('canvas.boards.titleLabel')}
                onSave={(value) => {
                  saveTitle(board, value);
                }}
                onCancel={() => {
                  setRenamingId(null);
                }}
              />
            );
          }
          return (
            <div
              key={board.id}
              className={cn(
                'relative flex h-[34px] shrink-0 items-center rounded-full transition-colors',
                active
                  ? 'bg-bg-panel font-semibold text-text shadow-block'
                  : // A tab whose menu is open stays highlighted, as on hover.
                    cn(
                      'font-medium text-text-2 hover:bg-wash hover:text-text',
                      menuId === board.id && 'bg-wash text-text',
                    ),
              )}
            >
              <button
                type="button"
                role="tab"
                id={boardTabId(board.id)}
                aria-selected={active}
                aria-controls={active ? BOARD_PANEL_ID : undefined}
                tabIndex={active || (planOpen && index === 0) ? 0 : -1}
                className={cn(
                  'flex h-full max-w-[200px] cursor-pointer items-center rounded-full text-ui whitespace-nowrap',
                  FOCUS_RING,
                  active ? 'px-4' : 'px-3.5',
                  active && editable && 'pr-1',
                )}
                onClick={() => {
                  if (!active) void onSelect(board.id);
                }}
                onDoubleClick={
                  editable
                    ? () => {
                        setRenamingId(board.id);
                      }
                    : undefined
                }
                onContextMenu={
                  editable
                    ? (event) => {
                        event.preventDefault();
                        setMenuId(board.id);
                      }
                    : undefined
                }
              >
                <span className="truncate">{title}</span>
              </button>
              {editable ? (
                <DropdownMenu
                  open={menuId === board.id}
                  onOpenChange={(open) => {
                    setMenuId(open ? board.id : null);
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    {active ? (
                      <button
                        type="button"
                        aria-label={t('canvas.boards.menu', { title })}
                        className={cn(
                          'mr-1.5 grid size-6 cursor-pointer place-items-center rounded-full text-text-3 hover:bg-wash hover:text-text',
                          FOCUS_RING,
                        )}
                      >
                        <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
                      </button>
                    ) : (
                      // Right-click on another tab opens its menu below it.
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-0 left-0 h-0 w-full"
                      />
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    onCloseAutoFocus={(event) => {
                      if (!focusHandedOver.current) return;
                      focusHandedOver.current = false;
                      event.preventDefault();
                    }}
                  >
                    <DropdownMenuItem
                      onSelect={() => {
                        focusHandedOver.current = true;
                        setRenamingId(board.id);
                      }}
                    >
                      {t('canvas.boards.rename')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-danger"
                      onSelect={() => {
                        focusHandedOver.current = true;
                        setDeleting(board);
                      }}
                    >
                      {t('canvas.boards.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          );
        })}
      </div>

      {readOnly ? null : (
        <Tooltip content={t('canvas.boards.addLabel')}>
          <button
            type="button"
            aria-label={t('canvas.boards.addLabel')}
            className={cn(
              'grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-full text-text-2 transition-colors hover:bg-wash hover:text-text',
              FOCUS_RING,
            )}
            disabled={create.isPending}
            onClick={add}
          >
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </Tooltip>
      )}

      {/* The history belongs to the board that is open, so the plan has none here. */}
      {onOpenHistory && !planOpen ? (
        <button
          type="button"
          aria-label={t('history.open')}
          title={t('history.open')}
          className={cn(
            'ml-auto flex h-[34px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-ui font-medium whitespace-nowrap text-text-2 transition-colors hover:bg-wash hover:text-text',
            FOCUS_RING,
          )}
          onClick={onOpenHistory}
        >
          <History size={15} strokeWidth={1.9} aria-hidden="true" />
          {t('history.button')}
        </button>
      ) : null}
      {onOpenPlan ? (
        <button
          type="button"
          aria-pressed={planOpen}
          aria-controls={planOpen ? PLAN_PANEL_ID : undefined}
          className={cn(
            'flex h-[34px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-ui whitespace-nowrap transition-colors',
            // Pushed to the end of the row, unless the history's button already is.
            onOpenHistory && !planOpen ? '' : 'ml-auto',
            FOCUS_RING,
            planOpen
              ? 'bg-bg-panel font-semibold text-text shadow-block'
              : 'font-medium text-text-2 hover:bg-wash hover:text-text',
          )}
          onClick={() => {
            if (!planOpen) onOpenPlan();
          }}
        >
          <FileText size={15} strokeWidth={1.9} aria-hidden="true" />
          {t('plan.tab')}
          {planOutdated ? (
            <>
              <span aria-hidden="true" className="size-1.5 rounded-full bg-ink" />
              <span className="sr-only">, {t('plan.outdated.dot')}</span>
            </>
          ) : null}
        </button>
      ) : null}

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        {deleting ? (
          <DialogContent
            title={t('canvas.boards.deleteTitle', { title: deleting.title })}
            description={t('canvas.boards.deleteText')}
          >
            <div className="mt-2 flex justify-end gap-2">
              <DialogClose asChild>
                <Button>{t('common.cancel')}</Button>
              </DialogClose>
              <Button variant="danger" onClick={() => void deleteBoard(deleting)}>
                {t('canvas.boards.deleteConfirm')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

/** The title of a board, edited in place: Enter or leaving the field saves, Escape cancels. */
function TitleField({
  initial,
  label,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  const input = useFocusOnMount<HTMLInputElement>();

  return (
    <input
      ref={input}
      aria-label={label}
      value={value}
      maxLength={BOARD_TITLE_MAX_LENGTH}
      className="h-[34px] max-w-[200px] min-w-[96px] shrink-0 rounded-full border border-ink bg-bg-panel px-4 text-ui font-semibold text-text outline-none field-sizing-content"
      onChange={(event) => {
        setValue(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finished.current = true;
          onSave(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finished.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!finished.current) onSave(value);
      }}
    />
  );
}

/**
 * The row of the board tabs: over the canvas it floats and lets clicks between its pills through;
 * over the plan it is the panel's header row.
 */
export function CanvasTabsRow({
  floating = false,
  children,
}: {
  floating?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1',
        floating
          ? 'pointer-events-none absolute inset-x-3 top-3 z-10 *:pointer-events-auto'
          : 'px-3',
      )}
    >
      {children}
    </div>
  );
}
