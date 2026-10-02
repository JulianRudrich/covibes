import {
  diffPlan,
  planSectionTitle,
  type PlanChange,
  type PlanLanguage,
  type PlanNode,
  type PlanSection,
  type PlanState,
  type PlanSuggestion,
} from '@covibes/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, useAgents } from '@web/features/agents/agents';
import { AGENT_DARK_TEXT, AGENT_PROPOSAL } from '@web/features/canvas/agent-look';
import { PlanContent } from '@web/features/plan/plan-content';
import { PlanDiffView } from '@web/features/plan/plan-diff-view';
import type { PlanDecision } from '@web/features/plan/queries';
import { cn } from '@web/lib/cn';
import { formatClockTime } from '@web/lib/format';

type PlanSuggestionsProps = {
  state: PlanState;
  /** The project's language, in which the sections are named. */
  language: PlanLanguage;
  /** What every section of the plan holds right now, to show what a suggestion changes. */
  sections?: Partial<Record<PlanSection, PlanNode[]>>;
  /** Owners and editors decide; viewers see the suggestions without buttons. */
  onDecide?: (decision: PlanDecision) => void;
  /** Owners and editors bring an outdated plan up to date (spec 25c). */
  onUpdate?: () => void;
};

const NOTE = 'm-0 rounded-card bg-bg-subtle px-3.5 py-2.5 text-body text-text-2';

/** What changed in the project, as one short phrase per change. */
function useChangeList() {
  const { t, i18n } = useTranslation();
  return (changes: readonly PlanChange[], more: number): string =>
    new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format([
      ...changes.map((change) =>
        change.kind === 'criteria'
          ? t('plan.outdated.criteria')
          : t(`plan.outdated.${change.kind}`, { topic: change.topic ?? '' }),
      ),
      ...(more > 0 ? [t('plan.outdated.more', { count: more })] : []),
    ]);
}

/**
 * What the moderator has for the plan (specs 25b and 25c; derived looks), above the document: the
 * note while it writes, the note after a generation that failed, the note that the plan is
 * outdated or was found current, and one card per section it suggests. Accepting writes the text
 * into that section of the plan.
 */
export function PlanSuggestions({
  state,
  language,
  sections,
  onDecide,
  onUpdate,
}: PlanSuggestionsProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const moderator = useAgents()('moderator');
  const changeList = useChangeList();
  const { suggestions, generating, failure, outdated, upToDate } = state;
  // While suggestions wait, the plan is being brought up to date already.
  const showOutdated = outdated !== null && !generating && suggestions.length === 0;
  const showUpToDate = upToDate && !generating && !failure && suggestions.length === 0;
  if (!generating && !failure && !showOutdated && !showUpToDate && suggestions.length === 0) {
    return null;
  }

  const accentText = agentClass(AGENT_DARK_TEXT, moderator);
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h3 id={titleId} className="sr-only">
        {t('plan.suggestions.title')}
      </h3>

      {generating ? (
        <p role="status" className={cn(NOTE, 'flex items-center gap-2')}>
          <AgentAvatar agent={moderator} size={16} />
          <span className="animate-pulse">{t('plan.generating')}</span>
        </p>
      ) : failure ? (
        <p role="alert" className={NOTE}>
          {failure.kind === 'quota'
            ? failure.resetsAt
              ? t('plan.failure.quotaUntil', {
                  time: formatClockTime(failure.resetsAt, i18n.language),
                })
              : t('plan.failure.quota')
            : t('plan.failure.failed')}
        </p>
      ) : null}

      {showOutdated ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-card border border-border-strong bg-bg-panel px-3.5 py-2.5"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ui font-semibold text-text">{t('plan.outdated.title')}</span>
            <span className="text-small leading-snug text-text-2">
              {t('plan.outdated.since', { changes: changeList(outdated.changes, outdated.more) })}
            </span>
          </div>
          {onUpdate ? (
            <Button variant="primary" size="s" onClick={onUpdate}>
              {t('plan.outdated.update')}
            </Button>
          ) : null}
        </div>
      ) : showUpToDate ? (
        <p role="status" className={NOTE}>
          {t('plan.upToDate')}
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-ui text-text-2">
              <AgentAvatar agent={moderator} size={16} />
              <span className={cn('font-semibold', accentText)}>{moderator.name}</span>
              <span>· {t('plan.suggestions.count', { count: suggestions.length })}</span>
            </div>
            {onDecide && suggestions.length > 1 ? (
              <Button
                size="s"
                onClick={() => {
                  onDecide({ suggestionId: null, decision: 'accept' });
                }}
              >
                {t('plan.suggestions.acceptAll')}
              </Button>
            ) : null}
          </div>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {suggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                title={planSectionTitle(suggestion.section, language)}
                current={sections?.[suggestion.section]}
                look={agentClass(AGENT_PROPOSAL, moderator)}
                accentText={accentText}
                onDecide={onDecide}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function SuggestionCard({
  suggestion,
  title,
  current,
  look,
  accentText,
  onDecide,
}: {
  suggestion: PlanSuggestion;
  title: string;
  /** What the section holds right now; undefined while the section does not exist. */
  current: PlanNode[] | undefined;
  look: string;
  accentText: string;
  onDecide?: (decision: PlanDecision) => void;
}) {
  const { t } = useTranslation();
  const label = t('plan.suggestions.for', { section: title });
  // A section that holds text shows what the suggestion changes in it; an update starts there.
  const hasText = (current ?? []).some((node) => (node.content ?? []).length > 0);
  const [showChanges, setShowChanges] = useState(suggestion.kind === 'update');
  return (
    <li
      aria-label={label}
      className={cn('flex flex-col gap-2.5 rounded-card border-[1.5px] border-dashed p-4', look)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-title font-semibold text-text">{title}</span>
        <span className={cn('shrink-0 text-meta font-medium', accentText)}>
          {t(
            suggestion.kind === 'update' ? 'plan.suggestions.kindUpdate' : 'plan.suggestions.kind',
          )}
        </span>
      </div>
      {suggestion.handEdited ? (
        <p className="m-0 text-small leading-snug text-text-2">
          {t('plan.suggestions.handEdited')}
        </p>
      ) : null}
      {hasText && showChanges ? (
        <PlanDiffView lines={diffPlan(current ?? [], suggestion.content)} />
      ) : (
        <PlanContent nodes={suggestion.content} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {onDecide ? (
          <>
            <Button
              variant="primary"
              size="s"
              aria-label={t('plan.suggestions.acceptFor', { section: title })}
              onClick={() => {
                onDecide({ suggestionId: suggestion.id, decision: 'accept' });
              }}
            >
              {t('proposals.apply')}
            </Button>
            <Button
              size="s"
              aria-label={t('plan.suggestions.rejectFor', { section: title })}
              onClick={() => {
                onDecide({ suggestionId: suggestion.id, decision: 'reject' });
              }}
            >
              {t('proposals.reject')}
            </Button>
          </>
        ) : null}
        {hasText ? (
          <Button
            variant="ghost"
            size="s"
            aria-pressed={showChanges}
            aria-label={t('plan.suggestions.changesFor', { section: title })}
            onClick={() => {
              setShowChanges((shown) => !shown);
            }}
          >
            {t(showChanges ? 'plan.suggestions.showText' : 'plan.suggestions.showChanges')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
