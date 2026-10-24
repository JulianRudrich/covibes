import type { MessageReference } from '@covibes/shared';
import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { agentClass, useAgents } from '@web/features/agents/agents';
import { AGENT_BACKGROUND } from '@web/features/canvas/agent-look';
import { cn } from '@web/lib/cn';

/**
 * A reference to an element of the canvas inside a message (spec 37a; handoff "Canvas
 * reference"): a pill with the element's name in the base color of whoever made the element,
 * `human` for an element a person made. A click leads to the element. Without `onOpen` it is the
 * same mark without the way there. In an own (ink) bubble a person's pill turns to the panel
 * color, so it does not melt into the bubble.
 */
export function ReferenceChip({
  reference,
  onOpen,
  onInk = false,
}: {
  reference: MessageReference;
  onOpen?: (reference: MessageReference) => void;
  onInk?: boolean;
}) {
  const { t } = useTranslation();
  const agents = useAgents();
  const tone =
    reference.by.kind === 'agent'
      ? cn(agentClass(AGENT_BACKGROUND, agents(reference.by.agentKey)), 'text-on-ink')
      : onInk
        ? 'bg-bg-panel text-text'
        : 'bg-human text-on-ink';
  const className = cn(
    'mx-px inline-flex h-[22px] max-w-full animate-pop items-center gap-1 rounded-full pr-[9px] pl-[7px] align-middle text-status leading-none font-semibold whitespace-nowrap transition-[filter]',
    tone,
  );
  const content = (
    <>
      <Network size={11} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{reference.label}</span>
    </>
  );

  if (!onOpen) return <span className={className}>{content}</span>;
  return (
    <button
      type="button"
      aria-label={t('chat.reference', { name: reference.label })}
      className={cn(
        className,
        'cursor-pointer hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink',
      )}
      onClick={() => {
        onOpen(reference);
      }}
    >
      {content}
    </button>
  );
}
