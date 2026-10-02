import type { PlanState } from '@covibes/shared';

import { GatewayLimitError } from '@server/ai-gateway';

const QUOTA = 'quota:';
const MAX_LENGTH = 1000;

/**
 * Why a generation of the plan failed, as the text stored with its run (spec 25b). A used-up
 * quota is marked with the time it is free again, so the plan can say when to try again.
 */
export function encodePlanFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const text =
    error instanceof GatewayLimitError
      ? `${QUOTA}${error.resetsAt?.toISOString() ?? ''} ${message}`
      : message;
  return text.slice(0, MAX_LENGTH);
}

/** The failure of a run for the web app; it never passes on the provider's message. */
export function decodePlanFailure(stored: string | null): NonNullable<PlanState['failure']> {
  if (!stored?.startsWith(QUOTA)) return { kind: 'failed', resetsAt: null };
  const at = stored.slice(QUOTA.length).split(' ', 1)[0] ?? '';
  return { kind: 'quota', resetsAt: Number.isNaN(Date.parse(at)) ? null : at };
}
