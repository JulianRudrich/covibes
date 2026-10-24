import type { CustomAgentSummary } from '@covibes/shared';
import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { customMark } from '@web/components/ui/agent-marks';
import { TooltipProvider } from '@web/components/ui/tooltip';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { AgentDirectoryProvider } from '@web/features/agents/agent-directory';
import { agentClass, agentColor, useAgents, useMentionNames } from '@web/features/agents/agents';
import { AGENT_TILE } from '@web/features/canvas/agent-look';
import { ChatMessageView } from '@web/features/chat/chat-message';
import { RaisedHands } from '@web/features/hands/raised-hands';

const WRITER: CustomAgentSummary = {
  key: '11111111-1111-4111-8111-111111111111',
  name: 'UX Writer',
  role: 'Texte und Tonalität',
  color: 3,
  model: null,
  canDraw: true,
  scope: 'personal',
  ownerId: '22222222-2222-4222-8222-222222222222',
  ownerName: 'Olga',
  deleted: false,
};
const GONE = '99999999-9999-4999-8999-999999999999';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AgentDirectoryProvider agents={[WRITER]}>{children}</AgentDirectoryProvider>
);

describe('useAgents (spec 19)', () => {
  it('resolves catalog agents from the translations', () => {
    const { result } = renderHook(() => useAgents(), { wrapper });
    expect(result.current('critic')).toEqual({
      key: 'critic',
      name: 'Kritiker',
      initials: 'K',
      role: 'Schwachstellen und Risiken',
      mention: 'Kritiker',
      look: 'critic',
      color: null,
      custom: null,
    });
  });

  it('resolves custom agents from the directory of the project', () => {
    const { result } = renderHook(() => useAgents(), { wrapper });
    expect(result.current(WRITER.key)).toEqual({
      key: WRITER.key,
      name: 'UX Writer',
      initials: 'UW',
      role: 'Texte und Tonalität',
      mention: 'UX-Writer',
      look: 'custom',
      color: 3,
      custom: WRITER,
    });
  });

  it('shows an agent nobody knows any more as "Agent" in graphite', () => {
    const { result } = renderHook(() => useAgents(), { wrapper });
    expect(result.current(GONE)).toMatchObject({
      name: 'Agent',
      initials: '?',
      mention: '',
      look: 'custom',
      color: 5,
      custom: null,
    });
    // Outside a project there is no directory at all.
    const bare = renderHook(() => useAgents());
    expect(bare.result.current(WRITER.key).name).toBe('Agent');
  });

  it('gives the names a team answers to, like the server', () => {
    const team = ['moderator', 'critic', WRITER.key, GONE];
    const { result } = renderHook(() => useMentionNames(team), { wrapper });
    expect(result.current).toEqual({
      moderator: ['moderator'],
      critic: ['critic', 'kritiker'],
      [WRITER.key]: ['ux-writer'],
    });
  });
});

describe('the look of an agent', () => {
  it('uses the classes of a catalog agent, or the custom look with the class of its color', () => {
    expect(agentClass(AGENT_TILE, { look: 'backend', color: null })).toBe(
      'border-agent-backend-border bg-agent-backend-tint text-agent-backend-dark',
    );
    expect(agentClass(AGENT_TILE, { look: 'custom', color: 3 })).toBe(
      'border-agent-custom-border bg-agent-custom-tint text-agent-custom-dark agent-color-3',
    );
    expect(agentColor({ look: 'backend', color: null })).toBe('var(--color-agent-backend)');
    expect(agentColor({ look: 'custom', color: 3 })).toBe('var(--color-agent-custom-3)');
    expect(agentColor({ look: 'custom', color: null })).toBe('var(--color-agent-custom-5)');
  });

  it('shows a custom agent with its mark in its color', () => {
    function Probe() {
      return <AgentAvatar agent={useAgents()(WRITER.key)} size={24} />;
    }
    render(<Probe />, { wrapper });
    const avatar = screen.getByRole('img', { name: 'UX Writer' });
    expect(avatar.querySelector('path')).toHaveAttribute('d', customMark(WRITER.key));
    expect(avatar).toHaveClass('bg-agent-custom-tint', 'agent-color-3', 'text-agent-custom');
  });
});

describe('custom agents in the chat', () => {
  const CREATED_AT = new Date(2026, 9, 1, 14, 5).toISOString();
  const message = {
    id: 'message-1',
    projectId: 'project-1',
    content: 'Der Knopf heißt „Speichern“. Frag sonst @UX-Writer oder @Kritiker.',
    mentions: [],
    replyTo: null,
    status: 'complete' as const,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };

  it('answer under their name, with their mark, color and the badge "Agent"', () => {
    render(
      <ChatMessageView
        item={{ ...message, author: { kind: 'agent', agentKey: WRITER.key } }}
        isOwn={false}
        team={['moderator', 'critic', WRITER.key]}
      />,
      { wrapper },
    );

    const article = screen.getByRole('article', { name: 'UX Writer Agent 14:05' });
    expect(article.querySelector('[role="img"] path')).toHaveAttribute('d', customMark(WRITER.key));
    expect(article.querySelector('[role="img"]')).toHaveClass('agent-color-3');
    expect(screen.getByText('UX Writer')).toHaveClass('text-agent-custom-dark', 'agent-color-3');
    expect(screen.getByText('Agent')).toHaveClass('bg-agent-custom-tint', 'agent-color-3');
    // Mentions of team agents are chips, custom agents by their handle.
    expect(screen.getByText('@UX-Writer')).toHaveClass('bg-agent-custom-tint', 'agent-color-3');
    expect(screen.getByText('@Kritiker')).toHaveClass('bg-agent-critic-tint');
  });

  it('raise their hand in their color', () => {
    render(
      <TooltipProvider>
        <RaisedHands
          hands={[
            {
              id: '33333333-3333-4333-8333-333333333333',
              projectId: '44444444-4444-4444-8444-444444444444',
              agentKey: WRITER.key,
              reason: 'Einwand zur Tonalität',
              createdAt: CREATED_AT,
            },
          ]}
          onDecide={() => undefined}
        />
      </TooltipProvider>,
      { wrapper },
    );

    const card = screen.getByRole('listitem');
    expect(card).toHaveTextContent('UX Writer meldet sich – Einwand zur Tonalität');
    expect(card).toHaveClass('bg-agent-custom-tint', 'agent-color-3');
    expect(screen.getByRole('button', { name: 'UX Writer: nicht jetzt' })).toBeInTheDocument();
  });
});
