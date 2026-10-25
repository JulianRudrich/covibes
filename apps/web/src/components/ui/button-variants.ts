import { cva } from 'class-variance-authority';

/**
 * On a phone every button is a target of at least 44 × 44 px (spec 36e): an invisible area around
 * its center, so a small button keeps its look.
 */
export const TOUCH_TARGET =
  'max-md:relative max-md:after:absolute max-md:after:top-1/2 max-md:after:left-1/2 max-md:after:h-11 max-md:after:w-full max-md:after:min-w-11 max-md:after:-translate-1/2';

/** The look of a button, e.g. for a link that acts as one. */
export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full whitespace-nowrap font-semibold transition-[background-color,box-shadow,transform] duration-150 active:translate-y-px active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ' +
    TOUCH_TARGET,
  {
    variants: {
      variant: {
        primary: 'bg-ink text-on-ink shadow-button-primary hover:bg-ink-hover',
        secondary:
          'border border-border-strong bg-bg-panel text-text-body shadow-button-secondary hover:bg-bg-secondary-hover',
        ghost: 'bg-transparent text-text-body hover:bg-wash',
        /** On a tinted or subtle card: the panel color without a border (handoff, overview cards). */
        surface: 'bg-bg-panel text-text hover:brightness-[1.03]',
        /** Confirms something that cannot be undone, e.g. deleting a board. */
        danger: 'bg-danger text-on-ink shadow-button-primary hover:bg-danger/90',
      },
      size: {
        m: 'h-8 px-3.5 text-ui',
        s: 'h-7 px-3 text-small',
        /** The actions of the login and the message pages (spec 36c). */
        l: 'h-[46px] px-5 text-[14px]',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'm',
    },
  },
);
