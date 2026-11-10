import { savedQueriesIn } from './saved-queries';
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
  it('can omit account storage entirely, as a credentials-only view test did', async () => {
    const phone = testPhone(fakeSplitbook(), { parts: { accountLocal: undefined } });
    phone.stores.owner.failNext('load');
    const app = phone.open();
    await app.signIn('sam');
    expect(app.getSnapshot().auth).toMatchObject({
      status: 'authenticated',
      user: { name: 'Sam Chen' },
    });
    expect(phone.stores.owner.value).toBeNull();
  });
  it('keeps an explicit native purge list and omitted optional account parts', async () => {
    const phone = testPhone(fakeSplitbook(), {
      parts: {
        accountLocal: {
          financialCleanup: undefined,
          untrustedCopies: undefined,
          signOutRecord: undefined,
        },
      },
      purge: ['settlementAttempts'],
    });
    phone.stores.signOutRecord.failNext('save');
    const app = phone.open();
    await app.signIn('alex');
    const account = 'a00000000000000000000001';
    await phone.stores.settlementAttempts.save(account, 'maple', { unfinished: true });
    await phone.stores.savedQueries.save(account, '/api/groups', {
      kept: 'not in this fixture’s purge list',
    });
    await app.signOut();
    expect(app.getSnapshot().auth).toMatchObject({ status: 'signed-out', message: null });
    expect(phone.stores.settlementAttempts.records.size).toBe(0);
    expect(phone.stores.savedQueries.records.size).toBeGreaterThan(0);
  });
  it('waits for a public snapshot condition, including one that is already true', async () => {
    const { until } = await import('./test-phone');
    const phone = testPhone(fakeSplitbook()),
      app = phone.open();
    const signedIn = until(app, (snapshot) => snapshot.auth.status === 'authenticated');
    await app.signIn('alex');
    await signedIn;
    await until(app, (snapshot) => snapshot.auth.user?.name === 'Alex Rivera');
    expect(app.getSnapshot().auth.status).toBe('authenticated');
  });
  it('keeps a fixture’s separated Draft keys across restart and sign-out', async () => {
    const phone = testPhone(fakeSplitbook(), { recordSeparator: ':' });
    const account = 'a00000000000000000000001',
      group = 'b00000000000000000000001';
    const app = phone.open();
    await app.signIn('alex');
    await app.openExpense(group);
    await app.updateExpenseDraft({ description: 'Dinner' });
    expect([...phone.stores.expenseDrafts.records.keys()]).toEqual([account + ':' + group]);
    expect(await phone.stores.expenseDrafts.keys(account)).toEqual([group]);
    const before = await phone.stores.expenseDrafts.load(account, group);
    const restarted = phone.open();
    await restarted.restore();
    expect(await phone.stores.expenseDrafts.load(account, group)).toEqual(before);
    await restarted.signOut();
    expect(phone.stores.expenseDrafts.records.size).toBe(0);
  });
  it('holds and fails only the requested saved-query path', async () => {
    const phone = testPhone(fakeSplitbook()),
      store = phone.stores.savedQueries;
    const held = store.at('/api/second').holdNext('save');
    await store.save('alex', '/api/first', { saved: 1 });
    const writing = store.save('alex', '/api/second', { saved: 2 });
    await held.arrived;
    expect(await store.load('alex', '/api/first')).toEqual({ saved: 1 });
    expect(await store.load('alex', '/api/second')).toBeNull();
    held.release();
    await writing;
    store.at('/api/second').failNext('load', new Error('Unreadable row'));
    expect(await store.load('alex', '/api/first')).toEqual({ saved: 1 });
    await expect(store.load('alex', '/api/second')).rejects.toThrow('Unreadable row');
    expect(await store.load('alex', '/api/second')).toEqual({ saved: 2 });
  });

  it('keeps a native failure active until disabled or removed, independently of failNext', async () => {
    const phone = testPhone(fakeSplitbook()),
      store = phone.stores.savedQueries;
    await store.save('alex', '/api/group', { saved: 1 });
    let broken = true;
    const stop = store
      .at('/api/group')
      .failPersistently('load', new Error('Broken storage'), () => broken);
    for (let i = 0; i < 2; i++)
      await expect(store.load('alex', '/api/group')).rejects.toThrow('Broken storage');
    broken = false;
    expect(await store.load('alex', '/api/group')).toEqual({ saved: 1 });
    broken = true;
    await expect(store.load('alex', '/api/group')).rejects.toThrow('Broken storage');
    stop();
    expect(await store.load('alex', '/api/group')).toEqual({ saved: 1 });
  });

  it('delays native reads while the device is slow and can remove that delay', async () => {
    vi.useFakeTimers();
    try {
      const store = testPhone(fakeSplitbook()).stores.savedQueries;
      await store.save('alex', '/api/group', { saved: 1 });
      let delay = 50;
      const stop = store.delayPersistently('load', () => delay);
      let answered = false;
      const reading = store.load('alex', '/api/group').then((value) => {
        answered = true;
        return value;
      });
      await vi.advanceTimersByTimeAsync(49);
      expect(answered).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await reading).toEqual({ saved: 1 });
      delay = 0;
      expect(await store.load('alex', '/api/group')).toEqual({ saved: 1 });
      delay = 50;
      stop();
      expect(await store.load('alex', '/api/group')).toEqual({ saved: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports connected without internet, keeps that signal on restart, and reconnects', async () => {
    const server = fakeSplitbook(),
      phone = testPhone(server);
    const app = phone.open();
    await app.signIn('alex');
    phone.connect(true, false);
    expect(server.online).toBe(false);
    await app.refreshHome();
    expect(app.getSnapshot().offline.active).toBe(true);
    const restarted = phone.open();
    await restarted.restore();
    expect(restarted.getSnapshot().offline.active).toBe(true);
    phone.connect(true, true);
    await vi.waitFor(() => expect(restarted.getSnapshot().offline.active).toBe(false));
    expect(server.online).toBe(true);
  });

  it('can persistently refuse the native saved-copy retention step', async () => {
    const store = testPhone(fakeSplitbook()).stores.savedQueries;
    const stop = store.failPersistently('retainGroups', new Error('Cannot retain rows'));
    await expect(store.retainGroups!('alex', ['maple'])).rejects.toThrow('Cannot retain rows');
    stop();
    await expect(store.retainGroups!('alex', ['maple'])).resolves.toBeUndefined();
  });
  it('stalls native operations while a device gate is active and can remove the stall', async () => {
    const store = testPhone(fakeSplitbook()).stores.expenseDrafts;
    let release!: () => void;
    let wait: Promise<void> | null = new Promise((done) => {
      release = done;
    });
    const stop = store.stallPersistently('save', () => wait);
    let written = false;
    const writing = store.save('alex', 'maple', { draft: 'Dinner' }).then(() => {
      written = true;
    });
    await Promise.resolve();
    expect(written).toBe(false);
    expect(store.records.size).toBe(0);
    release();
    await writing;
    wait = null;
    await store.save('alex', 'maple', { draft: 'Tea' });
    expect(await store.load('alex', 'maple')).toEqual({ draft: 'Tea' });
    wait = new Promise(() => {});
    stop();
    await store.save('alex', 'maple', { draft: 'Taxi' });
    expect(await store.load('alex', 'maple')).toEqual({ draft: 'Taxi' });
  });

  it('exposes faults on a supplied saved-query adapter without replacing its storage', async () => {
    const rows = new Map<string, unknown>(),
      adapter = savedQueriesIn(rows);
    const phone = testPhone(fakeSplitbook(), { parts: { savedQueries: adapter } });
    await phone.stores.savedQueries.save('alex', '/api/group', { saved: 1 });
    expect(await adapter.load('alex', '/api/group')).toEqual({ saved: 1 });
    const stop = phone.stores.savedQueries
      .at('/api/group')
      .failPersistently('remove', new Error('Disk full'));
    await expect(phone.stores.savedQueries.remove('alex', '/api/group')).rejects.toThrow(
      'Disk full',
    );
    expect(await adapter.load('alex', '/api/group')).toEqual({ saved: 1 });
    stop();
    await phone.stores.savedQueries.remove('alex', '/api/group');
    expect(await adapter.load('alex', '/api/group')).toBeNull();
  });
  it('lets an unblocked saved-row read answer on its native turn', async () => {
    const store = testPhone(fakeSplitbook()).stores.savedQueries;
    await store.save('alex', '/api/group', { saved: 1 });
    const answers: string[] = [];
    const reading = store.load('alex', '/api/group').then((value) => {
      answers.push('saved row');
      return value;
    });
    await Promise.resolve();
    answers.push('next turn');
    expect(answers).toEqual(['saved row', 'next turn']);
    expect(await reading).toEqual({ saved: 1 });
  });

  it('can seed native cell contents without consuming a write fault and still clones them', async () => {
    const phone = testPhone(fakeSplitbook()),
      store = phone.stores.financialCleanup;
    store.failNext('save', new Error('Journal unavailable'));
    const copy = { groupId: 'maple' };
    store.value = copy;
    copy.groupId = 'other';
    expect(await store.load()).toEqual({ groupId: 'maple' });
    await expect(store.save(null)).rejects.toThrow('Journal unavailable');
    store.value = null;
    expect(await store.load()).toBeNull();
  });

  it('uses the fixture’s local origin for both API and authentication requests', async () => {
    const server = fakeSplitbook(),
      phone = testPhone(server, { origin: 'http://localhost:4145' });
    const app = phone.open();
    await app.signIn('alex');
    expect(server.requests.length).toBeGreaterThan(1);
    expect([...new Set(server.requests.map((r) => r.url.origin))]).toEqual([
      'http://localhost:4145',
    ]);
  });
});

it('opens the phone with its build configuration and distinct API and auth origins', async () => {
  const server = fakeSplitbook();
  const phone = testPhone(server, { config: {
    apiBaseUrl: 'http://10.0.2.2:4127', authOrigin: 'http://localhost:4127',
    developmentPersonaEnabled: true,
  } });
  await phone.open().signIn('alex');
  expect(server.requests[0].url.origin).toBe('http://10.0.2.2:4127');
  expect(server.requests[0].headers.get('Origin')).toBe('http://localhost:4127');
});

it('keeps a payment store’s separated native keys independently of Draft keys', async () => {
  const phone=testPhone(fakeSplitbook(),{settlementSeparator:':'});
  await phone.stores.settlementAttempts.save('alex','maple',{payment:1});
  expect([...phone.stores.settlementAttempts.records.keys()]).toEqual(['alex:maple']);
  expect(await phone.stores.settlementAttempts.load('alex','maple')).toEqual({payment:1});
  expect(await phone.stores.settlementAttempts.list('alex')).toEqual([{groupId:'maple',value:{payment:1}}]);
  await phone.stores.expenseDrafts.save('alex','maple',{draft:1});
  expect([...phone.stores.expenseDrafts.records.keys()]).toEqual(['alexmaple']);
});
