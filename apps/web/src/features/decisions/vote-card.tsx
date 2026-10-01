import type { MessageVote } from '@covibes/shared';
import { Check } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import { cn } from '@web/lib/cn';
import { initialsOf } from '@web/lib/format';

/** What the vote cards of a chat need besides the vote itself. */
export type Voting = {
  /** The owners and editors of the project: they vote, and the vote ends once all of them did. */
  voters: readonly { userId: string; name: string }[];
  /** The signed-in user. */
  userId: string;
  canVote: boolean;
  /** Owners end a vote early. */
  canClose: boolean;
  onVote: (vote: MessageVote, option: number) => void;
  onClose: (vote: MessageVote) => void;
};

const BOLD = { b: <strong className="font-semibold" /> };

/**
 * A vote in the moderator's chat card (spec 16b, derived look): one row per option with who voted
 * for it. Owners and editors click an option to vote or to change their vote; once the vote is
 * closed, the rows show the result and the line below names the winner or the tie.
 */
export function VoteCard({ vote, voting }: { vote: MessageVote; voting: Voting }) {
  const { t } = useTranslation();
  const open = vote.status === 'open';
  const names = new Map(voting.voters.map((voter) => [voter.userId, voter.name]));
  const mine = vote.ballots.find((ballot) => ballot.userId === voting.userId)?.option;
  const voted = vote.ballots.filter((ballot) => names.has(ballot.userId)).length;

  return (
    <div
      role="group"
      aria-label={t('votes.title', { topic: vote.topic })}
      className="flex flex-col gap-1.5"
    >
      <div className="text-meta font-medium text-text-3">
        {t('votes.title', { topic: vote.topic })}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {vote.options.map((option, index) => {
          const ballots = vote.ballots.filter((ballot) => ballot.option === index);
          const chosen = mine === index;
          const won = !open && vote.winner === option;
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-4 shrink-0 place-items-center rounded-full border',
                  won
                    ? 'border-success bg-success text-on-ink'
                    : chosen
                      ? 'border-ink bg-ink text-on-ink'
                      : 'border-border-strong',
                )}
              >
                {chosen || won ? <Check size={10} strokeWidth={3.2} /> : null}
              </span>
              <span className="min-w-0 flex-1 text-left text-ui font-medium wrap-break-word text-text">
                {option}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {ballots.map((ballot) => {
                  const name = names.get(ballot.userId) ?? t('canvas.formerMember');
                  return (
                    <Avatar
                      key={ballot.userId}
                      kind="human"
                      size={16}
                      label={name}
                      initials={
                        ballot.userId === voting.userId ? t('common.you') : initialsOf(name)
                      }
                    />
                  );
                })}
                <span className="min-w-3 text-right text-small text-text-3 tabular-nums">
                  {ballots.length}
                </span>
              </span>
            </>
          );
          const row = cn(
            'flex min-h-[34px] w-full items-center gap-2 rounded-md border bg-bg-panel px-2.5 py-1.5',
            won ? 'border-success' : chosen ? 'border-ink' : 'border-agent-moderator-border',
          );
          return (
            <li key={option}>
              {open && voting.canVote ? (
                <button
                  type="button"
                  aria-pressed={chosen}
                  aria-label={t('votes.voteFor', { option, count: ballots.length })}
                  className={cn(
                    row,
                    'cursor-pointer hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
                  )}
                  onClick={() => {
                    voting.onVote(vote, index);
                  }}
                >
                  {content}
                </button>
              ) : (
                <div
                  className={row}
                  aria-label={t('votes.result', { option, count: ballots.length })}
                >
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {open ? (
        <div className="flex min-h-7 items-center justify-between gap-2">
          <span className="text-meta text-text-3">
            {t('votes.progress', { voted, total: voting.voters.length })}
          </span>
          {voting.canClose ? (
            <Button
              size="s"
              onClick={() => {
                voting.onClose(vote);
              }}
            >
              {t('votes.close')}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="m-0 flex items-center gap-1.5 border-t border-agent-moderator-divider pt-2.5 text-small text-agent-moderator-dark">
          {vote.winner ? (
            <>
              <Check size={14} strokeWidth={2.4} className="shrink-0" aria-hidden="true" />
              <span>
                <Trans i18nKey="votes.decided" values={{ winner: vote.winner }} components={BOLD} />
              </span>
            </>
          ) : (
            t('votes.tie')
          )}
        </p>
      )}
    </div>
  );
}
