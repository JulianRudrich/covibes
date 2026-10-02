import type {
  MarkNotificationsReadInput,
  NotificationList,
  NotificationSettings,
} from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@web/lib/api';

/** How often the bell asks: there is no person-wide live channel yet (spec 22a). */
const REFRESH_MS = 30_000;

/** The notifications of the signed-in person, newest first, with how many are unread. */
export const notificationsQuery = queryOptions({
  queryKey: ['notifications'] as const,
  queryFn: () => api<NotificationList>('/notifications'),
  refetchInterval: REFRESH_MS,
  refetchOnWindowFocus: true,
});

/** Which notifications of a list a "mark as read" covers. */
function covers(
  target: MarkNotificationsReadInput,
  notification: NotificationList['notifications'][number],
) {
  if ('all' in target) return true;
  if ('ids' in target) return target.ids.includes(notification.id);
  return notification.projectId === target.projectId && notification.kind === 'mention';
}

/** Marks notifications as read: shown at once, then loaded again from the server. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  const { queryKey } = notificationsQuery;
  return useMutation({
    mutationFn: (target: MarkNotificationsReadInput) =>
      api<undefined>('/notifications/read', { method: 'POST', body: JSON.stringify(target) }),
    onMutate: async (target) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, (list) => {
        if (!list) return list;
        const notifications = list.notifications.map((notification) =>
          !notification.read && covers(target, notification)
            ? { ...notification, read: true }
            : notification,
        );
        const marked = notifications.filter(
          (notification, index) => notification.read && !list.notifications[index]?.read,
        ).length;
        return { notifications, unread: Math.max(0, list.unread - marked) };
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey, exact: true }),
  });
}

/** Whether Covibes also tells the person by mail what they have not seen (spec 22b). */
export const notificationSettingsQuery = queryOptions({
  queryKey: ['notifications', 'settings'] as const,
  queryFn: () => api<NotificationSettings>('/notifications/settings'),
  staleTime: Infinity,
});

/** Turns the mails on or off: shown at once, taken back if the server refuses. */
export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  const { queryKey } = notificationSettingsQuery;
  return useMutation({
    mutationFn: (settings: NotificationSettings) =>
      api<NotificationSettings>('/notifications/settings', {
        method: 'PATCH',
        body: JSON.stringify(settings),
      }),
    onMutate: async (settings) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, settings);
      return { previous };
    },
    onError: (_error, _settings, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKey, settings);
    },
  });
}
