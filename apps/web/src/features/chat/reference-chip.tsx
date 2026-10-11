import type { MessageReference } from '@covibes/shared';
import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { agentClass, useAgents } from '@web/features/agents/agents';
import { cn } from '@web/lib/cn';
import { AGENT_REFERENCE } from '@web/lib/styles';

/** The colors of a reference to an element a person made. */
const HUMAN_REFERENCE =
  'border-border-strong bg-bg-subtle text-text-2 hover:border-edge hover:bg-bg-hover-app';

/**
 * A reference to an element of the canvas inside a message (spec 37a; handoff "Canvas
 * reference"): an inline button with the element's name, in the colors of the agent that made the
 * element, neutral for an element a person made. A click leads to the element. Without `onOpen`
 * it is the same mark without the way there.
 */
export function ReferenceChip({
  reference,
  onOpen,
}: {
  reference: MessageReference;
  onOpen?: (reference: MessageReference) => void;
}) {
  const { t } = useTranslation();
  const agents = useAgents();
  const tone =
    reference.by.kind === 'agent'
      ? agentClass(AGENT_REFERENCE, agents(reference.by.agentKey))
      : HUMAN_REFERENCE;
  const className = cn(
    'mx-px inline-flex h-[22px] max-w-full items-center gap-1 rounded-sm border pr-[7px] pl-[5px] align-middle text-small leading-none font-medium whitespace-nowrap transition-colors',
    tone,
  );
  const content = (
    <>
      <Network size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
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
        'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink',
      )}
      onClick={() => {
        onOpen(reference);
      }}
    >
      {content}
    </button>
  );
}
