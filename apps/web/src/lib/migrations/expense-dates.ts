import { type Db, type ObjectId } from 'mongodb';
import { onExpenseDay } from '@splitbook/shared/expense-day';

export interface ExpenseDateMigrationReport {
  dryRun: boolean;
  scanned: number;
  /** Expenses already stored at midnight UTC. */
  alreadyDays: number;
  /** Expenses stored at another time of day, to move to midnight UTC on their UTC day. */
  planned: number;
  /** Expenses this run moved. */
  moved: number;
  /**
   * Of those planned, Expenses stored at 22:00 UTC or later. Local noon in a zone 13 or 14
   * hours ahead of UTC (Tonga, Kiribati, New Zealand in summer) lands there on the day before,
   * so a member there may see one of these a day earlier than they picked.
   */
  lateInUtcDay: number;
  issues: { id: string; reason: string }[];
}

const LATE_UTC_HOUR = 22;

/**
 * An Expense's date is a calendar day, stored at midnight UTC (#437). Android's Add expense
 * stored local noon before, so this moves every other time of day to midnight UTC on the day it
 * falls on in UTC: the day every screen now shows. It changes nothing else, not even the
 * revision, as the day stays the same. Audits by default; nothing moves while any Expense's date
 * can't be read. Run with writers stopped; each move still checks the date it read.
 */
export async function migrateExpenseDates(
  db: Db,
  options: { apply?: boolean } = {},
): Promise<ExpenseDateMigrationReport> {
  const report: ExpenseDateMigrationReport = {
    dryRun: !options.apply,
    scanned: 0,
    alreadyDays: 0,
    planned: 0,
    moved: 0,
    lateInUtcDay: 0,
    issues: [],
  };
  const expenses = db.collection('expenses');
  const moves: { _id: ObjectId; from: Date; to: Date }[] = [];
  for await (const record of expenses.find({}, { projection: { date: 1 } })) {
    report.scanned++;
    const date = record.date;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      report.issues.push({ id: String(record._id), reason: 'The date is not a date' });
      continue;
    }
    const day = onExpenseDay(date);
    if (day.getTime() === date.getTime()) {
      report.alreadyDays++;
      continue;
    }
    report.planned++;
    if (date.getUTCHours() >= LATE_UTC_HOUR) report.lateInUtcDay++;
    moves.push({ _id: record._id, from: date, to: day });
  }
  if (!options.apply || report.issues.length) return report;
  for (const move of moves) {
    const result = await expenses.updateOne(
      { _id: move._id, date: move.from },
      { $set: { date: move.to } },
    );
    if (result.modifiedCount) report.moved++;
    else report.issues.push({ id: String(move._id), reason: 'Concurrent change; audit again' });
  }
  return report;
}
