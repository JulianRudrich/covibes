import type { ComponentProps } from 'react';

import { cn } from '@web/lib/cn';

/** A main panel of the workspace (chat, canvas, overview) with a 58 px header row; it stands out
 * from the app background by its shadow, without a border. */
export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'grid min-h-0 min-w-0 grid-rows-[58px_minmax(0,1fr)] overflow-hidden rounded-surface bg-bg-panel shadow-panel',
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-3 pr-[18px] pl-5', className)} {...props} />;
}

/** Panel titles in the display font (handoff: "Chat", "Wartet auf dich"). */
export function PanelTitle({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      className={cn('m-0 font-display text-heading font-semibold tracking-[-0.01em]', className)}
      {...props}
    />
  );
}
