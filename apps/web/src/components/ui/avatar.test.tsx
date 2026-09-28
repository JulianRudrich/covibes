import { AGENT_KEYS } from '@covibes/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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

  it.each(AGENT_KEYS)('renders the %s agent as a square in its color', (agent) => {
    render(<Avatar kind="agent" agent={agent} size={24} label={agent} initials="X" />);
    const avatar = screen.getByRole('img', { name: agent });

    expect(avatar).toHaveClass(`bg-agent-${agent}`, 'text-on-ink', 'rounded-btn-s', 'size-6');
    expect(avatar).not.toHaveClass('rounded-full');
  });

  it.each([
    [16, 'rounded-xs'],
    [28, 'rounded-md'],
  ] as const)('scales the agent radius with size %i', (size, radius) => {
    render(<Avatar kind="agent" agent="moderator" size={size} label="Moderator" initials="M" />);

    expect(screen.getByRole('img', { name: 'Moderator' })).toHaveClass(radius);
  });
});
