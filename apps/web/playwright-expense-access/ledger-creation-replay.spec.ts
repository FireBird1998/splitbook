import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import type { APIRequestContext } from '@playwright/test';
import { test, expect, dataOf, expensePath, joinGroup } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

const { priya, sam } = DEMO_PERSONA_IDS;
const expenseInput = () => ({
  description: `Replay characterization ${randomUUID()}`,
  amount: 100,
  currency: 'INR',
  category: 'housing',
  tag: 'Rent',
  date: new Date().toISOString(),
  paidBy: [{ user: priya, amount: 100 }],
  splitMethod: 'equal',
  splitBetween: [{ user: priya }, { user: sam }],
});
const settlementInput = () => ({ paidBy: sam, paidTo: priya, amount: 25, currency: 'INR' });
const keyHeaders = () => ({ 'Idempotency-Key': randomUUID() });

async function snapshot(actor: APIRequestContext, group: string) {
  return {
    expenses: await dataOf(await actor.get(`/api/groups/${group}/expenses`)),
    settlements: await dataOf(await actor.get(`/api/groups/${group}/settlements`)),
    balances: await dataOf(await actor.get(`/api/groups/${group}/balances`)),
    activity: await dataOf(await actor.get(`/api/groups/${group}/activity`)),
  };
}

async function assertEffects(
  actor: APIRequestContext,
  group: string,
  kind: 'expenses' | 'settlements',
  ids: string[],
  samBalance?: number,
) {
  const observed = await snapshot(actor, group);
  const records = kind === 'expenses' ? observed.expenses.expenses : observed.settlements;
  expect(records.filter((record: { _id: string }) => ids.includes(record._id))).toHaveLength(
    ids.length,
  );
  const type = kind === 'expenses' ? 'expense_added' : 'settlement_recorded';
  const idField = kind === 'expenses' ? 'expenseId' : 'settlementId';
  for (const id of ids) {
    expect(
      observed.activity.activities.filter(
        (event: { type: string; metadata?: Record<string, string> }) =>
          event.type === type && event.metadata?.[idField] === id,
      ),
    ).toHaveLength(1);
  }
  if (samBalance !== undefined) {
    expect(
      observed.balances.balances.find((row: { user: { _id: string } }) => row.user._id === sam)
        .balance,
    ).toBe(samBalance);
  }
  return observed;
}

for (const kind of ['expenses', 'settlements'] as const) {
  test(`${kind} creation keys are scoped to actor and Group`, async ({ ledger }) => {
    await joinGroup(ledger.alex, ledger.priya, ledger.groupA);
    await joinGroup(ledger.alex, ledger.sam, ledger.groupA);
    const body = kind === 'expenses' ? expenseInput() : settlementInput();
    const headers = keyHeaders();
    const created = [];
    for (const [actor, group] of [
      [ledger.priya, ledger.groupB],
      [ledger.sam, ledger.groupB],
      [ledger.priya, ledger.groupA],
    ] as const) {
      const path = `/api/groups/${group}/${kind}`;
      const first = await dataOf(await actor.post(path, { data: body, headers }), 201);
      expect((await dataOf(await actor.post(path, { data: body, headers }), 201))._id).toBe(
        first._id,
      );
      created.push(first._id);
    }
    expect(new Set(created).size).toBe(3);
    const effect = kind === 'expenses' ? -50 : 25;
    await assertEffects(ledger.priya, ledger.groupB, kind, created.slice(0, 2), effect * 2);
    await assertEffects(ledger.priya, ledger.groupA, kind, created.slice(2), effect);
  });

  test(`${kind} unkeyed legacy submissions remain independent financial writes`, async ({
    ledger,
  }) => {
    const body = kind === 'expenses' ? expenseInput() : settlementInput();
    const path = `/api/groups/${ledger.groupB}/${kind}`;
    const first = await dataOf(await ledger.priya.post(path, { data: body }), 201);
    const second = await dataOf(await ledger.priya.post(path, { data: body }), 201);
    expect(first._id).not.toBe(second._id);
    await assertEffects(
      ledger.priya,
      ledger.groupB,
      kind,
      [first._id, second._id],
      kind === 'expenses' ? -100 : 50,
    );
  });
}

test('Expense replay survives participant departure while a new creation is rejected', async ({
  ledger,
}) => {
  const body = expenseInput();
  const headers = keyHeaders();
  const path = `/api/groups/${ledger.groupB}/expenses`;
  const first = await dataOf(await ledger.priya.post(path, { data: body, headers }), 201);
  await dataOf(await ledger.priya.delete(`/api/groups/${ledger.groupB}/members/${sam}`));
  const before = await snapshot(ledger.priya, ledger.groupB);
  expect((await dataOf(await ledger.priya.post(path, { data: body, headers }), 201))._id).toBe(
    first._id,
  );
  const rejected = await ledger.priya.post(path, { data: body, headers: keyHeaders() });
  expect(rejected.status(), await rejected.text()).toBe(422);
  expect(await assertEffects(ledger.priya, ledger.groupB, 'expenses', [first._id])).toEqual(before);
});

test('Settlement replay rechecks both parties and denies a removed actor', async ({ ledger }) => {
  const body = settlementInput();
  const path = `/api/groups/${ledger.groupB}/settlements`;
  const recipientHeaders = keyHeaders();
  const payerHeaders = keyHeaders();
  const recipientWrite = await dataOf(
    await ledger.priya.post(path, { data: body, headers: recipientHeaders }),
    201,
  );
  const payerWrite = await dataOf(
    await ledger.sam.post(path, { data: body, headers: payerHeaders }),
    201,
  );
  await dataOf(await ledger.priya.delete(`/api/groups/${ledger.groupB}/members/${sam}`));
  const before = await snapshot(ledger.priya, ledger.groupB);
  const partyDenied = await ledger.priya.post(path, { data: body, headers: recipientHeaders });
  expect(partyDenied.status(), await partyDenied.text()).toBe(422);
  const actorDenied = await ledger.sam.post(path, { data: body, headers: payerHeaders });
  expect(actorDenied.status(), await actorDenied.text()).toBe(403);
  expect(
    await assertEffects(ledger.priya, ledger.groupB, 'settlements', [
      recipientWrite._id,
      payerWrite._id,
    ]),
  ).toEqual(before);
});

for (const array of ['paidBy', 'splitBetween'] as const) {
  test(`Expense creation fingerprint preserves ${array} array order`, async ({ ledger }) => {
    const body = {
      ...expenseInput(),
      paidBy: [
        { user: priya, amount: 75 },
        { user: sam, amount: 25 },
      ],
    };
    const headers = keyHeaders();
    const path = `/api/groups/${ledger.groupB}/expenses`;
    const first = await dataOf(await ledger.priya.post(path, { data: body, headers }), 201);
    const before = await assertEffects(ledger.priya, ledger.groupB, 'expenses', [first._id], -25);
    const conflict = await ledger.priya.post(path, {
      data: { ...body, [array]: [...body[array]].reverse() },
      headers,
    });
    expect(conflict.status(), await conflict.text()).toBe(409);
    expect(await snapshot(ledger.priya, ledger.groupB)).toEqual(before);
  });
}

test('legacy Tag aliases replay after rename, retirement and reassignment with current record', async ({
  ledger,
}) => {
  const body = { ...expenseInput(), tag: 'Original legacy tag' };
  await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/tags`, { data: { name: body.tag } }),
  );
  const headers = keyHeaders();
  const path = `/api/groups/${ledger.groupB}/expenses`;
  const first = await dataOf(await ledger.priya.post(path, { data: body, headers }), 201);
  const group = await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}`));
  const rent = group.tags.find((tag: { name: string }) => tag.name === body.tag);
  const replacement = group.tags.find(
    (tag: { _id: string; isArchived: boolean; isDeleted: boolean }) =>
      tag._id !== rent._id && !tag.isArchived && !tag.isDeleted,
  );
  expect(replacement).toBeDefined();
  const tagPath = `/api/groups/${ledger.groupB}/tags/${rent._id}`;
  await dataOf(await ledger.priya.patch(tagPath, { data: { name: 'Historical rent' } }));
  expect((await dataOf(await ledger.priya.post(path, { data: body, headers }), 201))._id).toBe(
    first._id,
  );
  await dataOf(await ledger.priya.patch(tagPath, { data: { isArchived: true } }));
  expect((await dataOf(await ledger.priya.post(path, { data: body, headers }), 201))._id).toBe(
    first._id,
  );
  const endpoint = expensePath(ledger.groupB, first._id);
  const original = await dataOf(await ledger.priya.get(endpoint));
  await dataOf(
    await ledger.priya.patch(endpoint, {
      data: { description: 'Edited after creation', tagId: replacement._id },
      headers: { 'If-Match': String(original.revision ?? 0) },
    }),
  );
  await dataOf(await ledger.priya.delete(tagPath));
  const current = await dataOf(await ledger.priya.get(endpoint));
  const before = await snapshot(ledger.priya, ledger.groupB);
  // POST replay keeps history actor IDs; GET detail populates those users.
  expect(await dataOf(await ledger.priya.post(path, { data: body, headers }), 201)).toEqual({
    ...current,
    editHistory: current.editHistory.map((entry: { editedBy: { _id: string } }) => ({
      ...entry,
      editedBy: entry.editedBy._id,
    })),
  });
  expect(current).toMatchObject({ description: 'Edited after creation', tagId: replacement._id });
  expect(await assertEffects(ledger.priya, ledger.groupB, 'expenses', [first._id], -50)).toEqual(
    before,
  );
});

test('Settlement replay returns the current stored record without another financial effect', async ({
  ledger,
}) => {
  const body = { ...settlementInput(), note: 'Original creation note' };
  const headers = keyHeaders();
  const path = `/api/groups/${ledger.groupB}/settlements`;
  const first = await dataOf(await ledger.priya.post(path, { data: body, headers }), 201);
  const name = process.env.EXPENSE_ACCESS_TEST_DB;
  if (!name?.startsWith('splitbook-test-access-')) throw new Error('Isolated database required');
  const client = new MongoClient(`mongodb://127.0.0.1:27017/${name}?directConnection=true`);
  try {
    // Settlement has no edit endpoint: amend only this isolated fixture's display metadata.
    const amended = await client
      .db(name)
      .collection('settlements')
      .updateOne(
        { _id: new ObjectId(first._id), group: new ObjectId(ledger.groupB) },
        { $set: { note: 'Current stored note' } },
      );
    expect(amended.modifiedCount).toBe(1);
  } finally {
    await client.close();
  }
  const before = await assertEffects(ledger.priya, ledger.groupB, 'settlements', [first._id], 25);
  const current = before.settlements.find((row: { _id: string }) => row._id === first._id);
  const replay = await dataOf(await ledger.priya.post(path, { data: body, headers }), 201);
  expect(replay).toEqual(current);
  expect(replay.note).toBe('Current stored note');
  expect(await snapshot(ledger.priya, ledger.groupB)).toEqual(before);
});

for (const kind of ['expenses', 'settlements'] as const) {
  test(`${kind} replay normalizes defaults and precedes new-write currency validation`, async ({
    ledger,
  }) => {
    const body =
      kind === 'expenses'
        ? { ...expenseInput(), category: undefined }
        : { ...settlementInput(), paidBy: undefined };
    const explicit =
      kind === 'expenses'
        ? { ...body, category: 'other', notes: '', predefinedItem: null }
        : { ...body, paidBy: sam, note: '' };
    const headers = keyHeaders();
    const path = `/api/groups/${ledger.groupB}/${kind}`;
    const first = await dataOf(await ledger.sam.post(path, { data: body, headers }), 201);
    expect((await dataOf(await ledger.sam.post(path, { data: explicit, headers }), 201))._id).toBe(
      first._id,
    );
    const before = await assertEffects(
      ledger.priya,
      ledger.groupB,
      kind,
      [first._id],
      kind === 'expenses' ? -50 : 25,
    );
    const name = process.env.EXPENSE_ACCESS_TEST_DB;
    if (!name?.startsWith('splitbook-test-access-')) throw new Error('Isolated database required');
    const client = new MongoClient(`mongodb://127.0.0.1:27017/${name}?directConnection=true`);
    try {
      // Simulate historical currency drift, which current Group mutations correctly forbid.
      const groups = client.db(name).collection('groups');
      const changed = await groups.updateOne(
        { _id: new ObjectId(ledger.groupB), defaultCurrency: 'INR' },
        { $set: { defaultCurrency: 'USD' } },
      );
      expect(changed.modifiedCount).toBe(1);
      expect(
        (await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}`))).defaultCurrency,
      ).toBe('USD');
      const replay = await dataOf(await ledger.sam.post(path, { data: explicit, headers }), 201);
      expect(replay).toMatchObject({ _id: first._id, currency: 'INR', amount: first.amount });
      const fresh = await ledger.sam.post(path, { data: explicit, headers: keyHeaders() });
      expect(fresh.status(), await fresh.text()).toBe(422);
    } finally {
      await client
        .db(name)
        .collection('groups')
        .updateOne({ _id: new ObjectId(ledger.groupB) }, { $set: { defaultCurrency: 'INR' } });
      await client.close();
    }
    expect(await snapshot(ledger.priya, ledger.groupB)).toEqual(before);
  });
}
