import { useId } from 'react';

import { Checkbox, Radio } from '@web/components/ui/checkbox';
import { cn } from '@web/lib/cn';

type ChoiceProps = {
  type: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  disabled?: boolean;
  label: string;
  /** One line that says what the choice does. */
  text: string;
  onChange: (checked: boolean) => void;
};

/**
 * A radio button or checkbox with its label and one gray line, as a card (spec 36d): the subtle
 * surface under the pointer, an ink border while chosen.
 */
export function Choice({
  type,
  name,
  checked,
  disabled = false,
  label,
  text,
  onChange,
}: ChoiceProps) {
  const id = useId();
  const Control = type === 'radio' ? Radio : Checkbox;
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-card border px-3.5 py-3 transition-colors',
        checked ? 'border-ink' : 'border-border',
        !disabled && 'hover:bg-bg-subtle',
      )}
    >
      <Control
        id={id}
        name={name}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-text`}
        wrapperClassName="mt-px"
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <label
        htmlFor={id}
        className={cn('flex min-w-0 flex-col gap-0.5', !disabled && 'cursor-pointer')}
      >
        <span className="text-ui leading-4 font-medium text-text">{label}</span>
        <span id={`${id}-text`} className="text-small leading-snug text-text-3">
          {text}
        </span>
      </label>
    </div>
  );
}
