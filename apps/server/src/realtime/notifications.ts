import type { DB } from '@covibes/db';
import { sql, type Kysely } from 'kysely';
import type pg from 'pg';
import { z } from 'zod';

import { loadMessage, loadRun } from '@server/chat/rows';
import type { LivePublisher } from '@server/realtime/realtime';

/**
 * Postgres channel from the worker (and database triggers) to the server, which forwards to the
 * live channel of the project. Notifications only carry ids and short text deltas: Postgres limits
 * a payload to 8000 bytes, so the server loads messages and runs itself.
 */
export const LIVE_NOTIFY_CHANNEL = 'covibes_live';

/** Longest text of one delta notification; 2000 UTF-16 units stay below 8000 bytes of UTF-8. */
export const MAX_DELTA_LENGTH = 2000;

export const liveNotificationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), projectId: z.uuid(), messageId: z.uuid() }),
  z.object({
    kind: z.literal('delta'),
    projectId: z.uuid(),
    messageId: z.uuid(),
    text: z.string().min(1).max(MAX_DELTA_LENGTH),
  }),
  z.object({ kind: z.literal('run'), projectId: z.uuid(), runId: z.uuid() }),
  // An agent proposed something (spec 13); clients load the open proposals again.
  z.object({ kind: z.literal('proposals'), projectId: z.uuid() }),
]);
export type LiveNotification = z.infer<typeof liveNotificationSchema>;

/** Sends a notification. Inside a transaction Postgres delivers it on commit. */
export async function notifyLive(db: Kysely<DB>, notification: LiveNotification) {
  const payload = JSON.stringify(liveNotificationSchema.parse(notification));
  await sql`select pg_notify(${LIVE_NOTIFY_CHANNEL}, ${payload})`.execute(db);
}

/** Turns a notification into the event for the live channel; undefined if the row is gone. */
export async function toLiveEvent(admin: Kysely<DB>, notification: LiveNotification) {
  switch (notification.kind) {
    case 'message': {
      const message = await loadMessage(admin, notification.messageId);
      return message && { type: 'message' as const, message };
    }
    case 'delta':
      return {
        type: 'message_delta' as const,
        messageId: notification.messageId,
        text: notification.text,
      };
    case 'run': {
      const run = await loadRun(admin, notification.runId);
      return run && { type: 'run' as const, run };
    }
    case 'proposals':
      return { type: 'proposals' as const };
  }
}

const RECONNECT_MS = 1_000;

/**
 * Listens on the channel with one dedicated connection and forwards every notification to the
 * live channel. If the connection breaks, it reconnects; clients reload their messages whenever
 * their own live connection opens, so a short gap here only delays updates.
 */
export function startLiveBridge(deps: {
  adminPool: pg.Pool;
  admin: Kysely<DB>;
  live: LivePublisher;
}) {
  let client: pg.PoolClient | undefined;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  // Strictly in arrival order: a message that has to be loaded first must still reach the clients
  // before the text deltas that follow it, or they would be appended to nothing.
  let queue = Promise.resolve();

  async function forward(payload: string | undefined) {
    let json: unknown;
    try {
      json = JSON.parse(payload ?? '');
    } catch {
      return;
    }
    const parsed = liveNotificationSchema.safeParse(json);
    if (!parsed.success) return;
    const event = await toLiveEvent(deps.admin, parsed.data);
    if (event) deps.live.publish(parsed.data.projectId, event);
  }

  function scheduleReconnect() {
    client = undefined;
    if (stopped) return;
    retry = setTimeout(() => void connect(), RECONNECT_MS);
  }

  async function connect() {
    try {
      const next = await deps.adminPool.connect();
      next.on('notification', (message) => {
        queue = queue
          .then(() => forward(message.payload))
          .catch((error: unknown) => {
            console.error('Live bridge could not forward a notification', error);
          });
      });
      next.on('error', (error) => {
        console.error('Live bridge connection failed', error);
        next.release(true);
        scheduleReconnect();
      });
      await next.query(`listen ${LIVE_NOTIFY_CHANNEL}`);
      if (stopped) {
        next.release(true);
        return;
      }
      client = next;
    } catch (error) {
      console.error('Live bridge could not connect', error);
      scheduleReconnect();
    }
  }

  const ready = connect();

  return {
    /** Resolves once the first LISTEN is in place (tests wait for it). */
    ready,
    stop() {
      stopped = true;
      clearTimeout(retry);
      client?.release(true);
      client = undefined;
    },
  };
}
