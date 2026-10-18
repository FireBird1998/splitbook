import { expenseDraftValuesSchema, type ExpenseDraftValues } from './validators/expense-draft';
import type { GroupCategory } from './types';
export type DraftEntries = Record<string, string>;
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
export function draftEntries(values: ExpenseDraftValues = {}): DraftEntries {
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
export function draftValues(entries: DraftEntries): ExpenseDraftValues {
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
