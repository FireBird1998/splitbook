import { expect, it, vi } from 'vitest';
import Group from './models/Group';
import Expense from './models/Expense';
import Activity from './models/Activity';
import RecurringExpense from './models/RecurringExpense';
import { DEMO_PERSONA_IDS } from './demo-personas';
import { recordingFixture } from './test-utils/recordings/fixture';

vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const fixture = recordingFixture(
  'recurring-expense',
  'recurring-order',
  new Date(2026, 10, 11, 12),
);

it('recognises a recorded Month before validating a drifted template', async () => {
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
  await Group.updateOne({ _id: fixture.groupId }, { $set: { defaultCurrency: 'EUR' } });
  const pending = fixture.send();
  expect((await pending).status).toBe(200);
  expect(await Expense.countDocuments({ group: fixture.groupId })).toBe(1);
  expect(await Activity.countDocuments({ group: fixture.groupId })).toBe(1);
  const stored = await Expense.findOne({ group: fixture.groupId }).select('+pendingActivity');
  expect(stored!.pendingActivity).toHaveLength(0);
  expect((await RecurringExpense.findById(fixture.templateId))!.lastGeneratedFor).toBe('2026-11');
});

it('captures recurring Activity time at its commit', async () => {
  const pause = fixture.holdFence(1);
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
  expect(feed.body.data.activities[0].createdAt).toBe(
    new Date(fixture.clock.getTime() + 500).toISOString(),
  );
});

it('keeps an archived-at-commit Month for the next read without failing the read', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const pause = fixture.holdFence(1);
  const pending = fixture.send();
  try {
    await Promise.race([
      pause.reached,
      pending.then(() => {
        throw new Error('Read ended before recording fence');
      }),
    ]);
    await fixture.archive();
  } finally {
    pause.restore();
    pause.release();
    await pending;
  }
  const first = await pending;
  expect(first.status).toBe(200);
  expect(first.body.data.expenses).toHaveLength(0);
  expect((await RecurringExpense.findById(fixture.templateId))!.lastGeneratedFor).toBeNull();
  await Group.updateOne({ _id: fixture.groupId }, { $set: { isArchived: false } });
  const next = await fixture.send();
  expect(next.status).toBe(200);
  expect(next.body.data.expenses).toHaveLength(1);
  expect((await RecurringExpense.findById(fixture.templateId))!.lastGeneratedFor).toBe('2026-11');
});

it('keeps a Month for the next read when a template participant leaves at the commit', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await fixture.readAs('priya');
  const pause = fixture.holdFence(1);
  const pending = fixture.send();
  try {
    await Promise.race([
      pause.reached,
      pending.then(() => {
        throw new Error('Read ended before recording fence');
      }),
    ]);
    await fixture.remove(DEMO_PERSONA_IDS.sam);
  } finally {
    pause.restore();
    pause.release();
    await pending;
  }
  const first = await pending;
  expect(first.status).toBe(200);
  expect(first.body.data.expenses).toHaveLength(0);
  expect((await RecurringExpense.findById(fixture.templateId))!.lastGeneratedFor).toBeNull();
  await Group.updateOne(
    { _id: fixture.groupId },
    { $push: { members: { user: DEMO_PERSONA_IDS.sam, role: 'member' } } },
  );
  const next = await fixture.send();
  expect(next.status).toBe(200);
  expect(next.body.data.expenses).toHaveLength(1);
  expect((await RecurringExpense.findById(fixture.templateId))!.lastGeneratedFor).toBe('2026-11');
});
