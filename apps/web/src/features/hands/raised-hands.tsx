import type { HandRaise } from '@covibes/shared';
import { Hand, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { IconButton } from '@web/components/ui/icon-button';
import { Tooltip } from '@web/components/ui/tooltip';
import {
  AGENT_BACKGROUND,
  AGENT_DARK_TEXT,
  AGENT_HAND,
  AGENT_HAND_BUTTON,
} from '@web/features/canvas/agent-look';
import type { HandDecision } from '@web/features/hands/queries';
import { cn } from '@web/lib/cn';

type RaisedHandsProps = {
  hands: readonly HandRaise[];
  /** Owners and editors listen or dismiss; viewers only see the cards. */
  onDecide?: (hand: HandRaise, decision: HandDecision) => void;
};

/**
 * The open raised hands above the composer (spec 15; handoff "Raised hand"): the agent's square
 * with a hand, "Kritiker meldet sich – …" and "Anhören". "Nicht jetzt" dismisses the hand (derived
 * look).
 */
export function RaisedHands({ hands, onDecide }: RaisedHandsProps) {
  const { t } = useTranslation();
  if (hands.length === 0) return null;

  return (
    <ul aria-label={t('hands.label')} className="m-0 flex list-none flex-col gap-2.5 p-0">
      {hands.map((hand) => {
        const name = t(`agents.${hand.agentKey}`);
        return (
          <li
            key={hand.id}
            className={cn(
              'flex items-center gap-2.5 rounded-card border py-2.5 pr-2.5 pl-3',
              AGENT_HAND[hand.agentKey],
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-md text-on-ink',
                AGENT_BACKGROUND[hand.agentKey],
              )}
            >
              <Hand size={15} strokeWidth={2} />
            </span>
            <p className="m-0 min-w-0 flex-1 text-ui leading-snug wrap-break-word text-text-2">
              <strong className={cn('font-semibold', AGENT_DARK_TEXT[hand.agentKey])}>
                {t('hands.raises', { name })}
              </strong>
              {` – ${hand.reason}`}
            </p>
            {onDecide ? (
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  className={cn('bg-bg-panel', AGENT_HAND_BUTTON[hand.agentKey])}
                  onClick={() => {
                    onDecide(hand, 'listen');
                  }}
                >
                  {t('hands.listen')}
                </Button>
                <Tooltip content={t('hands.dismiss')}>
                  <IconButton
                    aria-label={t('hands.dismissAgent', { name })}
                    className="size-6"
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
