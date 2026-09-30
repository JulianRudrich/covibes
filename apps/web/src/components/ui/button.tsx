import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@web/lib/cn';

const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-on-ink shadow-button-primary hover:bg-ink-hover',
        secondary:
          'border border-border-strong bg-bg-panel text-text-body shadow-button-secondary hover:bg-bg-secondary-hover',
        ghost: 'bg-transparent text-text-body hover:bg-bg-subtle',
        /** Confirms something that cannot be undone, e.g. deleting a board. */
        danger: 'bg-danger text-on-ink shadow-button-primary hover:bg-danger/90',
      },
      size: {
        m: 'h-[30px] rounded-md px-3 text-ui',
        s: 'h-7 rounded-btn-s px-2.5 text-small',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'm',
    },
  },
);

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
