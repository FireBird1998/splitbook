import { runStandaloneCase } from './test-utils/standalone-case';
import Group from './models/Group';
import { Types } from 'mongoose';
import { groupService } from './services/group.service';
import { expect, it, vi } from 'vitest';
import { DEMO_PERSONA_IDS } from './demo-personas';
import { recordingFixture } from './test-utils/recordings/fixture';

vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const fixture = recordingFixture('manual-expense', 'expense-order');

it('keeps the Expense Activity time captured before waiting for its fence', async () => {
  const pause = fixture.holdFence(1);
  const pending = fixture.send();
  try {
    await Promise.race([
      pause.reached,
      pending.then(() => {
        throw new Error('Expense ended before fence');
      }),
    ]);
    vi.setSystemTime(new Date(fixture.clock.getTime() + 500));
  } finally {
    pause.restore();
    pause.release();
    await pending;
  }
  const answer = await pending;
  expect(answer.status).toBe(201);
  expect(answer.body.data.createdAt).toBe(new Date(fixture.clock.getTime() + 500).toISOString());
  const feed = await fixture.http(fixture.routes.feed.GET, 'GET', 'activity');
  expect(feed.body.data.activities[0].createdAt).toBe(fixture.clock.toISOString());
});

it('refuses a standalone Expense when an archive commits after its fence check', async () => {
  if (
    await runStandaloneCase(
      'src/lib/expense-recording.integration.test.ts',
      'refuses a standalone Expense',
      'EXPENSE_ARCHIVE_STANDALONE',
    )
  )
    return;
  const update = Group.collection.updateOne;
  let archived = false;
  vi.spyOn(Group.collection, 'updateOne').mockImplementation(async (...args) => {
    const result = await update.apply(Group.collection, args);
    if (!archived && !Array.isArray(args[1]) && args[1].$set?.currencyLocked === true) {
      archived = true;
      // A real independent archive, after the standalone fence admitted this Expense.
      await groupService.archive(fixture.groupId, DEMO_PERSONA_IDS.alex);
    }
    return result;
  });
  const answer = await fixture.send();
  expect(archived).toBe(true);
  expect(answer.status).toBe(409);
  const feed = await fixture.http(fixture.routes.feed.GET, 'GET', 'activity');
  expect(
    feed.body.data.activities.filter((event: { type: string }) => event.type === 'expense_added'),
  ).toHaveLength(0);
  expect((await Group.findById(fixture.groupId))!.isArchived).toBe(true);
});

it('refuses an archived Group before validating a missing Expense participant', async () => {
  await Group.updateOne(
    { _id: fixture.groupId },
    {
      $set: { isArchived: true },
      $pull: { members: { user: DEMO_PERSONA_IDS.sam } },
    },
  );
  const answer = await fixture.send();
  expect(answer.status).toBe(409);
  expect(answer.body.code).toBe('GROUP_ARCHIVED');
});

it.each([false, true])(
  'keeps Group schema defaults when the stored Tags array is absent (retry: %s)',
  async (retry) => {
    if (retry) expect((await fixture.send()).status).toBe(201);
    await Group.collection.updateOne(
      { _id: new Types.ObjectId(fixture.groupId) },
      { $unset: { tags: '' } },
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const answer = await fixture.send();
    if (retry) {
      expect(answer.status).toBe(201);
      expect(answer.body.data.tag).toBe('Food');
    } else {
      expect(answer.status).toBe(422);
      expect(answer.body.code).toBe('INVALID_TAG');
    }
  },
);

it('refuses a standalone restoration when an archive commits after its currency check', async () => {
  if (
    await runStandaloneCase(
      'src/lib/expense-recording.integration.test.ts',
      'refuses a standalone restoration',
      'RESTORE_ARCHIVE_STANDALONE',
    )
  )
    return;
  const saved = await fixture.send();
  expect(saved.status).toBe(201);
  const params = Promise.resolve({ id: fixture.groupId, expenseId: saved.body.data._id as string });
  const suffix = `expenses/${saved.body.data._id}`;
  const deleted = await fixture.http(
    (req) => fixture.routes.expense.DELETE(req, { params }),
    'DELETE',
    suffix,
    undefined,
    { 'X-Splitbook-Revision': '0' },
  );
  expect(deleted.status).toBe(200);
  const update = Group.collection.updateOne;
  let archived = false;
  vi.spyOn(Group.collection, 'updateOne').mockImplementation(async (...args) => {
    const result = await update.apply(Group.collection, args);
    if (!archived && !Array.isArray(args[1]) && args[1].$set?.currencyLocked === true) {
      archived = true;
      await groupService.archive(fixture.groupId, DEMO_PERSONA_IDS.alex);
    }
    return result;
  });
  const restored = await fixture.http(
    (req) => fixture.routes.expense.PATCH(req, { params }),
    'PATCH',
    suffix,
    { isDeleted: false },
    { 'X-Splitbook-Revision': '1' },
  );
  expect(archived).toBe(true);
  expect(restored.status).toBe(409);
  expect(restored.body.code).toBe('GROUP_ARCHIVED');
  const read = await fixture.http(
    (req) => fixture.routes.expense.GET(req, { params }),
    'GET',
    suffix,
  );
  expect(read.body.data.isDeleted).toBe(true);
});
