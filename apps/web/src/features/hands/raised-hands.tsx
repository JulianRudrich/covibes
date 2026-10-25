import type { HandRaise } from '@covibes/shared';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { IconButton } from '@web/components/ui/icon-button';
import { Tooltip } from '@web/components/ui/tooltip';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, useAgents } from '@web/features/agents/agents';
import { AGENT_DARK_TEXT } from '@web/features/canvas/agent-look';
import { HandBadge } from '@web/features/hands/hand-badge';
import type { HandDecision } from '@web/features/hands/queries';
import { cn } from '@web/lib/cn';
import { AGENT_TONE } from '@web/lib/styles';

type RaisedHandsProps = {
  hands: readonly HandRaise[];
  /** Owners and editors listen or dismiss; viewers only see the cards. */
  onDecide?: (hand: HandRaise, decision: HandDecision) => void;
};

/**
 * The open raised hands above the composer (spec 15; handoff "Raised hand"): a card in the
 * agent's tint with its mark and the hand badge, "Kritiker meldet sich" over the reason, and
 * "Anhören" as a pill on the panel color. The X dismisses the hand (derived look).
 */
export function RaisedHands({ hands, onDecide }: RaisedHandsProps) {
  const { t } = useTranslation();
  const agents = useAgents();
  if (hands.length === 0) return null;

  return (
    <ul aria-label={t('hands.label')} className="m-0 flex list-none flex-col gap-2.5 p-0">
      {hands.map((hand) => {
        const agent = agents(hand.agentKey);
        const { name } = agent;
        return (
          <li
            key={hand.id}
            className={cn(
              'flex animate-rise items-center gap-2.5 rounded-panel p-2',
              agentClass(AGENT_TONE, agent),
            )}
          >
            <span aria-hidden="true" className="relative flex shrink-0">
              <AgentAvatar agent={agent} size={32} className="rounded-[11px] bg-bg-panel" />
              <HandBadge agent={agent} className="-top-1 -right-1 ring-0" />
            </span>
            <p className="m-0 min-w-0 flex-1 text-ui leading-[1.35] wrap-break-word text-text-2">
              <strong className={cn('block font-bold', agentClass(AGENT_DARK_TEXT, agent))}>
                {t('hands.raises', { name })}
              </strong>
              {hand.reason}
            </p>
            {onDecide ? (
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  variant="surface"
                  className={cn('px-3.5 max-md:h-9', agentClass(AGENT_DARK_TEXT, agent))}
                  onClick={() => {
                    onDecide(hand, 'listen');
                  }}
                >
                  {t('hands.listen')}
                </Button>
                <Tooltip content={t('hands.dismiss')}>
                  <IconButton
                    aria-label={t('hands.dismissAgent', { name })}
                    className="size-7"
                    onClick={() => {
                      onDecide(hand, 'dismiss');
                    }}
                  >
                    <X size={14} aria-hidden="true" />
                  </IconButton>
                </Tooltip>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
