import { describe, expect, it } from 'vitest';
import { parseGroupListResponse } from './group-read';

const person = { _id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const timestamp = '2026-09-28T10:00:00.000Z';
const group = {
  _id: 'b00000000000000000000001',
  name: 'Household',
  createdBy: person._id,
  defaultCurrency: 'INR',
  members: [{ user: person, role: 'admin', joinedAt: timestamp }],
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe('Group read contract', () => {
  it('reads a legacy Group with documented defaults and unchanged wire identities', () => {
    const [read] = parseGroupListResponse({ status: 200, data: [group] });
    expect(read).toMatchObject({
      ...group,
      description: '',
      category: 'other',
      tags: [],
      alternateCurrencies: [],
      currencyLocked: false,
      isArchived: false,
      startDate: null,
      endDate: null,
    });
  });
});

it('keeps response order, historical currencies and retired Tags with their identities', () => {
  const tags = [
    {
      _id: 'c00000000000000000000001',
      name: 'Old rent',
      isArchived: true,
      isDeleted: true,
      createdAt: timestamp,
    },
  ];
  const reads = parseGroupListResponse({
    status: 200,
    data: [
      {
        ...group,
        tags,
        alternateCurrencies: ['DEM', 'FRF', 'USD'],
        futureField: { enabled: true },
      },
      { ...group, _id: 'b00000000000000000000002', name: 'Second' },
    ],
  });
  expect(reads.map((item) => item.name)).toEqual(['Household', 'Second']);
  expect(reads[0].tags).toEqual(tags);
  expect(reads[0].alternateCurrencies).toEqual(['DEM', 'FRF', 'USD']);
  expect(reads[0].futureField).toEqual({ enabled: true });
});

it.each([
  ['identity', { _id: 'bad' }],
  ['creator', { createdBy: null }],
  ['name', { name: '' }],
  ['blank name', { name: '  ' }],
  ['currency missing', { defaultCurrency: undefined }],
  ['currency unknown', { defaultCurrency: 'XXX' }],
  ['category unknown', { category: 'moon' }],
  ['category null', { category: null }],
  ['description malformed', { description: 2 }],
  ['description null', { description: null }],
  ['image malformed', { image: {} }],
  ['created timestamp', { createdAt: '2026-02-30T00:00:00Z' }],
  ['updated timestamp', { updatedAt: 0 }],
  ['start date', { startDate: 'tomorrow' }],
  ['end date', { endDate: false }],
  ['archive flag', { isArchived: 'false' }],
  ['currency flag', { currencyLocked: 0 }],
  ['alternate currencies', { alternateCurrencies: ['USD', 2] }],
  ['alternate currencies null', { alternateCurrencies: null }],
  ['tags null', { tags: null }],
  ['tag timestamp', { tags: [{ _id: 'c00000000000000000000001', name: 'Rent' }] }],
  [
    'tag flag',
    {
      tags: [
        { _id: 'c00000000000000000000001', name: 'Rent', createdAt: timestamp, isDeleted: 'yes' },
      ],
    },
  ],
  ['unpopulated user', { members: [{ user: person._id, role: 'admin', joinedAt: timestamp }] }],
  ['null user', { members: [{ user: null, role: 'admin', joinedAt: timestamp }] }],
  [
    'member email',
    { members: [{ user: { ...person, email: 'bad' }, role: 'admin', joinedAt: timestamp }] },
  ],
  ['member date', { members: [{ user: person, role: 'admin', joinedAt: 'yesterday' }] }],
  ['member role', { members: [{ user: person, role: 'owner', joinedAt: timestamp }] }],
  ['members missing', { members: undefined }],
  ['invite code', { inviteCode: 2 }],
  ['invite expiry', { inviteCodeExpiresAt: 'soon' }],
])('rejects the whole list for invalid %s, without leaking the payload', (_label, invalid) => {
  expect(() =>
    parseGroupListResponse({ status: 200, data: [group, { ...group, ...invalid }] }),
  ).toThrow('Unable to load Groups. Please retry.');
});

it.each([null, [], {}, { status: 201, data: [] }, { status: 200, data: null }])(
  'rejects an invalid success envelope %j',
  (value) => {
    expect(() => parseGroupListResponse(value)).toThrow('Unable to load Groups. Please retry.');
  },
);

it('accepts documented absent images/dates without fabricating values', () => {
  const [read] = parseGroupListResponse({
    status: 200,
    data: [
      {
        ...group,
        image: null,
        startDate: null,
        endDate: null,
        members: [{ user: { ...person, image: null }, role: 'member', joinedAt: timestamp }],
      },
    ],
  });
  expect(read.image).toBeUndefined();
  expect(read.members[0].user.image).toBeUndefined();
  expect(read.startDate).toBeNull();
  expect(read.endDate).toBeNull();
});
