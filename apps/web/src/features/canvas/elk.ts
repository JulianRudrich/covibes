import type { ELK } from 'elkjs/lib/elk-api';

let elkInstance: Promise<ELK> | null = null;

/** ELK is large, so the web app only loads it when auto-layout is used for the first time. */
export function loadElk(): Promise<ELK> {
  elkInstance ??= import('elkjs/lib/elk.bundled.js').then(({ default: Elk }) => new Elk());
  return elkInstance;
}
