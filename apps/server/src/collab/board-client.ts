import { boardDocumentName } from '@covibes/shared';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';

/** How the worker reaches a board; tests use an in-memory Y.Doc instead. */
export type BoardAccess = {
  /**
   * Runs `fn` on the live Y.Doc of a board. It resolves once every change `fn` made has reached
   * the collaboration server, so everyone with the board open already sees it.
   */
  withBoard<T>(boardId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T>;
};

type BoardClientOptions = {
  /** WebSocket URL of the collaboration endpoint, e.g. `ws://127.0.0.1:3001/api/collab`. */
  collabUrl: string;
  /** The web app's address; the server only accepts WebSockets from its own origin. */
  appUrl: string;
  /** The internal token shared with the server. */
  token: string;
  /** Upper limit for connecting and for handing over the changes. */
  timeoutMs?: number;
};

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Board connection: ${what} took longer than ${String(ms)} ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * The worker's access to boards (spec 07): it connects to the server's collaboration endpoint like
 * a browser, but authenticates with the internal token instead of a session cookie. So agents
 * change the same live Y.Doc as everyone else, and the server stays its only owner.
 */
export function createBoardClient(options: BoardClientOptions): BoardAccess {
  const origin = new URL(options.appUrl).origin;
  const timeoutMs = options.timeoutMs ?? 15_000;

  class ServiceWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { origin });
    }
  }

  return {
    async withBoard(boardId, fn) {
      const doc = new Y.Doc();
      const websocketProvider = new HocuspocusProviderWebsocket({
        url: options.collabUrl,
        WebSocketPolyfill: ServiceWebSocket,
        maxAttempts: 3,
      });
      const provider = new HocuspocusProvider({
        websocketProvider,
        name: boardDocumentName(boardId),
        document: doc,
        token: options.token,
      });
      try {
        await withTimeout(
          new Promise<void>((resolve, reject) => {
            provider.on('synced', ({ state }: { state: boolean }) => {
              if (state) resolve();
            });
            provider.on('authenticationFailed', ({ reason }: { reason: string }) => {
              reject(new Error(`Board ${boardId} refused the worker: ${reason}`));
            });
            // With its own WebSocket provider, the document provider does not attach by itself.
            provider.attach();
          }),
          timeoutMs,
          'connecting',
        );

        const result = await fn(doc);

        // Only close once the server has everything; otherwise a change could get lost.
        await withTimeout(
          new Promise<void>((resolve) => {
            const check = () => {
              if (!provider.hasUnsyncedChanges) {
                provider.off('unsyncedChanges', check);
                resolve();
              }
            };
            provider.on('unsyncedChanges', check);
            check();
          }),
          timeoutMs,
          'handing over the changes',
        );
        return result;
      } finally {
        provider.destroy();
        websocketProvider.destroy();
        doc.destroy();
      }
    },
  };
}
