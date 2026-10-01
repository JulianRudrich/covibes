import type { AiRun, ChatMessage } from '@covibes/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { applyRunEvent, chatStatus, mergeServerRuns, runsQueryKey } from '@web/features/chat/runs';

const PROJECT_ID = 'project-1';

function run(id: string, overrides: Partial<AiRun> = {}): AiRun {
  return {
    id,
    projectId: PROJECT_ID,
    agentKey: 'moderator',
    status: 'queued',
    triggerMessageId: `trigger-${id}`,
    replyMessageId: null,
    createdAt: `2026-09-29T10:00:0${id}.000Z`,
    ...overrides,
  };
}

function message(id: string, status: ChatMessage['status']): ChatMessage {
  return {
    id,
    projectId: PROJECT_ID,
    author: { kind: 'agent', agentKey: 'moderator' },
    content: '',
    mentions: [],
    replyTo: null,
    status,
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
  };
}

describe('chatStatus', () => {
  it('is empty while no agent works or waits', () => {
    expect(chatStatus([], [])).toBeNull();
    expect(
      chatStatus([run('1', { status: 'done' }), run('2', { status: 'error' })], []),
    ).toBeNull();
  });

  it('reports the typing agent and how many runs wait', () => {
    const runs = [
      run('1', { status: 'running', replyMessageId: 'reply-1' }),
      run('2'),
      run('3', { agentKey: 'critic' }),
    ];

    expect(chatStatus(runs, [message('reply-1', 'streaming')])).toEqual({
      typing: 'moderator',
      waiting: 2,
    });
  });

  it('prefers the run whose answer is streaming right now', () => {
    const runs = [
      run('1', { status: 'running', agentKey: 'critic', replyMessageId: 'reply-1' }),
      run('2', { status: 'running', replyMessageId: 'reply-2' }),
    ];

    expect(
      chatStatus(runs, [message('reply-1', 'complete'), message('reply-2', 'streaming')]),
    ).toEqual({ typing: 'moderator', waiting: 0 });
  });

  it('reports waiting runs alone', () => {
    expect(chatStatus([run('1')], [])).toEqual({ typing: null, waiting: 1 });
  });

  it('counts open raised hands as waiting (spec 15)', () => {
    expect(chatStatus([], [], 2)).toEqual({ typing: null, waiting: 2 });
    expect(chatStatus([run('1')], [], 1)).toEqual({ typing: null, waiting: 2 });
  });
});

describe('applyRunEvent', () => {
  it('adds new runs and replaces known ones, oldest first', () => {
    const client = new QueryClient();
    applyRunEvent(client, PROJECT_ID, run('2'));
    applyRunEvent(client, PROJECT_ID, run('1'));
    applyRunEvent(client, PROJECT_ID, run('2', { status: 'running' }));

    expect(client.getQueryData<AiRun[]>(runsQueryKey(PROJECT_ID))).toEqual([
      run('1'),
      run('2', { status: 'running' }),
    ]);
  });
});

describe('mergeServerRuns', () => {
  it('follows the server for runs that did not change live during the request', () => {
    const cached = run('1', { status: 'running' });
    expect(mergeServerRuns([], [cached], [cached])).toEqual([]);
  });

  it('keeps what changed live while the list was loading', () => {
    const before = run('1');
    const live = run('1', { status: 'done' });

    expect(mergeServerRuns([run('1')], [before], [live])).toEqual([live]);
  });

  it('adds runs the server knows but the cache did not', () => {
    expect(mergeServerRuns([run('1'), run('2')], [], [])).toEqual([run('1'), run('2')]);
  });
});
