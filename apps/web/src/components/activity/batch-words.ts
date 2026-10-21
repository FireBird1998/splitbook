import type { SettlementBatchActivityItem } from '@splitbook/shared/settlement-batch-activity';
import type { SettlementBatchWordsEvent } from '@splitbook/shared/settlement-batch-words';

/** A payment that settled several Debts at once, as the shared rule collects it (#734). */
export type ActivityBatch<T extends SettlementBatchWordsEvent & { type: string }> = Extract<
  SettlementBatchActivityItem<T>,
  { kind: 'batch' }
>;

/**
 * Where a batch's row sits: at its newest event, the one the feed lists first, so it stays put
 * when an older page brings the rest of a split batch. Its events read in recorded order.
 */
export function newestEvent<T extends SettlementBatchWordsEvent & { type: string; _id: string }>(
  batch: ActivityBatch<T>,
  feed: readonly T[],
): T {
  const ids = new Set(batch.events.map((event) => event._id));
  return feed.find((event) => ids.has(event._id)) ?? batch.events[0];
}
