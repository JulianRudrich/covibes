// Usage and limits (spec 31): what members learn of the limits. The numbers are for owners
// (part 31b); everyone else only reads whether a limit is reached.

/** One limit: whether it is reached, and when it is free again. */
export type UsageLimitState = {
  reached: boolean;
  /** When the limit is free again; null while it is not reached. */
  resetsAt: string | null;
};

/**
 * `GET /api/projects/:projectId/usage/state`: the two limits of the AI as they stand for the
 * person who asks. `project`: what the project may cost in a month. `user`: what the person may
 * cost in a day, across all projects. While one is reached, no model is called; everything else
 * keeps working.
 */
export type UsageState = { project: UsageLimitState; user: UsageLimitState };
