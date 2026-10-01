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

// Handoff "Criteria": 26 px chips with radius 7 on the muted background.
const CHIP =
  'flex h-[26px] max-w-full items-center rounded-btn-s border border-border-soft bg-bg-muted text-small text-text-chip';

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
    <section aria-labelledby={titleId} className="flex flex-col gap-2.5 p-4">
      <h3 id={titleId} className="m-0 text-ui font-semibold text-text">
        {t('criteria.title')}
      </h3>
      {criteria.length === 0 && !edit ? (
        <p className="m-0 text-small text-text-3">{t('criteria.empty')}</p>
      ) : (
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
                    className="h-full min-w-0 cursor-text truncate rounded-btn-s px-[9px] focus-visible:outline-2 focus-visible:outline-ink"
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
                    className="absolute top-1/2 right-0.5 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-xs bg-bg-muted text-text-3 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-bg-hover-app hover:text-text focus-visible:outline-2 focus-visible:outline-ink"
                    onClick={() => {
                      edit.onRemove(criterion.id);
                    }}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ) : (
                <span className={cn(CHIP, 'px-[9px]')}>
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
                  className="flex h-[26px] cursor-pointer items-center gap-1 rounded-btn-s border border-dashed border-border-strong px-2 text-small text-text-3 hover:bg-bg-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-ink"
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
      className={cn(CHIP, 'max-w-[260px] border-ink bg-bg-panel px-[9px] outline-none')}
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
