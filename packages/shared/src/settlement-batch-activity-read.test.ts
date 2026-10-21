import { describe, expect, it } from 'vitest';
import { parseActivityPageResponse } from './activity-page-read';
import { parseUserActivityResponse } from './user-activity-read';

const event = {
  _id: 'e00000000000000000000001',
  type: 'settlement_recorded',
  actor: { _id: 'a00000000000000000000001', name: 'Alex Rivera' },
  createdAt: '2026-10-21T12:00:00.000Z',
};
const group = { _id: 'b00000000000000000000001', name: 'Fictional trip' };
const oldMetadata = {
  settlementId: 'f00000000000000000000001',
  amount: 20,
  currency: 'INR',
  paidByName: 'Alex Rivera',
  paidToName: 'Sam Chen',
};
const readers = [
  {
    name: 'Group Activity',
    read: (metadata: Record<string, unknown>) =>
      parseActivityPageResponse({
        status: 200,
        data: {
          activities: [{ ...event, group: group._id, metadata }],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      }).activities[0].metadata,
  },
  {
    name: 'Latest changes',
    read: (metadata: Record<string, unknown>) =>
      parseUserActivityResponse({
        status: 200,
        data: { activities: [{ ...event, group, metadata }], limit: 10 },
      }).activities[0].metadata,
  },
];

describe.each(readers)('$name batch reference read (#734)', ({ read }) => {
  it.each([1, 2])('retains a non-empty batch id and size %i', (batchSize) => {
    const metadata = { ...oldMetadata, batchId: 'batch-a', batchSize };
    expect(read(metadata)).toStrictEqual(metadata);
  });

  it('keeps older event metadata unchanged without adding a batch reference', () => {
    expect(read(oldMetadata)).toStrictEqual(oldMetadata);
  });

  it.each([{ batchId: 'batch-a' }, { batchSize: 2 }])(
    'accepts the reference fields independently as optional: %j',
    (reference) => {
      const metadata = { ...oldMetadata, ...reference };
      expect(read(metadata)).toStrictEqual(metadata);
    },
  );

  it.each([
    ['batchId', ''],
    ['batchId', 123],
    ['batchId', null],
    ['batchSize', 0],
    ['batchSize', -1],
    ['batchSize', 1.5],
    ['batchSize', '2'],
    ['batchSize', null],
    ['batchSize', Infinity],
  ] as const)('refuses invalid %s: %j', (field, value) => {
    expect(() =>
      read({ ...oldMetadata, batchId: 'batch-a', batchSize: 2, [field]: value }),
    ).toThrow('Unable to load');
  });
});
