/** What of a merge request can name an issue. */
export type MergeRequestRefs = { sourceBranch: string; title: string; description: string };

/** A branch GitLab makes from an issue starts with the issue's number: "12-login-per-link". */
const BRANCH = /^(\d{1,9})-/;

/** "#12" as people and GitLab write an issue, not inside a word or an address. */
const REFERENCE = /(?<![\w/#])#(\d{1,9})(?!\w)/g;

/**
 * The issue a merge request belongs to (spec 30b), among the issues Covibes created in the
 * repository: the one its source branch is named after, else the first one its title or its
 * description names. Null if it names none of them; then it is someone's own merge request.
 */
export function issueOfMergeRequest(
  mergeRequest: MergeRequestRefs,
  created: ReadonlySet<number>,
): number | null {
  const branch = Number(BRANCH.exec(mergeRequest.sourceBranch)?.[1]);
  if (created.has(branch)) return branch;
  for (const text of [mergeRequest.title, mergeRequest.description]) {
    for (const match of text.matchAll(REFERENCE)) {
      const number = Number(match[1]);
      if (created.has(number)) return number;
    }
  }
  return null;
}
