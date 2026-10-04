import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import {
  test,
  expect,
  dataOf,
  expensePath,
  joinGroup,
  observeLedger,
  type Ledger,
} from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

const { alex, sam, priya } = DEMO_PERSONA_IDS;
const revisionHeaders = (revision: number) => ({ 'X-Splitbook-Revision': String(revision) });
const newExpense = (overrides: Record<string, unknown> = {}) => ({
  description: `Exact ledger ${randomUUID()}`,
  amount: 100,
  currency: 'INR',
  category: 'housing',
  tag: 'Rent',
  date: new Date().toISOString(),
  paidBy: [{ user: priya, amount: 100 }],
  splitMethod: 'equal',
  splitBetween: [{ user: priya }, { user: sam }],
  ...overrides,
});

async function observeGroup(actor: APIRequestContext, groupId: string) {
  return {
    expenses: await dataOf(await actor.get(`/api/groups/${groupId}/expenses`)),
    balances: await dataOf(await actor.get(`/api/groups/${groupId}/balances`)),
    activity: await dataOf(await actor.get(`/api/groups/${groupId}/activity`)),
  };
}

async function createCurrencyGroup(ledger: Ledger, currency: string) {
  const group = await dataOf(
    await ledger.priya.post('/api/groups', {
      data: {
        name: `Exact ${currency}`,
        category: 'home',
        defaultCurrency: currency,
        alternateCurrencies: [],
      },
    }),
    201,
  );
  await joinGroup(ledger.priya, ledger.sam, group._id);
  await joinGroup(ledger.priya, ledger.alex, group._id);
  return group._id as string;
}

for (const [reason, overrides] of [
  ['payer total', { paidBy: [{ user: priya, amount: 1 }] }],
  [
    'duplicate payers',
    {
      paidBy: [
        { user: priya, amount: 50 },
        { user: priya, amount: 50 },
      ],
    },
  ],
  ['duplicate participants', { splitBetween: [{ user: priya }, { user: priya }] }],
  ['fractional minor units', { amount: 100.001, paidBy: [{ user: priya, amount: 100.001 }] }],
  [
    'incomplete percentages',
    {
      splitMethod: 'percentage',
      splitBetween: [
        { user: priya, percentage: 40 },
        { user: sam, percentage: 40 },
      ],
    },
  ],
  [
    'zero shares',
    {
      splitMethod: 'shares',
      splitBetween: [
        { user: priya, shares: 0 },
        { user: sam, shares: 0 },
      ],
    },
  ],
  [
    'incomplete exact allocation',
    {
      splitMethod: 'exact',
      splitBetween: [
        { user: priya, amount: 49.99 },
        { user: sam, amount: 50 },
      ],
    },
  ],
] as const) {
  test(`rejects ${reason} without changing the ledger`, async ({ ledger }) => {
    const before = await observeGroup(ledger.priya, ledger.groupB);
    const response = await ledger.priya.post(`/api/groups/${ledger.groupB}/expenses`, {
      data: newExpense(overrides),
    });
    expect(response.status(), await response.text()).toBe(422);
    expect(await observeGroup(ledger.priya, ledger.groupB)).toEqual(before);
  });
}

test('three equal shares conserve every minor unit in the record and balances', async ({
  ledger,
}) => {
  await joinGroup(ledger.priya, ledger.alex, ledger.groupB);
  const expense = await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/expenses`, {
      data: newExpense({
        splitMethod: 'shares',
        splitBetween: [
          { user: priya, shares: 1 },
          { user: sam, shares: 1 },
          { user: alex, shares: 1 },
        ],
      }),
    }),
    201,
  );
  const stored = await dataOf(await ledger.priya.get(expensePath(ledger.groupB, expense._id)));
  expect(stored).toMatchObject({ moneyVersion: 1, amount: 100, amountMinor: 10000 });
  expect(stored.splitBetween.map((person: { amountMinor: number }) => person.amountMinor)).toEqual([
    3333, 3333, 3334,
  ]);
  const balances = await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}/balances`));
  expect(balances.balances).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ user: expect.objectContaining({ _id: priya }), balance: 66.67 }),
      expect.objectContaining({ user: expect.objectContaining({ _id: sam }), balance: -33.33 }),
      expect.objectContaining({ user: expect.objectContaining({ _id: alex }), balance: -33.34 }),
    ]),
  );
});

test('an amount-only edit rejects the complete invalid state without history or Activity', async ({
  ledger,
}) => {
  const before = await observeLedger(ledger, ledger.expenseB);
  const response = await ledger.sam.patch(expensePath(ledger.groupB, ledger.expenseB), {
    data: { amount: 1300 },
    headers: revisionHeaders(before.expense.revision ?? 0),
  });
  expect(response.status(), await response.text()).toBe(422);
  expect(await observeLedger(ledger, ledger.expenseB)).toEqual(before);
});

test('JPY uses whole units and settlement clears the exact intended balance', async ({
  ledger,
}) => {
  const group = await createCurrencyGroup(ledger, 'JPY');
  const expense = await dataOf(
    await ledger.priya.post(`/api/groups/${group}/expenses`, {
      data: newExpense({
        currency: 'JPY',
        splitBetween: [{ user: priya }, { user: sam }, { user: alex }],
      }),
    }),
    201,
  );
  expect(expense.amountMinor).toBe(100);
  expect(expense.splitBetween.map((person: { amount: number }) => person.amount)).toEqual([
    33, 33, 34,
  ]);
  const before = await observeGroup(ledger.priya, group);
  const invalid = await ledger.sam.post(`/api/groups/${group}/settlements`, {
    data: { paidTo: priya, amount: 0.5, currency: 'JPY' },
  });
  expect(invalid.status(), await invalid.text()).toBe(422);
  expect(await observeGroup(ledger.priya, group)).toEqual(before);
  const settlement = await dataOf(
    await ledger.sam.post(`/api/groups/${group}/settlements`, {
      data: { paidTo: priya, amount: 33, currency: 'JPY' },
    }),
    201,
  );
  expect(settlement).toMatchObject({ moneyVersion: 1, amount: 33, amountMinor: 33 });
  const after = await dataOf(await ledger.sam.get(`/api/groups/${group}/balances`));
  expect(
    after.balances.find((row: { user: { _id: string } }) => row.user._id === sam).balance,
  ).toBe(0);
});

test('financial records permanently lock Group currency, including after deletion', async ({
  ledger,
}) => {
  const path = expensePath(ledger.groupB, ledger.expenseB);
  const expense = await dataOf(await ledger.priya.get(path));
  await dataOf(
    await ledger.priya.delete(path, { headers: revisionHeaders(expense.revision ?? 0) }),
  );
  const changed = await ledger.priya.patch(`/api/groups/${ledger.groupB}`, {
    data: { defaultCurrency: 'JPY' },
  });
  expect(changed.status(), await changed.text()).toBe(409);
  expect(
    (await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}`))).defaultCurrency,
  ).toBe('INR');
});

test('dashboard preserves separate currency balances across Groups', async ({ ledger }) => {
  const yenGroup = await createCurrencyGroup(ledger, 'JPY');
  for (const [group, currency] of [
    [ledger.groupB, 'INR'],
    [yenGroup, 'JPY'],
  ]) {
    await dataOf(
      await ledger.priya.post(`/api/groups/${group}/expenses`, {
        data: newExpense({
          currency,
          amount: 10,
          paidBy: [{ user: priya, amount: 10 }],
          splitBetween: [{ user: sam }],
        }),
      }),
      201,
    );
  }
  const result = await dataOf(await ledger.sam.get('/api/user/balances'));
  for (const [group, currency] of [
    [ledger.groupB, 'INR'],
    [yenGroup, 'JPY'],
  ]) {
    expect(
      result.groups.find((item: { groupId: string }) => item.groupId === group).balances,
    ).toEqual([expect.objectContaining({ currency, balance: -10 })]);
  }
  expect(result.buckets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ currency: 'INR' }),
      expect.objectContaining({ currency: 'JPY' }),
    ]),
  );
});

test('concurrent same-key Expense creates produce one record and one Activity', async ({
  ledger,
}) => {
  const body = newExpense();
  const headers = { 'Idempotency-Key': randomUUID() };
  const path = `/api/groups/${ledger.groupB}/expenses`;
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => ledger.priya.post(path, { data: body, headers })),
  );
  const created = await Promise.all(responses.map((response) => dataOf(response, 201)));
  expect(new Set(created.map((expense) => expense._id)).size).toBe(1);
  const snapshot = await observeGroup(ledger.priya, ledger.groupB);
  expect(
    snapshot.expenses.expenses.filter(
      (expense: { description: string }) => expense.description === body.description,
    ),
  ).toHaveLength(1);
  expect(
    snapshot.activity.activities.filter(
      (activity: { metadata?: { expenseId?: string }; type: string }) =>
        activity.type === 'expense_added' && activity.metadata?.expenseId === created[0]._id,
    ),
  ).toHaveLength(1);
  const conflict = await ledger.priya.post(path, {
    data: { ...body, description: `${body.description} changed` },
    headers,
  });
  expect(conflict.status(), await conflict.text()).toBe(409);
  expect(await observeGroup(ledger.priya, ledger.groupB)).toEqual(snapshot);
});

test('concurrent same-key Settlements change the balance only once', async ({ ledger }) => {
  await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/expenses`, {
      data: newExpense({ splitBetween: [{ user: sam }] }),
    }),
    201,
  );
  const path = `/api/groups/${ledger.groupB}/settlements`;
  const body = { paidTo: priya, amount: 25, currency: 'INR' };
  const headers = { 'Idempotency-Key': randomUUID() };
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => ledger.sam.post(path, { data: body, headers })),
  );
  const payments = await Promise.all(responses.map((response) => dataOf(response, 201)));
  expect(new Set(payments.map((payment) => payment._id)).size).toBe(1);
  const balances = await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/balances`));
  expect(
    balances.balances.find((row: { user: { _id: string } }) => row.user._id === sam).balance,
  ).toBe(-75);
  const conflict = await ledger.sam.post(path, { data: { ...body, amount: 30 }, headers });
  expect(conflict.status(), await conflict.text()).toBe(409);
  expect(await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}/balances`))).toEqual(
    balances,
  );
});

test('stale edits and deletes cannot overwrite a newer Expense', async ({ ledger }) => {
  const path = expensePath(ledger.groupB, ledger.expenseB);
  const original = await dataOf(await ledger.sam.get(path));
  const updated = await dataOf(
    await ledger.sam.patch(path, {
      data: { description: 'First editor won' },
      headers: revisionHeaders(original.revision ?? 0),
    }),
  );
  expect(updated.revision).toBe((original.revision ?? 0) + 1);
  const before = await observeLedger(ledger, ledger.expenseB);
  const staleEdit = await ledger.priya.patch(path, {
    data: { description: 'Stale editor' },
    headers: revisionHeaders(original.revision ?? 0),
  });
  expect(staleEdit.status(), await staleEdit.text()).toBe(409);
  const staleDelete = await ledger.priya.delete(path, {
    headers: revisionHeaders(original.revision ?? 0),
  });
  expect(staleDelete.status(), await staleDelete.text()).toBe(409);
  expect(await observeLedger(ledger, ledger.expenseB)).toEqual(before);
});

test('two simultaneous edits with the same revision cannot both succeed', async ({ ledger }) => {
  const path = expensePath(ledger.groupB, ledger.expenseB);
  const original = await dataOf(await ledger.sam.get(path));
  const responses = await Promise.all([
    ledger.sam.patch(path, {
      data: { description: 'Sam won' },
      headers: revisionHeaders(original.revision ?? 0),
    }),
    ledger.priya.patch(path, {
      data: { description: 'Priya won' },
      headers: revisionHeaders(original.revision ?? 0),
    }),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 409]);
  const latest = await dataOf(await ledger.priya.get(path));
  expect(['Sam won', 'Priya won']).toContain(latest.description);
  expect(latest.revision).toBe((original.revision ?? 0) + 1);
  expect(latest.editHistory).toHaveLength(1);
});

test('removed members cannot replay their successful creation key', async ({ ledger }) => {
  const body = newExpense({ paidBy: [{ user: sam, amount: 100 }], splitBetween: [{ user: sam }] });
  const headers = { 'Idempotency-Key': randomUUID() };
  const path = `/api/groups/${ledger.groupB}/expenses`;
  await dataOf(await ledger.sam.post(path, { data: body, headers }), 201);
  await dataOf(await ledger.priya.delete(`/api/groups/${ledger.groupB}/members/${sam}`));
  const before = await observeGroup(ledger.priya, ledger.groupB);
  const denied = await ledger.sam.post(path, { data: body, headers });
  expect(denied.status()).toBe(403);
  expect(await observeGroup(ledger.priya, ledger.groupB)).toEqual(before);
});

function recurringBody(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    ...newExpense(),
    dayOfMonth: 1,
    startsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    ...overrides,
  };
}

test('invalid recurring payer totals cannot create a template or generated Expense', async ({
  ledger,
}) => {
  const path = `/api/groups/${ledger.groupB}/recurring`;
  const before = {
    group: await observeGroup(ledger.priya, ledger.groupB),
    templates: await dataOf(await ledger.priya.get(path)),
  };
  const result = await ledger.priya.post(path, {
    data: recurringBody({ paidBy: [{ user: priya, amount: 1 }] }),
  });
  expect(result.status(), await result.text()).toBe(422);
  expect({
    group: await observeGroup(ledger.priya, ledger.groupB),
    templates: await dataOf(await ledger.priya.get(path)),
  }).toEqual(before);
});

test('recurring shares conserve units and invalid partial edits preserve generated history', async ({
  ledger,
}) => {
  await joinGroup(ledger.priya, ledger.alex, ledger.groupB);
  const path = `/api/groups/${ledger.groupB}/recurring`;
  const template = await dataOf(
    await ledger.priya.post(path, {
      data: recurringBody({
        splitMethod: 'shares',
        splitBetween: [
          { user: priya, shares: 1 },
          { user: sam, shares: 1 },
          { user: alex, shares: 1 },
        ],
      }),
    }),
    201,
  );
  const before = {
    group: await observeGroup(ledger.priya, ledger.groupB),
    templates: await dataOf(await ledger.priya.get(path)),
  };
  const generated = before.group.expenses.expenses.filter(
    (expense: { recurringExpense?: string }) => expense.recurringExpense === template._id,
  );
  expect(generated).toHaveLength(1);
  expect(generated[0].splitBetween.map((row: { amountMinor: number }) => row.amountMinor)).toEqual([
    3333, 3333, 3334,
  ]);
  const response = await ledger.priya.patch(`${path}/${template._id}`, {
    data: { amount: 110 },
    headers: revisionHeaders(template.revision ?? 0),
  });
  expect(response.status(), await response.text()).toBe(422);
  expect({
    group: await observeGroup(ledger.priya, ledger.groupB),
    templates: await dataOf(await ledger.priya.get(path)),
  }).toEqual(before);
});

test('recurring changes reject stale revisions without losing a newer template', async ({
  ledger,
}) => {
  const path = `/api/groups/${ledger.groupB}/recurring`;
  const template = await dataOf(await ledger.priya.post(path, { data: recurringBody() }), 201);
  const endpoint = `${path}/${template._id}`;
  const updated = await dataOf(
    await ledger.priya.patch(endpoint, {
      data: { description: 'Latest recurring description' },
      headers: revisionHeaders(template.revision ?? 0),
    }),
  );
  expect(updated.revision).toBe((template.revision ?? 0) + 1);
  const before = await dataOf(await ledger.priya.get(path));
  const staleUpdate = await ledger.priya.patch(endpoint, {
    data: { description: 'Stale recurring description' },
    headers: revisionHeaders(template.revision ?? 0),
  });
  expect(staleUpdate.status(), await staleUpdate.text()).toBe(409);
  const staleDelete = await ledger.priya.delete(endpoint, {
    headers: revisionHeaders(template.revision ?? 0),
  });
  expect(staleDelete.status(), await staleDelete.text()).toBe(409);
  expect(await dataOf(await ledger.priya.get(path))).toEqual(before);
});

test('Expense mutations require the revision actually shown to the client', async ({ ledger }) => {
  const endpoint = expensePath(ledger.groupB, ledger.expenseB);
  const before = await observeLedger(ledger, ledger.expenseB);
  const shown = String(before.expense.revision ?? 0);
  const malformed = ['NaN', '-1', '1.5', '9007199254740992'];
  for (const headers of [
    undefined,
    // A malformed revision is refused, never replaced by a valid If-Match beside it.
    ...malformed.map((value) => ({ 'X-Splitbook-Revision': value, 'If-Match': shown })),
    ...malformed.map((value) => ({ 'If-Match': value })),
  ]) {
    const edit = await ledger.sam.patch(endpoint, {
      data: { description: 'Unversioned edit' },
      headers,
    });
    expect(edit.status(), await edit.text()).toBe(428);
    const remove = await ledger.sam.delete(endpoint, { headers });
    expect(remove.status(), await remove.text()).toBe(428);
  }
  expect(await observeLedger(ledger, ledger.expenseB)).toEqual(before);
});

test('an older client’s If-Match still edits and deletes, and X-Splitbook-Revision wins when both are sent', async ({
  ledger,
}) => {
  // Apps released before #186 send the displayed revision in If-Match; the server still reads it.
  const endpoint = expensePath(ledger.groupB, ledger.expenseB);
  const shown = (await dataOf(await ledger.sam.get(endpoint))).revision ?? 0;
  const edited = await dataOf(
    await ledger.sam.patch(endpoint, {
      data: { description: 'Edited by an older app' },
      headers: { 'If-Match': String(shown) },
    }),
  );
  expect(edited.revision).toBe(shown + 1);
  const both = await ledger.sam.patch(endpoint, {
    data: { description: 'Stale in the new header' },
    headers: { 'X-Splitbook-Revision': String(shown), 'If-Match': String(shown + 1) },
  });
  expect(both.status(), await both.text()).toBe(409);
  expect((await both.json()).code).toBe('STALE_REVISION');
  const deleted = await dataOf(
    await ledger.sam.delete(endpoint, { headers: { 'If-Match': String(shown + 1) } }),
  );
  expect(deleted.revision).toBe(shown + 2);
  expect(await dataOf(await ledger.priya.get(endpoint))).toMatchObject({
    description: 'Edited by an older app',
    isDeleted: true,
    revision: shown + 2,
  });
});

test('recurring mutations require a revision and preserve the template when omitted', async ({
  ledger,
}) => {
  const path = `/api/groups/${ledger.groupB}/recurring`;
  const template = await dataOf(await ledger.priya.post(path, { data: recurringBody() }), 201);
  const endpoint = `${path}/${template._id}`;
  const before = await dataOf(await ledger.priya.get(path));
  const edit = await ledger.priya.patch(endpoint, { data: { isPaused: true } });
  expect(edit.status(), await edit.text()).toBe(428);
  const remove = await ledger.priya.delete(endpoint);
  expect(remove.status(), await remove.text()).toBe(428);
  expect(await dataOf(await ledger.priya.get(path))).toEqual(before);
});
