import mongoose, { Types } from 'mongoose';
import type { Document } from 'mongodb';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import Group from '@/lib/models/Group';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import RecurringExpense from '@/lib/models/RecurringExpense';
import Activity from '@/lib/models/Activity';
import { RateTable } from '@/lib/rates/table';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { integrationTestDb } from '../integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  requireReplicaSet,
  signIn,
} from '../signed-in-route';
import { recordingNames } from '../recordings/normalise';
import { zonedDateTime, zonedTimestamp } from '@splitbook/shared/export-csv';

export const readCases = [
  'member',
  'admin',
  'left',
  'outsider',
  'missing',
  'malformed',
  'archived',
  'deleting',
  'deletion-marker',
] as const;
export type ReadCase = (typeof readCases)[number];
export const readIds = {
  group: 'b10000000000000000000001',
  control: 'b10000000000000000000002',
  expense: 'e10000000000000000000001',
  controlExpense: 'e10000000000000000000002',
  template: 'c10000000000000000000001',
  tag: 'd10000000000000000000001',
  otherTag: 'd10000000000000000000002',
  controlTag: 'd10000000000000000000003',
  draft: 'f10000000000000000000001',
  otherDraft: 'f10000000000000000000002',
  receipt: '00000000-0000-4000-8000-000000001120',
};
const { alex, sam, priya } = DEMO_PERSONA_IDS;
const objectId = (value: string) => new Types.ObjectId(value);
export function readFixture(namespace: string) {
  const db = integrationTestDb(`reads-${namespace}`);
  // A member's local midday keeps the same Month in both Pacific test jobs.
  const clock = new Date(2026, 10, 11, 12);
  const seededAt = new Date(clock.getTime() - 60_000);
  let names: ReturnType<typeof recordingNames>;
  let cookies: Record<string, string>;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(seededAt);
    vi.stubEnv('AUTH_RATE_LIMIT_ENABLED', 'false');
    vi.stubEnv('MCP_ENABLED', 'true');
    vi.stubEnv('MCP_ALLOW_DCR', 'true');
    vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
    vi.stubEnv('ANDROID_NOTIFICATIONS_ENABLED', 'false');
    vi.stubEnv('ANDROID_NOTIFICATION_SENDS_ENABLED', 'false');
    vi.stubEnv('ANDROID_NOTIFICATION_EXPENSE_CHANGES_ENABLED', 'true');
    await connectSignedIn(db);
    await requireReplicaSet();
    await db.reset();
    await insertDemoPersonas();
    cookies = {
      alex: await signIn('alex'),
      sam: await signIn('sam'),
      priya: await signIn('priya'),
    };
    await mongoose.connection
      .db!.collection('users')
      .updateMany({}, { $set: { image: 'https://read-fixture.example.test/photo.png' } });
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(seededAt);
    vi.stubEnv('PERSISTENT_DRAFTS_ENABLED', 'true');
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
    for (const name of [
      'groups',
      'groupdeletions',
      'expenses',
      'settlements',
      'activities',
      'recurringexpenses',
      'expensedrafts',
      'tagactions',
      'productswitches',
      'exchangeratetables',
      'mcprequestlimits',
    ])
      await mongoose.connection.db!.collection(name).deleteMany({});
    // Keep base sessions and signing keys while isolating each case's grants and choices.
    for (const { name } of await mongoose.connection.db!.listCollections().toArray())
      if (/^(oauth|mcp)/i.test(name) && name.toLowerCase() !== 'oauthresources')
        await mongoose.connection.db!.collection(name).deleteMany({});
    names = recordingNames();
    for (const [key, id] of Object.entries(readIds)) if (key !== 'receipt') names.name(id, key);
    const members = [
      { user: alex, role: 'admin' as const, joinedAt: seededAt },
      { user: sam, role: 'member' as const, joinedAt: seededAt },
    ];
    await Group.create({
      _id: readIds.group,
      name: 'Reads Household',
      category: 'home',
      currencyLocked: true,
      defaultCurrency: 'INR',
      alternateCurrencies: ['EUR'],
      createdBy: alex,
      members,
      tags: [
        { _id: readIds.tag, name: 'Groceries', createdAt: seededAt },
        { _id: readIds.otherTag, name: 'Other', createdAt: seededAt },
      ],
      inviteCode: 'READS1120',
      inviteCodeExpiresAt: new Date(clock.getTime() + 86_400_000),
    });
    await Group.create({
      _id: readIds.control,
      name: 'Control Trip',
      category: 'trip',
      currencyLocked: true,
      defaultCurrency: 'INR',
      createdBy: priya,
      members: [...members, { user: priya, role: 'admin', joinedAt: seededAt }],
      tags: [{ _id: readIds.controlTag, name: 'Food', createdAt: seededAt }],
      startDate: new Date('2026-11-01T00:00:00Z'),
      endDate: new Date('2026-11-15T00:00:00Z'),
    });
    const money = {
      amount: 120,
      amountMinor: 12000,
      moneyVersion: 1,
      currency: 'INR',
      paidBy: [{ user: alex, amount: 120, amountMinor: 12000 }],
      splitMethod: 'equal' as const,
      splitBetween: [
        { user: alex, amount: 60, amountMinor: 6000 },
        { user: sam, amount: 60, amountMinor: 6000 },
      ],
    };
    await Expense.create({
      _id: readIds.expense,
      group: readIds.group,
      createdBy: alex,
      description: 'Earlier rent groceries',
      ...money,
      category: 'food',
      tag: 'Groceries',
      tagId: readIds.tag,
      date: new Date('2026-11-05T00:00:00Z'),
    });
    await Expense.create({
      _id: readIds.controlExpense,
      group: readIds.control,
      createdBy: priya,
      description: 'Control rent',
      ...money,
      amount: 45,
      amountMinor: 4500,
      paidBy: [{ user: priya, amount: 45, amountMinor: 4500 }],
      splitBetween: [
        { user: priya, amount: 22.5, amountMinor: 2250 },
        { user: sam, amount: 22.5, amountMinor: 2250 },
      ],
      category: 'food',
      tag: 'Food',
      tagId: readIds.controlTag,
      date: new Date('2026-11-05T00:00:00Z'),
    });
    const payment = await Settlement.create({
      group: readIds.group,
      createdBy: sam,
      paidBy: sam,
      paidTo: alex,
      amount: 20,
      amountMinor: 2000,
      moneyVersion: 1,
      currency: 'INR',
      note: 'Earlier payment',
      createdAt: new Date('2026-11-05T00:00:00Z'),
      updatedAt: new Date('2026-11-05T00:00:00Z'),
    });
    names.name(payment._id, 'payment');
    const activity = await Activity.create({
      group: readIds.group,
      actor: alex,
      type: 'expense_added',
      createdAt: seededAt,
      metadata: {
        expenseId: readIds.expense,
        description: 'Earlier rent groceries',
        amount: 120,
        currency: 'INR',
      },
    });
    names.name(activity._id, 'activity');
    const controlActivity = await Activity.create({
      group: readIds.control,
      actor: priya,
      type: 'expense_added',
      createdAt: seededAt,
      metadata: {
        expenseId: readIds.controlExpense,
        description: 'Control rent',
        amount: 45,
        currency: 'INR',
      },
    });
    names.name(controlActivity._id, 'activity');
    await RecurringExpense.create({
      _id: readIds.template,
      group: readIds.group,
      createdBy: alex,
      description: 'Due rent',
      ...money,
      amount: 600,
      amountMinor: 60000,
      paidBy: [{ user: alex, amount: 600, amountMinor: 60000 }],
      splitBetween: [
        { user: alex, amount: 300, amountMinor: 30000 },
        { user: sam, amount: 300, amountMinor: 30000 },
      ],
      category: 'housing',
      tag: 'Groceries',
      tagId: readIds.tag,
      dayOfMonth: 1,
      startsOn: new Date('2026-11-01T00:00:00Z'),
      lastGeneratedFor: null,
    });
    await mongoose.connection.db!.collection('expensedrafts').insertMany(
      [sam, alex].map((owner, index) => ({
        _id: objectId(index === 0 ? readIds.draft : readIds.otherDraft),
        group: objectId(readIds.group),
        owner: objectId(owner),
        requestKey: `reads-seeded-${index}`,
        requestFingerprint: '1'.repeat(64),
        itemIndex: 0,
        revision: 0,
        state: 'active',
        preparedBy: { kind: 'member' },
        values: {
          description: 'Due rent',
          amount: 600,
          currency: 'INR',
          date: '2026-11-01',
          paidBy: [{ user: alex, amount: 600 }],
          splitMethod: 'equal',
          splitBetween: [{ user: alex }, { user: sam }],
          tagId: readIds.tag,
          category: 'housing',
        },
        createdAt: seededAt,
        updatedAt: seededAt,
      })),
    );
    await mongoose.connection.db!.collection('tagactions').insertMany(
      [alex, sam].map((actor) => ({
        group: objectId(readIds.group),
        actor: objectId(actor),
        requestId: readIds.receipt,
        intent: { action: 'rename', tagId: readIds.tag, expectedRevision: 0, name: 'Groceries' },
        tagId: objectId(readIds.tag),
        appliedAt: seededAt,
      })),
    );
    await RateTable.create({
      _id: 'daily',
      entries: [
        {
          currency: 'INR',
          rate: '84',
          source: 'frankfurter',
          asOf: clock.toISOString().slice(0, 10),
          fetchedAt: seededAt.toISOString(),
        },
        {
          currency: 'EUR',
          rate: '0.9',
          source: 'frankfurter',
          asOf: clock.toISOString().slice(0, 10),
          fetchedAt: seededAt.toISOString(),
        },
      ],
    });
    vi.setSystemTime(clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  afterAll(() => disconnectSignedIn(db));
  async function arrange(state: ReadCase) {
    if (state === 'left')
      await Group.updateOne(
        { _id: readIds.group },
        { $pull: { members: { user: objectId(sam) } } },
      );
    if (state === 'archived')
      await Group.updateOne({ _id: readIds.group }, { $set: { isArchived: true } });
    if (state === 'deletion-marker')
      await Group.updateOne({ _id: readIds.group }, { $set: { deletionRequestedAt: clock } });
    if (state === 'deleting') {
      // A durable deletion claim archives the Group and removes its last member atomically.
      await Group.updateOne(
        { _id: readIds.group },
        {
          $set: {
            members: [],
            isArchived: true,
            deletionRequestedAt: clock,
            inviteCode: null,
            inviteCodeExpiresAt: null,
          },
        },
      );
      await mongoose.connection.db!.collection('groupdeletions').insertOne({
        _id: objectId(readIds.group),
        actorId: sam,
        state: 'pending',
        collectionIndex: 0,
        requestedAt: clock,
      });
    }
    return {
      groupId:
        state === 'missing'
          ? 'b10000000000000000000099'
          : state === 'malformed'
            ? 'not-an-id'
            : readIds.group,
      cookie: state === 'admin' ? cookies.alex : state === 'outsider' ? cookies.priya : cookies.sam,
      actorId: state === 'admin' ? alex : state === 'outsider' ? priya : sam,
    };
  }
  function normalise(value: unknown): unknown {
    if (value instanceof Date) return normalise(value.toISOString());
    if (value instanceof Types.ObjectId) return names.normalise(value);
    if (typeof value === 'string') {
      let text = value;
      for (const [date, label] of [
        [clock, '<read-time>'],
        [seededAt, '<seed-time>'],
        [new Date(clock.getTime() + 86_400_000), '<invite-expiry>'],
      ] as const) {
        text = text
          .replaceAll(date.toISOString(), label)
          .replaceAll(zonedDateTime(date, 'UTC'), label)
          .replaceAll(zonedDateTime(date, 'UTC').replace(/\s+/g, ' '), label)
          .replaceAll(zonedTimestamp(date, 'UTC'), label);
      }
      return names.normalise(text);
    }
    if (Array.isArray(value)) return value.map(normalise);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          key === 'asOf' && item === clock.toISOString().slice(0, 10)
            ? '<quote-day>'
            : normalise(item),
        ]),
      );
    return value;
  }
  async function ledger() {
    const result: Record<string, Document[]> = {};
    for (const name of [
      'groups',
      'expenses',
      'settlements',
      'activities',
      'recurringexpenses',
      'expensedrafts',
    ]) {
      const rows = await mongoose.connection
        .db!.collection(name)
        .find({})
        .sort({ _id: 1 })
        .toArray();
      for (const row of rows) {
        names.name(row._id, name);
        for (const event of row.pendingActivity ?? []) names.name(event._id, 'event');
      }
      result[name] = rows;
    }
    return result;
  }
  async function capture<Answer>(action: () => Promise<Answer>) {
    const before = await ledger();
    const answer = await action();
    const after = await ledger();
    const previous = new Set(before.expenses.map((row) => String(row._id)));
    const addedDueExpense = after.expenses.some(
      (row) =>
        String(row.recurringExpense) === readIds.template &&
        row.period === '2026-11' &&
        !previous.has(String(row._id)),
    );
    expect(normalise({ answer, addedDueExpense, after })).toMatchSnapshot();
    return { answer, addedDueExpense, before, after };
  }
  return {
    arrange,
    capture,
    ledger,
    normalise,
    clock,
    db,
    get cookies() {
      return cookies;
    },
  };
}
