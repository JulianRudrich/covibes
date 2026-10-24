import { foldPlanDiff, type PlanDiffLine } from '@covibes/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@web/lib/cn';

/** A line of the comparison, or a folded stretch by its place among the folds. */
type Row = PlanDiffLine | { kind: 'fold'; fold: number; count: number };

/**
 * What changes between two texts of the plan, line by line (spec 25c; derived looks): lines that
 * go in the danger tint and struck through, lines that come in the success tint, the rest plain.
 * Screen readers hear "entfällt" and "neu" in front of the changed lines. Long unchanged
 * stretches are folded, so the changes of a long plan show at once; a click opens a stretch.
 */
export function PlanDiffView({ lines }: { lines: readonly PlanDiffLine[] }) {
  const { t } = useTranslation();
  // The folds someone opened, by their place among the folds.
  const [opened, setOpened] = useState<readonly number[]>([]);
  if (!lines.some((line) => line.kind !== 'same')) {
    return <p className="m-0 text-small text-text-3">{t('plan.diff.none')}</p>;
  }

  const rows: Row[] = [];
  let folds = 0;
  for (const part of foldPlanDiff(lines)) {
    if (part.kind !== 'fold') {
      rows.push(part);
      continue;
    }
    if (opened.includes(folds)) rows.push(...part.lines);
    else rows.push({ kind: 'fold', fold: folds, count: part.lines.length });
    folds += 1;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-small leading-normal">
      {rows.map((row, index) =>
        // Lines only make sense in their order, and a text can hold the same line twice.
        row.kind === 'fold' ? (
          <li key={index}>
            <button
              type="button"
              className="w-full cursor-pointer rounded-sm border-0 bg-transparent px-2 py-0.5 text-left text-small text-text-3 hover:bg-wash hover:text-text-body focus-visible:outline-2 focus-visible:outline-ink"
              onClick={() => {
                setOpened((before) => [...before, row.fold]);
              }}
            >
              {t('plan.diff.unchanged', { count: row.count })}
            </button>
          </li>
        ) : (
          <li
            key={index}
            className={cn(
              'rounded-sm px-2 py-0.5 whitespace-pre-wrap',
              row.kind === 'removed' && 'bg-danger-bg text-danger line-through',
              row.kind === 'added' && 'bg-success-bg text-success',
              row.kind === 'same' && 'text-text-3',
            )}
          >
            {row.kind === 'same' ? null : (
              <span className="sr-only">{t(`plan.diff.${row.kind}`)}: </span>
            )}
            {row.text}
          </li>
        ),
      )}
    </ul>
  );
}
