import { z } from 'zod';

// Reviews of merge requests against the architecture (spec 30b): what the model answers, what
// the server keeps of it, and what the web reads.

/** `fits`: the change follows what the team decided. `deviates`: something goes against it. */
export const GIT_REVIEW_VERDICTS = ['fits', 'deviates'] as const;
export type GitReviewVerdict = (typeof GIT_REVIEW_VERDICTS)[number];

/** Findings a review keeps at most. */
export const MAX_REVIEW_FINDINGS = 12;

/** Files of a merge request a review reads at most (what GitLab is asked for). */
export const MAX_REVIEW_FILES = 30;
/** Characters of the changes of one file, and of all files, that a review reads. */
export const MAX_REVIEW_FILE_CHARS = 6000;
export const MAX_REVIEW_CHARS = 60_000;

const line = (max: number) => z.string().trim().min(1).max(max);
/** A text that may be missing: null, or nothing but blanks, means there is none. */
const optionalLine = (max: number) =>
  z
    .string()
    .nullish()
    .transform((text) => {
      const trimmed = text?.trim() ?? '';
      return trimmed === '' ? null : trimmed.slice(0, max);
    });

/**
 * One thing a review found: where the change goes against the architecture. All of it is plain
 * text, written by the model from what it read; the web shows it as text.
 */
export const gitReviewFindingSchema = z.object({
  /** A short name for it. */
  title: line(200),
  /** What the change does and why that does not fit. */
  detail: line(1500),
  /** What of the architecture it goes against, e.g. a decision with its value. */
  basis: optionalLine(300),
  /** The file of the merge request it shows in. */
  file: optionalLine(300),
});
export type GitReviewFinding = z.infer<typeof gitReviewFindingSchema>;

/**
 * What the model answers. A review that fits has no findings; one that deviates has at least one,
 * so the verdict follows from the findings and cannot contradict them.
 */
export const gitReviewAnswerSchema = z.object({
  summary: line(2000),
  findings: z.array(gitReviewFindingSchema).max(50),
});
export type GitReviewAnswer = z.infer<typeof gitReviewAnswerSchema>;

/** `queued` and `running`: the review is on its way. `failed`: its run ended without one. */
export type GitReviewStatus = 'queued' | 'running' | 'done' | 'failed';

/** A review as the list of merge requests shows it. */
export type GitReviewSummary = {
  id: string;
  /** The merge request, as people write it: "!7". */
  number: number;
  /** The last commit of the merge request when the review was asked for. */
  sha: string;
  status: GitReviewStatus;
  /** Null until it is written. */
  verdict: GitReviewVerdict | null;
  /** How many findings it has. */
  findings: number;
  /** Started by the reading of the repository's state, or by a person. */
  trigger: 'auto' | 'manual';
  createdAt: string;
  finishedAt: string | null;
};

/** A whole review (`GET /api/projects/:projectId/git/reviews/:reviewId`). */
export type GitReview = Omit<GitReviewSummary, 'findings'> & {
  title: string;
  /** The merge request's address in GitLab, for a link. */
  url: string;
  sourceBranch: string;
  author: string;
  /** The issue Covibes created that the merge request belongs to. */
  issueNumber: number | null;
  /** Who asked for it; null for a review that started by itself. */
  requestedBy: { userId: string; name: string } | null;
  summary: string | null;
  findings: GitReviewFinding[];
  /** The merge request is still open, as far as the repository's state was read. */
  open: boolean;
};

/**
 * `GET /api/projects/:projectId/git/reviews`: the latest review of every merge request that is
 * still open, the newest first.
 */
export type GitReviews = { reviews: GitReview[] };

/** `POST /api/projects/:projectId/git/merge-requests/:number/review`. */
export type GitReviewStarted = { reviewId: string };

/** The findings of a stored review as a list; what is no finding is left out. */
export function readReviewFindings(stored: unknown): GitReviewFinding[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry) => {
    const finding = gitReviewFindingSchema.safeParse(entry);
    return finding.success ? [finding.data] : [];
  });
}
