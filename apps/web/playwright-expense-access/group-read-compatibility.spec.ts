import { test, expect } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { readWebGroupListResponse } from '../src/lib/group-read';
import { parseGroups } from '../../mobile/src/data/dto';

test('authenticated Group list has the same meaning through web and native adapters', async ({
  ledger,
}) => {
  const response = await ledger.sam.get('/api/groups');
  expect(response.status()).toBe(200);
  const payload = await response.json();
  const web = readWebGroupListResponse(payload, DEMO_PERSONA_IDS.sam);
  const mobile = parseGroups(payload);
  expect(web.map((group) => group._id)).toEqual(mobile.map((group) => group.id));
  const webGroup = web.find((group) => group._id === ledger.groupB)!;
  const mobileGroup = mobile.find((group) => group.id === ledger.groupB)!;
  expect(webGroup).toMatchObject({
    name: 'Synthetic access household',
    category: 'home',
    defaultCurrency: 'INR',
  });
  expect(webGroup.tags.some((tag) => tag.name === 'Rent')).toBe(true);
  expect(mobileGroup).toEqual({
    id: webGroup._id,
    name: webGroup.name,
    description: webGroup.description,
    category: webGroup.category,
    defaultCurrency: webGroup.defaultCurrency,
    startDate: null,
    endDate: null,
    createdAt: new Date(webGroup.createdAt),
    updatedAt: new Date(webGroup.updatedAt),
    members: webGroup.members.map((member) => ({
      role: member.role,
      joinedAt: new Date(member.joinedAt),
      user: {
        id: member.user._id,
        name: member.user.name,
        email: member.user.email,
        image: member.user.image ?? null,
      },
    })),
  });
  // Consumer validation does not narrow the producer's serialized document.
  expect(payload.data.find((group: { _id: string }) => group._id === ledger.groupB)).toHaveProperty(
    'currencyLocked',
    true,
  );
  expect(payload.data.find((group: { _id: string }) => group._id === ledger.groupB)).toHaveProperty(
    '__v',
  );
  expect(web.some((group) => group._id === ledger.groupA)).toBe(false);
  expect(() => readWebGroupListResponse(payload, DEMO_PERSONA_IDS.alex)).toThrow();
  expect((await ledger.anonymous.get('/api/groups')).status()).toBe(401);
});

// Historical fixtures deliberately bypass current write restrictions, in this run's disposable DB.
async function withDatabase<T>(run: (db: import('mongodb').Db) => Promise<T>) {
  const name = process.env.EXPENSE_ACCESS_TEST_DB;
  if (!name?.startsWith('splitbook-test-access-')) throw new Error('Isolated database required');
  const client = new MongoClient(`mongodb://127.0.0.1:27017/${name}?directConnection=true`);
  try {
    return await run(client.db(name));
  } finally {
    await client.close();
  }
}

import { MongoClient, ObjectId } from 'mongodb';
import { dataOf } from './fixtures';
import { readWebGroupResponse } from '../src/lib/group-read';
import { parseGroup, parseCreatedGroup } from '../../mobile/src/data/dto';

test('real Group detail preserves settings, historical Tags and creation/invitation compatibility', async ({
  ledger,
}) => {
  const created = await ledger.alex.post('/api/groups', {
    data: {
      name: 'Read compatibility trip',
      description: 'All settings survive',
      category: 'trip',
      defaultCurrency: 'EUR',
      alternateCurrencies: ['USD'],
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    },
  });
  expect(created.status()).toBe(201);
  const createdPayload = await created.json();
  const mobileCreated = parseCreatedGroup(createdPayload);
  const id = mobileCreated.id;
  const invite = await dataOf(
    await ledger.alex.post(`/api/groups/${id}/invite-link`, { data: {} }),
    201,
  );
  expect((await ledger.sam.post(`/api/join/${invite.inviteCode}`)).status()).toBe(201);
  const retiredId = new ObjectId();
  await withDatabase((db) =>
    db.collection('groups').updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          alternateCurrencies: ['DEM', 'FRF', 'USD'],
          image: 'https://example.test/group.png',
          tags: [
            {
              _id: retiredId,
              name: 'Historical stay',
              isArchived: true,
              isDeleted: true,
              createdAt: new Date('2020-01-01T00:00:00Z'),
            },
          ],
          futureProperty: { preserved: true },
        },
      },
    ),
  );
  const response = await ledger.sam.get(`/api/groups/${id}`);
  expect(response.status()).toBe(200);
  const payload = await response.json();
  const web = readWebGroupResponse(payload, DEMO_PERSONA_IDS.sam, id);
  const mobile = parseGroup(payload);
  expect(web).toMatchObject({
    _id: id,
    name: 'Read compatibility trip',
    description: 'All settings survive',
    category: 'trip',
    defaultCurrency: 'EUR',
    alternateCurrencies: ['DEM', 'FRF', 'USD'],
    image: 'https://example.test/group.png',
    startDate: '2026-09-01T00:00:00.000Z',
    endDate: '2026-09-30T00:00:00.000Z',
    tags: [
      {
        _id: retiredId.toHexString(),
        name: 'Historical stay',
        isArchived: true,
        isDeleted: true,
        createdAt: '2020-01-01T00:00:00.000Z',
      },
    ],
    inviteCode: invite.inviteCode,
    futureProperty: { preserved: true },
  });
  expect(mobile.id).toBe(web._id);
  expect(mobile.startDate?.toISOString()).toBe(web.startDate);
  expect(mobile.endDate?.toISOString()).toBe(web.endDate);
  expect(mobile.members.map((member) => member.user.id)).toEqual(
    web.members.map((member) => member.user._id),
  );
  expect(() => readWebGroupResponse(payload, DEMO_PERSONA_IDS.sam, ledger.groupB)).toThrow();
  expect(() => readWebGroupResponse(payload, DEMO_PERSONA_IDS.priya, id)).toThrow();
  expect((await ledger.priya.get(`/api/groups/${id}`)).status()).toBe(403);
});

test('both adapters reject an entire actual response with a malformed legacy Group and recover after repair', async ({
  ledger,
}) => {
  await withDatabase((db) =>
    db.collection('groups').updateOne(
      { _id: new ObjectId(ledger.groupB) },
      {
        $set: { defaultCurrency: 'INVALID-CURRENCY' },
      },
    ),
  );
  const badList = await (await ledger.sam.get('/api/groups')).json();
  expect(() => readWebGroupListResponse(badList, DEMO_PERSONA_IDS.sam)).toThrow();
  expect(() => parseGroups(badList)).toThrow();
  const badDetail = await (await ledger.sam.get(`/api/groups/${ledger.groupB}`)).json();
  expect(() => readWebGroupResponse(badDetail, DEMO_PERSONA_IDS.sam, ledger.groupB)).toThrow();
  expect(() => parseGroup(badDetail)).toThrow();
  await withDatabase((db) =>
    db.collection('groups').updateOne(
      { _id: new ObjectId(ledger.groupB) },
      {
        $set: { defaultCurrency: 'INR' },
        $unset: {
          category: '',
          description: '',
          tags: '',
          alternateCurrencies: '',
          currencyLocked: '',
          isArchived: '',
          startDate: '',
          endDate: '',
        },
      },
    ),
  );
  const repaired = await (await ledger.sam.get(`/api/groups/${ledger.groupB}`)).json();
  expect(readWebGroupResponse(repaired, DEMO_PERSONA_IDS.sam, ledger.groupB)).toMatchObject({
    category: 'other',
    description: '',
    tags: [],
    alternateCurrencies: [],
    currencyLocked: false,
    isArchived: false,
  });
  expect(parseGroup(repaired)).toMatchObject({
    category: 'other',
    description: '',
    startDate: null,
    endDate: null,
  });
});

test('Group detail authorization precedes recurring generation and repeated authorized reads generate once', async ({
  ledger,
}) => {
  const nextYear = new Date().getUTCFullYear() + 1;
  const template = await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/recurring`, {
      data: {
        description: 'Read-triggered rent',
        amount: 100,
        currency: 'INR',
        category: 'housing',
        tag: 'Rent',
        paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount: 100 }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS.priya }],
        dayOfMonth: 1,
        startsOn: `${nextYear}-01-01T00:00:00.000Z`,
      },
    }),
    201,
  );
  const now = new Date();
  await withDatabase((db) =>
    db.collection('recurringexpenses').updateOne(
      { _id: new ObjectId(template._id) },
      {
        $set: { startsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) },
      },
    ),
  );
  const count = () =>
    withDatabase((db) =>
      db.collection('expenses').countDocuments({ recurringExpense: new ObjectId(template._id) }),
    );
  expect(await count()).toBe(0);
  expect((await ledger.anonymous.get(`/api/groups/${ledger.groupB}`)).status()).toBe(401);
  expect((await ledger.alex.get(`/api/groups/${ledger.groupB}`)).status()).toBe(403);
  expect(await count()).toBe(0);
  for (let request = 0; request < 2; request++) {
    const response = await ledger.sam.get(`/api/groups/${ledger.groupB}`);
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(readWebGroupResponse(payload, DEMO_PERSONA_IDS.sam, ledger.groupB)._id).toBe(
      ledger.groupB,
    );
    expect(parseGroup(payload).id).toBe(ledger.groupB);
  }
  expect(await count()).toBe(1);
});
