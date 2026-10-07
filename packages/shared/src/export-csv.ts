/**
 * The CSV files an export holds (#317), built from plain records the server reads: the rows of
 * a Group's Expenses and payments, and the text of a file. Framework-free (ADR 0002).
 *
 * Every file is UTF-8 with a byte-order mark, so Excel reads ₹ and €, and CRLF line ends
 * (RFC 4180). Amounts are exact decimals in their currency's minor units ("1249.50", "2400"
 * for yen), each beside its currency code, never converted. People appear by name only.
 *
 * Columns come in a fixed, documented order (docs/api.md, "GET /api/export"). Options add
 * columns after the ones that are always there, so a column never moves when another option
 * is turned on.
 */
import { getCategory } from './categories';
import { getCurrencyPrecision } from './currency';
import { assertSafeMinorAmount, moneyParticipantId, readLegacyAmountMinor } from './exact-money';
import type { SplitMethod } from './types';

// ─── Text ───────────────────────────────────────────────

/** The byte-order mark every file starts with, so spreadsheets read it as UTF-8. */
export const CSV_BOM = '﻿';

/**
 * Characters a spreadsheet may read as the start of a formula (OWASP, CSV injection). A cell
 * that starts with one gets a leading apostrophe, so it is shown as text and never run.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell: guarded against formulas, then quoted when it holds a comma, a quote or a line break. */
export function csvCell(value: string): string {
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: the byte-order mark, the header, then every row, each line ending in CRLF. */
export function serializeCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  return `${CSV_BOM}${[header, ...rows].map((row) => `${row.map(csvCell).join(',')}\r\n`).join('')}`;
}

// ─── Values ─────────────────────────────────────────────

/**
 * An exact amount in minor units as a plain decimal in its currency's precision: `124950`
 * INR → "1249.50", `2400` JPY → "2400". No grouping, no symbol, `.` as the decimal point.
 */
export function formatMinorAmount(amountMinor: number, currency: string): string {
  const digits = getCurrencyPrecision(currency);
  const minor = assertSafeMinorAmount(amountMinor);
  const sign = minor < 0 ? '-' : '';
  const units = String(Math.abs(minor));
  if (digits === 0) return `${sign}${units}`;
  const padded = units.padStart(digits + 1, '0');
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * An Expense's date. Expenses are dated by calendar day, stored at midnight UTC, so the day is
 * read in UTC and is the day the member picked, whatever the viewer's zone.
 */
export function expenseDay(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock parts of a moment in a time zone. */
function zonedParts(at: Date, timeZone: string) {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    zoneFormats.set(timeZone, format);
  }
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour % 24,
    minute: parts.minute,
    second: parts.second,
  };
}

/** The calendar day a moment falls on in a time zone, `YYYY-MM-DD`. */
export function zonedDay(at: Date | string, timeZone: string): string {
  const { year, month, day } = zonedParts(new Date(at), timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * A moment as the time zone's wall clock with its offset, to the second:
 * `2026-10-01T01:30:00+05:30`. Exact, and readable in the viewer's own time.
 */
export function zonedTimestamp(at: Date | string, timeZone: string): string {
  const moment = new Date(at);
  const { year, month, day, hour, minute, second } = zonedParts(moment, timeZone);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = Math.round((wall - Math.floor(moment.getTime() / 1000) * 1000) / 60_000);
  const sign = offset < 0 ? '-' : '+';
  const size = Math.abs(offset);
  return (
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}` +
    `${sign}${pad(Math.floor(size / 60))}:${pad(size % 60)}`
  );
}

/** How an Expense was split, as the app names it. */
export const SPLIT_LABELS: Record<SplitMethod, string> = {
  equal: 'Equally',
  unequal: 'Exact amounts',
  exact: 'Exact amounts',
  percentage: 'Percentages',
  shares: 'Shares',
};

const categoryLabel = (id: string) => getCategory(id)?.label ?? id;

// ─── Records ────────────────────────────────────────────

/** Someone who appears in an export, by name. */
export interface ExportPerson {
  id: string;
  name: string;
}

/** Shown for a person whose account no longer exists. */
export const FORMER_MEMBER = 'Former member';

/** One person's part of an Expense: what they paid, or their share. */
export interface ExportAllocation {
  userId: string;
  amountMinor: number;
}

/** One edit, as stored: who, when, and each field's value before and after. */
export interface ExportEdit {
  at: Date | string;
  byId: string;
  changes: Record<string, { old?: unknown; new?: unknown } | undefined>;
}

export interface ExportExpense {
  id: string;
  date: Date | string;
  description: string;
  /** The Category's id, e.g. `food`. */
  category: string;
  /** The Tag's name today. */
  tag: string;
  currency: string;
  amountMinor: number;
  splitMethod: SplitMethod;
  notes?: string | null;
  paidBy: ExportAllocation[];
  splitBetween: ExportAllocation[];
  /** Set for a deleted Expense: when, and by whom when known. */
  deleted?: { at: Date | string | null; byId: string | null } | null;
  /** Its edits, in any order. */
  edits?: ExportEdit[];
}

export interface ExportPayment {
  id: string;
  /** When it was recorded. */
  at: Date | string;
  fromId: string;
  toId: string;
  amountMinor: number;
  currency: string;
  note?: string | null;
  recordedById: string;
}

// ─── Expenses ───────────────────────────────────────────

/** The Expense columns every export has, in order. */
export const EXPENSE_COLUMNS = [
  'Date',
  'Description',
  'Category',
  'Tag',
  'Paid by',
  'Split',
  'Amount',
  'Currency',
  'Notes',
  'Expense ID',
] as const;

/** A share column's header: one per person, with "Shares per person". */
export const shareColumn = (name: string) => `${name} share`;

/** Added after the shares, with "Deleted Expenses". */
export const DELETED_COLUMNS = ['Deleted at', 'Deleted by'] as const;

/** Added last, with "Edit history". */
export const EDIT_COLUMNS = ['Edited at', 'Edited by', 'Change'] as const;

export interface ExpenseCsvOptions {
  /** One column per person with their share of each Expense. */
  shares: boolean;
  /** Deleted Expenses as rows, with when and by whom. */
  deleted: boolean;
  /** Each edit as a row after its Expense. */
  history: boolean;
  /** The zone the edit and deletion times are written in. */
  timeZone: string;
}

export interface ExpenseCsvInput {
  /** In the order the file lists them. */
  expenses: readonly ExportExpense[];
  /** The Group's members today, in the Group's order: the first share columns. */
  members: readonly ExportPerson[];
  /** Everyone's name by id, members or not. Anyone missing is a former member. */
  names: Readonly<Record<string, string>>;
  options: ExpenseCsvOptions;
}

export interface CsvTable {
  header: string[];
  rows: string[][];
}

const nameIn = (names: Readonly<Record<string, string>>) => (id: string) =>
  names[id] || FORMER_MEMBER;

/**
 * The share columns: every member today, in the Group's order, then anyone else with a share in
 * these Expenses, by name. Two people with one name are told apart as "Sam (2)".
 */
function sharePeople(input: ExpenseCsvInput): { id: string; header: string }[] {
  const name = nameIn(input.names);
  const ids = input.members.map((member) => member.id);
  const others = new Set<string>();
  for (const expense of input.expenses)
    if (!expense.deleted || input.options.deleted)
      for (const share of expense.splitBetween)
        if (!ids.includes(share.userId)) others.add(share.userId);
  const rest = [...others].sort(
    (a, b) => name(a).localeCompare(name(b), 'en') || (a < b ? -1 : a > b ? 1 : 0),
  );
  const used = new Set<string>();
  return [...ids, ...rest].map((id) => {
    let header = shareColumn(name(id));
    for (let count = 2; used.has(header); count += 1)
      header = shareColumn(`${name(id)} (${count})`);
    used.add(header);
    return { id, header };
  });
}

/** "Alex Rivera", or "Alex Rivera 600.00, Sam Chen 400.00" when several people paid. */
function payersCell(
  paidBy: readonly ExportAllocation[],
  currency: string,
  name: (id: string) => string,
) {
  if (paidBy.length === 1) return name(paidBy[0].userId);
  return paidBy
    .map((payer) => `${name(payer.userId)} ${formatMinorAmount(payer.amountMinor, currency)}`)
    .join(', ');
}

/**
 * The rows of a Group's Expenses CSV.
 *
 * Each Expense is one row. With edit history, each of its edits follows it, oldest first, as a
 * row of its own: the Expense's date, description and id, who edited it, when, and what
 * changed. An edit row leaves Amount and the shares blank, so summing the Amount column counts
 * each Expense once. A deleted Expense (only with "Deleted Expenses") keeps its amount and
 * says when and by whom it was deleted.
 */
export function buildExpenseCsv(input: ExpenseCsvInput): CsvTable {
  const { options } = input;
  const name = nameIn(input.names);
  const shares = options.shares ? sharePeople(input) : [];
  const header = [
    ...EXPENSE_COLUMNS,
    ...shares.map((person) => person.header),
    ...(options.deleted ? DELETED_COLUMNS : []),
    ...(options.history ? EDIT_COLUMNS : []),
  ];
  const blank = (count: number) => Array.from({ length: count }, () => '');

  const rows: string[][] = [];
  for (const expense of input.expenses) {
    if (expense.deleted && !options.deleted) continue;
    const day = expenseDay(expense.date);
    const shareCells = shares.map((person) => {
      const share = expense.splitBetween.find((entry) => entry.userId === person.id);
      return formatMinorAmount(share?.amountMinor ?? 0, expense.currency);
    });
    const deletedCells = options.deleted
      ? expense.deleted
        ? [
            expense.deleted.at ? zonedTimestamp(expense.deleted.at, options.timeZone) : '',
            expense.deleted.byId ? name(expense.deleted.byId) : '',
          ]
        : blank(2)
      : [];
    rows.push([
      day,
      expense.description,
      categoryLabel(expense.category),
      expense.tag,
      payersCell(expense.paidBy, expense.currency, name),
      SPLIT_LABELS[expense.splitMethod] ?? expense.splitMethod,
      formatMinorAmount(expense.amountMinor, expense.currency),
      expense.currency,
      expense.notes ?? '',
      expense.id,
      ...shareCells,
      ...deletedCells,
      ...(options.history ? blank(EDIT_COLUMNS.length) : []),
    ]);

    if (!options.history) continue;
    const edits = [...(expense.edits ?? [])].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
    for (const edit of edits) {
      rows.push([
        day,
        expense.description,
        ...blank(7),
        expense.id,
        ...blank(shares.length),
        ...(options.deleted ? blank(DELETED_COLUMNS.length) : []),
        zonedTimestamp(edit.at, options.timeZone),
        name(edit.byId),
        describeEdit(edit.changes, expense.currency, name),
      ]);
    }
  }
  return { header, rows };
}

// ─── Edits ──────────────────────────────────────────────

type Change = { old?: unknown; new?: unknown } | undefined;

/** The fields an edit row describes, in the order it names them. */
const EDIT_FIELDS = [
  'description',
  'amount',
  'currency',
  'date',
  'category',
  'tag',
  'paidBy',
  'splitMethod',
  'splitBetween',
  'notes',
] as const;

const NOTHING = '(none)';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stored minor amount, or a legacy decimal read exactly; null when it can't be read. */
function minorOf(minor: unknown, major: unknown, currency: string): number | null {
  try {
    if (typeof minor === 'number' && Number.isSafeInteger(minor)) return minor;
    if (typeof major === 'number' && Number.isFinite(major))
      return readLegacyAmountMinor(major, currency);
  } catch {
    // Unreadable: described as unknown below.
  }
  return null;
}

function amountText(minor: unknown, major: unknown, currency: string, withCode: boolean) {
  const value = minorOf(minor, major, currency);
  if (value === null) return '?';
  const text = formatMinorAmount(value, currency);
  return withCode ? `${text} ${currency}` : text;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value === '' ? NOTHING : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return NOTHING;
}

function dayOf(value: unknown): string {
  if (value instanceof Date || typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return expenseDay(date);
  }
  return NOTHING;
}

/** A stored list of payers or shares, as names with amounts. */
function peopleText(value: unknown, currency: string, name: (id: string) => string) {
  if (!Array.isArray(value) || value.length === 0) return NOTHING;
  return value
    .map((entry) => {
      const row = isRecord(entry) ? entry : {};
      const who = name(moneyParticipantId(row.user));
      const minor = minorOf(row.amountMinor, row.amount, currency);
      return minor === null ? who : `${who} ${formatMinorAmount(minor, currency)}`;
    })
    .join(', ');
}

/**
 * What an edit changed, field by field: "Amount: 2680.00 → 2860.00; Tag: Groceries → Food".
 * Ids, internal fields and anything else not shown in the app are left out; people are named.
 */
export function describeEdit(
  changes: Readonly<Record<string, Change>>,
  currency: string,
  name: (id: string) => string,
): string {
  const currencyChange = isRecord(changes.currency) ? changes.currency : undefined;
  const oldCurrency = typeof currencyChange?.old === 'string' ? currencyChange.old : currency;
  const newCurrency = typeof currencyChange?.new === 'string' ? currencyChange.new : currency;
  const mixed = oldCurrency !== newCurrency;
  const minor = isRecord(changes.amountMinor) ? changes.amountMinor : undefined;

  const parts: string[] = [];
  for (const field of EDIT_FIELDS) {
    // An amount edit records the decimal and, since exact money (#39), the minor units too.
    const change = field === 'amount' ? (changes.amount ?? minor) : changes[field];
    if (!isRecord(change)) continue;
    const pair = (before: string, after: string, label: string) =>
      parts.push(`${label}: ${before} → ${after}`);
    switch (field) {
      case 'description':
      case 'tag':
      case 'notes':
        pair(textOf(change.old), textOf(change.new), field[0].toUpperCase() + field.slice(1));
        break;
      case 'amount':
        pair(
          amountText(minor?.old, change.old, oldCurrency, mixed),
          amountText(minor?.new, change.new, newCurrency, mixed),
          'Amount',
        );
        break;
      case 'currency':
        pair(textOf(change.old), textOf(change.new), 'Currency');
        break;
      case 'date':
        pair(dayOf(change.old), dayOf(change.new), 'Date');
        break;
      case 'category':
        pair(
          typeof change.old === 'string' ? categoryLabel(change.old) : NOTHING,
          typeof change.new === 'string' ? categoryLabel(change.new) : NOTHING,
          'Category',
        );
        break;
      case 'splitMethod':
        pair(splitText(change.old), splitText(change.new), 'Split');
        break;
      case 'paidBy':
        pair(
          peopleText(change.old, oldCurrency, name),
          peopleText(change.new, newCurrency, name),
          'Paid by',
        );
        break;
      case 'splitBetween':
        pair(
          peopleText(change.old, oldCurrency, name),
          peopleText(change.new, newCurrency, name),
          'Shares',
        );
        break;
    }
  }
  return parts.length > 0 ? parts.join('; ') : 'Other details';
}

function splitText(value: unknown) {
  return typeof value === 'string' && value in SPLIT_LABELS
    ? SPLIT_LABELS[value as SplitMethod]
    : NOTHING;
}

// ─── Payments ───────────────────────────────────────────

/** The payments columns, in order. */
export const PAYMENT_COLUMNS = [
  'Date',
  'Recorded at',
  'From',
  'To',
  'Amount',
  'Currency',
  'Note',
  'Recorded by',
  'Payment ID',
] as const;

export interface PaymentCsvInput {
  /** In the order the file lists them. */
  payments: readonly ExportPayment[];
  names: Readonly<Record<string, string>>;
  /** The zone each payment's day and time are written in. */
  timeZone: string;
}

/** The rows of a Group's payments CSV: who paid whom, how much, and who recorded it. */
export function buildPaymentCsv({ payments, names, timeZone }: PaymentCsvInput): CsvTable {
  const name = nameIn(names);
  return {
    header: [...PAYMENT_COLUMNS],
    rows: payments.map((payment) => [
      zonedDay(payment.at, timeZone),
      zonedTimestamp(payment.at, timeZone),
      name(payment.fromId),
      name(payment.toId),
      formatMinorAmount(payment.amountMinor, payment.currency),
      payment.currency,
      payment.note ?? '',
      name(payment.recordedById),
      payment.id,
    ]),
  };
}
