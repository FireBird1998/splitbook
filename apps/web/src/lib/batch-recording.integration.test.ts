import { expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import Group from './models/Group';
import Expense from './models/Expense';
import Settlement from './models/Settlement';
import Activity from './models/Activity';
import User from './models/User';
import { DEMO_PERSONA_IDS } from './demo-personas';
import { recordingFixture, type Answer } from './test-utils/recordings/fixture';

vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const fixture = recordingFixture('settlement-batch', 'batch-order');
const { sam } = DEMO_PERSONA_IDS;
const fullPayment = { settlements: [{ amount: 120, currency: 'INR', note: 'Paid in full' }] };
const mixed = {
  settlements: [
    { amount: 30, currency: 'INR' },
    {
      amount: 30,
      currency: 'EUR',
      amountPaidMinor: 3000,
      appliedRate: '1',
      rateKind: 'entered',
    },
  ],
};

async function atFence(change: () => Promise<unknown>, command: object = {}): Promise<Answer> {
  const pause = fixture.holdFence(1);
  const pending = fixture.send(command);
  try {
    await Promise.race([
      pause.reached,
      pending.then(() => {
        throw new Error('Batch ended before fence');
      }),
    ]);
    await change();
  } finally {
    pause.restore();
    pause.release();
    await pending;
  }
  return pending;
}

it('refuses a departed person before a removed paying currency at the commit', async () => {
  const answer = await atFence(
    () =>
      Group.updateOne(
        { _id: fixture.groupId },
        {
          $pull: { members: { user: sam }, alternateCurrencies: 'EUR' },
        },
      ),
    {
      paidCurrency: 'EUR',
      settlements: [
        {
          amount: 30,
          currency: 'INR',
          amountPaidMinor: 3000,
          appliedRate: '1',
          rateKind: 'entered',
        },
      ],
    },
  );
  expect(answer.status).toBe(422);
  expect(answer.body.code).toBe('INVALID_MEMBERS');
  expect(await Settlement.countDocuments({ group: fixture.groupId })).toBe(0);
});

it('refuses the first row with no Debt before locking a later row’s unavailable currency', async () => {
  await Expense.deleteMany({ group: fixture.groupId });
  await Group.updateOne({ _id: fixture.groupId }, { $pull: { alternateCurrencies: 'EUR' } });
  const answer = await fixture.send(mixed);
  expect(answer.status).toBe(422);
  expect(answer.body.code).toBe('NO_SETTLEMENT_DEBT');
  expect(await Settlement.countDocuments({ group: fixture.groupId })).toBe(0);
});

it('confirms a concurrent retry inside the fence before recalculating its now-cleared Debt', async () => {
  let winner: Answer | undefined;
  const answer = await atFence(async () => {
    winner = await fixture.send(fullPayment);
    expect(winner.status).toBe(201);
  }, fullPayment);
  expect(answer.status).toBe(201);
  expect(answer.body).toEqual(winner!.body);
  expect(await Settlement.countDocuments({ group: fixture.groupId })).toBe(1);
});

it('reads batch names after waiting for the fence', async () => {
  const answer = await atFence(() => User.updateOne({ _id: sam }, { $set: { name: 'New Sam' } }));
  expect(answer.status).toBe(201);
  const feed = await fixture.http(fixture.routes.feed.GET, 'GET', 'activity');
  expect(feed.body.data.activities[0].metadata.paidToName).toBe('New Sam');
});

it.each(['missing ordered ids', 'missing stored row'])(
  'keeps a corrupt batch receipt a fault: %s',
  async (corruption) => {
    const first = await fixture.send(mixed);
    expect(first.status).toBe(201);
    const ids = first.body.data.settlements.map(
      (row: { _id: string }) => new Types.ObjectId(row._id),
    );
    if (corruption === 'missing ordered ids')
      await Settlement.collection.updateOne(
        { _id: ids[0] },
        { $unset: { batchSettlementIds: '' } },
      );
    else await Settlement.deleteOne({ _id: ids[1] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const retry = await fixture.send(mixed);
    expect(retry.status).toBe(500);
    expect(retry.body).toEqual({ error: 'Internal server error', status: 500 });
  },
);

it('keeps later-row Activity pending if preparing the first response row fails', async () => {
  vi.spyOn(Settlement.prototype, 'populate').mockRejectedValue(new Error('Response unavailable'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const answer = await fixture.send(mixed);
  expect(answer.status).toBe(500);
  expect(
    await Activity.countDocuments({ group: fixture.groupId, type: 'settlement_recorded' }),
  ).toBe(1);
  const stored = await Settlement.find({ group: fixture.groupId }).select('+pendingActivity');
  expect(stored).toHaveLength(2);
  expect(stored.map((row) => row.pendingActivity.length).sort()).toEqual([0, 1]);
});
