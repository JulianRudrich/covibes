import type { Author, BlockType } from '@covibes/shared';
import { createContext, useContext } from 'react';

/** What a block on the canvas may do and show; provided by the board (spec 08). */
export type BlockActions = {
  readOnly: boolean;
  /** The block the own client edits, or null. */
  editingId: string | null;
  startEditing: (id: string) => void;
  /** Ends editing; with changes they are saved, without they are dropped. */
  finishEditing: (id: string, changes: { label: string; subtitle: string } | null) => void;
  setType: (id: string, blockType: BlockType | null) => void;
  /** Name and initials for an author line; the signed-in person reads "you". */
  authorOf: (author: Author) => { name: string; initials: string };
};

const BlockActionsContext = createContext<BlockActions | null>(null);

export const BlockActionsProvider = BlockActionsContext.Provider;

export function useBlockActions(): BlockActions {
  const actions = useContext(BlockActionsContext);
  if (!actions) throw new Error('useBlockActions needs a BlockActionsProvider');
  return actions;
}
