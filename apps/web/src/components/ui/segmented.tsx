import { cn } from '@web/lib/cn';

type SegmentedProps<T extends string> = {
  /** The accessible name of the group; left out inside a fieldset, whose legend names it. */
  label?: string;
  /** The name that ties the radio buttons together. */
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  describedBy?: string;
  onChange: (value: T) => void;
  className?: string;
};

/**
 * A segmented switch (spec 36d, from the agent editor of 36c): the track on the subtle surface, the
 * chosen item a panel pill with the block shadow. Radio buttons inside, so arrows move the choice.
 */
export function Segmented<T extends string>({
  label,
  name,
  value,
  options,
  disabled = false,
  describedBy,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role={label ? 'radiogroup' : undefined}
      aria-label={label}
      className={cn('flex w-fit gap-0.5 rounded-full bg-bg-subtle p-[3px]', className)}
    >
      {options.map((option) => (
        <label key={option.value} className="relative flex">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            aria-describedby={describedBy}
            className="peer absolute inset-0 m-0 opacity-0 enabled:cursor-pointer"
            onChange={() => {
              onChange(option.value);
            }}
          />
          <span className="flex h-[30px] items-center rounded-full px-3.5 text-ui whitespace-nowrap text-text-3 transition-colors peer-checked:bg-bg-panel peer-checked:font-semibold peer-checked:text-text peer-checked:shadow-block peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-enabled:peer-hover:text-text peer-disabled:opacity-60">
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * The same look for views that are not a form value, e.g. the month of the usage dialog: toggle
 * buttons with `aria-pressed` in a labeled group.
 */
export function SegmentedToggle({
  label,
  items,
  className,
}: {
  label: string;
  items: readonly { id: string; label: string; pressed: boolean; onPress: () => void }[];
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex w-fit flex-wrap gap-0.5 rounded-full bg-bg-subtle p-[3px]', className)}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={item.pressed}
          className={cn(
            'flex h-[30px] cursor-pointer items-center rounded-full px-3.5 text-ui whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
            item.pressed
              ? 'bg-bg-panel font-semibold text-text shadow-block'
              : 'text-text-3 hover:text-text',
          )}
          onClick={item.onPress}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
