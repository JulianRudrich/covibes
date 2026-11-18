import { z } from 'zod';

/** A transport acknowledgement must never be substituted for this database receipt. */
export const persistenceReceiptSchema = z.object({
  status: z.literal('saved'),
  savedAt: z.iso.datetime(),
});

export type PersistenceReceipt = z.infer<typeof persistenceReceiptSchema>;
export type PersistenceState = 'unknown' | 'syncing' | 'saving' | 'saved' | 'error';
