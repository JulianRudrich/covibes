import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '@web/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** The heading of a section inside a dialog, for sections that build their own markup. */
export const DIALOG_SECTION_TITLE =
  'm-0 font-display text-display font-semibold tracking-[-0.01em] text-text';

type DialogContentProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /**
   * A column at the right, e.g. a preview (spec 36c): on the canvas color behind a hairline,
   * 300 px wide; it leaves below 900 px, the dialog's content stays.
   */
  aside?: ReactNode;
};

/** Centered modal in the panel style. Title and description are announced to screen readers. */
export function DialogContent({
  title,
  description,
  children,
  className,
  aside,
}: DialogContentProps) {
  const body = (
    <>
      <DialogPrimitive.Title className="m-0 font-display text-heading font-semibold tracking-[-0.01em]">
        {title}
      </DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="mt-1 mb-0 text-ui text-text-3">
          {description}
        </DialogPrimitive.Description>
      ) : null}
      <div className="mt-4">{children}</div>
    </>
  );
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2',
          'animate-pop rounded-surface bg-bg-panel shadow-float',
          aside
            ? 'grid grid-cols-[minmax(0,1fr)_300px] overflow-hidden max-[900px]:grid-cols-1'
            : 'p-6',
          className,
        )}
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        {aside ? (
          <>
            <div className="min-w-0 p-7 pb-6">{body}</div>
            <aside className="flex min-w-0 flex-col border-l border-border bg-bg-canvas max-[900px]:hidden">
              {aside}
            </aside>
          </>
        ) : (
          body
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * A section of a dialog (spec 36d): the heading in the display font, an optional gray hint below
 * it and an action at the right.
 */
export function DialogSection({
  title,
  hint,
  action,
  children,
  className,
  headingLevel = 3,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <section aria-label={title} className={cn('flex min-w-0 flex-col gap-2.5', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <Heading className={cn(DIALOG_SECTION_TITLE, 'min-w-0 flex-1')}>{title}</Heading>
          {action}
        </div>
        {hint ? <p className="m-0 text-small leading-snug text-text-3">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The foot of a dialog: something on the left (e.g. a destructive action), the actions at the right. */
export function DialogFooter({
  start,
  children,
  className,
}: {
  start?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mt-6 flex items-center gap-2', className)}>
      {start}
      <div className="ml-auto flex shrink-0 gap-2">{children}</div>
    </div>
  );
}
