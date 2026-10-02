import type { DB } from '@covibes/db';
import type { Task } from 'graphile-worker';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';

import type { Mailer } from '@server/integrations/mail/mailer';
import {
  notificationDigestMail,
  type DigestItem,
  type DigestProject,
} from '@server/integrations/mail/templates';

/** Name of the job the database schedules per person (migration 0019). */
export const NOTIFICATION_MAIL_TASK = 'notification_mail';

/** At most one mail per person in this time; what happens in between waits for the next one. */
export const MAIL_GAP_MS = 30 * 60_000;

/** The notifications that are mailed; that someone joined stays in the app. */
const MAILED_KINDS = ['mention', 'role_changed', 'removed'] as const;

/** Notifications one mail lists; more wait for the next one. */
const MAX_NOTIFICATIONS = 20;

const payloadSchema = z.object({ userId: z.uuid() });

export type NotificationMailDeps = {
  /** Role covibes_admin: the worker reads across people and notes what it mailed. */
  admin: Kysely<DB>;
  /** Without a mailer (production without SMTP) nothing is sent. */
  mailer: Mailer | undefined;
  /** The web app's address, for the links in the mail. */
  appUrl: string;
  /** Runs the job for the person again at `runAt`. */
  reschedule: (userId: string, runAt: Date) => Promise<void>;
  now?: () => Date;
};

/** What a run of the job came to. */
export type NotificationMailOutcome = 'sent' | 'nothing' | 'off' | 'later';

type WaitingRow = {
  project_id: string;
  project_name: string;
  waiting: number;
  newest: Date;
  last_seen_at: Date | null;
  waiting_mailed_at: Date | null;
};

function isRole(value: string | null): value is 'owner' | 'editor' | 'viewer' {
  return value === 'owner' || value === 'editor' || value === 'viewer';
}

/**
 * The mail job of one person (spec 22b): sums up in one mail what they have not seen, and notes
 * what it mailed, so everything goes out once.
 * - unread mentions, a changed role and a removal that were not mailed yet
 * - projects where something waits for them that appeared since they last had the project open
 *   and since the last mail about it
 * Nothing is sent to someone who turned mails off, when nothing is left, or without a mailer. Too
 * early after the last mail, the job runs again once the pause is over.
 */
export async function sendNotificationMail(
  deps: NotificationMailDeps,
  payload: unknown,
): Promise<NotificationMailOutcome> {
  const { userId } = payloadSchema.parse(payload);
  const { admin, mailer } = deps;
  const now = deps.now?.() ?? new Date();
  if (!mailer) return 'off';

  const user = await admin
    .selectFrom('users')
    .leftJoin('notification_settings', 'notification_settings.user_id', 'users.id')
    .select([
      'users.email',
      'users.name',
      'users.locale',
      'notification_settings.email as mails',
      'notification_settings.last_mail_at',
    ])
    .where('users.id', '=', userId)
    .executeTakeFirst();
  // Gone since the job was scheduled, or mails are switched off.
  if (!user || user.mails === false) return 'off';

  if (user.last_mail_at && now.getTime() - user.last_mail_at.getTime() < MAIL_GAP_MS) {
    await deps.reschedule(userId, new Date(user.last_mail_at.getTime() + MAIL_GAP_MS));
    return 'later';
  }

  const notifications = await admin
    .selectFrom('notifications')
    .select(['id', 'kind', 'project_id', 'project_name', 'actor_name', 'excerpt', 'role'])
    .where('user_id', '=', userId)
    .where('read_at', 'is', null)
    .where('mailed_at', 'is', null)
    .where('kind', 'in', MAILED_KINDS)
    .orderBy('created_at')
    .orderBy('id')
    .limit(MAX_NOTIFICATIONS)
    .execute();
  const waiting = await sql<WaitingRow>`select * from public.waiting_for_user(${userId})`.execute(
    admin,
  );
  // Only what the person has not seen: newer than their last visit and than the last mail about it.
  const unseen = waiting.rows.filter((row) => {
    const known = Math.max(row.last_seen_at?.getTime() ?? 0, row.waiting_mailed_at?.getTime() ?? 0);
    return row.newest.getTime() > known;
  });
  if (notifications.length === 0 && unseen.length === 0) return 'nothing';

  // Grouped by project, in the order things happened. A project gets its link only if it opens
  // for the person: not after a removal, but again once they are back in it.
  const memberships = await admin
    .selectFrom('project_members')
    .select('project_id')
    .where('user_id', '=', userId)
    .execute();
  const memberOf = new Set(memberships.map((membership) => membership.project_id));
  const projects = new Map<string, DigestProject>();
  const projectOf = (id: string, name: string) => {
    let project = projects.get(id);
    if (!project) {
      const url = memberOf.has(id) ? new URL(`/p/${id}`, deps.appUrl).href : null;
      project = { name, url, items: [] };
      projects.set(id, project);
    }
    return project;
  };
  for (const notification of notifications) {
    const project = projectOf(notification.project_id, notification.project_name);
    const item: DigestItem | undefined =
      notification.kind === 'mention'
        ? { kind: 'mention', actorName: notification.actor_name, excerpt: notification.excerpt }
        : notification.kind === 'removed'
          ? { kind: 'removed', actorName: notification.actor_name }
          : isRole(notification.role)
            ? { kind: 'role_changed', actorName: notification.actor_name, role: notification.role }
            : undefined;
    if (item) project.items.push(item);
  }
  for (const row of unseen) {
    projectOf(row.project_id, row.project_name).items.push({ kind: 'waiting', count: row.waiting });
  }

  await mailer.send(
    notificationDigestMail({
      to: user.email,
      name: user.name,
      appUrl: deps.appUrl,
      locale: user.locale === 'en' ? 'en' : 'de',
      projects: [...projects.values()].filter((project) => project.items.length > 0),
    }),
  );

  // Noted after the mail went out: a failure before this point mails again, never too little.
  await admin.transaction().execute(async (trx) => {
    if (notifications.length > 0) {
      await trx
        .updateTable('notifications')
        .set({ mailed_at: now })
        .where(
          'id',
          'in',
          notifications.map((notification) => notification.id),
        )
        .execute();
    }
    if (unseen.length > 0) {
      await trx
        .insertInto('member_activity')
        .values(
          unseen.map((row) => ({
            project_id: row.project_id,
            user_id: userId,
            waiting_mailed_at: now,
          })),
        )
        .onConflict((conflict) =>
          conflict.columns(['project_id', 'user_id']).doUpdateSet({ waiting_mailed_at: now }),
        )
        .execute();
    }
    await trx
      .insertInto('notification_settings')
      .values({ user_id: userId, last_mail_at: now })
      .onConflict((conflict) => conflict.column('user_id').doUpdateSet({ last_mail_at: now }))
      .execute();
  });

  // More than one mail lists: the rest follows after the pause.
  if (notifications.length === MAX_NOTIFICATIONS) {
    await deps.reschedule(userId, new Date(now.getTime() + MAIL_GAP_MS));
  }
  return 'sent';
}

/** The Graphile Worker task for `notification_mail`. */
export function notificationMailTask(
  deps: Pick<NotificationMailDeps, 'admin' | 'mailer' | 'appUrl'>,
): Task {
  return async (payload, helpers) => {
    await sendNotificationMail(
      {
        ...deps,
        reschedule: async (userId, runAt) => {
          await helpers.addJob(
            NOTIFICATION_MAIL_TASK,
            { userId },
            { jobKey: `${NOTIFICATION_MAIL_TASK}:${userId}`, runAt, maxAttempts: 3 },
          );
        },
      },
      payload,
    );
  };
}
