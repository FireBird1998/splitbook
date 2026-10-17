/**
 * What one opened Expense shows (#311): each person's Paid and Share, exactly as stored; where
 * a leftover minor unit went and why; what each recorded edit changed; and how the recurring
 * Expense that added it repeats. It reads an Expense as either Expense read returns it, legacy
 * rows included, and never recalculates a stored split: a figure it can't read exactly is left
 * out rather than shown wrong.
 */
import { format } from 'date-fns';
import { formatActivityAmount, recordedMoney } from './activity-timeline';
import { formatCurrency } from './currency';
import {
  calculateSplitAmountsMinor,
  moneyParticipantId,
  parseDecimalUnits,
  readStoredAmountMinor,
  sumMinorAmounts,
  toMajorAmount,
} from './exact-money';
import { splitLeftover } from './expense-split';
import { expenseDateForPeriod, nextPeriod, toPeriod } from './recurring-due-periods';
import type { ExpenseSplitMethod } from './split-calculation';
import { expenseLocalDate } from './expense-day';

/** A payer or share row as the Expense reads return it. */
export interface StoredAllocationRow {
  /** Populated, an id, or null for a former member. */
  user: unknown;
  amount: number;
  amountMinor?: number;
  percentage?: number;
  shares?: number;
}

/** The parts of a stored Expense its split is read from. */
export interface StoredExpenseSplit {
  currency: string;
  moneyVersion?: number;
  amount: number;
  amountMinor?: number;
  splitMethod: ExpenseSplitMethod;
  paidBy: StoredAllocationRow[];
  splitBetween: StoredAllocationRow[];
}

const storedMinor = (expense: StoredExpenseSplit, row: { amount: number; amountMinor?: number }) =>
  readStoredAmountMinor({
    currency: expense.currency,
    moneyVersion: expense.moneyVersion,
    amount: row.amount,
    amountMinor: row.amountMinor,
  });

/** One person's part in an Expense, in exact minor units. */
export interface ExpenseShareRow {
  /** Their id, or null when the read can't say who they were. */
  userId: string | null;
  /** The person as the read sent them: populated, an id, or null. */
  user: unknown;
  paidMinor: number;
  shareMinor: number;
}

/**
 * Who paid and who owes what: everyone who paid or has a share, each once, with their Paid and
 * Share exactly as stored. Those who paid come first, in the order they paid, then the others
 * in split order. Someone with neither (no Shares) is left out, as the split's count leaves them
 * out. Null when a stored amount can't be read exactly.
 */
export function expenseShareRows(expense: StoredExpenseSplit): ExpenseShareRow[] | null {
  try {
    const people: ExpenseShareRow[] = [];
    const byId = new Map<string, ExpenseShareRow>();
    const add = (row: StoredAllocationRow, part: 'paidMinor' | 'shareMinor') => {
      const id = moneyParticipantId(row.user);
      let person = id ? byId.get(id) : undefined;
      if (!person) {
        person = { userId: id || null, user: row.user, paidMinor: 0, shareMinor: 0 };
        if (id) byId.set(id, person);
        people.push(person);
      }
      person[part] = sumMinorAmounts([person[part], storedMinor(expense, row)]);
    };
    for (const row of expense.paidBy) add(row, 'paidMinor');
    for (const row of expense.splitBetween) add(row, 'shareMinor');
    return people
      .filter((person) => person.paidMinor > 0 || person.shareMinor > 0)
      .sort((a, b) => Number(b.paidMinor > 0) - Number(a.paidMinor > 0));
  } catch {
    return null;
  }
}

/**
 * Where the minor units an Equal, Percentage or Shares split couldn't divide went. Shared money
 * gives each person their exact share rounded down, then hands the leftover out one unit at a
 * time: first to those whose share lost the most to rounding (the largest remainder), and, when
 * shares lost the same, in a fixed order of members (by id). Nothing about who paid enters it.
 */
export interface ExpenseLeftover {
  /** The minor units handed out. */
  amountMinor: number;
  /** Who got one beyond their exact share, in split order. */
  userIds: string[];
  /**
   * Why them. `remainder`: their shares lost the most to rounding. `tie`: some shares lost the
   * same, so the member order decided. `stored`: the Expense keeps an older allocation the rule
   * wouldn't give today; it is shown as stored, never recalculated.
   */
  reason: 'remainder' | 'tie' | 'stored';
}

/** Each row's weight, as the shared split rules read it. */
function splitWeight(method: ExpenseSplitMethod, row: StoredAllocationRow): bigint {
  if (method === 'equal') return BigInt(1);
  if (method === 'percentage') return BigInt(parseDecimalUnits(row.percentage ?? 0, 2));
  return BigInt(row.shares ?? 0);
}

/** The leftover, or null when the split divided exactly, is by amounts, or can't be read. */
export function expenseLeftover(expense: StoredExpenseSplit): ExpenseLeftover | null {
  const method = expense.splitMethod;
  let total: number;
  let rows: Array<{
    user: unknown;
    amountMinor: number;
    percentage?: number;
    shares?: number;
  }>;
  let leftover: ReturnType<typeof splitLeftover>;
  try {
    total = storedMinor(expense, expense);
    rows = expense.splitBetween.map((row) => ({
      user: row.user,
      amountMinor: storedMinor(expense, row),
      percentage: row.percentage,
      shares: row.shares,
    }));
    leftover = splitLeftover(method, { amountMinor: total, splitBetween: rows });
  } catch {
    return null;
  }
  if (!leftover) return null;
  const result = (reason: ExpenseLeftover['reason']): ExpenseLeftover => ({
    amountMinor: leftover.amountMinor,
    userIds: leftover.users,
    reason,
  });
  try {
    const ruled = calculateSplitAmountsMinor(
      method,
      total,
      rows.map(({ user, percentage, shares }) => ({ user, percentage, shares })),
    );
    if (ruled.some((row, index) => row.amountMinor !== rows[index].amountMinor))
      return result('stored');
    // A tie decided when someone left out had lost as much to rounding as someone given a unit.
    const weights = expense.splitBetween.map((row) => splitWeight(method, row));
    const sum = weights.reduce((a, b) => a + b, BigInt(0));
    const lost = weights.map((weight) => (BigInt(total) * weight) % sum);
    const given = new Set(leftover.users);
    const ids = rows.map((row) => moneyParticipantId(row.user));
    const least = lost
      .filter((_, index) => given.has(ids[index]))
      .reduce((a, b) => (b < a ? b : a));
    const tied = lost.some((value, index) => !given.has(ids[index]) && value === least);
    return result(tied ? 'tie' : 'remainder');
  } catch {
    return result('stored');
  }
}

/** "Sam", "Sam and Priya", "you, Sam and Priya". */
export function listNames(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** An amount in its own currency, from exact minor units. */
const money = (amountMinor: number, currency: string) =>
  formatCurrency(toMajorAmount(amountMinor, currency), currency);

/**
 * The leftover in plain words, naming each person who got part of it (`name` gives the viewer
 * as "you"). It says why the rule chose them, never that the person who paid got it.
 */
export function leftoverNote(
  leftover: ExpenseLeftover,
  currency: string,
  name: (userId: string) => string,
): string {
  const amount = money(leftover.amountMinor, currency);
  const people = listNames(leftover.userIds.map(name));
  const went = `The leftover ${amount} went to ${people}`;
  if (leftover.reason === 'remainder') {
    const shares = leftover.userIds.length === 1 ? 'share was' : 'shares were';
    return `${went}, whose ${shares} rounded down the most, so the total is exact.`;
  }
  if (leftover.reason === 'tie')
    return (
      `${went}, so the total is exact. It goes to the shares rounded down the most, and a ` +
      'fixed member order settles a tie.'
    );
  return `${went}, so the total is exact.`;
}

/** One recorded edit, as the Expense read returns it. */
export interface RecordedEdit {
  editedBy: unknown;
  editedAt: string;
  changes: Record<string, { old?: unknown; new?: unknown }>;
}

/** The parts of an Expense its history is read from. */
export interface ExpenseHistorySource {
  currency: string;
  createdAt: string;
  createdBy?: unknown;
  editHistory?: RecordedEdit[];
}

/** One line of an Expense's history. */
export interface ExpenseHistoryEntry {
  /** The person who did it: populated, an id, or null. */
  by: unknown;
  at: string;
  /** "added this Expense", "changed the amount and notes" or "edited this Expense". */
  action: string;
  /**
   * What it was before and after, when an edit changed the amount ("₹899.00" → "₹999.00") or,
   * failing that, the description (“Rent” → “Flat rent”).
   */
  change: { kind: 'amount' | 'description'; before: string; after: string } | null;
  /** Each member whose payment or share the edit changed, when it changed who paid or the split. */
  members: MemberMoneyChange[];
}

/** One member's payment or share that an edit changed (#456). */
export interface MemberMoneyChange {
  /** Whose: the stored member reference, populated, an id, or null for a former member. */
  person: unknown;
  part: 'payment' | 'share';
  /** The amount before and after, in the edit's currencies; a share is null outside the split. */
  before: string | null;
  after: string | null;
}

/** "Not included": someone outside the split has no share, a word rather than an amount. */
export const NOT_INCLUDED = 'Not included';
/** Someone an Expense names whose account, or place in the Group, is gone. */
export const FORMER_MEMBER = 'Former member';

/**
 * The members whose payment (`paidBy`) or share (`splitBetween`) one edit changed, with the
 * amounts before and after. Someone who paid nothing paid ₹0.00; someone outside the split has
 * no share, which reads "Not included". Anyone whose amount didn't change is left out. The same
 * rule names these changes on web and Android (#434, #456).
 */
export function memberMoneyChanges(
  field: 'paidBy' | 'splitBetween',
  change: { old?: unknown; new?: unknown },
  currencies: { before: string; after: string },
): MemberMoneyChange[] {
  const part = field === 'paidBy' ? 'payment' : 'share';
  const amounts = (value: unknown, currency: string) =>
    new Map(
      rowsOf(value).map((row, index) => [
        memberId(row.user) ?? `former:${index}`,
        { person: row.user ?? null, amount: recordedMoney(row, currency) },
      ]),
    );
  const before = amounts(change.old, currencies.before);
  const after = amounts(change.new, currencies.after);
  const absent = (currency: string) => (part === 'payment' ? formatCurrency(0, currency) : null);
  return [...new Set([...after.keys(), ...before.keys()])].flatMap((key) => {
    const was = before.get(key)?.amount ?? absent(currencies.before);
    const now = after.get(key)?.amount ?? absent(currencies.after);
    if (was === now) return [];
    const { person } = (after.get(key) ?? before.get(key))!;
    return [{ person, part, before: was, after: now }];
  });
}

/**
 * "Your share" or "Alex Rivera’s payment": whose change it is, with the viewer as "Your",
 * matched by member id so a namesake is never mistaken for them.
 */
export function memberMoneyLabel(
  change: MemberMoneyChange,
  name: (person: unknown) => string,
  viewer?: string,
): string {
  const whose = viewer && memberId(change.person) === viewer ? 'Your' : `${name(change.person)}’s`;
  return `${whose} ${change.part}`;
}

/** What an edit can change, as the history words it, in the order it lists them. */
const FIELDS: ReadonlyArray<[word: string, keys: readonly string[]]> = [
  ['amount', ['amount', 'amountMinor']],
  ['description', ['description']],
  ['date', ['date']],
  ['who paid', ['paidBy']],
  ['split', ['splitMethod', 'splitBetween']],
  ['Tag', ['tag', 'tagId']],
  ['Category', ['category']],
  ['notes', ['notes']],
  ['currency', ['currency']],
  ['receipt', ['receiptUrl']],
];

type AllocationRow = Record<string, unknown>;
/** A recorded payer or share list's rows, skipping anything that isn't one. */
const rowsOf = (value: unknown): AllocationRow[] =>
  Array.isArray(value)
    ? value.filter((row): row is AllocationRow => !!row && typeof row === 'object')
    : [];
/** A member reference's id, populated or not; null for a former member's missing reference. */
const memberId = (value: unknown): string | null =>
  typeof value === 'string'
    ? value
    : value && typeof value === 'object' && '_id' in value
      ? String(value._id)
      : null;
const peopleOf = (value: unknown) =>
  JSON.stringify(
    rowsOf(value)
      .map((row) => moneyParticipantId(row.user))
      .sort(),
  );
const weightsOf = (value: unknown) =>
  JSON.stringify(
    rowsOf(value)
      .map((row) => [moneyParticipantId(row.user), row.percentage ?? null, row.shares ?? null])
      .sort(),
  );

/**
 * Whether one edit's payer or share rows only followed its new total: the same people, each
 * with the same part of it, give or take under one unit of rounding (#434). A lone payer's
 * payment always follows the total.
 */
export function allocationFollowedAmount(
  changes: RecordedEdit['changes'],
  field: 'paidBy' | 'splitBetween',
): boolean {
  const minor = typeof changes.amountMinor?.old === 'number';
  const total = minor ? changes.amountMinor : changes.amount;
  const was = total?.old,
    now = total?.new;
  if (typeof was !== 'number' || typeof now !== 'number' || was <= 0) return false;
  const amountOf = (row: AllocationRow) =>
    typeof row.amountMinor === 'number'
      ? row.amountMinor
      : minor || typeof row.amount !== 'number'
        ? null
        : row.amount;
  const parts = (value: unknown) =>
    new Map(rowsOf(value).map((row) => [memberId(row.user), amountOf(row)]));
  const before = parts(changes[field]?.old),
    after = parts(changes[field]?.new);
  return (
    before.size > 0 &&
    before.size === after.size &&
    [...before].every(([user, paid]) => {
      const paying = after.get(user);
      return (
        user !== null &&
        paid != null &&
        paying != null &&
        Math.abs(paying * was - paid * now) < (minor ? was : was / 100)
      );
    })
  );
}

/**
 * The fields an edit changed, in words. A changed amount rewrites every payer and share row, so
 * those count as "who paid" or "split" only when the people, the method or the percentages or
 * shares changed, when money moved other than with the new total, or when the rows changed
 * while the amount didn't.
 */
function changedFields(changes: RecordedEdit['changes']): string[] {
  const has = (key: string) => key in changes;
  const amountChanged = has('amount') || has('amountMinor');
  const rowsChanged = (
    key: 'paidBy' | 'splitBetween',
    also: (old: unknown, now: unknown) => boolean,
  ) =>
    has(key) &&
    (!amountChanged ||
      peopleOf(changes[key].old) !== peopleOf(changes[key].new) ||
      also(changes[key].old, changes[key].new) ||
      !allocationFollowedAmount(changes, key));
  return FIELDS.filter(([word, keys]) => {
    if (word === 'who paid') return rowsChanged('paidBy', () => false);
    if (word === 'split')
      return (
        has('splitMethod') ||
        rowsChanged('splitBetween', (old, now) => weightsOf(old) !== weightsOf(now))
      );
    return keys.some(has);
  }).map(([word]) => word);
}

/**
 * "changed the amount", "changed the amount and notes", "changed the date, Tag and notes", or
 * "changed who paid" when that comes first.
 */
function changedAction(fields: string[]): string {
  if (!fields.length) return 'edited this Expense';
  return fields[0] === 'who paid'
    ? `changed ${listNames(fields)}`
    : `changed the ${listNames(fields)}`;
}

const quoted = (value: unknown) => (typeof value === 'string' ? `“${value}”` : null);

/**
 * An Expense's recorded edits, newest first, each with what it changed; for the amount or
 * description, what it was before and after; and when it changed who paid or the split, each
 * member whose payment or share changed, in the currency the Expense had at the time.
 */
export function expenseEdits(
  expense: Pick<ExpenseHistorySource, 'currency' | 'editHistory'>,
): ExpenseHistoryEntry[] {
  let currencyAfter = expense.currency;
  const currencyOf = (value: unknown) => (typeof value === 'string' && value ? value : null);
  return [...(expense.editHistory ?? [])].reverse().map((edit): ExpenseHistoryEntry => {
    const fields = changedFields(edit.changes);
    // Newest first, each edit's currency is what the next one started from.
    const editedTo = currencyOf(edit.changes.currency?.new) ?? currencyAfter;
    const currencies = {
      before: currencyOf(edit.changes.currency?.old) ?? editedTo,
      after: editedTo,
    };
    currencyAfter = currencies.before;
    const { paidBy, splitBetween } = edit.changes;
    const members = [
      ...(fields.includes('who paid') && paidBy
        ? memberMoneyChanges('paidBy', paidBy, currencies)
        : []),
      ...(fields.includes('split') && splitBetween
        ? memberMoneyChanges('splitBetween', splitBetween, currencies)
        : []),
    ];
    const amount = formatActivityAmount(
      {
        _id: '',
        type: 'expense_updated',
        createdAt: edit.editedAt,
        metadata: { changes: edit.changes },
      },
      currencies.after,
    );
    const description = edit.changes.description;
    const before = quoted(description?.old);
    const after = quoted(description?.new);
    return {
      by: edit.editedBy,
      at: edit.editedAt,
      action: changedAction(fields),
      change: amount?.before
        ? { kind: 'amount', before: amount.before, after: amount.after }
        : before && after
          ? { kind: 'description', before, after }
          : null,
      members,
    };
  });
}

/** An Expense's history, newest first: its recorded edits, then who added it. */
export function expenseHistory(expense: ExpenseHistorySource): ExpenseHistoryEntry[] {
  return [
    ...expenseEdits(expense),
    {
      by: expense.createdBy ?? null,
      at: expense.createdAt,
      action: 'added this Expense',
      change: null,
      members: [],
    },
  ];
}

/** A recurring Expense's schedule, as the recurring read returns it. */
export interface RecurringSchedule {
  dayOfMonth: number;
  startsOn: string | Date;
  endsOn?: string | Date | null;
  isPaused: boolean;
  lastGeneratedFor?: string | null;
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`;
}

/** "2 Nov": the day an Expense is dated, like the Expense table shows it (#437). */
const shortDay = (date: Date) => format(expenseLocalDate(date), 'd MMM');

/**
 * The next date the recurring Expense adds an Expense on, or null when it has ended. Months are
 * the recurring rules' own (UTC), so this is the date the added Expense will carry.
 */
export function nextRecurringDate(schedule: RecurringSchedule, now = new Date()): Date | null {
  const startsOn = new Date(schedule.startsOn);
  const endsOn = schedule.endsOn ? new Date(schedule.endsOn) : null;
  if (Number.isNaN(startsOn.getTime()) || (endsOn && Number.isNaN(endsOn.getTime()))) return null;
  const startDay = Date.UTC(
    startsOn.getUTCFullYear(),
    startsOn.getUTCMonth(),
    startsOn.getUTCDate(),
  );
  const last = /^\d{4}-(0[1-9]|1[0-2])$/.test(schedule.lastGeneratedFor ?? '')
    ? schedule.lastGeneratedFor!
    : null;
  // Due Months up to this one are added on the Group's next read; the next is after them.
  const done = [last, toPeriod(now)]
    .filter((period): period is string => !!period)
    .sort()
    .at(-1)!;
  let period = [toPeriod(startsOn), nextPeriod(done)].sort().at(-1)!;
  for (let step = 0; step < 24; step += 1) {
    const date = expenseDateForPeriod(period, schedule.dayOfMonth);
    if (endsOn && date.getTime() > endsOn.getTime()) return null;
    if (date.getTime() >= startDay) return date;
    period = nextPeriod(period);
  }
  return null;
}

/**
 * How an Expense's recurring Expense repeats, for its Repeats row: "Monthly on the 2nd · next
 * 2 Nov", "… · paused" or "… · ended"; "Monthly" while the schedule is unknown, and "Stopped"
 * when the recurring Expense was deleted.
 */
export function repeatsLabel(
  schedule: RecurringSchedule | null | undefined,
  { now = new Date(), deleted = false }: { now?: Date; deleted?: boolean } = {},
): string {
  if (deleted) return 'Stopped';
  if (!schedule) return 'Monthly';
  const monthly = `Monthly on the ${ordinal(schedule.dayOfMonth)}`;
  if (schedule.isPaused) return `${monthly} · paused`;
  const next = nextRecurringDate(schedule, now);
  return next ? `${monthly} · next ${shortDay(next)}` : `${monthly} · ended`;
}
