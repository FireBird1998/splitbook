import { describe, expect, it } from 'vitest';
import { parseActivityPageResponse } from './activity-page-read';
import { formatActivityHeadline } from './activity-timeline';
import { parseUserActivityResponse } from './user-activity-read';
import { createSettlementSchema } from './validators/settlement';

const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const group = 'b00000000000000000000001';
const recorded = {
  _id: 'e00000000000000000000001',
  type: 'settlement_recorded',
  createdAt: '2026-10-21T12:00:00.000Z',
  actor: { _id: alex, name: 'Alex Rivera' },
  metadata: {
    settlementId: 'f00000000000000000000001',
    paidBy: alex,
    paidByName: 'Alex Rivera',
    paidTo: sam,
    paidToName: 'Sam Chen',
    amount: 20,
    amountMinor: 2000,
    currency: 'EUR',
    amountPaidMinor: 4000,
    paidCurrency: 'DEM',
    appliedRate: '2',
    rateKind: 'entered',
  },
};

// Both public reads feed the same Activity words on the web and Android.
const readers = [
  {
    name: 'Group Activity',
    read: (metadata: typeof recorded.metadata) => {
      const event = parseActivityPageResponse({
        status: 200,
        data: {
          activities: [{ ...recorded, group, metadata }],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      }).activities[0];
      return { ...event, actor: recorded.actor };
    },
  },
  {
    name: 'Latest changes',
    read: (metadata: typeof recorded.metadata) =>
      parseUserActivityResponse({
        status: 200,
        data: {
          activities: [{ ...recorded, group: { _id: group, name: 'Fictional trip' }, metadata }],
          limit: 10,
        },
      }).activities[0],
  },
];

describe.each(readers)('$name historical Settlement currencies (#779)', ({ read }) => {
  it('reads and displays a paid currency outside today’s supported list', () => {
    const event = read(recorded.metadata);
    expect(event.metadata).toMatchObject(recorded.metadata);
    expect(formatActivityHeadline(event, alex)).toBe(
      'You paid Sam Chen DEM\u00a040.00 to clear €20.00 at DEM\u00a02.00 per €; no rate suggested',
    );
  });

  it('reads and displays a cleared currency outside today’s supported list', () => {
    const metadata = { ...recorded.metadata, currency: 'DEM', paidCurrency: 'EUR' };
    const event = read(metadata);
    expect(event.metadata).toMatchObject(metadata);
    expect(formatActivityHeadline(event, alex)).toBe(
      'You paid Sam Chen €40.00 to clear DEM\u00a020.00 at €2.00 per DEM; no rate suggested',
    );
  });
});

it('still refuses an unsupported currency on new Settlement writes (#779)', () => {
  const input = {
    paidTo: sam,
    amount: 20,
    currency: 'EUR',
    amountPaidMinor: 4000,
    paidCurrency: 'INR',
    appliedRate: '2',
    rateKind: 'entered',
  };
  expect(createSettlementSchema.safeParse(input).success).toBe(true);
  for (const field of ['currency', 'paidCurrency']) {
    const result = createSettlementSchema.safeParse({ ...input, [field]: 'DEM' });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: [field] })]),
      );
  }
});
