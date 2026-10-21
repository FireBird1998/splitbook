import type { SettlementBatchActivityItem } from '@splitbook/shared/settlement-batch-activity';
import {
  settlementBatchWords,
  type SettlementBatchWordsEvent,
} from '@splitbook/shared/settlement-batch-words';

/** A payment that settled several Debts at once, as the shared rule collects it (#734). */
export type ActivityBatch<T extends SettlementBatchWordsEvent & { type: string }> = Extract<
  SettlementBatchActivityItem<T>,
  { kind: 'batch' }
>;

/**
 * A batch's row in the shared words, its Debts in the order the payment recorded them, as their
 * Settlements' ids keep it, not the feed's newest first: "₹1,480.00 and €20.00".
 */
export function batchWords<T extends SettlementBatchWordsEvent & { type: string }>(
  batch: ActivityBatch<T>,
  viewerId: string,
) {
  const settlementId = (event: T) => String(event.metadata?.settlementId ?? '');
  return settlementBatchWords(
    [...batch.events].sort((a, b) => settlementId(a).localeCompare(settlementId(b))),
    batch.batchSize,
    viewerId,
  );
}
