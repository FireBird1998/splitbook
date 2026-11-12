import { afterEach, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';
import { balancesWidget } from '@splitbook/shared/balances-widget';
import { groupWidget } from '@splitbook/shared/group-widget';
import { quickWidget } from '@splitbook/shared/quick-widget';
import { fakeSplitbook } from './test-utils/fake-splitbook';
import { testPhone } from './test-utils/test-phone';

const native = vi.hoisted(() => ({
  databases: new Map<string, DatabaseSync>(),
  exists: true,
  copyWrite: null as null | { arrive(): void; waiting: Promise<void>; complete(): void },
}));
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  return {
    defaultDatabaseDirectory: '/data/user/0/com.splitbook.app.dev/files/SQLite',
    openDatabaseAsync: async (file: string) => {
      let db = native.databases.get(file);
      if (!db) {
        db = new DatabaseSync(':memory:');
        native.databases.set(file, db);
      }
      return {
        execAsync: async (sql: string) => db.exec(sql),
        runAsync: async (sql: string, ...values: (string | number | null)[]) => {
          const held = sql.startsWith('UPDATE widget_state SET copy =') ? native.copyWrite : null;
          if (held) {
            native.copyWrite = null;
            held.arrive();
            await held.waiting;
          }
          const result = db.prepare(sql).run(...values);
          held?.complete();
          return result;
        },
        getFirstAsync: async (sql: string, ...values: (string | number | null)[]) =>
          db.prepare(sql).get(...values),
      };
    },
  };
});
afterEach(() => {
  for (const db of native.databases.values()) db.close();
  native.databases.clear();
  native.copyWrite = null;
});
vi.mock('expo-file-system', () => ({
  File: class {
    constructor(directory: string) {
      if (!directory.startsWith('file://')) throw new Error('URI is not absolute');
    }
    get exists() {
      return native.exists;
    }
  },
}));
import { createWidgetsNative, createWidgetsStore } from './widgets-native';

it('purges an existing copy after a cold start using an absolute file URI', async () => {
  const store = createWidgetsStore('development');
  await store.write({ version: 1, accountId: 'alex', home: null });
  await createWidgetsStore('development').clear();
  expect((await store.read()).copy).toBeNull();
});

it('keeps only the same account’s archived final balances across app-query eviction and restart', async () => {
  const copy: WidgetCopy = {
    version: 1,
    accountId: 'alex',
    home: null,
    groups: {
      maple: {
        id: 'maple',
        name: 'Maple House',
        theme: 'home',
        archived: true,
        mainCurrency: 'INR',
        verifiedAt: 100,
        balancesVerifiedAt: 200,
        currencies: [{ currency: 'INR', balanceMinor: -1200, payments: [] }],
      },
    },
  };
  await createWidgetsStore('development').write(copy);
  const restarted = createWidgetsStore('development');
  await restarted.write({ ...copy, groups: {} });
  expect((await restarted.read()).copy?.groups).toEqual(copy.groups);
  await restarted.write({ ...copy, groups: {}, lostGroupIds: ['maple'] });
  expect((await restarted.read()).copy?.groups).toEqual({});
  await restarted.write(copy);
  await restarted.write({ ...copy, accountId: 'sam', groups: {} });
  expect((await restarted.read()).copy?.groups).toEqual({});
});

it('treats an unreadable widget copy as absent while keeping the saved session and setup', async () => {
  const store = createWidgetsStore('development');
  const session = { status: 'authenticated' as const, accountId: 'alex', loading: false };
  const setup = { kind: 'group' as const, widgetId: 7, accountId: 'alex', groupId: 'maple' };
  await store.setSession(session);
  await store.saveSetup(setup);
  // Corruption at the SQLite boundary; observe only the store's public read interfaces.
  native.databases
    .get('splitbook-widgets.db')!
    .prepare('UPDATE widget_state SET copy = ? WHERE environment = ?')
    .run('{unreadable', 'development');
  await expect(store.read()).resolves.toEqual({ copy: null, session });
  expect(await store.setup(7)).toEqual(setup);
});

const homeTime = new Date(2026, 10, 13, 9, 41).getTime();
const groupTime = new Date(2026, 10, 13, 9, 40).getTime();
const balanceTime = new Date(2026, 10, 13, 9, 42).getTime();
const drawTime = new Date(2026, 10, 13, 10, 15).getTime();
const alexSession = { status: 'authenticated' as const, accountId: 'alex', loading: false };
const placedGroup = { kind: 'group' as const, widgetId: 7, accountId: 'alex', groupId: 'maple' };
const placedQuick = { kind: 'quick' as const, widgetId: 8, accountId: 'alex', groupId: 'maple' };

function savedWidgetCopy(): WidgetCopy {
  return {
    version: 1,
    accountId: 'alex',
    home: {
      verifiedAt: homeTime,
      groupCount: 1,
      currencies: [{ currency: 'INR', owedMinor: 0, oweMinor: 148000 }],
    },
    groups: {
      maple: {
        id: 'maple',
        name: 'Maple House',
        theme: 'home',
        archived: true,
        mainCurrency: 'INR',
        verifiedAt: groupTime,
        balancesVerifiedAt: balanceTime,
        currencies: [
          {
            currency: 'INR',
            balanceMinor: -148000,
            payments: [
              {
                from: 'alex',
                to: 'sam',
                fromName: 'Alex',
                toName: 'Sam',
                fromInitials: 'AR',
                toInitials: 'SC',
                amountMinor: 148000,
              },
            ],
          },
        ],
      },
    },
  };
}

/** The same input distinction as the headless renderer: explicit refusal versus no saved part. */
async function drawn(store: ReturnType<typeof createWidgetsStore>) {
  const { copy, session } = await store.read();
  const part = copy?.lostGroupIds?.includes('maple') ? null : copy?.groups?.maple;
  return {
    balances: balancesWidget(
      copy,
      {
        kind: 'balances',
        reviewEnabled: process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true',
      },
      '2x2',
      session,
      drawTime,
    ),
    group: groupWidget(part, placedGroup, '4x2', session, drawTime),
    quick: quickWidget(copy, placedQuick, '2x1', session),
  };
}

it('draws the archived final balance and saved time after a partial write and a SQLite restart', async () => {
  const first = createWidgetsStore('development');
  await first.setSession(alexSession);
  await first.write(savedWidgetCopy());

  const restarted = createWidgetsStore('development');
  await restarted.write({
    version: 1,
    accountId: 'alex',
    home: savedWidgetCopy().home,
    groups: {},
  });

  const view = await drawn(createWidgetsStore('development'));
  expect(view.group).toMatchObject({
    state: 'archived',
    name: 'Maple House',
    balance: 'You owe ₹1,480.00\u00a0· final',
    saved: 'Saved 9:40',
    final: true,
    addExpense: false,
    description: 'Nothing more can be saved here.',
  });
  expect(view.quick).toMatchObject({
    state: 'archived',
    title: 'Group archived',
    subtitle: 'Choose another',
  });
});

it('does not resurrect a refused archived Group or its name after a SQLite restart', async () => {
  const first = createWidgetsStore('development');
  await first.setSession(alexSession);
  await first.write(savedWidgetCopy());

  await createWidgetsStore('development').write({
    version: 1,
    accountId: 'alex',
    home: savedWidgetCopy().home,
    groups: {},
    lostGroupIds: ['maple'],
  });

  const view = await drawn(createWidgetsStore('development'));
  expect(view.group).toMatchObject({
    state: 'lost-access',
    title: 'You’re no longer in this Group',
    name: null,
    balance: '',
    saved: null,
    payments: [],
    action: 'Choose another Group',
  });
  expect(view.quick).toMatchObject({
    state: 'lost-access',
    title: 'Not in this Group',
    subtitle: 'Choose a Group',
  });
  expect(JSON.stringify([view.group, view.quick])).not.toMatch(/Maple|Sam|1,480/);
});

it('draws no previous account’s final balance, people or To review count after the account changes in SQLite', async () => {
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
  try {
    const first = createWidgetsStore('development');
    await first.setSession(alexSession);
    await first.write({
      ...savedWidgetCopy(),
      review: { count: 3, verifiedAt: homeTime + 60_000 },
    });

    const restarted = createWidgetsStore('development');
    await restarted.write({
      version: 1,
      accountId: 'sam',
      groups: {},
      home: {
        verifiedAt: drawTime,
        groupCount: 1,
        currencies: [{ currency: 'INR', oweMinor: 0, owedMinor: 72500 }],
      },
    });
    await restarted.setSession({ status: 'authenticated', accountId: 'sam', loading: false });

    const view = await drawn(createWidgetsStore('development'));
    expect(view.balances).toMatchObject({
      state: 'normal',
      owed: ['₹725.00'],
      owe: [],
      review: null,
    });
    expect(view.group).toMatchObject({
      state: 'other-account',
      name: null,
      balance: '',
      payments: [],
    });
    expect(view.quick).toMatchObject({
      state: 'other-account',
      title: 'Set up again',
      subtitle: 'Another account',
    });
    // A new placement for Sam must not reveal a part merely hidden by Alex's old setup.
    const record = await createWidgetsStore('development').read();
    const samView = groupWidget(
      record.copy?.groups?.maple,
      { ...placedGroup, accountId: 'sam' },
      '4x2',
      record.session,
      drawTime,
    );
    expect(samView).toMatchObject({ state: 'no-copy', name: null, balance: '', payments: [] });
    expect(JSON.stringify([view, samView])).not.toMatch(/Maple|You pay Sam|1,480|To review/);
  } finally {
    vi.unstubAllEnvs();
  }
});

function holdCopyWrite() {
  let arrive!: () => void, release!: () => void, complete!: () => void;
  const arrived = new Promise<void>((done) => {
    arrive = done;
  });
  const waiting = new Promise<void>((done) => {
    release = done;
  });
  const completed = new Promise<void>((done) => {
    complete = done;
  });
  native.copyWrite = { arrive, waiting, complete };
  return { arrived, release, completed };
}

it('hides figures on a 401 before a SQLite copy write finishes, and keeps them for the same account', async () => {
  const server = fakeSplitbook();
  const accountId = server.world.people.alex.id;
  const groupId = server.world.groups[0]._id;
  const home = (amount: number) => ({
    buckets: [{ currency: 'INR', youOwe: amount, youAreOwed: 0, net: -amount }],
    groups: [{ groupId, name: 'Maple House', balances: [{ currency: 'INR', balance: -amount }] }],
  });
  server.world.home = home(1480);
  const environment = 'http://localhost:1170';
  const adapter = createWidgetsNative(environment);
  const store = createWidgetsStore(environment);
  const phone = testPhone(server, {
    origin: environment,
    now: homeTime,
    parts: { widgets: { ...adapter, redraw: async () => undefined } },
  });
  const controller = phone.open();
  let held: ReturnType<typeof holdCopyWrite> | undefined;
  try {
    await controller.signIn('alex');
    await vi.waitFor(async () =>
      expect((await drawn(store)).balances).toMatchObject({ state: 'normal', owe: ['₹1,480.00'] }),
    );
    held = holdCopyWrite();
    server.world.home = home(1550);
    phone.clock.now = balanceTime;
    await controller.refreshHome();
    await held.arrived;

    server.auth.expired = true;
    await controller.refreshHome();
    await vi.waitFor(async () =>
      expect((await drawn(store)).balances).toMatchObject({
        state: 'expired',
        title: 'Sign in again',
        owed: [],
        owe: [],
        saved: null,
        review: null,
      }),
    );

    held.release();
    await held.completed;
    // Let the suspended native write return through the account lease and saved-copy queue.
    await new Promise<void>((done) => setImmediate(done));
    expect((await drawn(createWidgetsStore(environment))).balances).toMatchObject({
      state: 'expired',
      title: 'Sign in again',
      owed: [],
      owe: [],
      saved: null,
      review: null,
    });
    // Only session admission changes: no new balance read or copy write can refill this draw.
    await createWidgetsStore(environment).setSession({
      status: 'authenticated',
      accountId,
      loading: false,
    });
    expect((await drawn(createWidgetsStore(environment))).balances).toMatchObject({
      state: 'normal',
      owe: ['₹1,550.00'],
      saved: 'Saved 9:42',
    });
  } finally {
    held?.release();
    phone.dispose();
  }
});
