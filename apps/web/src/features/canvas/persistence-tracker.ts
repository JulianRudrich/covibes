import { persistenceReceiptSchema, type PersistenceState } from '@covibes/shared';

import { api } from '@web/lib/api';

/** Tracks transport acknowledgement separately from the server's database receipt. */
export class PersistenceTracker {
  private revision = 0;
  private connected = false;
  private synced = false;
  private pending = true;
  private inFlight = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly documentName: string,
    private readonly onState: (state: PersistenceState) => void,
  ) {}

  changed() {
    this.revision += 1;
    this.pending = true;
    this.schedule();
  }

  connection(connected: boolean, synced: boolean) {
    const reconnected = connected && !this.connected;
    this.connected = connected;
    this.synced = synced;
    if (!connected || !synced || reconnected) {
      this.pending = true;
      this.revision += 1;
    }
    this.schedule();
  }

  retry() {
    this.pending = true;
    this.schedule();
  }

  destroy() {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private isCurrent(revision: number) {
    return !this.disposed && revision === this.revision && this.connected && this.synced;
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.disposed) return;
    if (!this.connected || !this.synced) {
      this.onState('syncing');
      return;
    }
    if (!this.pending) return;
    this.onState('saving');
    if (!this.inFlight) this.timer = setTimeout(() => void this.flush(), 600);
  }

  private async flush() {
    if (this.disposed || !this.connected || !this.synced || this.inFlight) return;
    this.inFlight = true;
    const revision = this.revision;
    try {
      const result = await api<unknown>('/documents/flush', {
        method: 'POST',
        body: JSON.stringify({ documentName: this.documentName }),
      });
      persistenceReceiptSchema.parse(result);
      if (this.isCurrent(revision)) {
        this.pending = false;
        this.onState('saved');
      }
    } catch {
      if (this.isCurrent(revision)) {
        this.onState('error');
        this.inFlight = false;
        return;
      }
    }
    this.inFlight = false;
    if (this.pending) this.schedule();
  }
}
