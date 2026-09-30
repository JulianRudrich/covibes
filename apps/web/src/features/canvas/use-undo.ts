import { authorOrigin, getEdgesMap, getNodesMap, type Author } from '@covibes/shared';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

/** Changes that follow each other this quickly are one step (e.g. all frames of a drag). */
const CAPTURE_MS = 500;

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * Undo and redo of one's own changes on a board (spec 10): Ctrl or Cmd + Z, Ctrl or Cmd + Shift + Z
 * and Ctrl + Y. The undo manager only tracks transactions with the signed-in person's origin, so
 * changes of others and of agents are never undone. Keys typed into an input are left alone.
 * Returns the manager, so a new drag or edit can start a step of its own (`stopCapturing`).
 */
export function useUndo(doc: Y.Doc, author: Author, enabled: boolean): Y.UndoManager | null {
  const origin = authorOrigin(author);
  const [manager, setManager] = useState<Y.UndoManager | null>(null);

  useEffect(() => {
    const created = new Y.UndoManager([getNodesMap(doc), getEdgesMap(doc)], {
      trackedOrigins: new Set([origin]),
      captureTimeout: CAPTURE_MS,
    });
    setManager(created);
    return () => {
      created.destroy();
    };
  }, [doc, origin]);

  useEffect(() => {
    if (!manager || !enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      const redo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey);
      const undo = key === 'z' && !event.shiftKey;
      if (!undo && !redo) return;
      event.preventDefault();
      if (redo) manager.redo();
      else manager.undo();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [manager, enabled]);

  return manager;
}
