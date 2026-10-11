import {
  HISTORY_ACTIONS,
  HISTORY_DAYS,
  type BoardHistoryEntry,
  type BoardHistoryItem,
  type HistoryElementKind,
} from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { Frame, MoveRight, Square, StickyNote, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
import { FieldError } from '@web/components/ui/input';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { useAgents } from '@web/features/agents/agents';
import { boardHistoryQuery } from '@web/features/canvas/history-queries';
import { cn } from '@web/lib/cn';
import { formatRelativeTime, initialsOf } from '@web/lib/format';

/** How many elements an entry names before "show more". */
const ELEMENTS_SHOWN = 8;

const KIND_ICON: Record<HistoryElementKind, LucideIcon> = {
  block: Square,
  sticky: StickyNote,
  frame: Frame,
  edge: MoveRight,
};

/**
 * The dialog "Verlauf" of a board (spec 38a; derived look): what changed on it, the newest entry
 * first, each with who did it, what and when, and the elements it is about. An element that is
 * still on the board leads there. The content of a dialog; the caller opens and closes it.
 */
export function BoardHistoryDialog({
  projectId,
  boardId,
  onOpenElement,
}: {
  projectId: string;
  boardId: string;
  /** Brings an element of the board into view; the caller closes the dialog. */
  onOpenElement: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const history = useQuery(boardHistoryQuery(projectId, boardId));

  return (
    <DialogContent
      title={t('history.title')}
      description={t('history.hint', { days: HISTORY_DAYS })}
      className="w-[min(560px,calc(100vw-32px))]"
    >
      {!history.data ? (
        history.isError ? (
          <FieldError>{t('history.loadFailed')}</FieldError>
        ) : (
          <p role="status" className="m-0 text-ui text-text-3">
            {t('common.loading')}
          </p>
        )
      ) : history.data.entries.length === 0 ? (
        <p className="m-0 text-ui leading-snug text-text-2">{t('history.empty')}</p>
      ) : (
        <ol
          aria-label={t('history.title')}
          className="m-0 flex max-h-[min(480px,60vh)] list-none flex-col overflow-y-auto p-0 pr-1"
        >
          {history.data.entries.map((entry) => (
            <HistoryEntry key={entry.id} entry={entry} onOpenElement={onOpenElement} />
          ))}
        </ol>
      )}

      <div className="mt-4 flex justify-end">
        <DialogClose asChild>
          <Button variant="ghost">{t('common.close')}</Button>
        </DialogClose>
      </div>
    </DialogContent>
  );
}

function HistoryEntry({
  entry,
  onOpenElement,
}: {
  entry: BoardHistoryEntry;
  onOpenElement: (nodeId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const agents = useAgents();
  const [open, setOpen] = useState(false);
  const { actor } = entry;
  const agent = actor.kind === 'agent' ? agents(actor.agentKey) : null;
  const name =
    agent?.name ?? ((actor.kind === 'human' ? actor.name.trim() : '') || t('history.someone'));
  // What happened, in numbers: "4 hinzugefügt, 1 entfernt". The elements below say what.
  const counts = HISTORY_ACTIONS.flatMap((action) => {
    const count = entry.items.filter((item) => item.action === action).length;
    return count > 0 ? [t(`history.counts.${action}`, { count })] : [];
  });
  const shown = open ? entry.items : entry.items.slice(0, ELEMENTS_SHOWN);
  const hidden = entry.items.length - ELEMENTS_SHOWN;

  return (
    <li className="flex gap-2.5 border-b border-border-soft py-3 first:pt-0 last:border-b-0">
      <span aria-hidden="true" className="mt-px shrink-0">
        {agent ? (
          <AgentAvatar agent={agent} size={24} />
        ) : (
          <Avatar
            kind="human"
            size={24}
            label={name}
            initials={actor.kind === 'human' ? initialsOf(name) : '?'}
          />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="m-0 min-w-0 text-ui leading-snug text-text-2">
            <span className="font-semibold text-text">{name}</span>
            {' · '}
            {counts.join(', ')}
          </p>
          <time
            dateTime={entry.at}
            title={new Intl.DateTimeFormat(i18n.language, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(entry.at))}
            className="shrink-0 text-meta text-text-4"
          >
            {formatRelativeTime(entry.at, i18n.language)}
          </time>
        </div>
        {HISTORY_ACTIONS.map((action) => {
          const items = shown.filter((item) => item.action === action);
          if (items.length === 0) return null;
          return (
            <div key={action} className="flex items-start gap-2">
              <span className="w-[76px] shrink-0 pt-[3px] text-meta text-text-3">
                {t(`history.actions.${action}`)}
              </span>
              <ul className="m-0 flex min-w-0 flex-1 list-none flex-wrap gap-1.5 p-0">
                {items.map((item) => (
                  <li key={item.id} className="max-w-full">
                    <HistoryElement item={item} onOpen={onOpenElement} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {hidden > 0 ? (
          <div>
            <Button
              size="s"
              variant="ghost"
              aria-expanded={open}
              className="-ml-2.5"
              onClick={() => {
                setOpen((expanded) => !expanded);
              }}
            >
              {open ? t('history.less') : t('history.more', { count: hidden })}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * One element of an entry: its kind as an icon and its name. An element that is still on the
 * board is a button that leads to it; one that was removed is struck through. Arrows are named
 * and lead nowhere: the board brings blocks, notes and frames into view.
 */
function HistoryElement({
  item,
  onOpen,
}: {
  item: BoardHistoryItem;
  onOpen: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[item.kind];
  const name = item.label.trim() || t(`history.kinds.${item.kind}`);
  const className = cn(
    'inline-flex h-[22px] max-w-full items-center gap-1 rounded-sm border px-1.5 text-small leading-none whitespace-nowrap',
    item.action === 'removed'
      ? 'border-border-soft bg-bg-muted text-text-3 line-through'
      : 'border-border-strong bg-bg-panel text-text-2',
  );
  const content = (
    <>
      <Icon size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{name}</span>
    </>
  );

  if (!item.present || item.kind === 'edge') {
    return (
      <span className={className} title={t(`history.kinds.${item.kind}`)}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={t('history.goTo', { name })}
      className={cn(
        className,
        'cursor-pointer hover:border-edge hover:bg-bg-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink',
      )}
      onClick={() => {
        onOpen(item.id);
      }}
    >
      {content}
    </button>
  );
}
