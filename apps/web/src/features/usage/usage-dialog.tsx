import type { UsageAmount, UsageOverview } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, UserMinus, Zap } from 'lucide-react';
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
import { FieldError } from '@web/components/ui/input';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { useAgents } from '@web/features/agents/agents';
import { usageOverviewQuery } from '@web/features/usage/queries';
import { cn } from '@web/lib/cn';
import {
  formatCount,
  formatDayOfMonth,
  formatMonth,
  formatShare,
  formatUntil,
  formatUsd,
  initialsOf,
} from '@web/lib/format';

/** The month before a month like "2026-10". */
function monthBefore(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  return new Date(Date.UTC(year, index - 1, 1)).toISOString().slice(0, 7);
}

/** How many days a month like "2026-10" has. */
function daysIn(month: string): number {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
}

/**
 * The dialog "Verbrauch" (spec 31b; derived look), for owners: what the AI cost in the project in
 * a month, against the project's limit, and which agents, people and days the costs come from.
 * It shows the running month and, on request, the one before. The content of a dialog; the caller
 * opens and closes it.
 */
export function UsageDialog({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  // The server says which month runs; the one before follows from it.
  const running = useQuery(usageOverviewQuery(projectId, null)).data?.month ?? null;
  const [earlier, setEarlier] = useState(false);
  const before = running === null ? null : monthBefore(running);

  return (
    <DialogContent
      title={t('usage.title')}
      description={t('usage.hint')}
      className="w-[min(580px,calc(100vw-32px))]"
    >
      {running !== null && before !== null ? (
        <div
          role="group"
          aria-label={t('usage.month')}
          className="mb-4 inline-flex items-center gap-0.5 rounded-card bg-track p-[3px]"
        >
          {[before, running].map((month) => {
            const pressed = (month === before) === earlier;
            return (
              <button
                key={month}
                type="button"
                aria-pressed={pressed}
                onClick={() => {
                  setEarlier(month === before);
                }}
                className={cn(
                  'h-7 cursor-pointer rounded-btn-s px-2.5 text-ui whitespace-nowrap focus-visible:outline-2 focus-visible:outline-ink',
                  pressed
                    ? 'bg-bg-panel font-semibold text-text shadow-phase-active'
                    : 'text-text-upcoming hover:text-text',
                )}
              >
                {formatMonth(month, i18n.language)}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="max-h-[min(720px,calc(100dvh-230px))] overflow-y-auto pr-1">
        <UsageMonth projectId={projectId} month={earlier ? before : null} />
      </div>

      <div className="mt-4 flex justify-end">
        <DialogClose asChild>
          <Button variant="ghost">{t('common.close')}</Button>
        </DialogClose>
      </div>
    </DialogContent>
  );
}

/** One month: `month` null is the running one. */
function UsageMonth({ projectId, month }: { projectId: string; month: string | null }) {
  const { t, i18n } = useTranslation();
  const agents = useAgents();
  const loaded = useQuery(usageOverviewQuery(projectId, month));
  const overview = loaded.data;

  if (!overview) {
    return loaded.isError ? (
      <FieldError>{t('usage.loadFailed')}</FieldError>
    ) : (
      <p role="status" className="m-0 text-ui text-text-3">
        {t('common.loading')}
      </p>
    );
  }

  const byAgent = overview.byAgent.map((entry): RankedRow => {
    const agent = agents(entry.agentKey);
    return {
      key: entry.agentKey,
      icon: <AgentAvatar agent={agent} size={16} />,
      name: agent.name,
      amount: entry,
    };
  });
  const bySource = overview.bySource.map((entry): RankedRow => {
    if (entry.kind === 'member') {
      const name = entry.name.trim() || t('usage.sources.someone');
      return {
        key: entry.userId,
        icon: <Avatar kind="human" size={16} label={name} initials={initialsOf(name)} />,
        name,
        amount: entry,
      };
    }
    const Icon = entry.kind === 'left' ? UserMinus : Zap;
    return {
      key: entry.kind,
      icon: <Icon size={14} strokeWidth={2} className="text-text-3" />,
      name: t(`usage.sources.${entry.kind}`),
      amount: entry,
    };
  });
  const userLimit = overview.limits.userDayUsd;

  return (
    <div className="flex flex-col gap-5">
      <UsageTotal overview={overview} />
      {byAgent.length === 0 ? (
        <p className="m-0 text-ui leading-snug text-text-2">{t('usage.empty')}</p>
      ) : (
        <>
          <UsageRanking title={t('usage.byAgent')} rows={byAgent} />
          <UsageRanking title={t('usage.bySource')} rows={bySource} />
          <UsageDays overview={overview} />
        </>
      )}
      <p className="m-0 text-meta leading-snug text-text-3">
        {t('usage.note')}
        {userLimit > 0
          ? ` ${t('usage.noteUserLimit', { amount: formatUsd(userLimit, i18n.language) })}`
          : null}
        {overview.bySource.some((entry) => entry.kind === 'nobody')
          ? ` ${t('usage.noteNobody')}`
          : null}
      </p>
    </div>
  );
}

/**
 * The month's amount as one figure. The running month stands against the project's limit, with a
 * meter and when the month counts anew; a limit that is reached says so in words, the color only
 * goes with it. A month that is over shows its amount alone.
 */
function UsageTotal({ overview }: { overview: UsageOverview }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { total } = overview;
  const limit = overview.limits.projectMonthUsd;
  const limited = overview.current && limit > 0;
  const ratio = limited ? total.costUsd / limit : 0;
  const reached = limited && ratio >= 1;
  const amount = formatUsd(total.costUsd, locale);
  const time = formatUntil(overview.endsAt, locale);
  const stats: [string, string][] = [
    [t('usage.total.runs'), formatCount(total.runs, locale)],
    [t('usage.total.inputTokens'), formatCount(total.inputTokens, locale)],
    [t('usage.total.outputTokens'), formatCount(total.outputTokens, locale)],
  ];

  return (
    <section aria-label={t('usage.total.label')}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="m-0 text-[24px] leading-none font-semibold tracking-[-0.02em] text-text">
          {amount}
          {limited ? (
            <span className="ml-1.5 text-ui font-normal tracking-normal text-text-3">
              {t('usage.total.of', { limit: formatUsd(limit, locale) })}
            </span>
          ) : null}
        </p>
        {limited ? (
          <span className="text-ui font-medium text-text-2">{formatShare(ratio, locale)}</span>
        ) : null}
      </div>
      {limited ? (
        <div
          role="meter"
          aria-label={t('usage.total.meter')}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(total.costUsd, limit)}
          aria-valuetext={t('usage.total.meterValue', {
            amount,
            limit: formatUsd(limit, locale),
            share: formatShare(ratio, locale),
          })}
          className="mt-2.5 h-2 overflow-hidden rounded-full bg-track"
        >
          <div
            className={cn(
              'h-full rounded-full',
              reached ? 'bg-danger' : 'bg-ink',
              total.costUsd > 0 && 'min-w-[3px]',
            )}
            style={{ width: `${String(Math.min(ratio, 1) * 100)}%` }}
          />
        </div>
      ) : null}
      {reached ? (
        <p className="mt-2 mb-0 flex items-start gap-1.5 text-small leading-snug font-medium text-danger">
          <CircleAlert size={14} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
          {t('usage.total.reached', { time })}
        </p>
      ) : overview.current ? (
        <p className="mt-2 mb-0 text-small leading-snug text-text-3">
          {t(limited ? 'usage.total.resets' : 'usage.total.noLimit', { time })}
        </p>
      ) : null}
      <dl className="m-0 mt-3.5 grid grid-cols-3 gap-3 border-t border-border-soft pt-3">
        {stats.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-meta text-text-3">{label}</dt>
            <dd className="m-0 text-ui font-medium text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type RankedRow = { key: string; icon: ReactNode; name: string; amount: UsageAmount };

/**
 * Who the costs come from, the largest first: a bar per row against the largest, in one color,
 * with the amount and the runs written out. The picture beside the name says who it is.
 */
function UsageRanking({ title, rows }: { title: string; rows: RankedRow[] }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const largest = Math.max(0, ...rows.map((row) => row.amount.costUsd));

  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="m-0 mb-2 text-small font-semibold text-text-2">
        {title}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => (
          <li
            key={row.key}
            className="grid grid-cols-[minmax(0,170px)_minmax(0,1fr)_80px_68px] items-center gap-2.5"
          >
            <span className="flex min-w-0 items-center gap-2 text-ui text-text-body">
              <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
                {row.icon}
              </span>
              <span className="truncate">{row.name}</span>
            </span>
            <span aria-hidden="true" className="flex h-1.5">
              <span
                className={cn('rounded-r-full bg-chart', row.amount.costUsd > 0 && 'min-w-[2px]')}
                style={{
                  width: `${String(largest > 0 ? (row.amount.costUsd / largest) * 100 : 0)}%`,
                }}
              />
            </span>
            <span className="text-right text-ui text-text tabular-nums">
              {formatUsd(row.amount.costUsd, i18n.language)}
            </span>
            <span className="text-right text-small text-text-3 tabular-nums">
              {t('usage.runs', { count: row.amount.runs })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What every day of the month cost: one column per day, the days still to come left empty. The
 * line below names the day with the highest costs, and the day under the pointer or the keyboard:
 * the arrow keys walk through the days.
 */
function UsageDays({ overview }: { overview: UsageOverview }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const locale = i18n.language;
  const { byDay } = overview;
  const largest = Math.max(0, ...byDay.map((entry) => entry.costUsd));
  const peak = largest > 0 ? byDay.findIndex((entry) => entry.costUsd === largest) : -1;
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  // The one day the Tab key reaches; the arrow keys go on from there.
  const [reachable, setReachable] = useState(peak >= 0 ? peak : byDay.length - 1);

  const said = (index: number) => {
    const entry = byDay[index];
    return entry
      ? t('usage.days.day', {
          day: formatDayOfMonth(entry.day, locale),
          amount: formatUsd(entry.costUsd, locale),
          runs: t('usage.runs', { count: entry.runs }),
        })
      : '';
  };
  const shown = hovered ?? focused;
  const peakDay = byDay[peak];

  function walk(event: KeyboardEvent<HTMLDivElement>) {
    const last = byDay.length - 1;
    const from = focused ?? reachable;
    const target =
      event.key === 'ArrowLeft'
        ? Math.max(from - 1, 0)
        : event.key === 'ArrowRight'
          ? Math.min(from + 1, last)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    event.currentTarget.querySelectorAll('button')[target]?.focus();
  }

  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="m-0 mb-2 text-small font-semibold text-text-2">
        {t('usage.days.title')}
      </h3>
      {/* Keys on the group move between its buttons, as in a toolbar. */}
      <div
        role="group"
        aria-label={t('usage.days.chart')}
        onKeyDown={walk}
        className="flex h-24 items-end gap-[2px] border-b border-border-strong"
      >
        {Array.from({ length: daysIn(overview.month) }, (_, index) => {
          const entry = byDay[index];
          // A day still to come has no column and nothing to say.
          if (!entry) return <span key={index} className="flex-1" />;
          return (
            <button
              key={entry.day}
              type="button"
              tabIndex={index === reachable ? 0 : -1}
              aria-label={said(index)}
              onMouseEnter={() => {
                setHovered(index);
              }}
              onMouseLeave={() => {
                setHovered(null);
              }}
              onFocus={() => {
                setFocused(index);
                setReachable(index);
              }}
              onBlur={() => {
                setFocused(null);
              }}
              className={cn(
                'flex h-full flex-1 cursor-default items-end rounded-t-[3px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink',
                shown === index && 'bg-bg-subtle',
              )}
            >
              <span
                className={cn(
                  'block w-full rounded-t-[3px]',
                  shown === index ? 'bg-ink' : 'bg-chart',
                  entry.costUsd > 0 && 'min-h-[2px]',
                )}
                style={{
                  height: `${String(largest > 0 ? (entry.costUsd / largest) * 100 : 0)}%`,
                }}
              />
            </button>
          );
        })}
      </div>
      <div aria-hidden="true" className="mt-1 flex gap-[2px]">
        {Array.from({ length: daysIn(overview.month) }, (_, index) => (
          <span key={index} className="flex-1 text-center text-badge text-text-4 tabular-nums">
            {index === 0 || (index + 1) % 5 === 0 ? index + 1 : null}
          </span>
        ))}
      </div>
      <p className="mt-2 mb-0 min-h-[1lh] text-small leading-snug text-text-2">
        {shown !== null
          ? said(shown)
          : peakDay
            ? t('usage.days.peak', {
                day: formatDayOfMonth(peakDay.day, locale),
                amount: formatUsd(peakDay.costUsd, locale),
              })
            : null}
      </p>
    </section>
  );
}
