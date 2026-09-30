import type { Author, BlockType } from '@covibes/shared';
import { createContext, useContext } from 'react';

export type FrameBounds = { x: number; y: number; width: number; height: number };

/** The modes of the toolbar (spec 10); none is active by default. */
export type CanvasTool = 'block' | 'note' | 'frame' | 'connect';

/** What the elements on the canvas may do and show; provided by the board (specs 08 and 09). */
export type CanvasActions = {
  readOnly: boolean;
  /** The active tool; in the mode `connect` a drag anywhere on a block starts an arrow. */
  tool: CanvasTool | null;
  /** Starts a new undo step, so e.g. a resize does not merge with the change before it. */
  beginChange: () => void;
  /** The node or arrow whose text the own client edits, or null. */
  editingId: string | null;
  startEditing: (id: string) => void;
  /**
   * Ends editing a node; with changes they are saved, without they are dropped. Blocks have a
   * subtitle, notes and frames only their text.
   */
  finishEditing: (id: string, changes: { label: string; subtitle?: string } | null) => void;
  /** Ends editing the label of an arrow; an empty label hides the pill, null drops the change. */
  finishEdgeEditing: (id: string, label: string | null) => void;
  setType: (id: string, blockType: BlockType | null) => void;
  resizeFrame: (id: string, bounds: FrameBounds) => void;
  /** Name and initials for an author line; the signed-in person reads "you". */
  authorOf: (author: Author) => { name: string; initials: string };
};

const CanvasActionsContext = createContext<CanvasActions | null>(null);

export const CanvasActionsProvider = CanvasActionsContext.Provider;

export function useCanvasActions(): CanvasActions {
  const actions = useContext(CanvasActionsContext);
  if (!actions) throw new Error('useCanvasActions needs a CanvasActionsProvider');
  return actions;
}
