import { describe, expect, it } from 'vitest';
import { testPhone } from '../src/test-utils/test-phone';
import { fakeSplitbook } from '../src/test-utils/fake-splitbook';
import { savedQueriesIn } from '../src/test-utils/saved-queries';
import { waitForSavedQueries } from './offline-checkpoint';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** The verifier's phone: one saved Home write is still on its device when restart begins. */
function checkpointPhone() {
  const user = {
    id: 'a00000000000000000000002',
    name: 'Sam Chen',
    email: 'sam@example.test',
    image: null,
  };
  const server = fakeSplitbook();
  server.world.people.sam = user;
  server.world.groups = [];
  server.world.home = { buckets: [{ currency: 'INR', youOwe: 12, youAreOwed: 0 }], groups: [] };
  server.auth.cookie = () => 'better-auth.session_token=sam.signature';
  const phone = testPhone(server, {
    origin: 'http://localhost:4145',
    parts: {
      pendingInvitation: undefined,
      expenseDrafts: undefined,
      settlementAttempts: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      netInfo: undefined,
      newSubmissionKey: undefined,
    },
  });
  const rows = phone.stores.savedQueries;
  delete rows.retainGroups;
  const saving = deferred(),
    release = deferred();
  rows.at('/api/user/balances').stallPersistently('save', () => {
    saving.resolve();
    return release.promise;
  });
  return { user, phone, rows, saving, release };
}

describe('the offline verifier’s persistence checkpoint (#600)', () => {
  it('names a query that never reached disk instead of treating it as saved', async () => {
    const rows = savedQueriesIn(new Map());
    await expect(waitForSavedQueries(rows, 'sam', ['/api/user/balances'], 0)).rejects.toThrow(
      'Offline restart needs saved queries: /api/user/balances',
    );
  });

  it('propagates a storage read failure immediately', async () => {
    const rows = savedQueriesIn(new Map(), {
      load: async () => {
        throw new Error('Device read failed');
      },
    });
    await expect(waitForSavedQueries(rows, 'sam', ['/api/user/balances'])).rejects.toThrow(
      'Device read failed',
    );
  });

  it('restores Home after a restart even when its ready network read is still being saved', async () => {
    const { user, phone, rows, saving, release } = checkpointPhone();
    const create = () => phone.open();
    let controller = create();
    try {
      await controller.signIn('sam');
      await saving.promise;
      expect(controller.getSnapshot().home.status).toBe('ready');
      const restarting = (async () => {
        await waitForSavedQueries(rows, user.id, ['/api/groups', '/api/user/balances']);
        controller.dispose();
        phone.connect(false);
        controller = create();
        await controller.restore();
      })();
      // Release the disk only after the checkpoint has had a turn. Without waiting for storage,
      // disposal cancels the queued row or the new controller reads before it reaches disk.
      await new Promise<void>((done) => setImmediate(done));
      release.resolve();
      await restarting;
      expect(controller.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: user.id } },
        home: { status: 'ready', data: [{ currency: 'INR', youOwe: 12, youAreOwed: 0 }] },
        offline: { active: true },
      });
    } finally {
      release.resolve();
      controller.dispose();
    }
  });
});
