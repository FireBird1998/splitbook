/**
 * Integration tests for search across the member's Groups (`GET /api/search`, #321), against
 * a real, isolated MongoDB database (`splitbook-test-search`).
 *
 * Only the session is a stand-in. The records are raw documents and the route is loaded inside
 * the first test, after checking nothing has registered the User model: like every read that
 * populates members, search must register it itself on a fresh server instance (#186).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { SEARCH_LIMITS } from '@splitbook/shared/search';
import { parseSearchResponse } from '@splitbook/shared/search-read';

const id = (hex: string) => new mongoose.Types.ObjectId(hex.padStart(24, '0'));
const alice = id('b1');
const bob = id('b2');
const carol = id('b3');
const dave = id('b4');
const erin = id('b5');

const tripGroup = id('c1');
const flatGroup = id('c2');
/** Alice was a member and left: leaving pulls the member from the Group (group.service). */
const leftGroup = id('c3');
/** Alice never joined. */
const strangersGroup = id('c4');
/** Alice is still a member, but the Group is archived, so it is gone from her Group list. */
const archivedGroup = id('c5');

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

const db = integrationTestDb('search');
const at = new Date('2026-09-01T12:00:00Z');
const email = (name: string) => `${name.toLowerCase()}.search@splitbook-test.local`;

function member(user: mongoose.Types.ObjectId, role = 'member') {
  return { user, role, joinedAt: at };
}

function groupDoc(
  _id: mongoose.Types.ObjectId,
  name: string,
  members: mongoose.Types.ObjectId[],
  extra: Record<string, unknown> = {},
) {
  return {
    _id,
    name,
    category: 'trip',
    defaultCurrency: 'INR',
    createdBy: members[0],
    members: members.map((user, index) => member(user, index === 0 ? 'admin' : 'member')),
    tags: [],
    isArchived: false,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

let expenseCount = 0;
function expenseDoc(
  group: mongoose.Types.ObjectId,
  description: string,
  day: string,
  extra: Record<string, unknown> = {},
) {
  expenseCount += 1;
  return {
    _id: id(`e${String(expenseCount).padStart(3, '0')}`),
    group,
    description,
    amount: 1200.5,
    amountMinor: 120050,
    currency: 'INR',
    moneyVersion: 1,
    category: 'food',
    date: new Date(`${day}T00:00:00.000Z`),
    paidBy: [{ user: alice, amount: 1200.5, amountMinor: 120050 }],
    splitMethod: 'equal',
    splitBetween: [{ user: alice, amount: 1200.5, amountMinor: 120050 }],
    tag: 'Food',
    createdBy: alice,
    isDeleted: false,
    revision: 0,
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

type Route = typeof import('./route');
let route: Route;

async function search(q: string | null, as: mongoose.Types.ObjectId | null = alice) {
  session.userId = as ? String(as) : null;
  const url = q === null ? 'http://localhost/api/search' : `http://localhost/api/search?q=${q}`;
  return route.GET(new Request(url));
}

/** The read's answer, through the shared decoder the web uses. */
async function results(q: string, as: mongoose.Types.ObjectId = alice) {
  const response = await search(encodeURIComponent(q), as);
  expect(response.status).toBe(200);
  return parseSearchResponse(await response.json());
}

beforeAll(async () => {
  await db.connect();
  await db.reset();
  const database = mongoose.connection.db!;
  const people: [mongoose.Types.ObjectId, string][] = [
    [alice, 'Alice Tester'],
    [bob, 'Bob Goa'],
    [carol, 'Carol Stranger'],
    [dave, 'Dave Leftbehind'],
    [erin, 'Erin Archive'],
  ];
  await database
    .collection('users')
    .insertMany(people.map(([_id, name]) => ({ _id, name, email: email(name.split(' ')[0]) })));

  await database.collection('groups').insertMany([
    groupDoc(tripGroup, 'Goa Friends Trip', [alice, bob]),
    groupDoc(flatGroup, 'Banyan Court Flat', [alice, bob], {
      category: 'home',
      // Below the trip in the Group list, which puts the most recently updated first.
      updatedAt: new Date(at.getTime() - 60_000),
    }),
    groupDoc(leftGroup, 'Goa Leavers Trip', [dave]),
    groupDoc(strangersGroup, 'Goa Strangers Trip', [carol]),
    groupDoc(archivedGroup, 'Goa Archived Trip', [alice, erin], { isArchived: true }),
  ]);
  await database.collection('expenses').insertMany([
    expenseDoc(tripGroup, 'Dinner — beach shack', '2026-09-03'),
    expenseDoc(tripGroup, 'Dinner deleted by mistake', '2026-09-04', {
      isDeleted: true,
      deletedAt: at,
      deletedBy: alice,
    }),
    expenseDoc(flatGroup, 'Electricity bill', '2026-08-20'),
    expenseDoc(flatGroup, 'Priya’s tiffin', '2026-08-18'),
    // Alice paid this one in the Group she has since left; it is still not hers to search.
    expenseDoc(leftGroup, 'Dinner before leaving', '2026-09-05'),
    expenseDoc(strangersGroup, 'Dinner with strangers', '2026-09-06'),
    expenseDoc(archivedGroup, 'Dinner in the archive', '2026-09-07'),
  ]);
});
afterAll(db.teardown);
beforeEach(() => {
  session.userId = null;
});

describe('GET /api/search', () => {
  it('answers on a fresh instance where no other route registered the User model', async () => {
    expect(mongoose.modelNames()).not.toContain('User');
    route = await import('./route');
    const found = await results('bob');
    expect(found.people).toEqual([
      {
        id: String(bob),
        name: 'Bob Goa',
        groupId: String(tripGroup),
        groupName: 'Goa Friends Trip',
        groupCount: 2,
      },
    ]);
  });

  it('refuses a visitor who is not signed in', async () => {
    const response = await search('goa', null);
    expect(response.status).toBe(401);
  });

  it('searches Group names, people and Expense descriptions, grouped', async () => {
    const found = await results('goa');
    expect(found.query).toBe('goa');
    expect(found.groups).toEqual([
      { id: String(tripGroup), name: 'Goa Friends Trip', category: 'trip', memberCount: 2 },
    ]);
    expect(found.people.map((person) => person.name)).toEqual(['Bob Goa']);
    expect(found.expenses).toEqual([]);
    expect(found.more).toEqual({ groups: false, people: false, expenses: false });

    const dinner = await results('din');
    expect(dinner.expenses).toEqual([
      {
        id: expect.any(String),
        groupId: String(tripGroup),
        groupName: 'Goa Friends Trip',
        description: 'Dinner — beach shack',
        amountMinor: 120050,
        currency: 'INR',
        date: '2026-09-03T00:00:00.000Z',
      },
    ]);
  });

  describe('membership', () => {
    it('never searches a Group the member left, never joined, or archived', async () => {
      const found = await results('goa');
      const groupIds = found.groups.map((group) => group.id);
      expect(groupIds).not.toContain(String(leftGroup));
      expect(groupIds).not.toContain(String(strangersGroup));
      expect(groupIds).not.toContain(String(archivedGroup));

      const dinners = await results('dinner');
      expect(dinners.expenses.map((expense) => expense.description)).toEqual([
        'Dinner — beach shack',
      ]);
    });

    it('never finds people only in those Groups', async () => {
      for (const name of ['carol', 'dave', 'erin'])
        expect((await results(name)).people).toEqual([]);
    });

    it("searches each member's own Groups: Dave finds his, and none of Alice's", async () => {
      const found = await results('goa', dave);
      expect(found.groups.map((group) => group.name)).toEqual(['Goa Leavers Trip']);
      expect(found.people).toEqual([]);
      expect((await results('dinner', dave)).expenses.map((e) => e.description)).toEqual([
        'Dinner before leaving',
      ]);
      expect(await results('bob', dave)).toMatchObject({ groups: [], people: [], expenses: [] });
    });

    it('finds nothing for a member with no Groups', async () => {
      const found = await results('goa', id('b9'));
      expect(found).toMatchObject({ query: 'goa', groups: [], people: [], expenses: [] });
    });

    it('never lists the member themself among the people', async () => {
      expect((await results('alice')).people).toEqual([]);
      expect((await results('tester')).people).toEqual([]);
    });
  });

  describe('emails', () => {
    it('appear nowhere in the response', async () => {
      for (const q of ['goa', 'bob', 'b', 'dinner', 'tester']) {
        const response = await search(encodeURIComponent(q));
        const body = await response.text();
        expect(body).not.toContain('@');
        expect(body).not.toMatch(/email/i);
      }
    });

    it('are never matched', async () => {
      for (const q of [email('Bob'), 'bob.search', 'splitbook-test.local'])
        expect(await results(q)).toMatchObject({ groups: [], people: [], expenses: [] });
    });
  });

  it('leaves deleted Expenses out', async () => {
    const found = await results('mistake');
    expect(found.expenses).toEqual([]);
    expect((await results('dinner')).expenses.map((e) => e.description)).not.toContain(
      'Dinner deleted by mistake',
    );
  });

  it('matches each word of the query at the start of a word, in any order', async () => {
    expect((await results('ner')).expenses).toEqual([]);
    expect((await results('shack din')).expenses.map((e) => e.description)).toEqual([
      'Dinner — beach shack',
    ]);
    expect((await results('ELEC')).expenses.map((e) => e.description)).toEqual([
      'Electricity bill',
    ]);
    // An apostrophe stays inside its word, in the database as here.
    expect((await results('tiffin')).expenses.map((e) => e.description)).toEqual([
      'Priya’s tiffin',
    ]);
    expect((await results('s tiffin')).expenses).toEqual([]);
    // Treated as text, never as a pattern.
    expect((await results('.*')).expenses).toEqual([]);
  });

  describe('an empty query', () => {
    it.each([
      ['no query', null],
      ['an empty query', ''],
      ['only spaces', '%20%20%20'],
    ])('answers %s with empty sections', async (_label, q) => {
      const response = await search(q);
      expect(response.status).toBe(200);
      expect(parseSearchResponse(await response.json())).toEqual({
        query: '',
        groups: [],
        people: [],
        expenses: [],
        more: { groups: false, people: false, expenses: false },
      });
    });
  });

  it('refuses a query longer than the dialog allows', async () => {
    const response = await search('a'.repeat(101));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'QUERY_TOO_LONG' });
    expect((await search(`${'a'.repeat(100)}%20%20`)).status).toBe(200);
  });

  describe('caps', () => {
    const capGroups = Array.from({ length: SEARCH_LIMITS.groups + 2 }, (_, n) => id(`d${n + 1}`));
    const cappers = Array.from({ length: SEARCH_LIMITS.people + 2 }, (_, n) => id(`f${n + 1}`));

    beforeAll(async () => {
      const database = mongoose.connection.db!;
      await database
        .collection('users')
        .insertMany(
          cappers.map((_id, n) => ({ _id, name: `Capper ${n + 1}`, email: `capper${n}@x.test` })),
        );
      await database.collection('groups').insertMany(
        capGroups.map((_id, n) =>
          groupDoc(_id, `Cap Group ${n + 1}`, [alice, ...cappers], {
            // The Group list's order: the most recently updated first.
            updatedAt: new Date(at.getTime() + n * 60_000),
          }),
        ),
      );
      await database
        .collection('expenses')
        .insertMany(
          Array.from({ length: SEARCH_LIMITS.expenses + 3 }, (_, n) =>
            expenseDoc(
              capGroups[0],
              `Cap expense ${n + 1}`,
              `2026-07-${String(n + 1).padStart(2, '0')}`,
            ),
          ),
        );
    });

    it('returns at most the limit of each section, and says more matched', async () => {
      const found = await results('cap');
      expect(found.groups).toHaveLength(SEARCH_LIMITS.groups);
      expect(found.people).toHaveLength(SEARCH_LIMITS.people);
      expect(found.expenses).toHaveLength(SEARCH_LIMITS.expenses);
      expect(found.more).toEqual({ groups: true, people: true, expenses: true });
    });

    it('lists Groups in the Group list order, people by name and Expenses newest first', async () => {
      const found = await results('cap');
      expect(found.groups.map((group) => group.name)).toEqual(
        ['7', '6', '5', '4', '3'].map((n) => `Cap Group ${n}`),
      );
      expect(found.people.map((person) => person.name)).toEqual(
        ['1', '2', '3', '4', '5'].map((n) => `Capper ${n}`),
      );
      // A person opens the first Group shared with them, in the Group list's order.
      expect(new Set(found.people.map((person) => person.groupName))).toEqual(
        new Set(['Cap Group 7']),
      );
      expect(found.people[0].groupCount).toBe(capGroups.length);
      expect(found.expenses.map((expense) => expense.description)).toEqual(
        ['11', '10', '9', '8', '7', '6', '5', '4'].map((n) => `Cap expense ${n}`),
      );
    });

    it('puts a name that starts with the whole query first', async () => {
      const found = await results('group 3');
      expect(found.groups.map((group) => group.name)).toEqual(['Cap Group 3']);
      const people = await results('capper 2');
      expect(people.people.map((person) => person.name)).toEqual(['Capper 2']);
    });
  });
});
