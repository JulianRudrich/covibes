import { z } from 'zod';

import { messageVoteSchema } from './decisions';
import { PROJECT_ROLES } from './projects';

// Notifications in the app (spec 22a): what happened for a person while they looked elsewhere.

/**
 * `mention`: someone mentioned the person in a chat. `role_changed` and `removed`: an owner
 * changed their role or removed them. `joined`: someone joined a project the person owns.
 * `task_assigned`: someone gave the person a task of the plan (spec 26b).
 */
export const NOTIFICATION_KINDS = [
  'mention',
  'role_changed',
  'removed',
  'joined',
  'task_assigned',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** How many of the latest notifications the bell shows. */
export const NOTIFICATION_PAGE_SIZE = 50;

/**
 * A notification with the names as they were when it was written, so it stays readable for
 * someone who can no longer read the project or its people.
 */
export const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(NOTIFICATION_KINDS),
  projectId: z.uuid(),
  projectName: z.string(),
  /** Who mentioned, changed, removed or joined; empty when nobody in particular did. */
  actorName: z.string(),
  /** A mention: how the message starts. An assigned task: how it reads. */
  excerpt: z.string(),
  /** The new role, or the role of who joined. */
  role: z.enum(PROJECT_ROLES).nullable(),
  createdAt: z.string(),
  read: z.boolean(),
});
export type Notification = z.infer<typeof notificationSchema>;

/** `GET /api/notifications`: the latest notifications, newest first, and how many are unread. */
export type NotificationList = { notifications: Notification[]; unread: number };

/**
 * `POST /api/notifications/read`: single notifications, the mentions of one project (the person
 * is looking at its chat), or all.
 */
export const markNotificationsReadInputSchema = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(NOTIFICATION_PAGE_SIZE) }).strict(),
  z.object({ projectId: z.uuid() }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadInputSchema>;

/** An open vote of a project (`GET /api/projects/:projectId/votes`), for "Wartet auf dich". */
export const openVoteSchema = messageVoteSchema.extend({
  messageId: z.uuid(),
  createdAt: z.string(),
});
export type OpenVote = z.infer<typeof openVoteSchema>;

/**
 * A person's settings for notifications (spec 22b): whether Covibes also tells them by mail what
 * they have not seen in the app. `GET` and `PATCH /api/notifications/settings`.
 */
export const notificationSettingsSchema = z.object({ email: z.boolean() });
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
