import type { SettlementBatchActivityItem } from '@splitbook/shared/settlement-batch-activity';
import type { SettlementBatchWordsEvent } from '@splitbook/shared/settlement-batch-words';

/** A payment that settled several Debts at once, as the shared rule collects it (#734). */
export type ActivityBatch<T extends SettlementBatchWordsEvent & { type: string }> = Extract<
  SettlementBatchActivityItem<T>,
  { kind: 'batch' }
>;
