import { describe, expect, it, vi } from 'vitest';
import { fakeSplitbook } from './fake-splitbook';
import { testPhone } from './test-phone';

describe('test phone', () => {
  it('reopens the app on the same session and stored payment without sending it', async () => {
    const server = fakeSplitbook();
    const phone = testPhone(server);
    const first = phone.open();
    await first.signIn('alex');
    const body =
      '{"paidBy":"a00000000000000000000001","paidTo":"a00000000000000000000002","amount":30,"currency":"INR","note":"Cash"}';
    await phone.stores.settlementAttempts.save(
      'a00000000000000000000001',
      'b00000000000000000000001',
      {
        version: 1,
        accountId: 'a00000000000000000000001',
        groupId: 'b00000000000000000000001',
        key: 'original-payment-key',
        body,
      },
    );
    const second = phone.open();
    await second.restore();
    await second.openSettlements('b00000000000000000000001');
    expect(second).not.toBe(first);
    expect(second.getSnapshot().auth.user?.name).toBe('Alex Rivera');
    expect(second.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      attempt: { key: 'original-payment-key', body },
    });
    expect(
      await phone.stores.settlementAttempts.load(
        'a00000000000000000000001',
        'b00000000000000000000001',
      ),
    ).toMatchObject({ key: 'original-payment-key', body });
    expect(
      server.requests.filter((r) => r.method === 'POST' && r.path.includes('/settlements')),
    ).toEqual([]);
    phone.dispose();
  });
  it('fails, stalls and holds a store write without changing what was stored until release', async () => {
    const phone = testPhone(fakeSplitbook());
    const store = phone.stores.settlementAttempts;
    store.failNext('save', new Error('Fictional disk failure'));
    await expect(store.save('alex', 'maple', { value: 1 })).rejects.toThrow(
      'Fictional disk failure',
    );
    expect(store.records.size).toBe(0);
    const hold = store.holdNext('save');
    const writing = store.save('alex', 'maple', { value: 2 });
    await hold.arrived;
    expect(store.records.size).toBe(0);
    hold.release();
    await writing;
    expect(await store.load('alex', 'maple')).toEqual({ value: 2 });
    let release!: () => void;
    store.stallNext(
      'save',
      new Promise<void>((done) => {
        release = done;
      }),
    );
    const stalled = store.save('alex', 'maple', { value: 3 });
    await Promise.resolve();
    expect(await store.load('alex', 'maple')).toEqual({ value: 2 });
    release();
    await stalled;
    expect(await store.load('alex', 'maple')).toEqual({ value: 3 });
  });
  it('shows the current cleanup markers and keeps their write faults at the phone boundary', async () => {
    const phone = testPhone(fakeSplitbook());
    await phone.stores.cleanupMarker.mark();
    expect(phone.stores.cleanupMarker.value).toBe(true);
    await phone.stores.signOutRecord.mark({ invitationCleared: true });
    expect(phone.stores.signOutRecord.value).toEqual({ invitationCleared: true });
    phone.stores.cleanupMarker.failNext('save');
    await expect(phone.stores.cleanupMarker.mark()).rejects.toThrow(
      'Fictional device storage failure',
    );
  });
  it('purges every registered account store on sign-out and starts the next account empty', async () => {
    const server = fakeSplitbook(),
      phone = testPhone(server),
      app = phone.open();
    await app.signIn('alex');
    const id = server.world.people.alex.id;
    const rowStores = [
      phone.stores.savedQueries,
      phone.stores.expenseDrafts,
      phone.stores.settlementAttempts,
      phone.stores.draftRequests,
      phone.stores.tagRequests,
      phone.stores.groupCreations,
    ];
    for (const store of rowStores) store.records.set(id + '/fictional', { private: true });
    await phone.stores.pendingInvitation.save('abc123ab');
    await phone.stores.financialCleanup.save({ accountId: id, groupIds: [] });
    await phone.stores.untrustedCopies.save({ accountId: id, scopes: {} });
    await app.signOut();
    for (const store of rowStores) expect(store.records.size).toBe(0);
    for (const store of [
      phone.stores.financialCleanup,
      phone.stores.untrustedCopies,
      phone.stores.offlineIdentity,
    ])
      expect(store.value).toBeNull();
    expect(phone.stores.pendingInvitation.value).toBeNull();
    expect(phone.stores.credentials.value).toBeNull();
    expect(phone.stores.owner.value).toBeNull();
    expect(phone.stores.cleanupMarker.value).toBe(false);
    expect(phone.stores.signOutRecord.value).toBeNull();
    await app.signIn('sam');
    expect(app.getSnapshot().auth.user?.name).toBe('Sam Chen');
    phone.dispose();
  });
  it('keeps a failed purge retryable and revokes even when a store cannot clear', async () => {
    const server = fakeSplitbook(),
      phone = testPhone(server),
      app = phone.open();
    await app.signIn('alex');
    phone.stores.savedQueries.failNext('clear');
    await app.signOut();
    expect(app.getSnapshot().auth.status).not.toBe('authenticated');
    expect(phone.stores.cleanupMarker.value).toBe(true);
    expect(
      server.requests.filter((r) => r.method === 'POST' && r.path === '/api/auth/sign-out'),
    ).toHaveLength(1);
    await app.signOut();
    expect(phone.stores.savedQueries.records.size).toBe(0);
    phone.dispose();
  });
  it('reports connection changes and moves the controller and query verification clock together', async () => {
    const server = fakeSplitbook(),
      phone = testPhone(server, { now: Date.parse('2026-09-28T12:00:00Z') });
    const app = phone.open();
    await app.signIn('alex');
    expect(app.getSnapshot().home.refreshedAt).toBe(phone.clock.now);
    phone.connect(false);
    await app.refreshHome();
    await vi.waitFor(() => expect(app.getSnapshot().offline.active).toBe(true));
    phone.clock.now += 60_000;
    expect(Date.now()).toBe(phone.clock.now);
    phone.connect(true);
    await vi.waitFor(() => expect(app.getSnapshot().home.refreshedAt).toBe(phone.clock.now));
    expect(app.getSnapshot().offline.active).toBe(false);
    phone.dispose();
  });
  it('can replace one native part without rebuilding the phone and still revokes a refused sign-in', async () => {
    const server = fakeSplitbook();
    const phone = testPhone(server, {
      parts: {
        credentials: {
          load: async () => null,
          save: async () => {
            throw new Error('Fictional secure storage failure');
          },
          clear: async () => undefined,
        },
      },
    });
    const app = phone.open();
    await app.signIn('alex');
    expect(app.getSnapshot().auth.user).toBeNull();
    expect(app.getSnapshot().auth.message).toBe(
      'Could not safely save your session. Please try signing in again.',
    );
    expect(
      server.requests.filter((r) => r.method === 'POST' && r.path === '/api/auth/sign-out'),
    ).toHaveLength(1);
    phone.dispose();
  });
  it('lists native account/Group records as well as path-keyed saved copies', async () => {
    const phone = testPhone(fakeSplitbook());
    await phone.stores.settlementAttempts.save('alex', 'maple', { key: 'payment-key' });
    await phone.stores.savedQueries.save('alex', '/api/groups/maple', { copy: true });
    expect(await phone.stores.settlementAttempts.list('alex')).toEqual([
      { groupId: 'maple', value: { key: 'payment-key' } },
    ]);
    expect(await phone.stores.settlementAttempts.keys('alex')).toEqual(['maple']);
    expect(await phone.stores.savedQueries.list('alex')).toEqual([
      { groupId: '/api/groups/maple', value: { copy: true } },
    ]);
  });
  it('runs on the platform clock unless the test gives it one', async () => {
    const server = fakeSplitbook(),
      phone = testPhone(server);
    const before = Date.now();
    const app = phone.open();
    await app.signIn('alex');
    // No injected clock: `Date.now` is the platform's, as in a suite that never set `now`.
    expect(vi.isMockFunction(Date.now)).toBe(false);
    expect(phone.clock.now).toBeGreaterThanOrEqual(before);
    expect(() => {
      phone.clock.now += 60_000;
    }).toThrow('Give the phone a `now`');
  });

  it('purges without a part the test took away', async () => {
    const server = fakeSplitbook(),
      phone = testPhone(server, { parts: { savedQueries: undefined, tagRequests: undefined } });
    const app = phone.open();
    await app.signIn('alex');
    await phone.stores.expenseDrafts.save('a00000000000000000000001', 'b00000000000000000000001', {
      kept: 'until sign-out',
    });
    await app.signOut();
    expect(app.getSnapshot().auth).toMatchObject({ status: 'signed-out', message: null });
    expect(phone.stores.expenseDrafts.records.size).toBe(0);
    expect(phone.stores.cleanupMarker.value).toBe(false);
  });
});
