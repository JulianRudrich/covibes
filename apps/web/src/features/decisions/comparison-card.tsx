import type { Comparison, ComparisonRating } from '@covibes/shared';
import { Check, Minus, X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { cn } from '@web/lib/cn';

const RATING_COLOR: Record<ComparisonRating, string> = {
  good: 'text-success',
  ok: 'text-text-3',
  bad: 'text-danger',
};

function RatingIcon({ rating }: { rating: ComparisonRating }) {
  const Icon = rating === 'good' ? Check : rating === 'ok' ? Minus : X;
  return (
    <Icon
      size={13}
      strokeWidth={2.6}
      className={cn('mt-[3px] shrink-0', RATING_COLOR[rating])}
      aria-hidden="true"
    />
  );
}

const BOLD = { b: <strong className="font-semibold text-text" /> };

/**
 * The moderator's comparison of options by the project criteria (spec 16b, derived look): the
 * options as columns, one block per criterion with a rating and a note for every option, and the
 * recommendation if the moderator's stance allows one. Shown in the moderator's chat card and in
 * the dialog of the decision that followed it.
 */
export function ComparisonCard({ comparison }: { comparison: Comparison }) {
  const { t } = useTranslation();
  // The same columns for the header and every row.
  const columns = {
    gridTemplateColumns: `repeat(${String(comparison.options.length)}, minmax(0, 1fr))`,
  };

  return (
    <div
      role="group"
      aria-label={t('comparison.title', { topic: comparison.topic })}
      className="overflow-hidden rounded-md border border-agent-moderator-border bg-bg-panel"
    >
      <div className="border-b border-border-subtle px-2.5 py-1.5 text-meta font-medium text-text-3">
        {t('comparison.title', { topic: comparison.topic })}
      </div>
      <div className="grid gap-x-2.5 px-2.5 pt-2" style={columns}>
        {comparison.options.map((option) => (
          <div key={option} className="text-small font-semibold wrap-break-word text-text">
            {option}
          </div>
        ))}
      </div>
      {comparison.rows.map((row) => (
        <div key={row.criterion} className="px-2.5 pt-2 last:pb-2.5">
          <div className="text-meta text-text-3">{row.criterion}</div>
          <div className="mt-0.5 grid gap-x-2.5" style={columns}>
            {row.cells.map((cell, index) => (
              <div
                // Cells follow the order of the options.
                key={index}
                className="flex gap-1 text-small leading-snug wrap-break-word text-text-body"
              >
                <RatingIcon rating={cell.rating} />
                <span className="min-w-0">
                  <span className="sr-only">
                    {`${comparison.options[index] ?? ''}: ${t(`comparison.rating.${cell.rating}`)}. `}
                  </span>
                  {cell.note || t(`comparison.rating.${cell.rating}`)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {comparison.recommendation ? (
        <div className="mt-2.5 border-t border-border-subtle px-2.5 py-2 text-small leading-snug text-text-body">
          <Trans
            i18nKey="comparison.recommendation"
            values={{ option: comparison.recommendation.option }}
            components={BOLD}
          />
          {comparison.recommendation.reason ? ` – ${comparison.recommendation.reason}` : null}
        </div>
      ) : null}
    </div>
  );
}
