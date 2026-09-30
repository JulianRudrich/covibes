import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';

/**
 * Editing text in place (blocks, notes, frames, arrow labels): Enter or leaving the editor saves,
 * Escape cancels. Keys stay inside the editor, so e.g. Backspace never deletes the element.
 */
export function useInPlaceEditing(done: (save: boolean) => void) {
  const finished = useRef(false);

  function finish(save: boolean) {
    if (finished.current) return;
    finished.current = true;
    done(save);
  }

  function onKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  }

  function onBlur(event: FocusEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    finish(true);
  }

  return { onKeyDown, onBlur };
}

/** Focuses the element once, with its text selected for overwriting. */
export function useFocusOnMount<T extends HTMLInputElement | HTMLTextAreaElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return ref;
}
