import Group from '@/lib/models/Group';

/** A conservative, monotonic lock: an interrupted insert may lock an empty Group. */
export async function lockLedgerCurrency(groupId: string, currency: string): Promise<void> {
  const result = await Group.updateOne(
    { _id: groupId, defaultCurrency: currency },
    { $set: { currencyLocked: true } },
    { timestamps: false },
  );
  if (!result.matchedCount) throw new Error('CURRENCY_MISMATCH');
}
