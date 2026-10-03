import type { PackageSuggestion } from '@covibes/shared';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { FieldError } from '@web/components/ui/input';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import { agentClass, useAgents } from '@web/features/agents/agents';
import { AGENT_DARK_TEXT, AGENT_PROPOSAL } from '@web/features/canvas/agent-look';
import { cn } from '@web/lib/cn';
import { formatClockTime } from '@web/lib/format';

const TEXT_BUTTON =
  'cursor-pointer rounded-sm text-small text-text-3 underline-offset-2 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-50';

type PackageSuggestionNoteProps = {
  /** The text the suggestion is for, as its field is labeled. */
  label: string;
  suggestion: PackageSuggestion | null;
  /** Owners and editors take a suggestion over or dismiss it; viewers only see it. */
  canEdit: boolean;
  /** Taking it over replaces a text: the field holds one. */
  replaces: boolean;
  /** Asking for it or taking it over did not work. */
  problem: boolean;
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
};

/**
 * What the moderator has for a text of the package (spec 27c; derived look), below its field: a
 * note while it writes, the suggestion with "Übernehmen" and "Verwerfen", or why its run gave
 * nothing. Nothing of it touches the field before someone takes the suggestion over.
 */
export function PackageSuggestionNote({
  label,
  suggestion,
  canEdit,
  replaces,
  problem,
  busy,
  onAccept,
  onDismiss,
}: PackageSuggestionNoteProps) {
  const { t, i18n } = useTranslation();
  const moderator = useAgents()('moderator');

  if (suggestion?.status === 'running') {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-card bg-bg-subtle px-3 py-2 text-small text-text-2"
      >
        <AgentAvatar agent={moderator} size={16} />
        <span className="animate-pulse">{t('export.package.suggestion.running')}</span>
        {canEdit ? (
          <button
            type="button"
            className={cn(TEXT_BUTTON, 'ml-auto shrink-0')}
            disabled={busy}
            onClick={onDismiss}
          >
            {t('common.cancel')}
          </button>
        ) : null}
      </div>
    );
  }

  if (suggestion?.status === 'ready') {
    return (
      <section
        aria-label={t('export.package.suggestion.titleFor', { text: label })}
        className={cn(
          'flex flex-col gap-2 rounded-card border border-dashed px-3 py-2.5',
          agentClass(AGENT_PROPOSAL, moderator),
        )}
      >
        <div className="flex items-center gap-1.5 text-small text-text-2">
          <AgentAvatar agent={moderator} size={16} />
          <span className={cn('font-semibold', agentClass(AGENT_DARK_TEXT, moderator))}>
            {moderator.name}
          </span>
          <span>· {t('export.package.suggestion.title')}</span>
        </div>
        <p className="m-0 max-h-48 overflow-y-auto pr-1 text-small leading-normal whitespace-pre-wrap text-text-body">
          {suggestion.content}
        </p>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button variant="primary" size="s" disabled={busy} onClick={onAccept}>
              {t('export.package.suggestion.accept')}
            </Button>
            <Button variant="ghost" size="s" disabled={busy} onClick={onDismiss}>
              {t('export.package.suggestion.dismiss')}
            </Button>
            {replaces ? (
              <span className="ml-auto text-meta text-text-3">
                {t('export.package.suggestion.replaces')}
              </span>
            ) : null}
          </div>
        ) : null}
        {problem ? <FieldError>{t('export.package.suggestion.failed')}</FieldError> : null}
      </section>
    );
  }

  if (suggestion?.status === 'failed') {
    const { failure } = suggestion;
    return (
      <div className="flex items-baseline gap-2">
        <FieldError>
          {failure.kind === 'quota'
            ? failure.resetsAt
              ? t('export.package.suggestion.quotaUntil', {
                  time: formatClockTime(failure.resetsAt, i18n.language),
                })
              : t('export.package.suggestion.quota')
            : t('export.package.suggestion.failed')}
        </FieldError>
        {canEdit ? (
          <button
            type="button"
            className={cn(TEXT_BUTTON, 'ml-auto shrink-0')}
            disabled={busy}
            onClick={onDismiss}
          >
            {t('export.package.suggestion.hide')}
          </button>
        ) : null}
      </div>
    );
  }

  return problem ? <FieldError>{t('export.package.suggestion.failed')}</FieldError> : null;
}
