import type { ComponentProps } from 'react';

import { TOUCH_TARGET } from '@web/components/ui/button-variants';
import { cn } from '@web/lib/cn';

export type IconButtonProps = Omit<ComponentProps<'button'>, 'aria-label'> & {
  /** Icon-only buttons have no visible text, so an accessible name is mandatory. */
  'aria-label': string;
};

export function IconButton({ className, type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-text-2b transition-[background-color,color,transform] duration-150 hover:bg-wash hover:text-text active:scale-95 disabled:pointer-events-none disabled:opacity-50',
        TOUCH_TARGET,
        className,
      )}
      {...props}
    />
  );
}
