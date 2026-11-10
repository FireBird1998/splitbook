import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Group from './models/Group';
import { groupService } from './services/group.service';
import { expect, it, vi } from 'vitest';
import User from './models/User';
import { DEMO_PERSONA_IDS } from './demo-personas';
import { recordingFixture } from './test-utils/recordings/fixture';

vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const fixture = recordingFixture('single-settlement', 'settlement-names');

it('keeps the payment names read before the recording waits for its fence', async () => {
  const pause = fixture.holdFence(1);
  const pending = fixture.send();
  try {
    await Promise.race([
      pause.reached,
      pending.then(() => {
        throw new Error('Payment ended before fence');
      }),
    ]);
    await User.updateOne({ _id: DEMO_PERSONA_IDS.sam }, { $set: { name: 'A new name' } });
  } finally {
    pause.restore();
    pause.release();
    await pending;
  }
  expect((await pending).status).toBe(201);
  const feed = await fixture.http(fixture.routes.feed.GET, 'GET', 'activity');
  expect(feed.status).toBe(200);
  expect(feed.body.data.activities[0].metadata).toMatchObject({
    paidByName: 'Alex Rivera',
    paidToName: 'Sam Chen',
  });
});

it('preserves a standalone payment when an archive commits after its fence check', async () => {
  if (process.env.PAYMENT_ARCHIVE_STANDALONE !== 'true') {
    const uri = process.env.STANDALONE_TEST_MONGODB_URI;
    if (!uri) throw new Error('Standalone payment coverage requires STANDALONE_TEST_MONGODB_URI');
    const directory = await mkdtemp(join(tmpdir(), 'splitbook-payment-'));
    try {
      await promisify(execFile)(
        process.execPath,
        [
          resolve('node_modules/vitest/vitest.mjs'),
          'run',
          'src/lib/settlement-recording.integration.test.ts',
          '-t',
          'preserves a standalone payment',
          '--maxWorkers',
          '1',
        ],
        {
          cwd: process.cwd(),
          timeout: 15000,
          env: {
            ...process.env,
            TEST_MONGODB_URI: uri,
            PAYMENT_ARCHIVE_STANDALONE: 'true',
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
    if (!archived && args[1].$set?.currencyLocked === true) {
      archived = true;
      // A real independent archive, after the standalone fence admitted this payment.
      await groupService.archive(fixture.groupId, DEMO_PERSONA_IDS.alex);
    }
    return result;
  });
  const answer = await fixture.send();
  expect(archived).toBe(true);
  expect(answer.status).toBe(201);
  const feed = await fixture.http(fixture.routes.feed.GET, 'GET', 'activity');
  expect(
    feed.body.data.activities.filter(
      (event: { type: string }) => event.type === 'settlement_recorded',
    ),
  ).toHaveLength(1);
  expect((await Group.findById(fixture.groupId))!.isArchived).toBe(true);
});
