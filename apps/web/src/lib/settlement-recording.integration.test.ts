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
    await Promise.race([pause.reached, pending.then(() => { throw new Error('Payment ended before fence'); })]);
    await User.updateOne({ _id: DEMO_PERSONA_IDS.sam }, { $set: { name: 'A new name' } });
  } finally { pause.restore(); pause.release(); await pending; }
  expect((await pending).status).toBe(201);
  const feed = await fixture.http(fixture.routes.feed.GET, 'GET', 'activity');
  expect(feed.status).toBe(200);
  expect(feed.body.data.activities[0].metadata).toMatchObject({ paidByName: 'Alex Rivera', paidToName: 'Sam Chen' });
});
