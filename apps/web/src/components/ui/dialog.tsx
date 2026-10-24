import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '@web/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

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
