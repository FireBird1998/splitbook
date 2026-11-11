import type { IncompleteExpenseEntry } from './expense-entry';
import { expenseEntryPolicy, type ExpenseEntryPolicy } from './expense-entry';
type DraftEntries = Record<string, string>;
import { expenseDraftValuesSchema, type ExpenseDraftValues } from './validators/expense-draft';

export interface ExpenseDraftEntryPolicy {
  singlePayer: ExpenseEntryPolicy['singlePayer'];
  /** Sheet changes replace the split; a box edit retains the parts it didn't edit. */
  splitEdit?: 'replace' | 'patch';
  repeatedPeople?: 'keep' | 'merge';
}
export const fieldDraftEntryPolicy: ExpenseDraftEntryPolicy = {
  singlePayer: 'first-row',
  splitEdit: 'patch',
  repeatedPeople: 'merge',
};

/** An incomplete Draft is kept as typed text; no amount is filled in for the member. */
export function entryForExpenseDraft(
  values: ExpenseDraftValues = {},
  policy: ExpenseDraftEntryPolicy = expenseEntryPolicy,
): IncompleteExpenseEntry {
  if (policy.repeatedPeople === 'merge') {
    const merge = <Row extends { user: string }>(rows: Row[] = []) => {
      const people = new Map<string, Row>();
      for (const row of rows) people.set(row.user, { ...people.get(row.user), ...row });
      return [...people.values()];
    };
    values = { ...values, paidBy: merge(values.paidBy), splitBetween: merge(values.splitBetween) };
  }
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
    multiPayer: (values.paidBy?.length ?? 0) > 1,
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

/** Finish later keeps zero rows and omits boxes left blank; it never completes an Expense. */
export function draftForExpenseEntry(
  entry: IncompleteExpenseEntry,
  policy: ExpenseDraftEntryPolicy = expenseEntryPolicy,
  update?: {
    from: ExpenseDraftValues;
    changed: Partial<Record<keyof IncompleteExpenseEntry, boolean>>;
  },
): ExpenseDraftValues {
  const fields: DraftEntries = update ? draftEntries(update.from) : {};
  for (const key of ['description', 'amount', 'currency', 'date', 'category', 'notes'] as const)
    if (!update || update.changed[key]) fields[key] = entry[key];
  if (!update) {
    Object.assign(
      fields,
      /^[a-f0-9]{24}$/i.test(entry.tagId) ? { tagId: entry.tagId } : { tag: entry.tagId },
    );
    fields.splitMethod = entry.splitMethod;
  } else if (update.changed.tagId) {
    delete fields.tag;
    fields.tagId = entry.tagId;
  }
  const changed = update?.changed;
  if (
    !update ||
    changed?.payerId ||
    changed?.payers ||
    changed?.multiPayer ||
    (changed?.amount &&
      update.from.paidBy?.length === 1 &&
      (policy.singlePayer === 'field' || !entry.multiPayer))
  ) {
    for (const key of Object.keys(fields)) if (key.startsWith('paidBy.')) delete fields[key];
    const payers =
      entry.multiPayer || policy.singlePayer === 'first-row'
        ? entry.payers
        : [{ user: entry.payerId, amount: entry.amount }];
    for (const payer of payers) {
      if (update && !payer.user) continue;
      fields[`paidBy.${payer.user}`] = 'yes';
      fields[`paidBy.${payer.user}.amount`] = entry.multiPayer ? payer.amount : entry.amount;
    }
  }
  if (!update || changed?.splitMethod || changed?.participantIds || changed?.splitValues) {
    const replace = !update || policy.splitEdit !== 'patch';
    for (const key of Object.keys(fields)) {
      if (!key.startsWith('splitBetween.')) continue;
      if (
        replace ||
        (changed?.splitMethod && key.split('.').length === 3) ||
        (changed?.participantIds && key.split('.').length === 2)
      )
        delete fields[key];
    }
    if (!update || changed?.splitMethod) fields.splitMethod = entry.splitMethod;
    const part =
      entry.splitMethod === 'percentage'
        ? 'percentage'
        : entry.splitMethod === 'shares'
          ? 'shares'
          : 'amount';
    if (replace || changed?.participantIds)
      for (const id of entry.participantIds) fields[`splitBetween.${id}`] = 'yes';
    if (entry.splitMethod !== 'equal' && (replace || changed?.splitValues))
      for (const id of replace ? entry.participantIds : Object.keys(entry.splitValues))
        fields[`splitBetween.${id}.${part}`] = entry.splitValues[id] ?? '';
  }
  return draftValues(fields);
}

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
    for (const row of rows ?? []) {
      entries[`${key}.${row.user}`] = 'yes';
      for (const [field, value] of Object.entries(row))
        if (field !== 'user') entries[`${key}.${row.user}.${field}`] = String(value);
    }
  if (values.predefinedItem) entries.predefinedItem = values.predefinedItem;
  return entries;
}
function draftValues(entries: DraftEntries): ExpenseDraftValues {
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
    if (rows.length) value[kind] = rows;
  }
  const parsed = expenseDraftValuesSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  return parsed.data;
}
