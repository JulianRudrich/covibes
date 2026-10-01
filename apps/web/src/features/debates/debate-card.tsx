import { debatedRounds, debateProgress, type MessageDebate } from '@covibes/shared';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import { AGENT_DARK_TEXT } from '@web/features/canvas/agent-look';
import { cn } from '@web/lib/cn';

/**
 * A debate in the moderator's chat card (spec 18, derived look): the question, who debates, and
 * where the debate stands. Owners and editors end a running debate early with `onStop`; the turn
 * in progress is still finished, then the moderator sums up.
 */
export function DebateCard({
  debate,
  onStop,
}: {
  debate: MessageDebate;
  /** Ends the debate early; without it (viewers) the button is left out. */
  onStop?: (debate: MessageDebate) => void;
}) {
  const { t } = useTranslation();
  const title = t('debates.title', { topic: debate.topic });
  const progress = debate.status === 'running' && !debate.stopped ? debateProgress(debate) : null;

  return (
    <div role="group" aria-label={title} className="flex flex-col gap-1.5">
      <div className="text-meta font-medium text-text-3">{title}</div>
      <div className="flex flex-col gap-2 rounded-md border border-agent-moderator-border bg-bg-panel px-2.5 py-2">
        <p className="m-0 text-ui font-medium wrap-break-word text-text">{debate.question}</p>
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
          {debate.participants.map((agent) => {
            const name = t(`agents.${agent}`);
            return (
              <li
                key={agent}
                aria-current={progress?.speaker === agent ? 'true' : undefined}
                className="flex items-center gap-1.5 text-small"
              >
                <Avatar
                  kind="agent"
                  agent={agent}
                  size={16}
                  label={name}
                  initials={t(`agentInitials.${agent}`)}
                />
                <span className={cn('font-medium', AGENT_DARK_TEXT[agent])}>{name}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {debate.status === 'running' ? (
        <div className="flex min-h-7 items-center justify-between gap-2">
          <span className="text-meta text-text-3">
            {progress
              ? t('debates.turn', {
                  round: progress.round,
                  rounds: debate.rounds,
                  agent: t(`agents.${progress.speaker}`),
                })
              : t(debate.stopped ? 'debates.stopping' : 'debates.summarizing')}
          </span>
          {onStop && !debate.stopped ? (
            <Button
              size="s"
              onClick={() => {
                onStop(debate);
              }}
            >
              {t('debates.stop')}
            </Button>
          ) : null}
        </div>
      ) : debate.status === 'summarizing' ? (
        <div className="flex min-h-7 items-center text-meta text-text-3">
          {t('debates.summarizing')}
        </div>
      ) : debate.status === 'failed' ? (
        <p className="m-0 border-t border-agent-moderator-divider pt-2.5 text-small text-danger">
          {t('debates.failed')}
        </p>
      ) : (
        <p className="m-0 flex items-center gap-1.5 border-t border-agent-moderator-divider pt-2.5 text-small text-agent-moderator-dark">
          <Check size={14} strokeWidth={2.4} className="shrink-0" aria-hidden="true" />
          {debate.stopped
            ? debate.stoppedBy
              ? t('debates.stoppedBy', { name: debate.stoppedBy })
              : t('debates.stopped')
            : t('debates.finished', { count: debatedRounds(debate) })}
        </p>
      )}
    </div>
  );
}
