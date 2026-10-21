import { withGroupMutation } from '@/lib/group-mutation';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import Settlement from '@/lib/models/Settlement';
import { MoneyValidationError } from '@splitbook/shared/exact-money';

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

/**
 * A deleted Expense comes back in its currency while the Group lists it, or while another live
 * Expense or a Settlement still uses it, as an older Group's currency may be. Otherwise the
 * refusal says how to bring it back. Run inside the restore's own Group mutation.
 */
export async function lockRestoredCurrency(
  groupId: string,
  currency: string,
  expenseId: string,
): Promise<void> {
  try {
    await lockLedgerCurrency(groupId, currency);
    return;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'CURRENCY_MISMATCH') throw error;
  }
  const inUse =
    (await Expense.exists({
      group: groupId,
      currency,
      isDeleted: { $ne: true },
      _id: { $ne: expenseId },
    })) || (await Settlement.exists({ group: groupId, currency }));
  if (!inUse)
    throw new MoneyValidationError(
      'CURRENCY_MISMATCH',
      `Add ${currency} to the Group’s currencies to restore it.`,
    );
}
