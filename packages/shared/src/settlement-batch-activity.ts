import { z } from 'zod';

/** Optional on older Activity and single payments; a batch keeps its first Settlement's id. */
export const settlementBatchActivityShape = {
  batchId: z.string().min(1).optional(),
  batchSize: z.number().int().min(1).optional(),
};

export interface SettlementBatchActivityEvent {
  _id?: string;
  type: string;
  metadata?: Readonly<Record<string, unknown>> | null;
}

export type SettlementBatchActivityItem<T> =
  | { kind: 'event'; event: T; complete: true }
  | { kind: 'batch'; batchId: string; batchSize: number; events: T[]; complete: boolean };

const referenceSchema = z.object(settlementBatchActivityShape);

/**
 * Preserve feed order, collecting each batch where its first supplied event appeared. Call
 * again with concatenated pages to complete a split batch; neither input nor prior results
 * change. Single events (including one-row batches) are complete items of their own. An event
 * that arrives twice, as when a newer event shifts the pages, counts once, where it first appeared.
 */
export function groupSettlementBatches<T extends SettlementBatchActivityEvent>(
  events: readonly T[],
): SettlementBatchActivityItem<T>[] {
  const items: SettlementBatchActivityItem<T>[] = [];
  const batches = new Map<string, Extract<SettlementBatchActivityItem<T>, { kind: 'batch' }>>();
  const seen = new Set<string>();
  for (const event of events) {
    if (event._id !== undefined) {
      if (seen.has(event._id)) continue;
      seen.add(event._id);
    }
    const reference =
      event.type === 'settlement_recorded' ? referenceSchema.safeParse(event.metadata) : null;
    const batchId = reference?.success ? reference.data.batchId : undefined;
    const batchSize = reference?.success ? reference.data.batchSize : undefined;
    if (!batchId || batchSize === undefined || batchSize === 1) {
      items.push({ kind: 'event', event, complete: true });
      continue;
    }
    let batch = batches.get(batchId);
    if (!batch) {
      batch = { kind: 'batch', batchId, batchSize, events: [], complete: false };
      batches.set(batchId, batch);
      items.push(batch);
    }
    batch.events.push(event);
    batch.complete = batch.events.length === batch.batchSize;
  }
  return items;
}
