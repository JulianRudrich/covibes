import type { Notification } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  AtSign,
  Bell,
  ClipboardCheck,
  LogOut,
  UserPlus,
  UserRoundCog,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@web/components/ui/popover';
import { notificationsQuery, useMarkNotificationsRead } from '@web/features/notifications/queries';
import { cn } from '@web/lib/cn';
import { formatRelativeTime } from '@web/lib/format';

const ICONS: Record<Notification['kind'], LucideIcon> = {
  mention: AtSign,
  role_changed: UserRoundCog,
  removed: LogOut,
  joined: UserPlus,
  task_assigned: ClipboardCheck,
};

const BOLD = { b: <strong className="font-semibold text-text" /> };

/**
 * The bell in the header (spec 22a, derived look): the number of unread notifications, and a list
 * of what happened for the person across all projects. A notification opens its project and is
 * read then; one about a removal has no project to open.
 */
export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const list = useQuery(notificationsQuery).data;
  const markRead = useMarkNotificationsRead();
  const unread = list?.unread ?? 0;
  const notifications = list?.notifications ?? [];

  function openNotification(notification: Notification) {
    if (!notification.read) markRead.mutate({ ids: [notification.id] });
    if (notification.kind === 'removed') return;
    setOpen(false);
    void navigate({
      to: '/p/$projectId',
      params: { projectId: notification.projectId },
      // A task is read where it stands: in the plan.
      search: notification.kind === 'task_assigned' ? { view: 'plan' } : {},
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          unread > 0 ? t('notifications.openUnread', { count: unread }) : t('notifications.open')
        }
        className="relative grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-full text-text-2 transition-colors hover:bg-wash hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <Bell size={17} strokeWidth={1.9} aria-hidden="true" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-0 right-0 grid h-4 min-w-4 place-items-center rounded-[8px] bg-ink px-1 text-[10px] leading-none font-semibold text-on-ink tabular-nums"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        aria-label={t('notifications.title')}
        className="flex max-h-[min(70vh,520px)] w-[min(360px,calc(100vw-24px))] flex-col p-0"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3.5 py-2.5">
          <h2 className="m-0 text-ui font-semibold text-text">{t('notifications.title')}</h2>
          {unread > 0 ? (
            <button
              type="button"
              className="cursor-pointer rounded-xs text-meta text-text-3 underline-offset-2 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-ink"
              onClick={() => {
                markRead.mutate({ all: true });
              }}
            >
              {t('notifications.readAll')}
            </button>
          ) : null}
        </div>
        {notifications.length === 0 ? (
          <p className="m-0 px-3.5 py-6 text-center text-small text-text-3">
            {t('notifications.empty')}
          </p>
        ) : (
          <ul className="m-0 min-h-0 list-none overflow-y-auto p-1.5">
            {notifications.map((notification) => {
              const Icon = ICONS[notification.kind];
              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-ink',
                      notification.kind === 'removed' && notification.read && 'cursor-default',
                    )}
                    onClick={() => {
                      openNotification(notification);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-bg-subtle text-text-2"
                    >
                      <Icon size={13} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className={cn(
                          'text-small leading-snug',
                          notification.read ? 'text-text-3' : 'text-text-body',
                        )}
                      >
                        <Trans
                          i18nKey={`notifications.kinds.${notification.kind}`}
                          values={{
                            name: notification.actorName || t('notifications.someone'),
                            project: notification.projectName,
                            role: notification.role ? t(`projects.roles.${notification.role}`) : '',
                          }}
                          components={BOLD}
                        />
                      </span>
                      {notification.excerpt ? (
                        <span className="line-clamp-2 text-meta leading-snug text-text-3">
                          {notification.excerpt}
                        </span>
                      ) : null}
                      <span className="text-meta text-text-4 tabular-nums">
                        {formatRelativeTime(notification.createdAt, i18n.language)}
                      </span>
                    </span>
                    {notification.read ? null : (
                      <span
                        role="img"
                        aria-label={t('notifications.unread')}
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-ink"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
