import { COLLAB_PATH, type PersistenceState } from '@covibes/shared';
import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { PersistenceTracker } from '@web/features/canvas/persistence-tracker';
import { sameOriginWebSocketUrl } from '@web/lib/websocket-url';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

function toConnectionStatus(status: WebSocketStatus): ConnectionStatus {
  switch (status) {
    case WebSocketStatus.Connected:
      return 'connected';
    case WebSocketStatus.Connecting:
      return 'connecting';
    case WebSocketStatus.Disconnected:
      return 'disconnected';
  }
}

export type BoardConnectionState = {
  status: ConnectionStatus;
  /** True once the board has been loaded; stays true while reconnecting. */
  loaded: boolean;
  /** The server refused the board (session expired or no longer a member). */
  denied: boolean;
  persistence: PersistenceState;
};

/** WebSocket address of the collaboration server on the web app's own origin. */
export function collabUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  return sameOriginWebSocketUrl(location, COLLAB_PATH);
}

/**
 * The Y.Doc of one document of the collaboration server and its live connection: the canvas of a
 * board (spec 05) or the plan of a project (spec 25a). The browser sends the session cookie
 * with the WebSocket handshake; the server checks it, so no token is involved. The provider
 * reconnects on its own after an interruption and then syncs what changed in between.
 */
export class BoardConnection {
  readonly doc = new Y.Doc();
  readonly provider: HocuspocusProvider;
  private state: BoardConnectionState = {
    status: 'connecting',
    loaded: false,
    denied: false,
    persistence: 'unknown',
  };
  private readonly persistence: PersistenceTracker;
  private readonly listeners = new Set<() => void>();

  constructor(options: { documentName: string; url: string; onDenied: () => void }) {
    this.persistence = new PersistenceTracker(options.documentName, (persistence) => {
      this.update({ persistence });
    });
    this.provider = new HocuspocusProvider({
      url: options.url,
      name: options.documentName,
      document: this.doc,
      onStatus: ({ status }) => {
        this.update({ status: toConnectionStatus(status) });
        this.persistence.connection(status === WebSocketStatus.Connected, false);
      },
      onSynced: ({ state }) => {
        if (state) {
          this.update({ loaded: true });
          this.persistence.connection(
            this.state.status === 'connected',
            !this.provider.hasUnsyncedChanges,
          );
        }
      },
      onUnsyncedChanges: ({ number }) => {
        this.persistence.connection(
          this.state.status === 'connected',
          number === 0 && this.state.loaded,
        );
      },
      onAuthenticated: () => {
        this.update({ denied: false });
      },
      onAuthenticationFailed: () => {
        this.update({ denied: true });
        options.onDenied();
      },
    });
    this.doc.on('update', this.documentChanged);
  }

  private readonly documentChanged = () => {
    this.persistence.changed();
  };

  retryPersistence = () => {
    this.persistence.retry();
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): BoardConnectionState => this.state;

  private update(patch: Partial<BoardConnectionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  destroy() {
    this.persistence.destroy();
    this.doc.off('update', this.documentChanged);
    this.listeners.clear();
    this.provider.destroy();
    this.doc.destroy();
  }
}
