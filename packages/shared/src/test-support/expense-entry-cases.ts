/** #1111: typed examples shared by the three packages; no reading is implemented here. */
export const people = [
  { id: 'a00000000000000000000001', name: 'Alex Rivera' },
  { id: 'a00000000000000000000002', name: 'Sam Chen' },
  { id: 'a00000000000000000000003', name: 'Priya Shah' },
];
export const [alex, sam, priya] = people.map((person) => person.id);
export const groupId = 'b00000000000000000000001';
export const expenseId = 'd00000000000000000000001';
export const tagId = 'c00000000000000000000001';
export const day = '2026-11-10';

export interface TypedEntry {
  id: string;
  amount: string;
  currency: string;
  description: string;
  date: string;
  category: string;
  notes: string;
  tagId: string;
  payerId: string;
  multiPayer: boolean;
  payers: { user: string; amount: string }[];
  splitMethod: 'equal' | 'unequal' | 'exact' | 'percentage' | 'shares';
  splitValues: Record<string, string>;
  participantIds: string[];
  savedZeroPayer?: 'unchanged' | 'money-change' | 'conflict';
}
const entry = (id: string, changes: Partial<TypedEntry> = {}): TypedEntry => ({
  id,
  amount: '100',
  currency: 'INR',
  description: 'Groceries',
  date: day,
  category: 'food',
  notes: '',
  tagId,
  payerId: alex,
  multiPayer: false,
  payers: [{ user: alex, amount: '100' }],
  splitMethod: 'equal',
  splitValues: {},
  participantIds: [alex, sam],
  ...changes,
});
const split = (splitMethod: TypedEntry['splitMethod'], a: string, b: string) => ({
  splitMethod,
  splitValues: { [alex]: a, [sam]: b },
});
const payers = (a: string, b: string) => ({
  multiPayer: true,
  payers: [
    { user: alex, amount: a },
    { user: sam, amount: b },
  ],
});

export const entries: TypedEntry[] = [
  entry('equal'),
  entry('amounts', split('unequal', '40', '60')),
  entry('exact', split('exact', '40', '60')),
  entry('percentage', split('percentage', '40', '60')),
  entry('shares', split('shares', '2', '1')),
  entry('multiple-payers', payers('40', '60')),
  entry('leftover-cent', { participantIds: [alex, sam, priya] }),
  entry('shares-partly-blank', split('shares', '2', '')),
  entry('shares-all-blank', split('shares', '', '')),
  entry('shares-one-zero', split('shares', '2', '0')),
  entry('shares-all-zero', split('shares', '0', '0')),
  entry('shares-fractional', split('shares', '1.5', '1')),
  entry('payers-partly-blank', payers('100', '')),
  entry('payers-zero', payers('100', '0')),
  entry('single-payer-blank', { payers: [{ user: alex, amount: '' }] }),
  entry('lone-listed-payer-blank', { multiPayer: true, payers: [{ user: alex, amount: '' }] }),
  entry('amounts-partly-blank', split('unequal', '100', '')),
  entry('amounts-not-total', split('unequal', '40', '40')),
  entry('percentage-partly-blank', split('percentage', '100', '')),
  entry('percentage-not-total', split('percentage', '40', '40')),
  entry('unreadable-amount', { amount: 'not a number' }),
  entry('unreadable-payer', payers('100', 'not a number')),
  entry('unreadable-split-amount', split('unequal', '100', 'not a number')),
  entry('unreadable-percentage', split('percentage', '100', 'not a number')),
  entry('unreadable-share', split('shares', '2', 'not a number')),
  entry('unticked-typed-value', {
    ...split('shares', '1', 'not a number'),
    participantIds: [alex],
  }),
  entry('no-participants', { participantIds: [] }),
  entry('single-payer-field-differs', { payerId: sam }),
  entry('saved-zero-payer-unchanged', {
    ...payers('100', '0'),
    savedZeroPayer: 'unchanged',
  }),
  entry('saved-zero-payer-money-change', {
    ...payers('120', '0'),
    amount: '120',
    savedZeroPayer: 'money-change',
  }),
  entry('saved-zero-payer-conflict', {
    ...payers('100', '0'),
    savedZeroPayer: 'conflict',
  }),
];

export const columns = [
  'web-new',
  'web-edit',
  'web-recurring',
  'android-new',
  'android-edit',
  'server-complete',
  'web-finish-later',
  'android-finish-later',
  'web-review',
  'android-review',
] as const;

export type Reading = {
  result:
    | { kind: 'command' | 'draft'; value: unknown }
    | { kind: 'refusal'; issues: { field: string; message: string }[] }
    | { kind: 'unsupported'; reason: string };
  shown?: unknown;
};

export const savedExpense = {
  _id: expenseId,
  group: groupId,
  revision: 1,
  description: 'Groceries',
  amount: 100,
  amountMinor: 10000,
  currency: 'INR',
  moneyVersion: 1,
  paidBy: [{ user: alex, amount: 100, amountMinor: 10000 }],
  splitBetween: [
    { user: alex, amount: 50, amountMinor: 5000 },
    { user: sam, amount: 50, amountMinor: 5000 },
  ],
  splitMethod: 'equal' as const,
  date: day + 'T00:00:00.000Z',
  createdAt: day + 'T00:00:00.000Z',
  updatedAt: day + 'T00:00:00.000Z',
  category: 'food',
  tag: 'Shared',
  tagId,
  notes: '',
  isDeleted: false,
};
export const savedFor = (row: TypedEntry) => ({
  ...savedExpense,
  paidBy: row.savedZeroPayer
    ? [...savedExpense.paidBy, { user: sam, amount: 0, amountMinor: 0 }]
    : savedExpense.paidBy,
});

/** Preserve the native refusal's words and path; an unscoped error stays unscoped. */
export function refusal(error: unknown): Extract<Reading['result'], { kind: 'refusal' }> {
  const cause = error as {
    message?: string;
    field?: (string | number)[];
    issues?: { path: PropertyKey[]; message: string }[];
  };
  return {
    kind: 'refusal',
    issues: cause?.issues
      ? cause.issues.map((issue) => ({
          field: issue.path.map(String).join('.'),
          message: issue.message,
        }))
      : [{ field: cause?.field?.join('.') ?? '', message: cause?.message ?? String(error) }],
  };
}

/** The numeric input a stored Draft can carry; unreadable text has no representation in it. */
export function numericDraft(row: TypedEntry) {
  const number = (text: string) => (text.trim() ? { value: Number(text) } : {});
  const total = number(row.amount);
  const part =
    row.splitMethod === 'percentage'
      ? 'percentage'
      : row.splitMethod === 'shares'
        ? 'shares'
        : 'amount';
  return {
    description: row.description,
    ...(total.value === undefined ? {} : { amount: total.value }),
    currency: row.currency,
    date: row.date,
    category: row.category,
    notes: row.notes,
    tagId,
    splitMethod: row.splitMethod,
    paidBy: row.payers.map((payer) => {
      const amount = number(payer.amount);
      return { user: payer.user, ...(amount.value === undefined ? {} : { amount: amount.value }) };
    }),
    splitBetween: row.participantIds.map((user) => {
      const value = number(row.splitValues[user] ?? '');
      return {
        user,
        ...(row.splitMethod === 'equal' || value.value === undefined
          ? {}
          : { [part]: value.value }),
      };
    }),
  };
}
