import type { ComponentProps } from 'react';

import { cn } from '@web/lib/cn';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'h-9 w-full rounded-md border border-border-strong bg-bg-panel px-3 text-ui text-text',
        'transition-colors focus-visible:border-ink focus-visible:outline-none',
        'aria-invalid:border-danger disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('block text-small font-medium text-text-2', className)} {...props} />;
}

/** Inline error below a field or form; announced by screen readers. */
export function FieldError({ className, ...props }: ComponentProps<'p'>) {
  return <p role="alert" className={cn('m-0 text-small text-danger', className)} {...props} />;
}
