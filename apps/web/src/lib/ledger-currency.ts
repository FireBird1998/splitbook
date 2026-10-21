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
 * Whether the Group's ledger still holds this currency: a live Expense (other than `except`) or a
 * Settlement uses it, as an older Group's currency the list no longer names may be.
 */
async function ledgerStillUses(groupId: string, currency: string, except?: string) {
  return Boolean(
    (await Expense.exists({
      group: groupId,
      currency,
      isDeleted: { $ne: true },
      ...(except ? { _id: { $ne: except } } : {}),
    })) || (await Settlement.exists({ group: groupId, currency })),
  );
}

/**
 * A Settlement clears a Debt in one of the Group's currencies, or in an older currency its
 * ledger still holds (#727); either way it locks the main currency. Run inside the insert's own
 * Group mutation, so a removal of the currency can't come in between (#721).
 */
export async function lockClearedCurrency(groupId: string, currency: string): Promise<void> {
  try {
    await lockLedgerCurrency(groupId, currency);
    return;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'CURRENCY_MISMATCH') throw error;
  }
  if (!(await ledgerStillUses(groupId, currency))) throw new Error('CURRENCY_MISMATCH');
  await withGroupMutation(groupId, async () =>
    Group.updateOne({ _id: groupId }, { $set: { currencyLocked: true } }, { timestamps: false }),
  );
}

/**
 * A deleted Expense comes back in its currency while the Group lists it, or while the ledger
 * still holds it otherwise. Otherwise the refusal says how to bring it back. Run inside the
 * restore's own Group mutation.
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
  if (!(await ledgerStillUses(groupId, currency, expenseId)))
    throw new MoneyValidationError(
      'CURRENCY_MISMATCH',
      `Add ${currency} to the Group’s currencies to restore it.`,
    );
}
