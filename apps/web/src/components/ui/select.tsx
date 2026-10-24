import { cva, type VariantProps } from 'class-variance-authority';
import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@web/lib/cn';

const selectVariants = cva(
  'w-full cursor-pointer appearance-none border border-border-strong bg-bg-panel pr-8 text-text transition-colors hover:bg-bg-secondary-hover focus-visible:border-ink focus-visible:outline-none disabled:cursor-default disabled:opacity-50',
  {
    variants: {
      size: {
        s: 'h-7 rounded-full pl-3 text-small',
        m: 'h-8 rounded-full pl-3.5 text-ui',
        /** Next to inputs in a form: the field's height and radius. */
        field: 'h-9 rounded-md pl-3 text-ui',
      },
    },
    defaultVariants: { size: 'm' },
  },
);

type SelectProps = Omit<ComponentProps<'select'>, 'size'> &
  VariantProps<typeof selectVariants> & {
    /** Classes of the wrapper, e.g. its width; `className` goes to the select itself. */
    wrapperClassName?: string;
  };

/**
 * A native select as a pill with a chevron (spec 36d). It stays native, so keyboard, screen
 * readers and the system's list of options work as everywhere.
 */
export function Select({ className, wrapperClassName, size, ...props }: SelectProps) {
  return (
    <span className={cn('relative inline-flex shrink-0', wrapperClassName)}>
      <select className={cn(selectVariants({ size }), className)} {...props} />
      <ChevronDown
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-text-3"
      />
    </span>
  );
}
