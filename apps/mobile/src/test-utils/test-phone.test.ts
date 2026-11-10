import { describe, expect, it, vi } from 'vitest';
import { fakeSplitbook } from './fake-splitbook';
import { testPhone } from './test-phone';

describe('test phone', () => {
  it('reopens the app on the same session and stored payment without sending it', async () => {
    const server = fakeSplitbook();
    const phone = testPhone(server);
    const first = phone.open();
    await first.signIn('alex');
    await phone.stores.settlementAttempts.save(
      'a00000000000000000000001',
      'b00000000000000000000001',
      { untouched: 'fictional payment' },
    );
    const second = phone.open();
    await second.restore();
    expect(second).not.toBe(first);
    expect(second.getSnapshot().auth.user?.name).toBe('Alex Rivera');
    expect(
      await phone.stores.settlementAttempts.load(
        'a00000000000000000000001',
        'b00000000000000000000001',
      ),
    ).toEqual({ untouched: 'fictional payment' });
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
});
