import type { ChatMessage, LiveEvent, ProjectDetails } from '@covibes/shared';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { messagesQuery } from '@web/features/chat/queries';
import { planStateQuery } from '@web/features/plan/queries';
import { runsQuery } from '@web/features/chat/runs';
import { projectQuery } from '@web/features/projects/queries';
import { proposalsQuery } from '@web/features/proposals/queries';
import { gitReviewsQuery } from '@web/features/git/request-queries';
import { roadmapQuery } from '@web/features/roadmap/queries';
import { usageOverviewQuery, usageStateQuery } from '@web/features/usage/queries';
import { openVotesQuery } from '@web/features/decisions/queries';
import { notificationsQuery } from '@web/features/notifications/queries';
import { useProjectLive } from '@web/features/workspace/use-project-live';
import { createQueryClient } from '@web/lib/query-client';
import { stubApi } from '@web/test-utils';

// The live channel is replaced; the test sends its events by hand.
const live = vi.hoisted(() => ({
  handlers: undefined as undefined | { onEvent: (event: LiveEvent) => void; onConnect: () => void },
}));
vi.mock('@web/features/realtime/live-channel', () => ({
  useLiveChannel: (
    _projectId: string,
    handlers: { onEvent: (event: LiveEvent) => void; onConnect: () => void },
  ) => {
    live.handlers = handlers;
  },
}));

const PROJECT_ID = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const PROJECT_URL = `/api/projects/${PROJECT_ID}`;
const MESSAGES_URL = `${PROJECT_URL}/messages`;
const RUNS_URL = `${PROJECT_URL}/runs`;
const PROPOSALS_URL = `${PROJECT_URL}/proposals`;
const DETAILS: ProjectDetails = {
  id: PROJECT_ID,
  name: 'Covibes',
  role: 'owner',
  members: [],
  boards: [{ id: '33333333-3333-4333-8333-333333333333', title: 'Haupt-Canvas', kind: 'main' }],
  proposalsOnly: false,
  observer: true,
  webAccess: true,
  stance: 'criteria',
  decisionProcess: 'consensus',
  phase: 'brainstorming',
  language: 'de',
  agents: [{ key: 'moderator', model: null }],
  customAgents: [],
};

const ME = '11111111-1111-4111-8111-111111111111';

/** The workspace's queries plus the live channel, as the workspace page has them. */
function renderLive() {
  const queryClient = createQueryClient();
  function Harness() {
    useQuery(projectQuery(PROJECT_ID));
    useQuery(messagesQuery(PROJECT_ID));
    useQuery(runsQuery(PROJECT_ID));
    useQuery(proposalsQuery(PROJECT_ID));
    useQuery(notificationsQuery);
    useQuery(openVotesQuery(PROJECT_ID));
    useQuery(planStateQuery(PROJECT_ID));
    useProjectLive(PROJECT_ID, ME);
    return null;
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return queryClient;
}

function loads(fetchMock: ReturnType<typeof stubApi>, url: string) {
  return fetchMock.mock.calls.filter(([called, init]) => called === url && !init?.method).length;
}

describe('useProjectLive', () => {
  it('reloads the notifications for a mention of the user and the open votes for a vote (spec 22a)', async () => {
    const NOTIFICATIONS_URL = '/api/notifications';
    const VOTES_URL = `${PROJECT_URL}/votes`;
    const fetchMock = stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${MESSAGES_URL}`]: () => ({ body: [] }),
      [`GET ${RUNS_URL}`]: () => ({ body: [] }),
      [`GET ${NOTIFICATIONS_URL}`]: () => ({ body: { notifications: [], unread: 0 } }),
      [`GET ${VOTES_URL}`]: () => ({ body: [] }),
    });
    const queryClient = renderLive();
    await waitFor(() => {
      expect(queryClient.getQueryData(messagesQuery(PROJECT_ID).queryKey)).toEqual([]);
      expect(loads(fetchMock, NOTIFICATIONS_URL)).toBe(1);
      expect(loads(fetchMock, VOTES_URL)).toBe(1);
    });
    const now = new Date().toISOString();
    const message: ChatMessage = {
      id: 'm1',
      projectId: PROJECT_ID,
      author: { kind: 'human', userId: 'u1', name: 'Alex' },
      content: 'Hallo',
      mentions: [],
      replyTo: null,
      status: 'complete',
      createdAt: now,
      updatedAt: now,
    };

    // A message that mentions someone else changes nothing for the bell.
    act(() => {
      live.handlers?.onEvent({
        type: 'message',
        message: { ...message, mentionedUsers: ['someone-else'] },
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loads(fetchMock, NOTIFICATIONS_URL)).toBe(1);

    act(() => {
      live.handlers?.onEvent({
        type: 'message',
        message: { ...message, id: 'm2', mentionedUsers: [ME] },
      });
    });
    await waitFor(() => {
      expect(loads(fetchMock, NOTIFICATIONS_URL)).toBe(2);
    });
    expect(loads(fetchMock, VOTES_URL)).toBe(1);

    act(() => {
      live.handlers?.onEvent({
        type: 'message',
        message: {
          ...message,
          id: 'm3',
          author: { kind: 'agent', agentKey: 'moderator' },
          vote: {
            id: '22222222-2222-4222-8222-222222222222',
            topic: 'Hosting',
            options: ['A', 'B'],
            status: 'open',
            winner: null,
            ballots: [],
          },
        },
      });
    });
    await waitFor(() => {
      expect(loads(fetchMock, VOTES_URL)).toBe(2);
    });
  });

  it('puts messages into the chat and reloads the boards when they change', async () => {
    const fetchMock = stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${MESSAGES_URL}`]: () => ({ body: [] }),
      [`GET ${RUNS_URL}`]: () => ({ body: [] }),
    });
    const queryClient = renderLive();
    await waitFor(() => {
      expect(queryClient.getQueryData(messagesQuery(PROJECT_ID).queryKey)).toEqual([]);
    });
    const now = new Date().toISOString();
    const message: ChatMessage = {
      id: 'm1',
      projectId: PROJECT_ID,
      author: { kind: 'human', userId: 'u1', name: 'Alex' },
      content: 'Live!',
      mentions: [],
      replyTo: null,
      status: 'complete',
      createdAt: now,
      updatedAt: now,
    };

    act(() => {
      live.handlers?.onEvent({ type: 'message', message });
    });
    expect(queryClient.getQueryData(messagesQuery(PROJECT_ID).queryKey)).toMatchObject([
      { id: 'm1', content: 'Live!' },
    ]);

    const urls = [PROJECT_URL, MESSAGES_URL, RUNS_URL];
    const before = urls.map((url) => loads(fetchMock, url));
    act(() => {
      live.handlers?.onEvent({ type: 'boards' });
    });
    await waitFor(() => {
      expect(loads(fetchMock, PROJECT_URL)).toBe((before[0] ?? 0) + 1);
    });
    // Messages and runs, whose keys start with the project's, are left alone.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(urls.map((url) => loads(fetchMock, url))).toEqual([
      (before[0] ?? 0) + 1,
      before[1],
      before[2],
    ]);
  });

  it('reloads the proposals and the project settings when they change', async () => {
    const fetchMock = stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${MESSAGES_URL}`]: () => ({ body: [] }),
      [`GET ${RUNS_URL}`]: () => ({ body: [] }),
      [`GET ${PROPOSALS_URL}`]: () => ({ body: [] }),
    });
    const queryClient = renderLive();
    await waitFor(() => {
      expect(queryClient.isFetching()).toBe(0);
    });
    const urls = [PROJECT_URL, PROPOSALS_URL, MESSAGES_URL];
    const before = urls.map((url) => loads(fetchMock, url));

    act(() => {
      live.handlers?.onEvent({ type: 'proposals' });
      live.handlers?.onEvent({ type: 'project' });
    });

    await waitFor(() => {
      expect(urls.map((url) => loads(fetchMock, url))).toEqual([
        (before[0] ?? 0) + 1,
        (before[1] ?? 0) + 1,
        before[2],
      ]);
    });
  });

  it('reloads chat, runs and boards whenever the channel connects', async () => {
    const fetchMock = stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${MESSAGES_URL}`]: () => ({ body: [] }),
      [`GET ${RUNS_URL}`]: () => ({ body: [] }),
    });
    const queryClient = renderLive();
    await waitFor(() => {
      expect(queryClient.isFetching()).toBe(0);
    });
    const urls = [PROJECT_URL, MESSAGES_URL, RUNS_URL];
    const before = urls.map((url) => loads(fetchMock, url));

    act(() => {
      live.handlers?.onConnect();
    });

    await waitFor(() => {
      expect(urls.map((url) => loads(fetchMock, url))).toEqual(before.map((count) => count + 1));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(urls.map((url) => loads(fetchMock, url))).toEqual(before.map((count) => count + 1));
  });

  it('loads the state of the plan again when the plan changes (spec 25b)', async () => {
    let suggestions = 0;
    const api = stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${PROJECT_URL}/plan`]: () => ({
        body: {
          suggestions: Array.from({ length: suggestions }, (_, index) => ({
            id: `0000000${String(index)}-0000-4000-8000-000000000000`,
            section: ['scope', 'risks'][index],
            content: [],
            createdAt: '2026-10-02T18:00:00.000Z',
          })),
          generating: false,
          failure: null,
        },
      }),
    });
    const queryClient = renderLive();
    const planOf = () => queryClient.getQueryData(planStateQuery(PROJECT_ID).queryKey);
    await waitFor(() => {
      expect(planOf()).toMatchObject({ suggestions: [] });
    });
    const asked = () => api.mock.calls.filter(([url]) => url === `${PROJECT_URL}/plan`).length;
    const before = asked();

    // The moderator's suggestions arrived.
    suggestions = 2;
    act(() => {
      live.handlers?.onEvent({ type: 'plan' });
    });

    await waitFor(() => {
      expect(planOf()?.suggestions).toHaveLength(2);
    });
    expect(asked()).toBe(before + 1);
  });

  it('loads the state of the plan again when a decision changes (spec 25c)', async () => {
    const api = stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${PROJECT_URL}/plan`]: () => ({
        body: {
          suggestions: [],
          generating: false,
          failure: null,
          outdated: null,
          upToDate: false,
        },
      }),
    });
    const queryClient = renderLive();
    await waitFor(() => {
      expect(queryClient.getQueryData(planStateQuery(PROJECT_ID).queryKey)).toBeDefined();
    });
    const asked = () => api.mock.calls.filter(([url]) => url === `${PROJECT_URL}/plan`).length;
    const before = asked();

    // Someone reopened a decision: the plan may be outdated now.
    act(() => {
      live.handlers?.onEvent({ type: 'decisions' });
    });

    await waitFor(() => {
      expect(asked()).toBe(before + 1);
    });
  });

  it('loads the roadmap again when what it shows changed (spec 26a)', async () => {
    const api = stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${PROJECT_URL}/roadmap`]: () => ({ body: { milestones: [] } }),
    });
    const queryClient = renderLive();
    await queryClient.query(roadmapQuery(PROJECT_ID));
    const asked = () => api.mock.calls.filter(([url]) => url === `${PROJECT_URL}/roadmap`).length;
    const before = asked();

    act(() => {
      live.handlers?.onEvent({ type: 'roadmap' });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(roadmapQuery(PROJECT_ID).queryKey)?.isInvalidated).toBe(
        true,
      );
    });
    // Nobody shows the roadmap here, so it is only marked; it loads when a board shows it.
    expect(asked()).toBe(before);
  });

  it('loads the roadmap again when the team changes: who left has no tasks (spec 26b)', async () => {
    stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${PROJECT_URL}/roadmap`]: () => ({ body: { milestones: [] } }),
    });
    const queryClient = renderLive();
    await queryClient.query(roadmapQuery(PROJECT_ID));
    const invalidated = () =>
      queryClient.getQueryState(roadmapQuery(PROJECT_ID).queryKey)?.isInvalidated;

    // A board changing says nothing about tasks.
    act(() => {
      live.handlers?.onEvent({ type: 'boards' });
    });
    await waitFor(() => {
      expect(queryClient.isFetching({ queryKey: [PROJECT_URL] })).toBe(0);
    });
    expect(invalidated()).toBe(false);

    act(() => {
      live.handlers?.onEvent({ type: 'project' });
    });
    await waitFor(() => {
      expect(invalidated()).toBe(true);
    });
  });

  it('loads the roadmap again when the repository’s state was read (spec 30a)', async () => {
    stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${PROJECT_URL}/roadmap`]: () => ({ body: { milestones: [] } }),
    });
    const queryClient = renderLive();
    await queryClient.query(roadmapQuery(PROJECT_ID));

    // A task got its issue, or an issue was closed: the roadmap shows the status.
    act(() => {
      live.handlers?.onEvent({ type: 'git' });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(roadmapQuery(PROJECT_ID).queryKey)?.isInvalidated).toBe(
        true,
      );
    });
  });

  it('loads the reviews again when one started or ended (spec 30b)', async () => {
    stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${PROJECT_URL}/git/reviews`]: () => ({ body: { reviews: [] } }),
    });
    const queryClient = renderLive();
    await queryClient.query(gitReviewsQuery(PROJECT_ID));

    act(() => {
      live.handlers?.onEvent({ type: 'git' });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(gitReviewsQuery(PROJECT_ID).queryKey)?.isInvalidated).toBe(
        true,
      );
    });
  });

  it('loads the state of the limits again when a run cost something (spec 31a)', async () => {
    const free = { reached: false, resetsAt: null };
    stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${PROJECT_URL}/usage/state`]: () => ({ body: { project: free, user: free } }),
    });
    const queryClient = renderLive();
    await queryClient.query(usageStateQuery(PROJECT_ID));

    act(() => {
      live.handlers?.onEvent({ type: 'usage' });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(usageStateQuery(PROJECT_ID).queryKey)?.isInvalidated).toBe(
        true,
      );
    });
    // The owner's overview is only held by its open dialog: nothing to load here.
    expect(
      queryClient.getQueryState(usageOverviewQuery(PROJECT_ID, null).queryKey),
    ).toBeUndefined();
  });

  it('loads the open overview of the running month again when a run cost something (spec 31b)', async () => {
    const free = { reached: false, resetsAt: null };
    const overview = {
      month: '2026-10',
      current: true,
      limits: { projectMonthUsd: 100, userDayUsd: 15 },
      endsAt: '2026-11-01T00:00:00.000Z',
      total: { costUsd: 1, runs: 1, inputTokens: 0, outputTokens: 0 },
      byAgent: [],
      bySource: [],
      byDay: [],
    };
    stubApi({
      [`GET ${PROJECT_URL}`]: () => ({ body: DETAILS }),
      [`GET ${PROJECT_URL}/usage/state`]: () => ({ body: { project: free, user: free } }),
      [`GET ${PROJECT_URL}/usage`]: () => ({ body: overview }),
      [`GET ${PROJECT_URL}/usage?month=2026-09`]: () => ({
        body: { ...overview, month: '2026-09', current: false },
      }),
    });
    const queryClient = renderLive();
    await queryClient.query(usageOverviewQuery(PROJECT_ID, null));
    await queryClient.query(usageOverviewQuery(PROJECT_ID, '2026-09'));

    act(() => {
      live.handlers?.onEvent({ type: 'usage' });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryState(usageOverviewQuery(PROJECT_ID, null).queryKey)?.isInvalidated,
      ).toBe(true);
    });
    // A month that is over does not change any more.
    expect(
      queryClient.getQueryState(usageOverviewQuery(PROJECT_ID, '2026-09').queryKey)?.isInvalidated,
    ).toBe(false);
  });
});
