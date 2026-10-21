import { withGroupMutation } from '@/lib/group-mutation';
import Group from '@/lib/models/Group';

/**
 * A conservative, monotonic lock: an interrupted insert may lock an empty Group. A record in any
 * of the Group's currencies locks its main currency, and is refused if the currency isn't one of
 * them any more (#719).
 */
export async function lockLedgerCurrency(groupId: string, currency: string): Promise<void> {
  const result = await withGroupMutation(groupId, async () =>
    Group.updateOne(
      { _id: groupId, $or: [{ defaultCurrency: currency }, { alternateCurrencies: currency }] },
      { $set: { currencyLocked: true } },
      { timestamps: false },
    ),
  );
  if (!result.matchedCount) throw new Error('CURRENCY_MISMATCH');
}
