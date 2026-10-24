import type { PhaseStatus } from '@covibes/shared';

import { cn } from '@web/lib/cn';

/**
 * One segment of the phase bar (handoff "Phase bar"): done in the text color, upcoming in the
 * track color, the current one the track 60 % filled, since Covibes does not measure progress
 * inside a phase (spec 36b). Shared by the phase bar and the project cards (spec 36c); the caller
 * sets its width.
 */
export function PhaseSegment({ status, className }: { status: PhaseStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block h-1.5 overflow-hidden rounded-full',
        status === 'done' ? 'bg-text' : 'bg-track',
        className,
      )}
    >
      {status === 'active' ? (
        <span className="absolute inset-y-0 left-0 w-[60%] rounded-full bg-text opacity-55" />
      ) : null}
    </span>
  );
}
