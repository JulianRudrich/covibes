import { cn } from '@web/lib/cn';

/** Placeholder brand mark from the handoff: two overlapping squares. */
export function Logo({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('relative block size-[22px] shrink-0', className)}>
      <span className="absolute top-0 left-0 size-3.5 rounded-xs bg-ink" />
      <span className="absolute right-0 bottom-0 size-3.5 rounded-xs border-2 border-ink" />
    </span>
  );
}
