import { createHash } from 'node:crypto';

import type { GitFile, GitFileState } from '@covibes/shared';
import { z } from 'zod';

import { GitlabError, type GitlabClient } from '@server/integrations/gitlab/client';

// Comparing files with a branch of a repository (spec 29c) without reading the files: Git marks
// the content of every file with an id, and GitLab hands that id out when it lists a folder. A
// file whose id is the one of our content is the same file.

/** Git's mark of a file's content: the id of its blob. */
export function gitBlobId(content: string | Buffer): string {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return createHash('sha1')
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest('hex');
}

/** GitLab gives at most this many entries per page. */
const PAGE = 100;
/** Pages of one folder that are read at most; a folder with more files is cut there. */
const MAX_PAGES = 30;

const entrySchema = z.object({ id: z.string().min(1), path: z.string().min(1), type: z.string() });

/** The folders that hold the given paths; the top of the repository is "". */
export function foldersOf(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => path.split('/').slice(0, -1).join('/')))];
}

/**
 * The files that lie directly in the given folders of a ref, by their path, each with Git's id
 * of its content. Undefined if the ref does not exist (or the repository is empty). A folder that
 * does not exist holds nothing.
 */
export async function listBlobs(
  client: Pick<GitlabClient, 'get'>,
  target: { baseUrl: string; repositoryId: number },
  token: string,
  ref: string,
  folders: readonly string[],
): Promise<Map<string, string> | undefined> {
  const blobs = new Map<string, string>();

  /** Reads one folder; false if GitLab does not know it. */
  async function read(folder: string): Promise<boolean> {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        ref,
        per_page: String(PAGE),
        page: String(page),
        ...(folder ? { path: folder } : {}),
      });
      let answer: unknown;
      try {
        answer = await client.get(
          target.baseUrl,
          `/projects/${String(target.repositoryId)}/repository/tree?${query.toString()}`,
          token,
        );
      } catch (error) {
        if (error instanceof GitlabError && error.status === 404) return false;
        throw error;
      }
      const entries = z.array(z.unknown()).safeParse(answer);
      if (!entries.success) throw new GitlabError(502, 'GitLab sent no list of files');
      for (const entry of entries.data) {
        const parsed = entrySchema.safeParse(entry);
        if (parsed.success && parsed.data.type === 'blob') {
          blobs.set(parsed.data.path, parsed.data.id);
        }
      }
      if (entries.data.length < PAGE) break;
    }
    return true;
  }

  // The top says whether the ref is there at all.
  if (!(await read(''))) return undefined;
  for (const folder of new Set(folders)) {
    if (folder !== '') await read(folder);
  }
  return blobs;
}

/**
 * Every file next to what a branch holds, in the order given: it is new there; it is there in
 * another form; it is the same; or it is there and is only added when missing, so it stays.
 */
export function fileStates(
  files: readonly Pick<GitFile, 'path' | 'content' | 'mode'>[],
  blobs: ReadonlyMap<string, string>,
): { path: string; state: GitFileState }[] {
  return files.map((file) => {
    const existing = blobs.get(file.path);
    const state: GitFileState =
      existing === undefined
        ? 'new'
        : file.mode === 'create'
          ? 'kept'
          : existing === gitBlobId(file.content)
            ? 'same'
            : 'changed';
    return { path: file.path, state };
  });
}
