/**
 * Integration tests for what #315 added to a Group's insights read
 * (`GET /api/groups/[id]/insights`): spending by Tag against each Tag's average, who paid
 * against their share, and, only while recurring Expenses are switched on (#289), the
 * recurring Expenses card's templates. Against a real, isolated MongoDB database
 * (`splitbook-test-group-insights-detail`); only the session is a stand-in, and only `Date` is
 * faked: the read runs on 15 September 2026 at 06:00 UTC.
 *
 * The fields #314 sent come first and stay exactly as they were: `insights-before-315.golden.json`
 * holds the answers `main` gave before #315 (6d81817), compared as text, and the new fields
 * follow them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import {
  parseGroupInsightsResponse,
  readGroupInsightsByTag,
  readGroupInsightsRecurring,
  readGroupInsightsWhoPaid,
} from '@splitbook/shared/group-insights-read';
import { GET } from './route';
import { GET as getBalances } from '../balances/route';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        session.userId
          ? { user: { id: session.userId, name: 'Tester', email: 'tester@splitbook-test.local' } }
          : null,
      ),
    },
  },
}));

const db = integrationTestDb('group-insights-detail');
const { alice, bob, carol, dave } = TEST_USER_IDS;
const NOW = new Date('2026-09-15T06:00:00.000Z');

beforeAll(async () => {
  await db.connect();
  await Expense.createIndexes();
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
  session.userId = alice;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(db.teardown);

/** Recurring Expenses are off unless the variable is exactly `true`. */
function switchRecurringExpenses(on: boolean) {
  vi.stubEnv('RECURRING_EXPENSES_ENABLED', on ? 'true' : undefined);
}

async function read(groupId: string, query = 'month=2026-09&compare=6&tz=Asia%2FKolkata') {
  const response = await GET(
    new Request(`http://localhost/api/groups/${groupId}/insights?${query}`),
    { params: Promise.resolve({ id: groupId }) },
  );
  return { status: response.status, text: await response.text() };
}

async function createGroup(
  name: string,
  members: string[],
  { category = 'home', currency = 'INR' }: { category?: 'trip' | 'home'; currency?: string } = {},
) {
  const group = await groupService.create(
    { name, category, defaultCurrency: currency, alternateCurrencies: [] },
    members[0],
  );
  const groupId = String(group._id);
  for (const member of members.slice(1)) await groupService.addMember(groupId, member);
  return groupId;
}

const oid = (id: string) => new mongoose.Types.ObjectId(id);

/** Make the Group as old as a Household with history. */
async function createdIn(groupId: string, date: string) {
  await mongoose.connection
    .db!.collection('groups')
    .updateOne({ _id: oid(groupId) }, { $set: { createdAt: new Date(date) } });
}

/** The Group's Tag ids, by name. */
async function tagIds(groupId: string): Promise<Record<string, string>> {
  const group = await groupService.getById(groupId);
  return Object.fromEntries(
    (group?.tags ?? []).map((tag: { _id: unknown; name: string }) => [tag.name, String(tag._id)]),
  );
}

let sequence = 0;

/**
 * A stored Expense, written as the database holds it: `shares` maps each person to their share
 * in minor units, and `paid` to what they paid (the first person in `shares` by default). It
 * carries a Tag by id (`tagId`), or by name alone as older Expenses do (`tag`). A legacy
 * Expense has no minor units.
 */
async function insertExpense(
  groupId: string,
  date: string,
  shares: Record<string, number>,
  {
    paid,
    currency = 'INR',
    legacy = false,
    isDeleted = false,
    description = 'Synthetic expense',
    tag = 'General',
    tagId = null,
  }: {
    paid?: Record<string, number>;
    currency?: string;
    legacy?: boolean;
    isDeleted?: boolean;
    description?: string;
    tag?: string;
    tagId?: string | null;
  } = {},
) {
  const totalMinor = Object.values(shares).reduce((sum, share) => sum + share, 0);
  const payers = paid ?? { [Object.keys(shares)[0]]: totalMinor };
  const money = (amountMinor: number) =>
    legacy ? { amount: amountMinor / 100 } : { amount: amountMinor / 100, amountMinor };
  const _id = new mongoose.Types.ObjectId();
  sequence += 1;
  await mongoose.connection.db!.collection('expenses').insertOne({
    _id,
    group: oid(groupId),
    description,
    ...money(totalMinor),
    ...(legacy ? {} : { moneyVersion: 1 }),
    currency,
    category: 'food',
    date: new Date(date),
    paidBy: Object.entries(payers).map(([user, minor]) => ({ user: oid(user), ...money(minor) })),
    splitMethod: 'exact',
    splitBetween: Object.entries(shares).map(([user, minor]) => ({
      user: oid(user),
      ...money(minor),
    })),
    tag,
    ...(tagId ? { tagId: oid(tagId) } : {}),
    createdBy: oid(Object.keys(payers)[0]),
    isDeleted,
    revision: 0,
    createdAt: new Date(NOW.getTime() + sequence),
    updatedAt: NOW,
  });
  return String(_id);
}

/** A monthly template, as Group settings saves one: Rent on the 5th, paid by Alice. */
async function rentTemplate(
  groupId: string,
  members: string[],
  {
    description = 'Rent',
    dayOfMonth = 5,
    startsOn = '2026-07-05T00:00:00.000Z',
    isPaused = false,
    tag = 'Rent',
  }: {
    description?: string;
    dayOfMonth?: number;
    startsOn?: string;
    isPaused?: boolean;
    tag?: string;
  } = {},
) {
  const each = 300000 / members.length;
  const template = await RecurringExpense.create({
    group: groupId,
    description,
    amount: 3000,
    amountMinor: 300000,
    moneyVersion: 1,
    currency: 'INR',
    category: 'housing',
    tag,
    paidBy: [{ user: members[0], amount: 3000, amountMinor: 300000 }],
    splitMethod: 'equal',
    splitBetween: members.map((user) => ({ user, amount: each / 100, amountMinor: each })),
    dayOfMonth,
    startsOn: new Date(startsOn),
    isPaused,
    createdBy: members[0],
  });
  return String(template._id);
}

/** The fields #315 added, in the order they follow the fields #314 sent. */
const ADDED = ['byTag', 'whoPaid', 'recurring'];

/**
 * The answer as text without the fields #315 added, with every Expense id replaced by a label
 * (they change from run to run). Key order is kept: it is compared byte for byte.
 */
function before315(text: string, labels: Map<string, string>): string {
  const body = JSON.parse(text);
  for (const key of ADDED) delete body.data?.[key];
  return JSON.stringify(body, (_key, value) =>
    typeof value === 'string' && labels.has(value) ? labels.get(value) : value,
  );
}

/** Every stored Expense, by "description@day": generated ones included. */
async function expenseLabels(): Promise<Map<string, string>> {
  const expenses = await Expense.find({}).select('description date').lean();
  return new Map(
    expenses.map((expense) => [
      String(expense._id),
      `<expense:${expense.description}@${expense.date.toISOString().slice(0, 10)}>`,
    ]),
  );
}

/**
 * The Groups and reads the golden answers were recorded with on `main` before #315: a
 * Household with history and Tags (by id, by name only, and none of the Group's) read by
 * three members in three zones and ranges; a legacy Group in two currencies; Households with a
 * recurring template read with the switch on and off; a Group's first Month; and a new Group.
 */
async function goldenReads(): Promise<Array<[answer: string, text: string]>> {
  const maple = await createGroup('Maple House', [alice, bob, carol]);
  await createdIn(maple, '2026-03-02T10:00:00Z');
  const tags = await tagIds(maple);
  await insertExpense(
    maple,
    '2026-09-02T06:00:00Z',
    { [bob]: 33334, [alice]: 33333, [carol]: 33333 },
    { description: 'Weekly groceries', tag: 'Groceries', tagId: tags.Groceries },
  );
  await insertExpense(
    maple,
    '2026-09-05T06:00:00Z',
    { [alice]: 100000, [bob]: 100000, [carol]: 100000 },
    {
      paid: { [carol]: 200000, [alice]: 100000 },
      description: 'Cook (September)',
      tag: 'Household',
      tagId: tags.Household,
    },
  );
  await insertExpense(
    maple,
    '2026-09-07T06:00:00Z',
    { [alice]: 500, [bob]: 500 },
    { paid: { [bob]: 1000 }, description: 'Fuel top-up', tag: 'Fuel' },
  );
  await insertExpense(
    maple,
    '2026-08-11T06:00:00Z',
    { [alice]: 1, [bob]: 2 },
    { description: 'Fuse', tag: 'Utilities' },
  );
  await insertExpense(
    maple,
    '2026-04-11T06:00:00Z',
    { [carol]: 90000 },
    { description: 'April rent', tag: 'Rent', tagId: tags.Rent },
  );
  await insertExpense(
    maple,
    '2026-09-06T06:00:00Z',
    { [alice]: 99999 },
    { description: 'Deleted', isDeleted: true },
  );

  const lisbon = await createGroup('Lisbon Offsite', [alice, bob], { currency: 'EUR' });
  await insertExpense(
    lisbon,
    '2026-09-05T12:00:00Z',
    { [alice]: 1275, [bob]: 1275 },
    { currency: 'EUR', legacy: true, description: 'Pastries' },
  );
  await insertExpense(
    lisbon,
    '2026-09-06T12:00:00Z',
    { [alice]: 150000, [bob]: 150000 },
    { description: 'Written before one currency' },
  );

  const lakeview = await createGroup('Lakeview Flat', [alice, bob, carol]);
  await createdIn(lakeview, '2026-06-20T10:00:00Z');
  await rentTemplate(lakeview, [alice, bob, carol]);
  await insertExpense(lakeview, '2026-09-08T06:00:00Z', { [bob]: 2000 }, { description: 'Bulbs' });

  const quiet = await createGroup('Quiet Flat', [alice, bob]);
  await createdIn(quiet, '2026-06-20T10:00:00Z');
  await rentTemplate(quiet, [alice, bob]);

  const young = await createGroup('Young Flat', [alice, bob]);
  await createdIn(young, '2026-07-20T10:00:00Z');
  await insertExpense(young, '2026-07-21T06:00:00Z', { [alice]: 1500 }, { description: 'Mop' });

  const fresh = await createGroup('Sunday Football', [alice, bob]);

  const reads: Array<[answer: string, user: string, groupId: string, query: string, on: boolean]> =
    [
      ['household-alice', alice, maple, 'month=2026-09&compare=6&tz=Asia%2FKolkata', false],
      ['household-bob-one-month', bob, maple, 'month=2026-09&compare=1&tz=UTC', false],
      [
        'household-carol-august',
        carol,
        maple,
        'month=2026-08&compare=12&tz=America%2FNew_York',
        false,
      ],
      ['legacy-two-currencies', alice, lisbon, 'month=2026-09&compare=1&tz=UTC', false],
      ['recurring-on', alice, lakeview, 'month=2026-09&compare=6&tz=Asia%2FKolkata', true],
      ['recurring-off', bob, quiet, 'month=2026-09&compare=6&tz=Asia%2FKolkata', false],
      ['first-month', alice, young, 'month=2026-07&compare=12&tz=UTC', false],
      ['new-group', alice, fresh, 'tz=Asia%2FKolkata', false],
    ];
  const answers: Array<[string, string]> = [];
  for (const [answer, user, groupId, query, on] of reads) {
    switchRecurringExpenses(on);
    session.userId = user;
    const { status, text } = await read(groupId, query);
    expect(status, answer).toBe(200);
    answers.push([answer, text]);
  }
  return answers;
}

describe('the fields #314 sent', () => {
  it('answer byte for byte as they did before #315, with the new fields after them', async () => {
    const answers = await goldenReads();
    const labels = await expenseLabels();
    const golden = JSON.parse(
      readFileSync(join(__dirname, 'insights-before-315.golden.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(answers.map(([answer]) => answer)).toEqual(Object.keys(golden));
    for (const [answer, text] of answers) {
      expect(before315(text, labels), answer).toBe(JSON.stringify(golden[answer]));
      // The new fields come after every field #314 sent, in this order.
      const data = (golden[answer] as { data: Record<string, unknown> }).data;
      const recurringOn = data.recurringExpenses === true;
      expect(Object.keys(JSON.parse(text).data), answer).toEqual([
        ...Object.keys(data),
        'byTag',
        'whoPaid',
        ...(recurringOn ? ['recurring'] : []),
      ]);
    }
  });
});

/** The decoded answer, its new fields read as the Insights tab reads them. */
async function decoded(groupId: string, query?: string) {
  const { status, text } = await read(groupId, query);
  expect(status).toBe(200);
  const insights = parseGroupInsightsResponse(JSON.parse(text));
  return {
    text,
    insights,
    byTag: readGroupInsightsByTag(insights),
    whoPaid: readGroupInsightsWhoPaid(insights),
    recurring: readGroupInsightsRecurring(insights),
  };
}

/** A Household of three since March with Tagged Expenses in August and September. */
async function mapleHouse() {
  const maple = await createGroup('Maple House', [alice, bob, carol]);
  await createdIn(maple, '2026-03-02T10:00:00Z');
  const tags = await tagIds(maple);
  // September: Groceries twice (once by name only, as older Expenses store it), Utilities, and
  // an Expense whose Tag isn't one of the Group's.
  await insertExpense(
    maple,
    '2026-09-02T06:00:00Z',
    { [bob]: 33334, [alice]: 33333, [carol]: 33333 },
    { tag: 'Groceries', tagId: tags.Groceries },
  );
  await insertExpense(
    maple,
    '2026-09-04T06:00:00Z',
    { [alice]: 10000, [carol]: 20000 },
    { paid: { [carol]: 30000 }, tag: 'Groceries' },
  );
  await insertExpense(
    maple,
    '2026-09-05T06:00:00Z',
    { [alice]: 100000, [bob]: 100000, [carol]: 100000 },
    { paid: { [carol]: 200000, [alice]: 100000 }, tag: 'Utilities', tagId: tags.Utilities },
  );
  await insertExpense(
    maple,
    '2026-09-07T06:00:00Z',
    { [alice]: 500, [bob]: 500 },
    { paid: { [bob]: 1000 }, tag: 'Fuel' },
  );
  // Earlier Months: Groceries in July and August, Rent in August only.
  await insertExpense(
    maple,
    '2026-07-11T06:00:00Z',
    { [alice]: 40000 },
    { tag: 'Groceries', tagId: tags.Groceries },
  );
  await insertExpense(
    maple,
    '2026-08-11T06:00:00Z',
    { [bob]: 80000 },
    { tag: 'Groceries', tagId: tags.Groceries },
  );
  await insertExpense(
    maple,
    '2026-08-01T06:00:00Z',
    { [carol]: 600000 },
    { tag: 'Rent', tagId: tags.Rent },
  );
  // Deleted, and in another currency: neither counts.
  await insertExpense(
    maple,
    '2026-09-06T06:00:00Z',
    { [alice]: 99999 },
    { isDeleted: true, tag: 'Groceries', tagId: tags.Groceries },
  );
  await insertExpense(
    maple,
    '2026-09-06T06:00:00Z',
    { [alice]: 5000 },
    { currency: 'EUR', legacy: true, tag: 'Groceries', tagId: tags.Groceries },
  );
  return { maple, tags };
}

describe('spending by Tag', () => {
  it('gives each Tag’s Month against its own average, the Month left out', async () => {
    const { maple, tags } = await mapleHouse();

    const { byTag } = await decoded(maple, 'month=2026-09&compare=2&tz=Asia%2FKolkata');

    expect(byTag).toEqual({
      ok: true,
      value: {
        earlierMonths: ['2026-07', '2026-08'],
        tags: [
          {
            tagId: tags.Utilities,
            name: 'Utilities',
            spentMinor: 300000,
            expenseCount: 1,
            averageMinor: 0,
            differenceMinor: 300000,
            direction: 'up',
            changePercent: null,
          },
          {
            tagId: tags.Groceries,
            name: 'Groceries',
            spentMinor: 130000,
            expenseCount: 2,
            // ₹1,200.00 over July and August; September is not in it.
            averageMinor: 60000,
            differenceMinor: 70000,
            direction: 'up',
            changePercent: 116.7,
          },
          {
            tagId: tags.Rent,
            name: 'Rent',
            spentMinor: 0,
            expenseCount: 0,
            averageMinor: 300000,
            differenceMinor: -300000,
            direction: 'down',
            changePercent: -100,
          },
          {
            tagId: null,
            name: null,
            spentMinor: 1000,
            expenseCount: 1,
            averageMinor: 0,
            differenceMinor: 1000,
            direction: 'up',
            changePercent: null,
          },
        ],
      },
    });
  });

  it('has no average in the Group’s first Month', async () => {
    const young = await createGroup('Young Flat', [alice, bob]);
    await createdIn(young, '2026-09-01T10:00:00Z');
    await insertExpense(young, '2026-09-03T06:00:00Z', { [alice]: 1500 });

    const { byTag } = await decoded(young);

    expect(byTag).toEqual({
      ok: true,
      value: {
        earlierMonths: [],
        tags: [
          {
            tagId: expect.any(String),
            name: 'General',
            spentMinor: 1500,
            expenseCount: 1,
            averageMinor: null,
            differenceMinor: null,
            direction: null,
            changePercent: null,
          },
        ],
      },
    });
  });

  it('buckets the Month in the zone sent', async () => {
    const maple = await createGroup('Maple House', [alice, bob]);
    await createdIn(maple, '2026-03-02T10:00:00Z');
    // 20:00 UTC on 31 August: September in Kolkata, August in New York.
    await insertExpense(maple, '2026-08-31T20:00:00Z', { [alice]: 4200 });

    const spent = async (tz: string) =>
      (await decoded(maple, `month=2026-09&compare=1&tz=${tz}`)).byTag;
    expect(await spent('Asia%2FKolkata')).toMatchObject({
      value: { tags: [{ spentMinor: 4200, averageMinor: 0 }] },
    });
    expect(await spent('America%2FNew_York')).toMatchObject({
      value: { tags: [{ spentMinor: 0, averageMinor: 4200 }] },
    });
  });
});

describe('who paid this Month', () => {
  it('gives each member their Paid against their Share, exact, named without an email', async () => {
    const { maple } = await mapleHouse();

    const { whoPaid, insights, text } = await decoded(maple);

    expect(whoPaid).toEqual({
      ok: true,
      value: {
        members: [
          {
            id: carol,
            name: 'Carol Tester',
            isMember: true,
            paidMinor: 230000,
            shareMinor: 153333,
            netMinor: 76667,
          },
          {
            id: bob,
            name: 'Bob Tester',
            isMember: true,
            paidMinor: 101000,
            shareMinor: 133834,
            netMinor: -32834,
          },
          {
            id: alice,
            name: 'Alice Tester',
            isMember: true,
            paidMinor: 100000,
            shareMinor: 143833,
            netMinor: -43833,
          },
        ],
      },
    });
    // The Paids and the Shares each add up to what the Group spent: ₹4,310.00.
    expect(insights.months.at(-1)?.spentMinor).toBe(431000);
    expect(text).not.toContain('@splitbook-test.local');
  });

  it('is the same Group figures for every member', async () => {
    const { maple } = await mapleHouse();
    const asAlice = (await decoded(maple)).whoPaid;
    session.userId = bob;
    expect((await decoded(maple)).whoPaid).toEqual(asAlice);
  });

  it('lists every member with nothing in the Month, and keeps someone who left', async () => {
    const flat = await createGroup('Old Flat', [alice, bob, dave]);
    await insertExpense(
      flat,
      '2026-09-05T12:00:00Z',
      { [alice]: 7000, [dave]: 7000 },
      {
        paid: { [dave]: 14000 },
      },
    );
    // Dave leaves; his Expense stays in the ledger and in the Month.
    await Group.updateOne({ _id: flat }, { $pull: { members: { user: oid(dave) } } });

    const { whoPaid } = await decoded(flat);

    expect(whoPaid).toEqual({
      ok: true,
      value: {
        members: [
          {
            id: dave,
            name: 'Dave Tester',
            isMember: false,
            paidMinor: 14000,
            shareMinor: 7000,
            netMinor: 7000,
          },
          {
            id: alice,
            name: 'Alice Tester',
            isMember: true,
            paidMinor: 0,
            shareMinor: 7000,
            netMinor: -7000,
          },
          { id: bob, name: 'Bob Tester', isMember: true, paidMinor: 0, shareMinor: 0, netMinor: 0 },
        ],
      },
    });
  });
});

describe('the recurring Expenses card', () => {
  it('lists each template with its amount, payers, the day it added this Month and its next day', async () => {
    switchRecurringExpenses(true);
    const lakeview = await createGroup('Lakeview Flat', [alice, bob, carol]);
    await createdIn(lakeview, '2026-06-20T10:00:00Z');
    const rent = await rentTemplate(lakeview, [alice, bob, carol]);
    const wifi = await rentTemplate(lakeview, [bob, alice, carol], {
      description: 'Wi-Fi',
      dayOfMonth: 28,
      tag: 'Internet',
    });
    const cleaner = await rentTemplate(lakeview, [carol, alice, bob], {
      description: 'Cleaner',
      isPaused: true,
      tag: 'Household',
    });
    await insertExpense(lakeview, '2026-09-08T06:00:00Z', { [bob]: 2000 });

    const { recurring, insights, text } = await decoded(lakeview);

    // Added first: July to September for Rent and Wi-Fi, before the Month was totalled.
    expect(insights.months.at(-1)).toMatchObject({ expenseCount: 3, recurringCount: 2 });
    expect(recurring).toEqual({
      ok: true,
      value: {
        addedInMonth: { count: 2, spentMinor: 600000 },
        templates: [
          {
            id: rent,
            description: 'Rent',
            amountMinor: 300000,
            dayOfMonth: 5,
            paused: false,
            nextDate: '2026-10-05',
            addedOn: '2026-09-05',
            paidBy: [{ id: alice, name: 'Alice Tester' }],
          },
          {
            // September's, dated the 28th, was added with the Month: the next is October's.
            id: wifi,
            description: 'Wi-Fi',
            amountMinor: 300000,
            dayOfMonth: 28,
            paused: false,
            nextDate: '2026-10-28',
            addedOn: '2026-09-28',
            paidBy: [{ id: bob, name: 'Bob Tester' }],
          },
          {
            id: cleaner,
            description: 'Cleaner',
            amountMinor: 300000,
            dayOfMonth: 5,
            paused: true,
            nextDate: null,
            addedOn: null,
            paidBy: [{ id: carol, name: 'Carol Tester' }],
          },
        ],
      },
    });
    expect(text).not.toContain('@splitbook-test.local');
  });

  it('sends no recurring data at all while recurring Expenses are off', async () => {
    switchRecurringExpenses(false);
    const lakeview = await createGroup('Lakeview Flat', [alice, bob]);
    await createdIn(lakeview, '2026-06-20T10:00:00Z');
    await rentTemplate(lakeview, [alice, bob], { description: 'Synthetic rent template' });
    await insertExpense(lakeview, '2026-09-08T06:00:00Z', { [bob]: 2000 });

    const { recurring, text } = await decoded(lakeview);

    expect(recurring).toBeNull();
    const data = JSON.parse(text).data;
    expect(data).not.toHaveProperty('recurring');
    expect(data.recurringExpenses).toBe(false);
    expect(text).not.toContain('Synthetic rent template');
    expect(text).not.toMatch(/nextDate|addedInMonth|recurringCount/);
    // Nothing was added either.
    expect(await Expense.countDocuments({ group: lakeview })).toBe(1);
  });

  it('lists none in a Group without templates while switched on', async () => {
    switchRecurringExpenses(true);
    const trip = await createGroup('Goa Friends Trip', [alice, bob], { category: 'trip' });
    await insertExpense(trip, '2026-09-08T06:00:00Z', { [bob]: 2000 });

    expect((await decoded(trip)).recurring).toEqual({
      ok: true,
      value: { addedInMonth: { count: 0, spentMinor: 0 }, templates: [] },
    });
  });
});

describe('only members', () => {
  async function readBalances(groupId: string) {
    const response = await getBalances(
      new Request(`http://localhost/api/groups/${groupId}/balances`),
      { params: Promise.resolve({ id: groupId }) },
    );
    return { status: response.status, text: await response.text() };
  }

  it('refuses a non-member, a member who left and a missing Group exactly as Balances does, with nothing new', async () => {
    switchRecurringExpenses(true);
    const { maple } = await mapleHouse();
    const theirs = await createGroup('Sunday Football', [bob, carol]);
    await insertExpense(theirs, '2026-09-05T12:00:00Z', { [bob]: 1000, [carol]: 500 });
    const left = await createGroup('Old Flat', [bob, alice]);
    await Group.updateOne({ _id: left }, { $pull: { members: { user: oid(alice) } } });

    for (const groupId of [theirs, left, 'f00000000000000000000000']) {
      const refused = await read(groupId);
      expect(refused).toEqual({
        status: 403,
        text: JSON.stringify({ error: 'Forbidden', status: 403 }),
      });
      expect(refused).toEqual(await readBalances(groupId));
    }

    session.userId = dave;
    expect((await read(maple)).status).toBe(403);
    session.userId = null;
    expect(await read(maple)).toEqual({
      status: 401,
      text: JSON.stringify({ error: 'Unauthorized', status: 401 }),
    });
  });
});
