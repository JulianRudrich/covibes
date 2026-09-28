import type { ComponentProps } from 'react';

import { cn } from '@web/lib/cn';

/** White workspace panel (chat, canvas, overview) with a 52 px header row. */
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'grid min-h-0 min-w-0 grid-rows-[52px_minmax(0,1fr)] overflow-hidden rounded-panel border border-border bg-bg-panel shadow-panel',
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center gap-3 border-b border-border-subtle px-4', className)}
      {...props}
    />
  );
}

export function PanelTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('m-0 text-title font-semibold', className)} {...props} />;
}
