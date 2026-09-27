import { type Db, type Document } from 'mongodb';
import { readLegacyAmountMinor, readStoredAmountMinor } from '@splitbook/shared/exact-money';

export interface MoneyMigrationIssue {
  collection: string;
  id: string;
  reason: string;
}

export interface MoneyMigrationReport {
  dryRun: boolean;
  scanned: number;
  planned: number;
  applied: number;
  issues: MoneyMigrationIssue[];
}

/** Preserve historical allocations exactly; never rerun a split algorithm on old money. */
function canonicalFields(record: Document, isSettlement: boolean): Document {
  const currency = record.currency;
  const amountMinor = readLegacyAmountMinor(record.amount, currency);
  if (amountMinor <= 0) throw new Error('Amount must be positive');
  if (record.moneyVersion !== undefined && record.moneyVersion !== 1)
    throw new Error('Unknown money representation version');
  if (!record.moneyVersion && record.amountMinor != null)
    throw new Error('Unversioned canonical amount requires review');
  if (record.moneyVersion === 1)
    readStoredAmountMinor({
      currency,
      amount: record.amount,
      amountMinor: record.amountMinor,
      moneyVersion: record.moneyVersion,
    });
  if (isSettlement) return { moneyVersion: 1, amountMinor };
  const fields: Document = { moneyVersion: 1, amountMinor };
  for (const name of ['paidBy', 'splitBetween']) {
    const rows = record[name];
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${name} is empty`);
    const ids = new Set<string>();
    let sum = 0;
    fields[name] = rows.map((row: Document) => {
      const id = String(row.user ?? '');
      if (!id || ids.has(id)) throw new Error(`${name} has missing or duplicate participants`);
      ids.add(id);
      const minor = readLegacyAmountMinor(row.amount, currency);
      if (minor < 0) throw new Error(`${name} contains a negative amount`);
      if (record.moneyVersion === 1) readStoredAmountMinor({ ...row, currency, moneyVersion: 1 });
      else if (row.amountMinor != null) throw new Error('Unversioned participant amount');
      sum += minor;
      if (!Number.isSafeInteger(sum)) throw new Error('Participant total exceeds safe range');
      return { ...row, amountMinor: minor };
    });
    if (sum !== amountMinor) throw new Error(`${name} total does not equal the Expense amount`);
  }
  return fields;
}

/** Run with writers stopped; conditional updates still protect against accidental concurrent edits. */
export async function migrateLedgerMoney(
  db: Db,
  options: { apply?: boolean } = {},
): Promise<MoneyMigrationReport> {
  const report: MoneyMigrationReport = {
    dryRun: !options.apply,
    scanned: 0,
    planned: 0,
    applied: 0,
    issues: [],
  };
  // Audit all collections before making any change. Large ledgers use a second cursor pass.
  for (const collection of ['expenses', 'recurringexpenses', 'settlements']) {
    for await (const record of db.collection(collection).find({})) {
      report.scanned++;
      try {
        canonicalFields(record, collection === 'settlements');
        if (record.moneyVersion !== 1) report.planned++;
      } catch (err) {
        report.issues.push({ collection, id: String(record._id), reason: String(err) });
      }
    }
  }
  if (!options.apply || report.issues.length) return report;
  for (const collection of ['expenses', 'recurringexpenses', 'settlements']) {
    for await (const record of db.collection(collection).find({ moneyVersion: { $ne: 1 } })) {
      const fields = canonicalFields(record, collection === 'settlements');
      const result = await db.collection(collection).updateOne(
        {
          _id: record._id,
          moneyVersion: { $exists: false },
          amount: record.amount,
          currency: record.currency,
          updatedAt: record.updatedAt ?? { $exists: false },
          ...(collection === 'settlements'
            ? {}
            : { paidBy: record.paidBy, splitBetween: record.splitBetween }),
        },
        { $set: fields },
      );
      if (result.modifiedCount) report.applied++;
      else
        report.issues.push({
          collection,
          id: String(record._id),
          reason: 'Concurrent change; audit again',
        });
    }
  }
  return report;
}
