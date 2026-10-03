import { getCategory } from '@splitbook/shared/categories';
import { formatCurrency } from '@splitbook/shared/currency';
import { formatDateTime } from '@splitbook/shared/date';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type { ActivityEvent } from './activity';
import type { ExpenseRecord } from './expense-record';

/** One changed value. Values are absent when only the change itself can be described. */
export interface ExpenseHistoryChange {
  label: string;
  before?: string;
  after?: string;
  /** Which values are amounts, which the design sets in the monospace money face. */
  money?: { before: boolean; after: boolean };
}

export interface ExpenseHistoryEntry {
  key: string;
  editor: string;
  /** For example "Priya Shah changed the amount and date". */
  summary: string;
  editedAt: string;
  changes: ExpenseHistoryChange[];
}

/** One Activity event about an Expense, as its record lists it. */
export interface ExpenseHistoryEvent {
  key: string;
  /** Who acted, or "Former member". */
  name: string;
  /** "You" for the signed-in member, otherwise `name`. */
  actor: string;
  /** For example "changed the amount" or "added this Expense". */
  action: string;
  changes: ExpenseHistoryChange[];
  /** The action already names the only change, so its label isn't repeated. */
  implied: boolean;
  at: string;
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

const changedFields = (changes: Record<string, unknown>) =>
  Object.keys(changes).filter((field) => field !== 'moneyVersion');
/** "the amount and the date": what an edit changed, as a member would say it. */
const changedWhat = (changes: Record<string, unknown>) =>
  list(changedFields(changes).map((field) => nouns[field] ?? 'other details'));

function allocation(
  field: 'paidBy' | 'splitBetween',
  change: { old?: unknown; new?: unknown },
  currencies: { before: string; after: string },
  person: (value: unknown) => string,
): ExpenseHistoryChange[] {
  const amounts = (value: unknown, currency: string) =>
    new Map(
      rows(value).map((row, index) => [
        identity(row.user) ?? `former:${index}`,
        { who: person(row.user), amount: money(row, currency) },
      ]),
    );
  const before = amounts(change.old, currencies.before);
  const after = amounts(change.new, currencies.after);
  // Someone missing from the split is "Not included", which is a word, not an amount.
  const absent = (currency: string) => (field === 'paidBy' ? formatCurrency(0, currency) : null);
  return [...new Set([...after.keys(), ...before.keys()])].flatMap((key) => {
    const was = before.get(key)?.amount ?? absent(currencies.before);
    const now = after.get(key)?.amount ?? absent(currencies.after);
    if (was === now) return [];
    const who = (after.get(key) ?? before.get(key))!.who;
    return [
      {
        label: field === 'paidBy' ? `${who}’s payment` : `${who}’s share`,
        before: was ?? 'Not included',
        after: now ?? 'Not included',
        money: { before: was !== null, after: now !== null },
      },
    ];
  });
}

/**
 * Describes one recorded edit, field by field, in member terms. Shared by an Expense's history
 * and by Activity events, so an edit reads the same wherever it appears.
 */
export function describeExpenseChanges(
  changes: Record<string, { old?: unknown; new?: unknown }>,
  {
    currencies,
    person,
    tagName = () => undefined,
  }: {
    /** The currency before and after this edit. */
    currencies: { before: string; after: string };
    /** Names a member reference, or "Former member". */
    person: (value: unknown) => string;
    tagName?: (value: unknown) => string | undefined;
  },
): ExpenseHistoryChange[] {
  return Object.entries(changes).flatMap(([field, change]): ExpenseHistoryChange[] => {
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
            money: { before: true, after: true },
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
            money: { before: true, after: true },
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
        return allocation(field, change, currencies, person);
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
}

/** Names member references from known people; anyone else is a former member. */
export function memberNamer(names: Map<string, string>) {
  return (value: unknown) => {
    const id = identity(value);
    const named =
      value && typeof value === 'object' && 'name' in value ? text(value.name) : undefined;
    return named || (id && names.get(id)) || formerMember;
  };
}

/** The Group's members by id, then anyone the Expense itself still names. */
function knownNames(record: ExpenseRecord, people: { id: string; name: string }[]) {
  const names = new Map(people.map((person) => [person.id, person.name]));
  for (const row of [...record.paidBy, ...record.splitBetween])
    if (row.user && row.name !== formerMember && !names.has(row.user))
      names.set(row.user, row.name);
  return names;
}

const tagNamer =
  (tags: { id: string; name: string }[]) =>
  (value: unknown): string | undefined => {
    const id = identity(value);
    return tags.find((tag) => tag.id === id)?.name;
  };

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
  const names = knownNames(record, people);
  for (const entry of record.editHistory) {
    const editor = entry.editedBy;
    if (editor && typeof editor === 'object' && editor.name && !names.has(editor._id))
      names.set(editor._id, editor.name);
  }
  const person = memberNamer(names);
  const tagName = tagNamer(tags);

  let currencyAfter = record.currency;
  return [...record.editHistory].reverse().map((entry, index) => {
    const { changes } = entry;
    // Walking back from the current record gives each edit the currency it was made in.
    const currencies = {
      after: currencyAfter,
      before: text(changes.currency?.old) || currencyAfter,
    };
    currencyAfter = currencies.before;
    const described = describeExpenseChanges(changes, { currencies, person, tagName });
    const editor = person(entry.editedBy);
    return {
      key: `${entry.editedAt}:${index}`,
      editor,
      summary: `${editor} changed ${changedWhat(changes)}`,
      editedAt: formatDateTime(entry.editedAt),
      changes: described,
    };
  });
}

/**
 * The currency in force just after a moment in an Expense's life, from every currency change
 * its record or events show. Events read on another occasion than the record, such as older
 * ones saved on this device, still get the currency they were made in, even when a change
 * between them and the record isn't among them.
 */
function currencyTimeline(record: ExpenseRecord, events: ActivityEvent[]) {
  const changes = [
    ...record.editHistory.map((entry) => ({ at: entry.editedAt, change: entry.changes.currency })),
    ...events.map((event) => ({ at: event.createdAt, change: event.metadata.changes?.currency })),
  ]
    .flatMap(({ at, change }) => {
      const before = text(change?.old),
        after = text(change?.new);
      return before && after ? [{ at: Date.parse(at), before, after }] : [];
    })
    .sort((a, b) => a.at - b.at);
  return (at: string) => {
    const time = Date.parse(at);
    const later = changes.find((change) => change.at > time);
    if (later) return later.before;
    return changes.at(-1)?.after ?? record.currency;
  };
}

/**
 * Explains an Expense's own Activity events, newest first, in the same terms as its recorded
 * edits: who acted, what changed with its before and after values, and each amount in the
 * currency it had at the time. Anyone the event, Group and Expense don't name is a former
 * member; no raw values or identifiers are shown.
 */
export function describeExpenseEvents(
  events: ActivityEvent[],
  record: ExpenseRecord,
  {
    currentUserId,
    people = [],
    tags = [],
  }: {
    currentUserId?: string;
    /** The Group's current members. */
    people?: { id: string; name: string }[];
    tags?: { id: string; name: string }[];
  } = {},
): ExpenseHistoryEvent[] {
  const person = memberNamer(knownNames(record, people));
  const tagName = tagNamer(tags);
  const currencyAfter = currencyTimeline(record, events);
  return events.map((event) => {
    const name = person(event.actor);
    const base = {
      key: event._id,
      name,
      actor: currentUserId && event.actor?._id === currentUserId ? 'You' : name,
      changes: [],
      implied: false,
      at: event.createdAt,
    };
    const { action, changes = {} } = event.metadata;
    switch (event.type) {
      case 'expense_added':
        return { ...base, action: 'added this Expense' };
      case 'expense_deleted':
        return { ...base, action: 'deleted this Expense' };
      case 'expense_updated': {
        if (action === 'restored') return { ...base, action: 'restored this Expense' };
        const after = text(changes.currency?.new) || currencyAfter(event.createdAt);
        const currencies = { after, before: text(changes.currency?.old) || after };
        const described = describeExpenseChanges(changes, { currencies, person, tagName });
        const [only] = described;
        const fields = changedFields(changes);
        return {
          ...base,
          action: `changed ${changedWhat(changes)}`,
          changes: described,
          // "changed the amount" needs only "₹2,680.00 → ₹2,860.00"; a share keeps its name.
          implied:
            described.length === 1 &&
            only.before !== undefined &&
            only.after !== undefined &&
            new Set(fields.map((field) => nouns[field])).size === 1 &&
            !fields.some((field) => field === 'paidBy' || field === 'splitBetween'),
        };
      }
      default:
        return { ...base, action: 'changed this Expense' };
    }
  });
}
