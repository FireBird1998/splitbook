import { formatDateTime } from '@splitbook/shared/date';
import { expenseEditLines, type ExpenseEditLine } from '@splitbook/shared/expense-detail';
import type { ActivityEvent } from './activity';
import type { ExpenseRecord } from './expense-record';

/** One fact an edit changed, as web words it too (#515). */
export type ExpenseHistoryChange = ExpenseEditLine;

export interface ExpenseHistoryEntry {
  key: string;
  editor: string;
  /** For example "Priya Shah edited this Expense". */
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
  /** For example "edited this Expense" or "added this Expense". */
  action: string;
  changes: ExpenseHistoryChange[];
  at: string;
}

const formerMember = 'Former member';

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const identity = (value: unknown): string | null =>
  typeof value === 'string'
    ? value
    : value && typeof value === 'object' && '_id' in value
      ? String(value._id)
      : null;

/**
 * Describes one recorded edit, one short line per fact, by the rule web uses too (#515). Shared
 * by an Expense's history and by Activity events, so an edit reads the same wherever it appears.
 */
export function describeExpenseChanges(
  changes: Record<string, { old?: unknown; new?: unknown }>,
  {
    currencies,
    person,
    tagName,
    viewer,
  }: {
    /** The currency before and after this edit. */
    currencies: { before: string; after: string };
    /** Names a member reference, or "Former member". */
    person: (value: unknown) => string;
    tagName?: (value: unknown) => string | undefined;
    /** The signed-in member, whose payment and share are "Your". */
    viewer?: string;
  },
): ExpenseHistoryChange[] {
  return expenseEditLines(changes, currencies, { name: person, viewer, tagName });
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
  currentUserId?: string,
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
    const described = describeExpenseChanges(changes, {
      currencies,
      person,
      tagName,
      viewer: currentUserId,
    });
    const editor =
      currentUserId && identity(entry.editedBy) === currentUserId ? 'You' : person(entry.editedBy);
    return {
      key: `${entry.editedAt}:${index}`,
      editor,
      summary: `${editor} edited this Expense`,
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
        return {
          ...base,
          action: 'edited this Expense',
          changes: describeExpenseChanges(changes, {
            currencies,
            person,
            tagName,
            viewer: currentUserId,
          }),
        };
      }
      default:
        return { ...base, action: 'changed this Expense' };
    }
  });
}
