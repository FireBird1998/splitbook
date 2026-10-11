import { expenseDraftValuesSchema, type ExpenseDraftValues } from './validators/expense-draft';
import { CATEGORY_IDS } from './categories';
export type DraftEntries = Record<string, string>;
export interface DraftField {
  key: string;
  label: string;
  options?: Array<{ value: string; label: string }>;
  numeric?: boolean;
}
export interface DraftContext {
  members: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
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
export function draftFields(entries: DraftEntries, context: DraftContext): DraftField[] {
  const choices = (values: string[]) => values.map((value) => ({ value, label: value }));
  const fields: DraftField[] = [
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', numeric: true },
    { key: 'currency', label: 'Currency (e.g. INR)' },
    { key: 'date', label: 'Date (YYYY-MM-DD)' },
    { key: 'category', label: 'Category', options: choices(CATEGORY_IDS) },
    {
      key: 'tagId',
      label: 'Tag',
      options: context.tags.map((tag) => ({ value: tag.id, label: tag.name })),
    },
    {
      key: 'splitMethod',
      label: 'Split method',
      options: choices(['equal', 'exact', 'percentage', 'shares']),
    },
    { key: 'notes', label: 'Notes' },
  ];
  for (const kind of ['paidBy', 'splitBetween']) {
    const known = new Map(context.members.map((member) => [member.id, member.name]));
    for (const key of Object.keys(entries))
      if (key.startsWith(`${kind}.`)) {
        const id = key.split('.')[1];
        if (!known.has(id)) known.set(id, `Former member (${id})`);
      }
    for (const [id, name] of known) {
      fields.push({
        key: `${kind}.${id}`,
        label: `${kind === 'paidBy' ? 'Paid by' : 'Shared by'} ${name}`,
        options: [{ value: 'yes', label: 'Included' }],
      });
      if (entries[`${kind}.${id}`] !== 'yes') continue;
      const part =
        kind === 'paidBy'
          ? 'amount'
          : entries.splitMethod === 'percentage'
            ? 'percentage'
            : entries.splitMethod === 'shares'
              ? 'shares'
              : entries.splitMethod === 'equal'
                ? null
                : 'amount';
      if (part)
        fields.push({ key: `${kind}.${id}.${part}`, label: `${name} — ${part}`, numeric: true });
    }
  }
  return fields;
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
