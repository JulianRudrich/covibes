import { AGENT_KEYS } from '@covibes/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CATALOG_MARKS, CUSTOM_MARKS, customMark } from './agent-marks';
import { Avatar } from './avatar';

describe('Avatar', () => {
  it('renders a round human avatar with an accessible name', () => {
    render(<Avatar kind="human" label="Alex" initials="A" />);
    const avatar = screen.getByRole('img', { name: 'Alex' });

    expect(avatar).toHaveClass('rounded-full', 'bg-human-avatar-bg', 'size-7');
    expect(avatar).toHaveTextContent('A');
  });

  it('uses the stronger background for humans on the app background', () => {
    render(<Avatar kind="human" tone="strong" size={26} label="Sam" initials="S" />);

    expect(screen.getByRole('img', { name: 'Sam' })).toHaveClass(
      'bg-human-avatar-bg-strong',
      'size-[26px]',
    );
  });

  it.each(AGENT_KEYS)('renders the %s agent as its mark on its tint', (agent) => {
    render(
      <Avatar kind="agent" agent={agent} size={24} label={agent} mark={CATALOG_MARKS[agent]} />,
    );
    const avatar = screen.getByRole('img', { name: agent });

    expect(avatar).toHaveClass(`bg-agent-${agent}-tint`, `text-agent-${agent}`, 'size-6');
    expect(avatar).not.toHaveClass('rounded-full');
    expect(avatar.querySelector('path')).toHaveAttribute('d', CATALOG_MARKS[agent]);
    // No letters: the mark alone stands for the agent.
    expect(avatar).toHaveTextContent('');
  });

  it('gives every catalog agent its own mark', () => {
    expect(new Set(Object.values(CATALOG_MARKS)).size).toBe(AGENT_KEYS.length);
  });

  it('keeps the mark of a custom agent the same for the same id', () => {
    expect(customMark('agent-a')).toBe(customMark('agent-a'));
    expect(CUSTOM_MARKS).toContain(customMark('agent-a'));
    expect(Object.values(CATALOG_MARKS)).not.toContain(customMark('agent-a'));
  });

  it.each([
    [16, 'rounded-[5px]'],
    [30, 'rounded-[10px]'],
  ] as const)('scales the agent radius with size %i', (size, radius) => {
    render(
      <Avatar
        kind="agent"
        agent="moderator"
        size={size}
        label="Moderator"
        mark={CATALOG_MARKS.moderator}
      />,
    );

    expect(screen.getByRole('img', { name: 'Moderator' })).toHaveClass(radius);
  });
});
