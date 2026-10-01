import type { AiRun, ChatMessage } from '@covibes/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';

import type { ChatStatus } from '@web/features/chat/status-pill';
import { api } from '@web/lib/api';

/** React Query key of the agent runs of a project. */
export function runsQueryKey(projectId: string) {
  return ['projects', projectId, 'runs'] as const;
}

/** Oldest first, like the server. Ties go by id. */
function compareRuns(a: AiRun, b: AiRun): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * The runs the server listed, combined with what the live channel reported while the list was
 * loading. The server read its list at some moment during the request, so a run that changed live
 * in the meantime (a different object in `after` than in `before`) keeps its live state: the channel
 * was already open, so anything newer still arrives live. Every other run follows the server; one
 * the cache shows as active but the server no longer lists ended while the channel was down.
 */
export function mergeServerRuns(
  server: readonly AiRun[],
  before: readonly AiRun[],
  after: readonly AiRun[],
): AiRun[] {
  const known = new Map(before.map((run) => [run.id, run]));
  const changed = after.filter((run) => known.get(run.id) !== run);
  const changedIds = new Set(changed.map((run) => run.id));
  return [...server.filter((run) => !changedIds.has(run.id)), ...changed].sort(compareRuns);
}

/**
 * The agent runs of a project that wait or work (`GET /api/projects/:projectId/runs`), for the
 * status pill. After loading, live `run` events keep the list current (`applyRunEvent`).
 */
export function runsQuery(projectId: string) {
  return queryOptions({
    queryKey: runsQueryKey(projectId),
    queryFn: async ({ client, queryKey }) => {
      const before = client.getQueryData<AiRun[]>(queryKey) ?? [];
      const server = await api<AiRun[]>(`/projects/${encodeURIComponent(projectId)}/runs`);
      return mergeServerRuns(server, before, client.getQueryData<AiRun[]>(queryKey) ?? []);
    },
    // Like the messages: the live channel keeps the list current, the chat reloads it on connect.
    staleTime: Infinity,
    refetchOnMount: 'always',
  });
}

/**
 * Applies a live `run` event. A finished run no longer counts for the status, but it stays in the
 * cache as a marker until the next reload: removing it would leave no trace, and a reload that
 * started before the run ended would bring it back as active. Unlike messages, events are applied
 * before the first load completes too, since a partial list of runs misleads no one.
 */
export function applyRunEvent(queryClient: QueryClient, projectId: string, run: AiRun) {
  queryClient.setQueryData<AiRun[]>(runsQueryKey(projectId), (runs = []) =>
    [...runs.filter((known) => known.id !== run.id), run].sort(compareRuns),
  );
}

/**
 * What the chat header reports (handoff: "Backend is typing · 1 waiting"): the agent of a running
 * run, preferably one whose answer is streaming right now, and how many runs wait in their queue.
 * Null while no agent works or waits.
 */
export function chatStatus(
  runs: readonly AiRun[],
  messages: readonly ChatMessage[],
  /** Open raised hands wait to speak too (spec 15). */
  openHands = 0,
): ChatStatus | null {
  // Finished runs (`done`, `error`) are only markers in the cache, see `applyRunEvent`.
  const waiting = runs.filter((run) => run.status === 'queued').length + openHands;
  const running = runs.filter((run) => run.status === 'running');
  const streaming = new Set(
    messages.filter((message) => message.status === 'streaming').map((message) => message.id),
  );
  const typing =
    running.find((run) => run.replyMessageId !== null && streaming.has(run.replyMessageId)) ??
    running[0];

  if (typing === undefined && waiting === 0) return null;
  return { typing: typing?.agentKey ?? null, waiting };
}
