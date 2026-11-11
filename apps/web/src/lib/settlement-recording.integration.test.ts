import { runStandaloneCase } from './test-utils/standalone-case';
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
const fixture = recordingFixture(
  'single-settlement',
  'settlement-names',
  new Date(2026, 10, 11, 12),
);

it('captures payment names at its commit', async () => {
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
    paidToName: 'A new name',
  });
});

it('refuses a standalone payment when an archive commits after its fence check', async () => {
  if (
    await runStandaloneCase(
      'src/lib/settlement-recording.integration.test.ts',
      'refuses a standalone payment',
      'PAYMENT_ARCHIVE_STANDALONE',
    )
  )
    return;
  const update = Group.collection.updateOne;
  let archived = false;
  vi.spyOn(Group.collection, 'updateOne').mockImplementation(async (...args) => {
    const result = await update.apply(Group.collection, args);
    if (!archived && !Array.isArray(args[1]) && args[1].$set?.currencyLocked === true) {
      archived = true;
      // A real independent archive, after the standalone fence admitted this payment.
      await groupService.archive(fixture.groupId, DEMO_PERSONA_IDS.alex);
    }
    return result;
  });
  const answer = await fixture.send();
  expect(archived).toBe(true);
  expect(answer.status).toBe(409);
  const feed = await fixture.http(fixture.routes.feed.GET, 'GET', 'activity');
  expect(
    feed.body.data.activities.filter(
      (event: { type: string }) => event.type === 'settlement_recorded',
    ),
  ).toHaveLength(0);
  expect((await Group.findById(fixture.groupId))!.isArchived).toBe(true);
});
