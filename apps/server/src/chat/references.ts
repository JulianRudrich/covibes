import type { DB } from '@covibes/db';
import {
  findReferences,
  referenceNames,
  type CanvasNode,
  type MessageReference,
  type NamedElement,
  type ReferenceBoard,
} from '@covibes/shared';
import type { Kysely } from 'kysely';

// What a message refers to on the canvas (spec 37a). The server finds the elements when the
// message is stored, so a reference is something the server saw on a board of the project, never
// something a client claims.

/** Reads the elements of a board as they are right now, also while people have it open. */
export type BoardReader = (boardId: string) => Promise<{ nodes: readonly CanvasNode[] }>;

/**
 * The boards of a project in the order references are looked up in: the main canvas first, then
 * the others as their tabs stand. `db` is a transaction on behalf of a member, or the admin
 * connection.
 */
export async function projectBoardIds(db: Kysely<DB>, projectId: string): Promise<string[]> {
  const boards = await db
    .selectFrom('boards')
    .select('id')
    .where('project_id', '=', projectId)
    .orderBy('kind', 'desc') // 'main' before 'extra'
    .orderBy('position')
    .orderBy('created_at')
    .execute();
  return boards.map((board) => board.id);
}

/**
 * The references of a text on these boards, the first board that has a name winning. A text
 * without a name in square brackets reads no board at all, which is nearly every message. A board
 * that cannot be read right now has no elements to refer to: the message is stored all the same.
 *
 * `named` are elements the message names itself (spec 37b). They count only on `boardIds`, so a
 * client cannot point at a board of another project, and only under the name the text writes.
 */
export async function referencesOf(
  text: string,
  boardIds: readonly string[],
  readBoard: BoardReader,
  named: readonly NamedElement[] = [],
): Promise<MessageReference[]> {
  if (referenceNames(text).length === 0) return [];
  const boards: ReferenceBoard[] = [];
  for (const boardId of boardIds) {
    const nodes = await readBoard(boardId).then(
      (board) => board.nodes,
      () => [],
    );
    boards.push({ boardId, nodes });
  }
  return findReferences(text, boards, named);
}
