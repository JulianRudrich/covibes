import {
  REOPEN_REASON_MAX_LENGTH,
  variantLetter,
  type Decision,
  type DecisionLogEntry,
  type DecisionVariants,
  type VoteTally,
} from '@covibes/shared';
import { Check } from 'lucide-react';
import { useId, useState, type SubmitEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@web/components/ui/dialog';
import { Label } from '@web/components/ui/input';
import { ComparisonCard } from '@web/features/decisions/comparison-card';
import { VariantPreview } from '@web/features/proposals/variant-preview';
import { cn } from '@web/lib/cn';
import { formatLongDate, formatRelativeTime } from '@web/lib/format';

type DecisionsSectionProps = {
  decisions: readonly Decision[];
  /** Topics (lowercase) whose variants wait for the team: "Vergleich A/B läuft" (spec 17). */
  comparing?: readonly string[];
  /** The decision log, loaded once the dialog opens; undefined while it loads. */
  log: readonly DecisionLogEntry[] | undefined;
  /** Opens the log; without it there is no "Protokoll" (the read-only view, spec 21b). */
  onOpenLog?: () => void;
  /** Owners and editors reopen a decision with a reason; viewers only read. */
  onReopen?: (decision: Decision, reason: string) => void;
  /**
   * The decision whose dialog is open, when something outside the section opens decisions too
   * (spec 23: "Seit du weg warst"); without it the section keeps that to itself.
   */
  openId?: string | null;
  onOpenIdChange?: (decisionId: string | null) => void;
};

const BOLD = { b: <strong className="font-semibold text-text" /> };

const NO_TOPICS: readonly string[] = [];

/**
 * The variants a decision chose from, as a snapshot (spec 17): every variant with a preview of its
 * diagram, its summary, and whether it was adopted or discarded.
 */
function VariantsSnapshot({ variants }: { variants: DecisionVariants }) {
  const { t } = useTranslation();
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {variants.variants.map((variant, position) => {
        const title = t('variants.title', { letter: variantLetter(position), name: variant.name });
        return (
          <li key={variant.name} className="flex flex-col gap-1">
            <VariantPreview operations={variant.operations} label={title} />
            <span className="text-small leading-snug text-text-3">
              <strong className="font-semibold text-text">{title}</strong>
              {` · ${t(position === variants.chosen ? 'variants.adopted' : 'variants.discarded')}`}
              {variant.summary ? ` – ${variant.summary}` : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The result of a vote in one line, e.g. "React Flow 2 · tldraw 1". */
function tallyText(tally: VoteTally): string {
  return tally.map((entry) => `${entry.name} ${String(entry.votes)}`).join(' · ');
}

/** Handoff "Entscheidungen": a green check circle when decided, a dashed ring while open. */
function StatusSymbol({ decided }: { decided: boolean }) {
  return decided ? (
    <span
      aria-hidden="true"
      className="grid size-[22px] shrink-0 place-items-center rounded-full bg-success-bg text-success"
    >
      <Check size={11} strokeWidth={3} />
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="size-[22px] shrink-0 rounded-full border-2 border-dashed border-text-3"
    />
  );
}

/**
 * "Entscheidungen" in the overview (handoff, section 4; spec 16a): every topic with its value,
 * decided or open. A row opens the decision with its reasoning and the discarded alternatives,
 * where owners and editors reopen it; "Protokoll" opens the decision log (derived looks).
 */
export function DecisionsSection({
  decisions,
  comparing = NO_TOPICS,
  log,
  onOpenLog,
  onReopen,
  openId: givenOpenId,
  onOpenIdChange,
}: DecisionsSectionProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [ownOpenId, setOwnOpenId] = useState<string | null>(null);
  const openId = givenOpenId !== undefined ? givenOpenId : ownOpenId;
  const setOpenId = onOpenIdChange ?? setOwnOpenId;
  const [logOpen, setLogOpen] = useState(false);
  // The decision may change or disappear while its dialog is open.
  const open = decisions.find((decision) => decision.id === openId);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 id={titleId} className="m-0 font-display text-display font-semibold text-text">
          {t('decisions.title')}
        </h2>
        {onOpenLog ? (
          <button
            type="button"
            className="cursor-pointer rounded-xs text-meta text-text-3 underline-offset-2 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-ink"
            onClick={() => {
              setLogOpen(true);
              onOpenLog();
            }}
          >
            {t('decisions.log')}
          </button>
        ) : null}
      </div>

      {decisions.length === 0 ? (
        <p className="m-0 text-small leading-snug text-text-3">{t('decisions.empty')}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {decisions.map((decision) => {
            const decided = decision.status === 'decided';
            const isComparing = comparing.includes(decision.topic.toLowerCase());
            return (
              <li key={decision.id}>
                {/* One row per topic (handoff): the topic on the left, the value or "offen" on
                    the right; the row opens the decision. */}
                <button
                  type="button"
                  className="-mx-2 flex w-[calc(100%+16px)] cursor-pointer items-center gap-2.5 rounded-full px-2 py-1.5 text-left transition-colors hover:bg-wash focus-visible:outline-2 focus-visible:outline-ink"
                  onClick={() => {
                    setOpenId(decision.id);
                  }}
                >
                  <StatusSymbol decided={decided} />
                  <span className="min-w-0 flex-1 truncate text-body text-text-3">
                    {decision.topic}
                  </span>
                  {decided ? (
                    <span className="max-w-[55%] shrink-0 truncate text-body font-semibold text-text">
                      {decision.value}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'flex h-6 shrink-0 items-center rounded-full px-2.5 text-status font-semibold',
                        isComparing
                          ? 'bg-agent-moderator-tint text-agent-moderator-dark'
                          : 'bg-bg-subtle text-text-2',
                      )}
                    >
                      {isComparing ? t('decisions.comparing') : t('decisions.open')}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={open !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setOpenId(null);
        }}
      >
        {open ? (
          <DecisionDialog
            decision={open}
            comparing={comparing.includes(open.topic.toLowerCase())}
            onReopen={
              onReopen
                ? (reason) => {
                    onReopen(open, reason);
                    setOpenId(null);
                  }
                : undefined
            }
          />
        ) : null}
      </Dialog>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        {logOpen ? <DecisionLogDialog log={log} /> : null}
      </Dialog>
    </section>
  );
}

/** One decision with reasoning and alternatives; owners and editors reopen it with a reason. */
function DecisionDialog({
  decision,
  comparing,
  onReopen,
}: {
  decision: Decision;
  /** Whether variants for the topic wait for the team (spec 17). */
  comparing: boolean;
  onReopen?: (reason: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const reasonId = useId();
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const decided = decision.status === 'decided';

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (onReopen && reason.trim() !== '') onReopen(reason.trim());
  }

  return (
    <DialogContent title={decision.topic}>
      {/* A decision with a comparison is long; it scrolls inside the dialog. */}
      <div className="flex max-h-[min(75vh,680px)] flex-col gap-3 overflow-y-auto pr-1 text-ui text-text-body">
        <div className="flex items-center gap-2.5">
          <StatusSymbol decided={decided} />
          <span className="text-title font-semibold text-text">
            {decided
              ? decision.value
              : t(comparing ? 'decisions.comparing' : 'decisions.notDecided')}
          </span>
        </div>
        {decided && decision.decidedAt ? (
          <p className="m-0 text-small text-text-3">
            {decision.tally
              ? t('decisions.byVote', {
                  result: tallyText(decision.tally),
                  date: formatLongDate(decision.decidedAt, i18n.language),
                })
              : decision.decidedBy
                ? t('decisions.confirmedBy', {
                    name: decision.decidedBy,
                    date: formatLongDate(decision.decidedAt, i18n.language),
                  })
                : formatLongDate(decision.decidedAt, i18n.language)}
          </p>
        ) : null}
        {decision.reopenReason ? (
          <p className="m-0">
            <Trans
              i18nKey="decisions.reopenedBecause"
              values={{ reason: decision.reopenReason }}
              components={BOLD}
            />
          </p>
        ) : null}
        {decision.reasoning ? <p className="m-0 leading-normal">{decision.reasoning}</p> : null}
        {decision.comparison ? <ComparisonCard comparison={decision.comparison} /> : null}
        {decision.variants ? <VariantsSnapshot variants={decision.variants} /> : null}
        {/* The snapshot of the variants already names the discarded ones. */}
        {decision.alternatives.length > 0 && !decision.variants ? (
          <div>
            <h4 className="m-0 mb-1 text-small font-medium text-text-2">
              {t('decisions.alternatives')}
            </h4>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {decision.alternatives.map((alternative) => (
                <li key={alternative.name}>
                  <strong className="font-semibold text-text">{alternative.name}</strong>
                  {alternative.note ? ` – ${alternative.note}` : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {reopening ? (
          <form
            onSubmit={submit}
            className="flex flex-col gap-2 border-t border-border-subtle pt-3"
          >
            <Label htmlFor={reasonId}>{t('decisions.reopenReason')}</Label>
            <textarea
              id={reasonId}
              value={reason}
              maxLength={REOPEN_REASON_MAX_LENGTH}
              rows={3}
              required
              className="w-full resize-none rounded-md border border-border-strong bg-bg-panel px-3 py-2 text-ui text-text focus-visible:border-ink focus-visible:outline-none"
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <p className="m-0 text-small text-text-3">{t('decisions.reopenHint')}</p>
            <div className="mt-1 flex justify-end gap-2">
              <Button
                onClick={() => {
                  setReopening(false);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={reason.trim() === ''}>
                {t('decisions.reopen')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-1 flex justify-end gap-2">
            {decided && onReopen ? (
              <Button
                onClick={() => {
                  setReopening(true);
                }}
              >
                {t('decisions.reopen')}
              </Button>
            ) : null}
            <DialogClose asChild>
              <Button variant="primary">{t('common.close')}</Button>
            </DialogClose>
          </div>
        )}
      </div>
    </DialogContent>
  );
}

/** The decision log, newest first: decisions, reopenings and changes of the criteria. */
function DecisionLogDialog({ log }: { log: readonly DecisionLogEntry[] | undefined }) {
  const { t, i18n } = useTranslation();

  return (
    <DialogContent title={t('decisions.logTitle')} className="w-[min(560px,calc(100vw-32px))]">
      {log === undefined ? (
        <p className="m-0 text-ui text-text-3">{t('common.loading')}</p>
      ) : log.length === 0 ? (
        <p className="m-0 text-ui text-text-3">{t('decisions.logEmpty')}</p>
      ) : (
        <ol className="m-0 flex max-h-[min(60vh,520px)] list-none flex-col gap-3 overflow-y-auto p-0 pr-1">
          {log.map((entry) => {
            const by = [entry.user, entry.agentKey ? t(`agents.${entry.agentKey}`) : null].filter(
              (name) => name !== null,
            );
            return (
              <li key={entry.id} className="flex flex-col gap-0.5 text-ui text-text-body">
                <span className="leading-snug">
                  <Trans
                    i18nKey={`decisions.entry.${entry.kind}`}
                    values={{
                      topic: entry.topic ?? '',
                      value: entry.value ?? '',
                      previous: entry.previous ?? '',
                    }}
                    components={BOLD}
                  />
                </span>
                {entry.reason ? (
                  <span className="text-small text-text-2">
                    {t('decisions.reason', { reason: entry.reason })}
                  </span>
                ) : null}
                {entry.kind === 'decided' && entry.reasoning ? (
                  <span className="text-small text-text-2">{entry.reasoning}</span>
                ) : null}
                {entry.votes ? (
                  <span className="text-small text-text-2">
                    {t('decisions.votes', { result: tallyText(entry.votes) })}
                  </span>
                ) : null}
                {entry.compared ? (
                  <span className="text-small text-text-2">{t('decisions.compared')}</span>
                ) : null}
                {entry.variants ? (
                  <details className="text-small text-text-2">
                    <summary className="cursor-pointer">{t('variants.snapshot')}</summary>
                    <div className="mt-1.5">
                      <VariantsSnapshot variants={entry.variants} />
                    </div>
                  </details>
                ) : null}
                {entry.kind === 'decided' && entry.alternatives && entry.alternatives.length > 0 ? (
                  <span className="text-small text-text-2">
                    {t('decisions.discarded', {
                      names: entry.alternatives.map((alternative) => alternative.name).join(', '),
                    })}
                  </span>
                ) : null}
                <span className="text-meta text-text-3">
                  {[...by, formatRelativeTime(entry.createdAt, i18n.language)].join(' · ')}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-4 flex justify-end">
        <DialogClose asChild>
          <Button variant="primary">{t('common.close')}</Button>
        </DialogClose>
      </div>
    </DialogContent>
  );
}
