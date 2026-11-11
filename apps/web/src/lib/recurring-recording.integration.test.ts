import { expect, it, vi } from 'vitest';
import Group from './models/Group';
import Expense from './models/Expense';
import Activity from './models/Activity';
import RecurringExpense from './models/RecurringExpense';
import { recordingFixture } from './test-utils/recordings/fixture';

vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const fixture = recordingFixture('recurring-expense', 'recurring-order');

it('locks currency before recovering an already recorded month with a stale marker', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const outage = vi.spyOn(Activity, 'updateOne').mockImplementation(() => {
    throw new Error('Activity unavailable');
  });
  expect((await fixture.send()).status).toBe(200);
  outage.mockRestore();
  await RecurringExpense.updateOne(
    { _id: fixture.templateId },
    { $set: { lastGeneratedFor: null } },
  );
  const pause = fixture.holdFence(1);
  const pending = fixture.send();
  try {
    await Promise.race([
      pause.reached,
      pending.then(() => {
        throw new Error('Read ended before currency lock');
      }),
    ]);
    await Group.updateOne({ _id: fixture.groupId }, { $set: { defaultCurrency: 'EUR' } });
  } finally {
    pause.restore();
    pause.release();
    await pending;
  }
  expect((await pending).status).toBe(200);
  expect(await Expense.countDocuments({ group: fixture.groupId })).toBe(1);
  expect(await Activity.countDocuments({ group: fixture.groupId })).toBe(0);
  const stored = await Expense.findOne({ group: fixture.groupId }).select('+pendingActivity');
  expect(stored!.pendingActivity).toHaveLength(1);
  expect((await RecurringExpense.findById(fixture.templateId))!.lastGeneratedFor).toBeNull();
});

it('captures recurring Activity time after the currency lock and before waiting for the write', async () => {
  const pause = fixture.holdFence(2);
  const pending = fixture.send();
  try {
    await Promise.race([
      pause.reached,
      pending.then(() => {
        throw new Error('Read ended before recording fence');
      }),
    ]);
    vi.setSystemTime(new Date(fixture.clock.getTime() + 500));
  } finally {
    pause.restore();
    pause.release();
    await pending;
  }
  const answer = await pending;
  expect(answer.status).toBe(200);
  expect(answer.body.data.expenses[0].createdAt).toBe(
    new Date(fixture.clock.getTime() + 500).toISOString(),
  );
  const feed = await fixture.http(fixture.routes.feed.GET, 'GET', 'activity');
  expect(feed.body.data.activities[0].createdAt).toBe(fixture.clock.toISOString());
});
