import { Check } from 'lucide-react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@web/lib/cn';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({
  children,
  className,
  align = 'end',
  onCloseAutoFocus,
}: {
  children: ReactNode;
  className?: string;
  align?: ComponentProps<typeof MenuPrimitive.Content>['align'];
  /** Where the focus goes when the menu closes; by default back to the trigger. */
  onCloseAutoFocus?: ComponentProps<typeof MenuPrimitive.Content>['onCloseAutoFocus'];
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        onCloseAutoFocus={onCloseAutoFocus}
        sideOffset={6}
        className={cn(
          'z-50 min-w-[200px] animate-pop rounded-panel bg-bg-panel p-1.5 shadow-float',
          className,
        )}
      >
        {children}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
}

/** Non-interactive header, e.g. the signed-in name. */
export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-2.5 pt-1.5 pb-1 text-small text-text-3', className)}
      {...props}
    />
  );
}

/** One of several choices in a menu, of which one holds: a check marks it. */
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-ui text-text-body outline-none select-none',
        'data-highlighted:bg-bg-subtle data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="grid size-3.5 shrink-0 place-items-center">
        <MenuPrimitive.ItemIndicator>
          <Check size={14} strokeWidth={2.4} />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

/** A line between two groups of a menu. */
export function DropdownMenuSeparator() {
  return <MenuPrimitive.Separator className="mx-1 my-1 h-px bg-border" />;
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-ui text-text-body outline-none select-none',
        'data-highlighted:bg-bg-subtle',
        className,
      )}
      {...props}
    />
  );
}

/** A switch in a menu: a check marks it as on; choosing it keeps the menu open. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      className={cn(
        'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-ui text-text-body outline-none select-none',
        'data-highlighted:bg-bg-subtle data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      onSelect={(event) => {
        event.preventDefault();
      }}
      {...props}
    >
      <span aria-hidden="true" className="grid size-3.5 shrink-0 place-items-center">
        <MenuPrimitive.ItemIndicator>
          <Check size={14} strokeWidth={2.4} />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}
