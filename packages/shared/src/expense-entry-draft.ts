import type { GroupCategory } from './types';
export interface DraftContext {
  members: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  /** The Group's currency, which an item without its own is in (#512). */
  currency?: string;
  /** The Group's category, which names it as Add expense does: a Trip's currency (#567). */
  category?: GroupCategory;
  /** The member reviewing, called "You" by id, never made the payer (#591). */
  viewerId?: string;
}

import { enteredPayers, type IncompleteExpenseEntry } from './expense-entry';
import { expenseDraftValuesSchema, type ExpenseDraftValues } from './validators/expense-draft';

type DraftEntries = Record<string, string>;

/** An incomplete Draft is kept as typed text; no amount is filled in for the member. */
export function entryForExpenseDraft(values: ExpenseDraftValues = {}): IncompleteExpenseEntry {
  const multiPayer = (values.paidBy?.length ?? 0) > 1;
  values = {
    ...values,
    paidBy: lastPeople(values.paidBy),
    splitBetween: lastPeople(values.splitBetween),
  };
  const part =
    values.splitMethod === 'percentage'
      ? 'percentage'
      : values.splitMethod === 'shares'
        ? 'shares'
        : 'amount';
  return {
    description: values.description ?? '',
    amount: values.amount === undefined ? '' : String(values.amount),
    currency: values.currency ?? '',
    date: values.date ?? '',
    category: values.category ?? '',
    tagId: values.tagId ?? '',
    notes: values.notes ?? '',
    payerId: values.paidBy?.[0]?.user ?? '',
    multiPayer,
    payers:
      values.paidBy?.map((row) => ({
        user: row.user,
        amount: row.amount === undefined ? '' : String(row.amount),
      })) ?? [],
    splitMethod: values.splitMethod ?? '',
    participantIds: values.splitBetween?.map((row) => row.user) ?? [],
    splitValues: Object.fromEntries(
      (values.splitBetween ?? []).map((row) => [
        row.user,
        row[part] === undefined ? '' : String(row[part]),
      ]),
    ),
  };
}

/** Finish later omits unpaid people and boxes left blank; it never completes an Expense. */
export function draftForExpenseEntry(
  entry: IncompleteExpenseEntry,
  update?: {
    from: ExpenseDraftValues;
    changed: Partial<Record<keyof IncompleteExpenseEntry, boolean>>;
  },
): ExpenseDraftValues {
  const fields: DraftEntries = update ? draftEntries(update.from) : {};
  for (const key of ['description', 'amount', 'currency', 'date', 'category', 'notes'] as const)
    if (!update || update.changed[key]) fields[key] = entry[key];
  if (!update) {
    fields.tagId = entry.tagId;
    fields.splitMethod = entry.splitMethod;
  } else if (update.changed.tagId) {
    delete fields.tag;
    fields.tagId = entry.tagId;
  }
  const changed = update?.changed;
  const payersEdited =
    !update ||
    changed?.payerId ||
    changed?.payers ||
    changed?.multiPayer ||
    (changed?.amount && update.from.paidBy?.length === 1);
  const splitEdited =
    !update || changed?.splitMethod || changed?.participantIds || changed?.splitValues;
  if (payersEdited) {
    for (const key of Object.keys(fields)) if (key.startsWith('paidBy.')) delete fields[key];
    const payers = entry.multiPayer
      ? enteredPayers(entry.payers)
      : [{ user: entry.payerId, amount: entry.amount }];
    for (const payer of payers) {
      if (update && !payer.user) continue;
      fields[`paidBy.${payer.user}`] = 'yes';
      fields[`paidBy.${payer.user}.amount`] = entry.multiPayer ? payer.amount : entry.amount;
    }
  }
  if (splitEdited) {
    const replace = !update;
    for (const key of Object.keys(fields)) {
      if (!key.startsWith('splitBetween.')) continue;
      if (replace || (changed?.splitMethod && key.split('.').length === 3)) delete fields[key];
      else if (changed?.participantIds && key.split('.').length === 2) fields[key] = '';
    }
    const method = entry.splitMethod;
    if (replace || changed?.splitMethod) fields.splitMethod = method;
    const part = method === 'percentage' ? 'percentage' : method === 'shares' ? 'shares' : 'amount';
    if (replace || changed?.participantIds)
      for (const id of entry.participantIds) fields[`splitBetween.${id}`] = 'yes';
    if (method !== 'equal' && (replace || changed?.splitValues))
      for (const id of replace ? entry.participantIds : Object.keys(entry.splitValues))
        fields[`splitBetween.${id}.${part}`] = entry.splitValues[id] ?? '';
  }
  const values = draftValues(fields, entry.multiPayer);
  // The codec holds one row per person. Editing something else must not settle a person an
  // assistant listed twice: those rows stay as given, so the warning and the blocked Save stay
  // until the member edits that part themselves (#1117 decision 11).
  if (update && !payersEdited && repeats(update.from.paidBy)) values.paidBy = update.from.paidBy;
  if (update && !splitEdited && repeats(update.from.splitBetween))
    values.splitBetween = update.from.splitBetween;
  return values;
}
const repeats = (rows: Array<{ user: string }> = []) =>
  new Set(rows.map((row) => row.user)).size < rows.length;

// Private codec: these temporary fields are never held by a form or persisted.
function draftEntries(values: ExpenseDraftValues = {}): DraftEntries {
  const entries: DraftEntries = {};
  for (const key of [
    'description',
    'amount',
    'currency',
    'date',
    'category',
    'notes',
    'tagId',
    'tag',
    'splitMethod',
  ] as const)
    if (values[key] !== undefined) entries[key] = String(values[key]);
  for (const [key, rows] of [
    ['paidBy', values.paidBy],
    ['splitBetween', values.splitBetween],
  ] as const)
    for (const row of lastPeople(rows)) {
      entries[`${key}.${row.user}`] = 'yes';
      for (const [field, value] of Object.entries(row))
        if (field !== 'user') entries[`${key}.${row.user}.${field}`] = String(value);
    }
  if (values.predefinedItem) entries.predefinedItem = values.predefinedItem;
  return entries;
}
function draftValues(entries: DraftEntries, multiPayer: boolean): ExpenseDraftValues {
  const value: Record<string, unknown> = {};
  for (const key of [
    'description',
    'amount',
    'currency',
    'date',
    'category',
    'notes',
    'tagId',
    'tag',
    'splitMethod',
    'predefinedItem',
  ]) {
    if (key === 'tag' && Object.hasOwn(entries, 'tagId')) continue;
    if (entries[key]?.trim())
      value[key] = key === 'amount' ? Number(entries[key]) : entries[key].trim();
  }
  for (const kind of ['paidBy', 'splitBetween']) {
    const rows = Object.entries(entries)
      .filter(
        ([key, selected]) =>
          key.startsWith(`${kind}.`) && key.split('.').length === 2 && selected === 'yes',
      )
      .map(([key]) => {
        const row: Record<string, unknown> = { user: key.split('.')[1] };
        for (const part of ['amount', 'percentage', 'shares'])
          if (entries[`${key}.${part}`]?.trim()) row[part] = Number(entries[`${key}.${part}`]);
        return row;
      });
    const kept =
      // Collapsing repeated identities can leave one row, but does not turn an entered
      // multiple-payer amount into an instruction that one person paid the whole Expense.
      kind === 'paidBy' && (multiPayer || rows.length > 1)
        ? rows.filter((row) => row.amount !== undefined && row.amount !== 0)
        : rows;
    if (kept.length) value[kind] = kept;
  }
  const parsed = expenseDraftValuesSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  return parsed.data;
}

/** Repeated identities are one box: the later row wins, never a sum or an invented value. */
function lastPeople<Row extends { user: string }>(rows: Row[] = []): Row[] {
  return [...new Map(rows.map((row) => [row.user, row])).values()];
}
