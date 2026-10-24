import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@web/lib/cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

/** A floating card next to its trigger, in the look of the dropdown menus (derived look). */
export function PopoverContent({
  children,
  className,
  align = 'end',
  ...props
}: {
  children: ReactNode;
  className?: string;
  align?: ComponentProps<typeof PopoverPrimitive.Content>['align'];
} & Pick<ComponentProps<typeof PopoverPrimitive.Content>, 'aria-label' | 'aria-labelledby'>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          'z-50 animate-pop rounded-panel bg-bg-panel shadow-float outline-none',
          className,
        )}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
