import type { AgentKey } from '@covibes/shared';

import { cn } from '@web/lib/cn';

type AvatarSize = 16 | 24 | 26 | 28;

type CommonProps = {
  /** Accessible name, usually the person's or agent's name. */
  label: string;
  /** One or two characters shown inside the avatar. */
  initials: string;
  size?: AvatarSize;
  className?: string;
};

export type AvatarProps = CommonProps &
  (
    | {
        kind: 'human';
        /** `strong` is used on the app background (header). */ tone?: 'default' | 'strong';
      }
    | { kind: 'agent'; agent: AgentKey }
  );

const SIZE_CLASSES: Record<AvatarSize, string> = {
  16: 'size-4 text-[8px]',
  24: 'size-6 text-badge',
  26: 'size-[26px] text-badge',
  28: 'size-7 text-badge',
};

// Agents are rounded squares; the radius grows with the size (handoff: 5 / 7 / 8 px).
const AGENT_RADIUS: Record<AvatarSize, string> = {
  16: 'rounded-xs',
  24: 'rounded-btn-s',
  26: 'rounded-btn-s',
  28: 'rounded-md',
};

const AGENT_BACKGROUND: Record<AgentKey, string> = {
  moderator: 'bg-agent-moderator',
  backend: 'bg-agent-backend',
  kritiker: 'bg-agent-kritiker',
  daten: 'bg-agent-daten',
};

export function Avatar(props: AvatarProps) {
  const { label, initials, size = 28, className } = props;
  const kindClasses =
    props.kind === 'agent'
      ? cn(AGENT_RADIUS[size], AGENT_BACKGROUND[props.agent], 'text-on-ink')
      : cn(
          'rounded-full text-human-avatar-fg',
          props.tone === 'strong' ? 'bg-human-avatar-bg-strong' : 'bg-human-avatar-bg',
        );

  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'grid shrink-0 place-items-center font-semibold leading-none select-none',
        SIZE_CLASSES[size],
        initials.length > 1 && size === 26 && 'text-[10px]',
        kindClasses,
        className,
      )}
    >
      <span aria-hidden="true">{initials}</span>
    </span>
  );
}
