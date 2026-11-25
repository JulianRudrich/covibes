import type { DecisionLink, DecisionLinkTarget } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@web/components/ui/tooltip';
import { DecisionLinksReview, TargetDecisionLinks } from '@web/features/decisions/decision-links';
import { decisionLinksQueryKey } from '@web/features/decisions/link-queries';
import { decisionsQueryKey } from '@web/features/decisions/queries';

const PROJECT = '00000000-0000-4000-8000-000000000001';
const DECISION = '00000000-0000-4000-8000-000000000002';
const BLOCK: DecisionLinkTarget = {
  kind: 'block',
  boardId: '00000000-0000-4000-8000-000000000003',
  id: '00000000-0000-4000-8000-000000000004',
};
const TASK: DecisionLinkTarget = { kind: 'task', id: '00000000-0000-4000-8000-000000000005' };
const LINKS: DecisionLink[] = [
  {
    id: 'link-block',
    decisionId: DECISION,
    topic: 'Database',
    status: 'open',
    label: '<img src=x onerror=alert(1)>',
    context: 'Main',
    target: BLOCK,
    available: true,
  },
  {
    id: 'link-task',
    decisionId: DECISION,
    topic: 'Database',
    status: 'open',
    label: 'Build API',
    context: 'Foundation',
    target: TASK,
    available: true,
  },
  {
    id: 'removed',
    decisionId: DECISION,
    topic: 'Database',
    status: 'open',
    label: 'Removed service',
    context: '',
    target: { ...TASK, id: '00000000-0000-4000-8000-000000000006' },
    available: false,
  },
];
function setup(element: React.ReactNode, links = LINKS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(decisionLinksQueryKey(PROJECT), links);
  client.setQueryData(decisionsQueryKey(PROJECT), []);
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{element}</TooltipProvider>
    </QueryClientProvider>,
  );
  return { client, ...view };
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('decision impact and backlinks', () => {
  it('navigates using exact block/task identities, disables missing targets and keeps labels inert', () => {
    const open = vi.fn();
    const { container } = setup(
      <DecisionLinksReview
        projectId={PROJECT}
        decisionId={DECISION}
        readOnly
        onOpenTarget={open}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Block: <img src=x onerror=alert(1)>' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aufgabe: Build API' }));
    expect(open.mock.calls).toEqual([[BLOCK], [TASK]]);
    expect(screen.getByRole('button', { name: /Removed service/ })).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Block oder Aufgabe verknüpfen' }),
    ).not.toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('persists a chosen target and reloads its real relationship list', async () => {
    const requests: { path: string; method: string; body: unknown }[] = [];
    let linked = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string, init?: RequestInit) => {
        requests.push({
          path,
          method: init?.method ?? 'GET',
          body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
        });
        if (path.includes('/targets?'))
          return Promise.resolve(
            json({
              targets: [{ target: TASK, label: 'Build API', context: 'Foundation' }],
              more: false,
            }),
          );
        if (init?.method === 'POST') {
          linked = true;
          return Promise.resolve(json({ id: 'link-task' }));
        }
        return Promise.resolve(json(linked ? [LINKS[1]] : []));
      }),
    );
    setup(<DecisionLinksReview projectId={PROJECT} decisionId={DECISION} readOnly={false} />, []);
    fireEvent.click(screen.getByRole('button', { name: 'Block oder Aufgabe verknüpfen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aufgabe: Build API · Foundation' }));
    await waitFor(() => {
      expect(requests.some((request) => request.method === 'POST')).toBe(true);
    });
    expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
      decisionId: DECISION,
      target: TASK,
    });
    expect(await screen.findByRole('button', { name: 'Aufgabe: Build API' })).toBeInTheDocument();
  });

  it('opens a linked decision from a target for viewers without offering changes', async () => {
    const open = vi.fn();
    setup(<TargetDecisionLinks projectId={PROJECT} target={TASK} readOnly onOpenDecision={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entscheidungen dahinter' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Database · Offen' }));
    expect(open).toHaveBeenCalledWith(DECISION);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
