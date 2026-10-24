import type { ComponentProps } from 'react';

import { cn } from '@web/lib/cn';

/** A surface in the panel style, e.g. the login card. */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-surface bg-bg-panel shadow-panel', className)} {...props} />;
}

/** Info or error box inside a card or form. */
export function Notice({
  tone = 'info',
  className,
  ...props
}: ComponentProps<'div'> & { tone?: 'info' | 'success' | 'danger' }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'rounded-card border px-3.5 py-2.5 text-small leading-[1.5]',
        tone === 'info' && 'border-border bg-bg-muted text-text-2',
        tone === 'success' && 'border-transparent bg-success-bg text-success',
        tone === 'danger' && 'border-danger-border bg-danger-bg text-danger',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A soft box inside a dialog or card (spec 36d): the subtle surface with the card radius and no
 * border, e.g. a link box, an account card or a list of files.
 */
export function Inset({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-card bg-bg-subtle', className)} {...props} />;
}
