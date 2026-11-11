import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

it('preserves a standalone Expense when an archive commits after its fence check', async () => {
  if (process.env.EXPENSE_ARCHIVE_STANDALONE !== 'true') {
    const uri = process.env.STANDALONE_TEST_MONGODB_URI;
    if (!uri) throw new Error('Standalone payment coverage requires STANDALONE_TEST_MONGODB_URI');
    const directory = await mkdtemp(join(tmpdir(), 'splitbook-expense-'));
    try {
      await promisify(execFile)(
        process.execPath,
        [
          resolve('node_modules/vitest/vitest.mjs'),
          'run',
          'src/lib/expense-recording.integration.test.ts',
          '-t',
          'preserves a standalone Expense',
          '--maxWorkers',
          '1',
        ],
        {
          cwd: process.cwd(),
          timeout: 15000,
          env: {
            ...process.env,
            TEST_MONGODB_URI: uri,
            EXPENSE_ARCHIVE_STANDALONE: 'true',
            RECORDING_STANDALONE_RESULT: join(directory, 'unused.json'),
          },
        },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    return;
  }
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
  expect(answer.status).toBe(201);
  const feed = await fixture.http(fixture.routes.feed.GET, 'GET', 'activity');
  expect(
    feed.body.data.activities.filter((event: { type: string }) => event.type === 'expense_added'),
  ).toHaveLength(1);
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
