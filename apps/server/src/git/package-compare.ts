import {
  buildCodingPackage,
  gitFilesOf,
  MAX_GIT_FILES,
  MAX_GIT_FILES_BYTES,
  packageBytes,
  STALE_SPEC_PATTERN,
  type CodingPackageInput,
  type GitFileState,
  type GitMergeRequestPlan,
  type PackageFile,
} from '@covibes/shared';

import { fileStates, foldersOf, listBlobs } from '@server/integrations/gitlab/blobs';
import type { GitlabClient } from '@server/integrations/gitlab/client';
import type { GitAccess } from '@server/integrations/gitlab/connections';
import { RepositoryError } from '@server/integrations/git-host';
import type { RepositoryOperations } from '@server/integrations/repository-operations';

// The plan package next to a repository (specs 29c and 29e): what the dialog of the package
// shows before a request is made, and what a request is built from. The API compares for a
// person, the worker for the moderator; both get the same answer.

/** The folder of the package's feature specs, where those of an earlier package may lie. */
const SPECS_FOLDER = 'context/feature-specs';

export type ComparedPackage =
  | { problem: NonNullable<GitMergeRequestPlan['problem']> }
  | {
      problem: null;
      projectName: string;
      language: 'de' | 'en';
      /** The repository's default branch, which the merge request goes into. */
      targetBranch: string;
      files: PackageFile[];
      /** Every file with what it is next to the default branch. */
      states: { path: string; state: GitFileState }[];
      /** Feature specs of an earlier package that the repository holds and this one does not. */
      stale: string[];
    };

/** How the repository is read: the client, and the project's reading access. */
export type PackageReach = {
  operations?: RepositoryOperations | undefined;
  client: Pick<GitlabClient, 'get'>;
  access: () => Promise<GitAccess | undefined>;
};

/**
 * A package next to the default branch of a repository: every file with whether it is new,
 * changed or the same there. It reads by Git's marks of the files' content, so no file is
 * fetched. `input` is undefined when there is nothing to build a package from.
 */
export async function comparePackage(
  input: CodingPackageInput | undefined,
  repository: { id: number; defaultBranch: string | null; path?: string },
  reach: PackageReach | undefined,
): Promise<ComparedPackage> {
  const files = input ? buildCodingPackage(input) : [];
  if (!input || files.length === 0) return { problem: 'no_plan' };
  if (files.length > MAX_GIT_FILES || packageBytes(files) > MAX_GIT_FILES_BYTES) {
    return { problem: 'too_large' };
  }
  const targetBranch = repository.defaultBranch;
  if (!targetBranch) return { problem: 'no_branch' };

  let blobs: Map<string, string> | undefined;
  try {
    const access = await reach?.access();
    if (!reach || !access) return { problem: 'unreachable' };
    const target = {
      baseUrl: access.baseUrl,
      repositoryId: repository.id,
      repositoryPath: repository.path ?? '',
    };
    const folders = foldersOf([...files.map((file) => file.path), `${SPECS_FOLDER}/x`]);
    blobs = reach.operations
      ? await reach.operations.blobs(target, access.token, targetBranch, folders)
      : await listBlobs(reach.client, target, access.token, targetBranch, folders);
  } catch (error) {
    if (!(error instanceof RepositoryError)) throw error;
    return { problem: 'unreachable' };
  }
  if (!blobs) return { problem: 'no_branch' };

  const own = new Set(files.map((file) => file.path));
  return {
    problem: null,
    projectName: input.projectName,
    language: input.language,
    targetBranch,
    files,
    states: fileStates(gitFilesOf(files), blobs),
    stale: [...blobs.keys()]
      .filter((path) => STALE_SPEC_PATTERN.test(path) && !own.has(path))
      .sort(),
  };
}

/** Whether a compared package would change anything in the repository. */
export function packageDiffers(compared: Extract<ComparedPackage, { problem: null }>): boolean {
  return compared.states.some(({ state }) => state === 'new' || state === 'changed');
}
