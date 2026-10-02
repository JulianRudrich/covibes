import {
  planSectionTitle,
  type PlanLanguage,
  type PlanState,
  type PlanSuggestion,
} from '@covibes/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, useAgents } from '@web/features/agents/agents';
import { AGENT_DARK_TEXT, AGENT_PROPOSAL } from '@web/features/canvas/agent-look';
import { PlanContent } from '@web/features/plan/plan-content';
import type { PlanDecision } from '@web/features/plan/queries';
import { cn } from '@web/lib/cn';
import { formatClockTime } from '@web/lib/format';

type PlanSuggestionsProps = {
  state: PlanState;
  /** The project's language, in which the sections are named. */
  language: PlanLanguage;
  /** Owners and editors decide; viewers see the suggestions without buttons. */
  onDecide?: (decision: PlanDecision) => void;
};

/**
 * What the moderator has for the plan (spec 25b; derived looks), above the document: the note
 * while it writes, the note after a generation that failed, and one card per section it suggests,
 * with the suggested text. Accepting writes the text into that section of the plan.
 */
export function PlanSuggestions({ state, language, onDecide }: PlanSuggestionsProps) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const moderator = useAgents()('moderator');
  const { suggestions, generating, failure } = state;
  if (!generating && !failure && suggestions.length === 0) return null;

  const accentText = agentClass(AGENT_DARK_TEXT, moderator);
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h3 id={titleId} className="sr-only">
        {t('plan.suggestions.title')}
      </h3>

      {generating ? (
        <p
          role="status"
          className="m-0 flex items-center gap-2 rounded-card bg-bg-subtle px-3.5 py-2.5 text-body text-text-2"
        >
          <AgentAvatar agent={moderator} size={16} />
          <span className="animate-pulse">{t('plan.generating')}</span>
        </p>
      ) : failure ? (
        <p
          role="alert"
          className="m-0 rounded-card bg-bg-subtle px-3.5 py-2.5 text-body text-text-2"
        >
          {failure.kind === 'quota'
            ? failure.resetsAt
              ? t('plan.failure.quotaUntil', {
                  time: formatClockTime(failure.resetsAt, i18n.language),
                })
              : t('plan.failure.quota')
            : t('plan.failure.failed')}
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
  look,
  accentText,
  onDecide,
}: {
  suggestion: PlanSuggestion;
  title: string;
  look: string;
  accentText: string;
  onDecide?: (decision: PlanDecision) => void;
}) {
  const { t } = useTranslation();
  const label = t('plan.suggestions.for', { section: title });
  return (
    <li
      aria-label={label}
      className={cn('flex flex-col gap-2.5 rounded-card border-[1.5px] border-dashed p-4', look)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-title font-semibold text-text">{title}</span>
        <span className={cn('shrink-0 text-meta font-medium', accentText)}>
          {t('plan.suggestions.kind')}
        </span>
      </div>
      <PlanContent nodes={suggestion.content} />
      {onDecide ? (
        <div className="flex gap-2">
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
        </div>
      ) : null}
    </li>
  );
}
