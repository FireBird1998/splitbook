import { format, resolveConfig } from 'prettier';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { normalizeExpenseMoney } from '@splitbook/shared/exact-money';
import { completeExpenseDraftSchema } from '@splitbook/shared/validators/expense-draft';
import {
  entries,
  columns,
  savedFor,
  alex,
  sam,
  refusal,
  type TypedEntry,
  type Reading,
} from '@splitbook/shared/test-support/expense-entry-cases';
import { recording } from '@splitbook/shared/test-support/expense-entry-recording';

type Cell = Reading & { edit?: Reading };
const table = Object.fromEntries(
  columns.map((column) => [
    column,
    JSON.parse(
      readFileSync(
        new URL(
          '../../../../../test/expense-entry-readings/recordings/' + column + '.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as Record<string, Cell>,
  ]),
);
const cell = (column: string, id: string) => table[column][id];
/** Compare the accepted figures, not object key order or each client's wire envelope. */
function allocation(column: string, row: TypedEntry, value = cell(column, row.id)) {
  const result = value.result;
  if (result.kind === 'refusal' || result.kind === 'unsupported') return result;
  try {
    const input =
      result.kind === 'draft'
        ? completeExpenseDraftSchema.parse(result.value)
        : ({
            ...(column === 'android-edit' || column === 'web-edit' ? savedFor(row) : {}),
            ...(result.value as object),
          } as Parameters<typeof normalizeExpenseMoney>[0]);
    const money = normalizeExpenseMoney(input);
    return {
      kind: 'allocation' as const,
      amountMinor: money.amountMinor,
      currency: money.currency,
      paidBy: money.paidBy.map((p) => ({ user: String(p.user), amountMinor: p.amountMinor })),
      splitBetween: money.splitBetween.map((p) => ({
        user: String(p.user),
        amountMinor: p.amountMinor,
        ...(p.percentage === undefined ? {} : { percentage: p.percentage }),
        ...(p.shares === undefined ? {} : { shares: p.shares }),
      })),
    };
  } catch (error) {
    return refusal(error);
  }
}
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
function groups<T>(values: [string, T][]) {
  const groups: { columns: string[]; reading: T }[] = [];
  for (const [column, value] of values) {
    const existing = groups.find((g) => stable(g.reading) === stable(value));
    if (existing) existing.columns.push(column);
    else groups.push({ columns: [column], reading: value });
  }
  return groups;
}
const row = (id: string) => entries.find((r) => r.id === id)!;
const money = (column: string, id: string) => {
  const result = allocation(column, row(id));
  if (result.kind !== 'allocation') throw new Error(column + '/' + id + ': expected an allocation');
  return result;
};
const resultValue = (column: string, id: string) => {
  const result = cell(column, id).result;
  if (result.kind !== 'command' && result.kind !== 'draft')
    throw new Error('Expected accepted values');
  return result.value as {
    paidBy: { user: string; amount?: number }[];
    splitBetween: { user: string; shares?: number; amount?: number }[];
  };
};

it('records every column and every differing reading by entry (#1111)', async () => {
  for (const column of columns)
    expect(Object.keys(table[column]), column).toEqual(entries.map((r) => r.id));
  const differences = Object.fromEntries(
    entries.map((row) => {
      const contexts: [string, Reading][] = columns.flatMap((column) => {
        const current = cell(column, row.id);
        return current.edit
          ? [
              [column, current] as [string, Reading],
              [column + '.edit', current.edit] as [string, Reading],
            ]
          : [[column, current]];
      });
      return [
        row.id,
        {
          // Drafts are also completed by the current server schema here, showing a Finish later round trip.
          allocationsOrRefusals: groups(
            contexts.map(([column, value]) => [
              column,
              allocation(column.split('.')[0], row, value),
            ]),
          ),
          wireResults: groups(contexts.map(([column, value]) => [column, value.result])).map(
            (g) => g.columns,
          ),
          displays: groups(contexts.map(([column, value]) => [column, value.shown ?? null])).map(
            (g) => g.columns,
          ),
        },
      ];
    }),
  );
  await expect(await recording(differences)).toMatchFileSnapshot(
    '../../../../../test/expense-entry-readings/differences.json',
  );
  const short = (column: string) =>
    ({
      'web-new': 'WN',
      'web-edit': 'WE',
      'web-recurring': 'RC',
      'android-new': 'AN',
      'android-edit': 'AE',
      'server-complete': 'SC',
      'web-finish-later': 'WF',
      'android-finish-later': 'AF',
      'web-review': 'WR',
      'android-review': 'AR',
      'web-recurring.edit': 'RC edit',
    })[column] ?? column;
  const describe = (value: ReturnType<typeof allocation>) => {
    if (value.kind === 'unsupported') return 'unsupported: ' + value.reason;
    if (value.kind === 'refusal')
      return value.issues.map((i) => (i.field || 'form') + ': ' + i.message).join('; ');
    const person = (id: string) => ({ [alex]: 'Alex', [sam]: 'Sam' })[id] ?? 'Priya';
    const amount = (minor: number) =>
      formatCurrency(toMajorAmount(minor, value.currency), value.currency);
    return (
      'paid ' +
      value.paidBy.map((p) => person(p.user) + ' ' + amount(p.amountMinor)).join(', ') +
      '; split ' +
      value.splitBetween
        .map(
          (p) =>
            person(p.user) +
            ' ' +
            amount(p.amountMinor) +
            (p.shares === undefined ? '' : ' (' + p.shares + ' shares)') +
            (p.percentage === undefined ? '' : ' (' + p.percentage + '%)'),
        )
        .join(', ')
    );
  };
  const groupNames = (sets: string[][]) =>
    sets.map((set) => '[' + set.map(short).join(', ') + ']').join(' ');
  const lines = [
    '# Today’s Expense entry readings (#1111)',
    '',
    'Recorded by the three package suites from `packages/shared/src/test-support/expense-entry-cases.ts`. Regenerate each column before updating this comparison.',
    '',
    'WN/WE: web new/edit; RC: recurring new (RC edit: saved template); AN/AE: Android new/edit; SC: server completion; WF/AF: web/Android Finish later; WR/AR: web/Android To review.',
    '',
    'Each allocation below uses the existing money rules. Draft outputs are first completed with the existing server schema; an edit’s patch is applied to its saved fixture. Raw commands/Drafts and rendered words stay in the ten column files under `recordings/`. Empty refusal paths there mean an unscoped/form refusal. No translator or arithmetic is implemented by this comparison.',
    '',
    'Raw-result and display brackets group equal cells; different brackets differ. The recurring form offers `exact` for Amounts, so that column records the offered method explicitly. Its portal alone renders inline for the component test.',
    '',
    '| Entry | Allocations or refusals (columns in the same group agree) | Equal raw-result groups | Equal display groups |',
    '| --- | --- | --- | --- |',
  ];
  for (const [entry, difference] of Object.entries(differences))
    lines.push(
      '| ' +
        entry +
        ' | ' +
        difference.allocationsOrRefusals
          .map(
            (group) =>
              '**' +
              group.columns.map(short).join(', ') +
              '**: ' +
              describe(group.reading).replaceAll('|', '\\|'),
          )
          .join('<br>') +
        ' | ' +
        groupNames(difference.wireResults) +
        ' | ' +
        groupNames(difference.displays) +
        ' |',
    );
  const markdown = await format(lines.join('\n') + '\n', {
    ...(await resolveConfig('entry-readings.md')),
    parser: 'markdown',
  });
  await expect(markdown).toMatchFileSnapshot(
    '../../../../../test/expense-entry-readings/comparison.md',
  );
});

it('shows a partly blank share saved as zero everywhere (#1117 decision 1)', () => {
  expect(money('web-new', 'shares-partly-blank').splitBetween.map((p) => p.amountMinor)).toEqual([
    10000, 0,
  ]);
  for (const column of [
    'android-new',
    'web-recurring',
    'server-complete',
    'web-finish-later',
    'android-finish-later',
    'web-review',
    'android-review',
  ])
    expect(
      money(column, 'shares-partly-blank').splitBetween.map((p) => p.amountMinor),
      column,
    ).toEqual([10000, 0]);
  expect(cell('web-new', 'shares-partly-blank').shown).toMatchObject({
    formContents: expect.stringContaining('2\u00a0shares\u00a0· ₹50.00/share'),
  });
});
it('shows a zero payer sent or retained except by Android save (#1111 claim 2)', () => {
  expect(resultValue('web-new', 'payers-zero').paidBy.map((p) => p.user)).toEqual([alex, sam]);
  expect(resultValue('android-new', 'payers-zero').paidBy.map((p) => p.user)).toEqual([alex]);
  for (const column of [
    'server-complete',
    'web-finish-later',
    'android-finish-later',
    'web-review',
    'android-review',
  ])
    expect(resultValue(column, 'payers-zero').paidBy, column).toContainEqual({
      user: sam,
      amount: 0,
    });
});
it('shows a blank split amount as zero, missing, or invalid (#1111 claim 3)', () => {
  for (const column of ['web-new', 'android-new'])
    expect(money(column, 'amounts-partly-blank').splitBetween.map((p) => p.amountMinor)).toEqual([
      10000, 0,
    ]);
  expect(cell('server-complete', 'amounts-partly-blank').result).toEqual({
    kind: 'refusal',
    issues: [
      { field: 'splitBetween.1.amount', message: 'Enter an amount for each person in the split' },
    ],
  });
  expect(cell('web-recurring', 'amounts-partly-blank').result).toEqual({
    kind: 'refusal',
    issues: [{ field: '', message: 'Enter a valid decimal amount' }],
  });
});
it('shows blank payer refusal, dropping, and the lone-payer completion (#1111 claim 4)', () => {
  expect(cell('web-new', 'payers-partly-blank').result.kind).toBe('refusal');
  expect(money('android-new', 'payers-partly-blank').paidBy).toEqual([
    { user: alex, amountMinor: 10000 },
  ]);
  expect(cell('server-complete', 'payers-partly-blank').result).toMatchObject({
    kind: 'refusal',
    issues: [{ field: 'paidBy.1.amount' }],
  });
  expect(money('server-complete', 'lone-listed-payer-blank').paidBy).toEqual([
    { user: alex, amountMinor: 10000 },
  ]);
});
it('limits recurring unreadable-to-zero coercion to percentages and shares (#1111 claim 5)', () => {
  for (const id of ['unreadable-percentage', 'unreadable-share']) {
    expect(money('web-recurring', id).splitBetween.map((p) => p.amountMinor)).toEqual([10000, 0]);
    for (const column of [
      'web-new',
      'android-new',
      'web-finish-later',
      'android-finish-later',
      'web-review',
      'android-review',
    ])
      expect(cell(column, id).result.kind, column).toBe('refusal');
  }
  for (const id of ['unreadable-amount', 'unreadable-split-amount'])
    expect(cell('web-recurring', id).result.kind).toBe('refusal');
});
it('shows fractional shares in the web total while both preview and save refuse them (#1111 claim 6)', () => {
  expect(cell('web-new', 'shares-fractional')).toMatchObject({
    result: {
      kind: 'refusal',
      issues: [{ message: 'Shares must be whole numbers within the supported range' }],
    },
    shown: {
      formContents: expect.stringContaining('2\u00a0shares'),
      preview: { error: 'Shares must be whole numbers within the supported range' },
    },
  });
});
it('shows the three no-share wordings, including both Android correction surfaces (#1111 claim 7)', () => {
  expect(cell('web-new', 'shares-all-blank').result).toMatchObject({
    issues: [{ message: 'Each member needs at least 1 share' }],
  });
  expect(cell('web-recurring', 'shares-all-blank').result).toMatchObject({
    issues: [{ message: 'Total split weight must be positive' }],
  });
  expect(cell('server-complete', 'shares-all-blank').result).toMatchObject({
    issues: [{ message: 'Total split weight must be positive' }],
  });
  expect(cell('android-new', 'shares-all-blank').shown).toMatchObject({
    split: { status: { message: 'Give at least one person a share.' } },
    corrections: { split: 'Total split weight must be positive' },
  });
});
it('shows the separate single-payer field and the zero-payer conflict comparison (#1111)', () => {
  expect(money('web-new', 'single-payer-field-differs').paidBy).toEqual([
    { user: sam, amountMinor: 10000 },
  ]);
  expect(money('android-new', 'single-payer-field-differs').paidBy).toEqual([
    { user: sam, amountMinor: 10000 },
  ]);
  expect(cell('android-edit', 'payers-zero')).toMatchObject({
    result: { kind: 'command', value: {} },
    shown: { payerDifferencesWithoutZero: ['payers'] },
  });
  expect(cell('android-edit', 'saved-zero-payer-conflict').shown).toMatchObject({
    conflictReview: ['payers'],
  });
});

it('records To review’s missing-fact gate and local rejection instead of only its Split preview (#1111)', () => {
  expect(cell('android-review', 'amounts-partly-blank').shown).toMatchObject({
    split: { status: { kind: 'adds-up' } },
    reviewScreen: {
      saveDisabled: true,
      text: expect.stringContaining('One thing left before you can save: who shared it'),
    },
  });
  for (const id of [
    'shares-fractional',
    'unreadable-amount',
    'unreadable-payer',
    'unreadable-split-amount',
    'unreadable-percentage',
    'unreadable-share',
  ]) {
    expect(cell('android-review', id).shown, id).toMatchObject({
      reviewScreen: {
        saveDisabled: true,
        text: expect.stringContaining('Correct the entered amount or details before saving.'),
      },
    });
  }
  expect(cell('android-review', 'unreadable-amount').shown).toMatchObject({
    reviewScreen: {
      valuesKept: { amount: 100 },
      fields: expect.arrayContaining([
        { label: 'Amount, Indian Rupee', value: 'not a number', editable: true },
      ]),
    },
  });
});

it('keeps a historical zero payer through a notes edit and records the money-change difference (#1111)', () => {
  for (const column of ['web-edit', 'android-edit'])
    expect(money(column, 'saved-zero-payer-unchanged').paidBy).toEqual([
      { user: alex, amountMinor: 10000 },
      { user: sam, amountMinor: 0 },
    ]);
  expect(cell('android-edit', 'saved-zero-payer-unchanged').result).toEqual({
    kind: 'command',
    value: { notes: 'Receipt checked' },
  });
  expect(money('web-edit', 'saved-zero-payer-money-change').paidBy).toEqual([
    { user: alex, amountMinor: 12000 },
    { user: sam, amountMinor: 0 },
  ]);
  expect(money('android-edit', 'saved-zero-payer-money-change').paidBy).toEqual([
    { user: alex, amountMinor: 12000 },
  ]);
});
