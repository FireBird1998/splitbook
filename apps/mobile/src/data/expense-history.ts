import { getCategory } from '@splitbook/shared/categories';
import { formatCurrency } from '@splitbook/shared/currency';
import { formatDateTime } from '@splitbook/shared/date';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type { ExpenseRecord } from './expense-record';

/** One changed value. Values are absent when only the change itself can be described. */
export interface ExpenseHistoryChange {
  label: string;
  before?: string;
  after?: string;
  /** Amounts, which the design sets in the monospace money face. */
  money?: boolean;
}

export interface ExpenseHistoryEntry {
  key: string;
  editor: string;
  /** For example "Priya Shah changed the amount and date". */
  summary: string;
  editedAt: string;
  changes: ExpenseHistoryChange[];
}

const formerMember = 'Former member';
const splitMethods: Record<string, string> = {
  equal: 'Equal',
  unequal: 'Unequal',
  percentage: 'Percentage',
  shares: 'Shares',
  exact: 'Exact',
};
const nouns: Record<string, string> = {
  description: 'the description',
  amount: 'the amount',
  amountMinor: 'the amount',
  currency: 'the currency',
  date: 'the date',
  category: 'the category',
  notes: 'the notes',
  tag: 'the Tag',
  tagId: 'the Tag',
  paidBy: 'who paid',
  splitBetween: 'the split',
  splitMethod: 'the split',
  predefinedItem: 'the item',
  receiptUrl: 'the receipt',
};

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const quoted = (value: unknown) => (text(value).trim() ? `“${text(value).trim()}”` : 'None');
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? value.filter((row): row is Row => !!row && typeof row === 'object') : [];
const identity = (value: unknown): string | null =>
  typeof value === 'string'
    ? value
    : value && typeof value === 'object' && '_id' in value
      ? String(value._id)
      : null;

function money(row: Row, currency: string): string | null {
  try {
    if (typeof row.amountMinor === 'number')
      return formatCurrency(toMajorAmount(row.amountMinor, currency), currency);
  } catch {
    // Legacy rows fall back to their recorded major amount.
  }
  return typeof row.amount === 'number' && Number.isFinite(row.amount)
    ? formatCurrency(row.amount, currency)
    : null;
}

function day(value: unknown) {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime())
    ? 'Unknown date'
    : date.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

function list(items: string[]) {
  const unique = [...new Set(items)];
  if (unique.length > 4) return `${unique.length} details`;
  return unique.length > 1
    ? `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`
    : (unique[0] ?? 'this Expense');
}

/**
 * Explains recorded edits in member terms, newest first: names instead of member references,
 * each amount in the currency it had at the time, and no raw values or identifiers. Anyone the
 * Group and Expense no longer name is a former member.
 */
export function describeExpenseHistory(
  record: ExpenseRecord,
  people: { id: string; name: string }[] = [],
  tags: { id: string; name: string }[] = [],
): ExpenseHistoryEntry[] {
  const names = new Map(people.map((person) => [person.id, person.name]));
  for (const row of [...record.paidBy, ...record.splitBetween])
    if (row.user && row.name !== formerMember && !names.has(row.user))
      names.set(row.user, row.name);
  for (const entry of record.editHistory) {
    const editor = entry.editedBy;
    if (editor && typeof editor === 'object' && editor.name && !names.has(editor._id))
      names.set(editor._id, editor.name);
  }
  const person = (value: unknown) => {
    const id = identity(value);
    const named =
      value && typeof value === 'object' && 'name' in value ? text(value.name) : undefined;
    return named || (id && names.get(id)) || formerMember;
  };
  const tagName = (value: unknown) => {
    const id = identity(value);
    return tags.find((tag) => tag.id === id)?.name;
  };

  const allocation = (
    field: 'paidBy' | 'splitBetween',
    change: { old?: unknown; new?: unknown },
    currencies: { before: string; after: string },
  ): ExpenseHistoryChange[] => {
    const amounts = (value: unknown, currency: string) =>
      new Map(
        rows(value).map((row, index) => [
          identity(row.user) ?? `former:${index}`,
          { who: person(row.user), amount: money(row, currency) },
        ]),
      );
    const before = amounts(change.old, currencies.before);
    const after = amounts(change.new, currencies.after);
    const absent = (currency: string) =>
      field === 'paidBy' ? formatCurrency(0, currency) : 'Not included';
    return [...new Set([...after.keys(), ...before.keys()])].flatMap((key) => {
      const was = before.get(key)?.amount ?? absent(currencies.before);
      const now = after.get(key)?.amount ?? absent(currencies.after);
      if (was === now) return [];
      const who = (after.get(key) ?? before.get(key))!.who;
      return [
        {
          label: field === 'paidBy' ? `${who}’s payment` : `${who}’s share`,
          before: was,
          after: now,
          money: true,
        },
      ];
    });
  };

  let currencyAfter = record.currency;
  return [...record.editHistory].reverse().map((entry, index) => {
    const { changes } = entry;
    // Walking back from the current record gives each edit the currency it was made in.
    const currencies = {
      after: currencyAfter,
      before: text(changes.currency?.old) || currencyAfter,
    };
    currencyAfter = currencies.before;
    const described = Object.entries(changes).flatMap(([field, change]): ExpenseHistoryChange[] => {
      switch (field) {
        case 'moneyVersion':
          return [];
        // References restate a named change; they are described only when that is missing.
        case 'tagId': {
          if (changes.tag) return [];
          const before = tagName(change.old),
            after = tagName(change.new);
          return [before && after ? { label: 'Tag', before, after } : { label: 'Tag' }];
        }
        case 'amountMinor':
          if (changes.amount) return [];
          return [
            {
              label: 'Amount',
              before: money({ amountMinor: change.old }, currencies.before) ?? undefined,
              after: money({ amountMinor: change.new }, currencies.after) ?? undefined,
              money: true,
            },
          ];
        case 'description':
        case 'notes':
        case 'predefinedItem':
          return [
            {
              label:
                field === 'predefinedItem' ? 'Item' : field === 'notes' ? 'Notes' : 'Description',
              before: quoted(change.old),
              after: quoted(change.new),
            },
          ];
        case 'amount':
          return [
            {
              label: 'Amount',
              before: money({ amount: change.old }, currencies.before) ?? undefined,
              after: money({ amount: change.new }, currencies.after) ?? undefined,
              money: true,
            },
          ];
        case 'currency':
          return [{ label: 'Currency', before: currencies.before, after: currencies.after }];
        case 'date':
          return [{ label: 'Date', before: day(change.old), after: day(change.new) }];
        case 'category':
          return [
            {
              label: 'Category',
              before: getCategory(text(change.old))?.label ?? 'None',
              after: getCategory(text(change.new))?.label ?? 'None',
            },
          ];
        case 'tag':
          return [
            {
              label: 'Tag',
              before: text(change.old) || 'Historical Tag',
              after: text(change.new) || 'Historical Tag',
            },
          ];
        case 'splitMethod':
          return [
            {
              label: 'Split method',
              before: splitMethods[text(change.old)] ?? 'Unknown',
              after: splitMethods[text(change.new)] ?? 'Unknown',
            },
          ];
        case 'paidBy':
        case 'splitBetween':
          return allocation(field, change, currencies);
        case 'receiptUrl':
          return [
            {
              label: 'Receipt',
              after: !text(change.new) ? 'Removed' : text(change.old) ? 'Replaced' : 'Added',
            },
          ];
        default:
          return [{ label: 'Other details' }];
      }
    });
    const editor = person(entry.editedBy);
    const fields = Object.keys(changes).filter((field) => field !== 'moneyVersion');
    return {
      key: `${entry.editedAt}:${index}`,
      editor,
      summary: `${editor} changed ${list(fields.map((field) => nouns[field] ?? 'other details'))}`,
      editedAt: formatDateTime(entry.editedAt),
      changes: described,
    };
  });
}
