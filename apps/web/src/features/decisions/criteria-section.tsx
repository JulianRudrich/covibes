import { CRITERION_MAX_LENGTH, MAX_CRITERIA_PER_PROJECT, type Criterion } from '@covibes/shared';
import { Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@web/lib/cn';

type CriteriaSectionProps = {
  criteria: readonly Criterion[];
  /** Owners and editors add, change and remove criteria; viewers only see them. */
  edit?: {
    onAdd: (text: string) => void;
    onChange: (criterion: Criterion) => void;
    onRemove: (id: string) => void;
  };
};

// Handoff "Kriterien": outlined round pills, 30 px.
const CHIP =
  'flex h-[30px] max-w-full items-center rounded-full border border-border-strong text-small text-text-2';

/**
 * "Kriterien" in the overview (handoff, section 4; spec 16a): the project criteria as chips.
 * Owners and editors click a chip to change it, remove it with its "×" and add one with "+"
 * (derived look).
 */
export function CriteriaSection({ criteria, edit }: CriteriaSectionProps) {
  const { t } = useTranslation();
  const titleId = useId();
  // The criterion in the input: an id, 'new' for a new one, or none.
  const [editing, setEditing] = useState<string | null>(null);

  function commit(id: string, text: string, before: string) {
    setEditing(null);
    const value = text.trim();
    if (!edit || value === before) return;
    if (id === 'new') {
      if (value !== '') edit.onAdd(value);
    } else if (value === '') {
      edit.onRemove(id);
    } else {
      edit.onChange({ id, text: value });
    }
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2.5">
      <h2 id={titleId} className="m-0 font-display text-display font-semibold text-text">
        {t('criteria.title')}
      </h2>
      {/* Without criteria the section says what they are for (spec 33), also to those who can
          add the first one below. */}
      {criteria.length === 0 ? (
        <p className="m-0 text-small leading-snug text-text-3">{t('criteria.empty')}</p>
      ) : null}
      {criteria.length === 0 && !edit ? null : (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {criteria.map((criterion) => (
            <li key={criterion.id} className="max-w-full">
              {editing === criterion.id ? (
                <CriterionInput
                  initial={criterion.text}
                  label={t('criteria.change', { text: criterion.text })}
                  onCommit={(text) => {
                    commit(criterion.id, text, criterion.text);
                  }}
                  onCancel={() => {
                    setEditing(null);
                  }}
                />
              ) : edit ? (
                <span className={cn(CHIP, 'group relative')}>
                  <button
                    type="button"
                    aria-label={t('criteria.change', { text: criterion.text })}
                    className="h-full min-w-0 cursor-text truncate rounded-full px-[13px] focus-visible:outline-2 focus-visible:outline-ink"
                    onClick={() => {
                      setEditing(criterion.id);
                    }}
                  >
                    {criterion.text}
                  </button>
                  <button
                    type="button"
                    aria-label={t('criteria.remove', { text: criterion.text })}
                    // Over the end of the chip, so the chip keeps the size of the handoff.
                    className="absolute top-1/2 right-1 grid size-[22px] -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-bg-panel text-text-3 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-bg-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-ink"
                    onClick={() => {
                      edit.onRemove(criterion.id);
                    }}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ) : (
                <span className={cn(CHIP, 'px-[13px]')}>
                  <span className="truncate">{criterion.text}</span>
                </span>
              )}
            </li>
          ))}
          {edit && criteria.length < MAX_CRITERIA_PER_PROJECT ? (
            <li>
              {editing === 'new' ? (
                <CriterionInput
                  initial=""
                  label={t('criteria.add')}
                  onCommit={(text) => {
                    commit('new', text, '');
                  }}
                  onCancel={() => {
                    setEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  aria-label={t('criteria.add')}
                  className="flex h-[30px] min-w-[30px] cursor-pointer items-center justify-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 text-small text-text-3 hover:bg-wash hover:text-text focus-visible:outline-2 focus-visible:outline-ink"
                  onClick={() => {
                    setEditing('new');
                  }}
                >
                  <Plus size={12} aria-hidden="true" />
                  {criteria.length === 0 ? t('criteria.addFirst') : null}
                </button>
              )}
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

/** A chip-shaped input: Enter or leaving it saves, Escape cancels. */
function CriterionInput({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  // The input replaces the chip that was clicked, so it takes the focus with its text selected.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCommit(text);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <input
      ref={input}
      aria-label={label}
      value={text}
      maxLength={CRITERION_MAX_LENGTH}
      size={Math.max(8, text.length + 1)}
      className={cn(CHIP, 'max-w-[260px] border-ink bg-bg-panel px-[13px] text-text outline-none')}
      onChange={(event) => {
        setText(event.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        onCommit(text);
      }}
    />
  );
}
