/** The canvas below the board tabs (spec 11). */
export const BOARD_PANEL_ID = 'board-panel';

/** The id of a board's tab, which names the canvas while the board is open. */
export function boardTabId(boardId: string): string {
  return `board-tab-${boardId}`;
}
