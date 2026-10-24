import type { AgentKey } from '@covibes/shared';
import type { CSSProperties } from 'react';

import { cn } from '@web/lib/cn';

type AvatarSize = 16 | 20 | 24 | 26 | 28 | 30 | 32 | 52;

type CommonProps = {
  /** Accessible name, usually the person's or agent's name. */
  label: string;
  size?: AvatarSize;
  className?: string;
  style?: CSSProperties;
};

export type AvatarProps = CommonProps &
  (
    | {
        kind: 'human';
        /** One or two characters shown inside the avatar. */
        initials: string;
        /** `strong` is used on the app background (header). */
        tone?: 'default' | 'strong';
      }
    | {
        kind: 'agent';
        /** A catalog agent, or `custom` with a class `agent-color-N` that picks the color. */
        agent: AgentKey | 'custom';
        /** The agent's mark: a path on a 24 × 24 grid from `agent-marks.ts`. */
        mark: string;
      }
  );

const SIZE_CLASSES: Record<AvatarSize, string> = {
  16: 'size-4 text-[8px]',
  20: 'size-5 text-[9px]',
  24: 'size-6 text-badge',
  26: 'size-[26px] text-badge',
  28: 'size-7 text-badge',
  30: 'size-[30px] text-meta',
  32: 'size-8 text-status',
  52: 'size-[52px] text-display',
};

// Agents are rounded squares whose radius is about a third of their size (handoff: 30 px → 10).
const AGENT_RADIUS: Record<AvatarSize, string> = {
  16: 'rounded-[5px]',
  20: 'rounded-[7px]',
  24: 'rounded-[8px]',
  26: 'rounded-[8px]',
  28: 'rounded-[9px]',
  30: 'rounded-[10px]',
  32: 'rounded-[10px]',
  52: 'rounded-[17px]',
};

// The glyph fills about half of the mark.
const GLYPH_SIZE: Record<AvatarSize, number> = {
  16: 9,
  20: 11,
  24: 13,
  26: 14,
  28: 15,
  30: 16,
  32: 17,
  52: 27,
};

// The mark sits on the agent's tint with a fine inner line, the glyph in the agent's color.
const AGENT_LOOK: Record<AgentKey | 'custom', string> = {
  moderator: 'bg-agent-moderator-tint text-agent-moderator inset-ring-agent-moderator-border',
  backend: 'bg-agent-backend-tint text-agent-backend inset-ring-agent-backend-border',
  critic: 'bg-agent-critic-tint text-agent-critic inset-ring-agent-critic-border',
  data: 'bg-agent-data-tint text-agent-data inset-ring-agent-data-border',
  product: 'bg-agent-product-tint text-agent-product inset-ring-agent-product-border',
  frontend: 'bg-agent-frontend-tint text-agent-frontend inset-ring-agent-frontend-border',
  devops: 'bg-agent-devops-tint text-agent-devops inset-ring-agent-devops-border',
  security: 'bg-agent-security-tint text-agent-security inset-ring-agent-security-border',
  ml: 'bg-agent-ml-tint text-agent-ml inset-ring-agent-ml-border',
  content: 'bg-agent-content-tint text-agent-content inset-ring-agent-content-border',
  custom: 'bg-agent-custom-tint text-agent-custom inset-ring-agent-custom-border',
};

export function Avatar(props: AvatarProps) {
  const { label, size = 28, className, style } = props;
  const base = cn(
    'grid shrink-0 place-items-center font-semibold leading-none select-none',
    SIZE_CLASSES[size],
  );

  if (props.kind === 'agent') {
    const glyph = GLYPH_SIZE[size];
    return (
      <span
        role="img"
        aria-label={label}
        className={cn(base, 'inset-ring', AGENT_RADIUS[size], AGENT_LOOK[props.agent], className)}
        style={style}
      >
        <svg
          width={glyph}
          height={glyph}
          viewBox="0 0 24 24"
          fill="currentColor"
          fillRule="evenodd"
          aria-hidden="true"
        >
          <path d={props.mark} />
        </svg>
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        base,
        'rounded-full text-human-avatar-fg',
        props.tone === 'strong' ? 'bg-human-avatar-bg-strong' : 'bg-human-avatar-bg',
        props.initials.length > 1 && size === 26 && 'text-[10px]',
        className,
      )}
      style={style}
    >
      <span aria-hidden="true">{props.initials}</span>
    </span>
  );
}
