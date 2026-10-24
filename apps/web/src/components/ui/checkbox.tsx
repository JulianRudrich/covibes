import { Check, Minus } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@web/lib/cn';

type InputProps = Omit<ComponentProps<'input'>, 'type'> & {
  /** Classes of the wrapper, e.g. a top margin to align it with the first line of a label. */
  wrapperClassName?: string;
};

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

/**
 * A native checkbox drawn in the studio look (spec 36d): 16 px with the stronger border, checked in
 * ink with a check in `on-ink`, partly checked with a dash.
 */
export function Checkbox({ className, wrapperClassName, ...props }: InputProps) {
  return (
    <span
      className={cn('relative inline-grid size-4 shrink-0 place-items-center', wrapperClassName)}
    >
      <input
        type="checkbox"
        className={cn(
          'peer m-0 size-4 appearance-none rounded-xs border-[1.5px] border-border-strong bg-bg-panel transition-colors',
          'checked:border-ink checked:bg-ink indeterminate:border-ink indeterminate:bg-ink enabled:cursor-pointer enabled:hover:border-text-3 enabled:checked:hover:border-ink disabled:opacity-50',
          FOCUS,
          className,
        )}
        {...props}
      />
      <Check
        size={12}
        strokeWidth={3}
        aria-hidden="true"
        className="pointer-events-none absolute hidden text-on-ink peer-checked:block peer-indeterminate:hidden"
      />
      <Minus
        size={12}
        strokeWidth={3}
        aria-hidden="true"
        className="pointer-events-none absolute hidden text-on-ink peer-indeterminate:block"
      />
    </span>
  );
}

/** A native radio button in the studio look: round, checked as an ink ring around a panel dot. */
export function Radio({ className, wrapperClassName, ...props }: InputProps) {
  return (
    <span className={cn('inline-grid size-4 shrink-0', wrapperClassName)}>
      <input
        type="radio"
        className={cn(
          'm-0 size-4 appearance-none rounded-full border-[1.5px] border-border-strong bg-bg-panel transition-[border-color,border-width]',
          'checked:border-[5px] checked:border-ink enabled:cursor-pointer enabled:hover:border-text-3 enabled:checked:hover:border-ink disabled:opacity-50',
          FOCUS,
          className,
        )}
        {...props}
      />
    </span>
  );
}
