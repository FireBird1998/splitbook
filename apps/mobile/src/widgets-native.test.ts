import { widgetPeople } from '@splitbook/shared/widget-people';
import { personWidget } from '@splitbook/shared/person-widget';
import { overviewAt } from './test-utils/overview-widget';
import { widgetDimensions } from './test-utils/widget-size';
import { afterEach, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';
import { groupWidget } from '@splitbook/shared/group-widget';
import { quickWidget } from '@splitbook/shared/quick-widget';
import { fakeSplitbook } from './test-utils/fake-splitbook';
import { testPhone } from './test-utils/test-phone';
import { expenseReceipt } from './test-utils/expense-receipt';

const native = vi.hoisted(() => ({
  databases: new Map<string, DatabaseSync>(),
  exists: true,
  failMigration: false,
  copyWrite: null as null | {
    when(value: string): boolean;
    arrive(): void;
    waiting: Promise<void>;
    complete(): void;
  },
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
        execAsync: async (sql: string) => {
          if (native.failMigration && sql.startsWith('BEGIN IMMEDIATE')) {
            native.failMigration = false;
            db.exec(
              'BEGIN IMMEDIATE; DROP TRIGGER IF EXISTS widget_recent_copy; SELECT * FROM missing_migration_table;',
            );
          }
          return db.exec(sql);
        },
        runAsync: async (sql: string, ...values: (string | number | null)[]) => {
          const held =
            sql.startsWith('UPDATE widget_state SET copy =') &&
            typeof values[0] === 'string' &&
            native.copyWrite?.when(values[0])
              ? native.copyWrite
              : null;
          if (held) {
            native.copyWrite = null;
            held.arrive();
            await held.waiting;
          }
          const result = db.prepare(sql).run(...values);
          held?.complete();
          return result;
        },
        withExclusiveTransactionAsync: async (
          task: (transaction: {
            runAsync(sql: string, ...values: (string | number | null)[]): Promise<unknown>;
          }) => Promise<void>,
        ) => {
          db.exec('BEGIN IMMEDIATE');
          try {
            await task({ runAsync: async (sql, ...values) => db.prepare(sql).run(...values) });
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        },
        getFirstAsync: async (sql: string, ...values: (string | number | null)[]) =>
          db.prepare(sql).get(...values),
        getAllAsync: async (sql: string, ...values: (string | number | null)[]) =>
          db.prepare(sql).all(...values),
      };
    },
  };
});
afterEach(() => {
  for (const db of native.databases.values()) db.close();
  native.databases.clear();
  native.failMigration = false;
  native.copyWrite = null;
  vi.unstubAllEnvs();
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
vi.mock('react-native-android-widget/src/api/get-widget-info', () => ({
  getWidgetInfo: async () => [],
}));

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
    balances: overviewAt(
      copy,
      {
        kind: 'balances',
        reviewEnabled: process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true',
      },
      '2x2',
      session,
      drawTime,
    ),
    group: groupWidget(part, placedGroup, widgetDimensions('4x2'), session, drawTime),
    quick: quickWidget(copy, placedQuick, { width: 172, height: 104 }, session),
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
      widgetDimensions('4x2'),
      record.session,
      drawTime,
    );
    expect(samView).toMatchObject({ state: 'no-copy', name: null, balance: '', payments: [] });
    expect(JSON.stringify([view, samView])).not.toMatch(/Maple|You pay Sam|1,480|To review/);
  } finally {
    vi.unstubAllEnvs();
  }
});

function holdCopyWrite(verifiedAt: number, predicate?: (copy: WidgetCopy) => boolean) {
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
  // Initial Group/list projections may still be queued. Hold the new verified Home read,
  // rather than an older copy whose redraw just became visible.
  native.copyWrite = {
    when: (value) =>
      predicate
        ? predicate(JSON.parse(value) as WidgetCopy)
        : (JSON.parse(value) as WidgetCopy).home?.verifiedAt === verifiedAt,
    arrive,
    waiting,
    complete,
  };
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
  let shown: Awaited<ReturnType<typeof drawn>>['balances'] | null = null;
  const redraw = async () => {
    shown = (await drawn(store)).balances;
  };
  const phone = testPhone(server, {
    origin: environment,
    now: homeTime,
    parts: { widgets: { ...adapter, redraw } },
  });
  const controller = phone.open();
  let held: ReturnType<typeof holdCopyWrite> | undefined;
  try {
    await controller.signIn('alex');
    await vi.waitFor(() => expect(shown).toMatchObject({ state: 'normal', owe: ['₹1,480.00'] }));
    held = holdCopyWrite(balanceTime);
    server.world.home = home(1550);
    phone.clock.now = balanceTime;
    await controller.refreshHome();
    await held.arrived;

    server.auth.expired = true;
    await controller.refreshHome();
    await vi.waitFor(() =>
      expect(shown).toMatchObject({
        state: 'expired',
        title: 'Sign in again',
        owed: [],
        owe: [],
        saved: null,
        review: null,
      }),
    );
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
    expect(shown).toMatchObject({ state: 'expired', owed: [], owe: [] });
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

async function verifiedReviewPhone() {
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
  const server = fakeSplitbook();
  const groupId = server.world.groups[0]._id;
  const accountId = server.world.people.alex.id;
  const items = [1, 2, 3].map((index) => ({
    draft: {
      id: `d${String(index).padStart(23, '0')}`,
      groupId,
      revision: 0,
      state: 'active',
      preparedBy: { kind: 'member' },
      changedBy: { kind: 'member' },
      createdAt: new Date(homeTime).toISOString(),
      updatedAt: new Date(homeTime).toISOString(),
      missingFields: [],
      values: {
        description: `Fictional review item ${index}`,
        amount: 10,
        currency: 'INR',
        date: '2026-11-13',
        tagId: 'c00000000000000000000001',
        splitMethod: 'equal',
        paidBy: [{ user: accountId, amount: 10 }],
        splitBetween: [{ user: accountId }],
      },
    },
    problems: [],
    duplicates: [],
  }));
  server.world.toReview = {
    total: 3,
    groups: [{ groupId, groupName: 'Maple House', currency: 'INR', count: 3, items }],
  };
  server.world.home = {
    buckets: [{ currency: 'INR', youOwe: 1480, youAreOwed: 0, net: -1480 }],
    groups: [{ groupId, name: 'Maple House', balances: [{ currency: 'INR', balance: -1480 }] }],
  };
  const environment = 'http://localhost:1170';
  const adapter = createWidgetsNative(environment);
  const phone = testPhone(server, {
    origin: environment,
    now: homeTime,
    parts: { widgets: { ...adapter, redraw: async () => undefined } },
  });
  const first = phone.open();
  await first.signIn('alex');
  await vi.waitFor(async () =>
    expect((await drawn(createWidgetsStore(environment))).balances).toMatchObject({
      state: 'normal',
      saved: 'Saved 9:41',
      review: 'To review\u00a0· 3',
    }),
  );
  // To review answers separately; refreshing it must not advance Home's saved time.
  phone.clock.now = new Date(2026, 10, 13, 9, 49).getTime();
  await first.refreshToReview();
  return { server, phone, environment, controller: first };
}

it('keeps the To review chip on a cold offline restart without a preceding live NetInfo change', async () => {
  const { server, phone, environment } = await verifiedReviewPhone();
  try {
    server.online = false;
    const restarted = phone.open();
    phone.clock.now = drawTime;
    await restarted.restore();
    expect(restarted.getSnapshot().auth.status).toBe('authenticated');
    await vi.waitFor(async () =>
      expect((await drawn(createWidgetsStore(environment))).balances).toMatchObject({
        state: 'normal',
        owe: ['₹1,480.00'],
        saved: 'Saved 9:41',
        review: 'To review\u00a0· 3',
      }),
    );
  } finally {
    phone.dispose();
  }
});

it('keeps the verified To review chip and original Home time when the app restarts offline after a live NetInfo change', async () => {
  const { phone, environment } = await verifiedReviewPhone();
  try {
    phone.connect(false);
    await new Promise<void>((done) => setImmediate(done));
    const restarted = phone.open();
    phone.clock.now = drawTime;
    await restarted.restore();
    expect(restarted.getSnapshot().auth.status).toBe('authenticated');
    await vi.waitFor(async () =>
      expect((await drawn(createWidgetsStore(environment))).balances).toMatchObject({
        state: 'normal',
        owe: ['₹1,480.00'],
        saved: 'Saved 9:41',
        review: 'To review\u00a0· 3',
      }),
    );
  } finally {
    phone.dispose();
    vi.unstubAllEnvs();
  }
});

it('replaces the saved To review count with a verified zero', async () => {
  const { server, phone, environment, controller } = await verifiedReviewPhone();
  try {
    server.world.toReview = { total: 0, groups: [] };
    phone.clock.now = drawTime;
    await controller.refreshToReview();
    await vi.waitFor(async () => {
      const store = createWidgetsStore(environment);
      expect((await store.read()).copy?.review).toEqual({ count: 0, verifiedAt: drawTime });
      expect((await drawn(store)).balances).toMatchObject({ review: null, saved: 'Saved 9:41' });
    });
  } finally {
    phone.dispose();
  }
});

it('hides a saved To review count when Drafts are off', async () => {
  const { phone, environment } = await verifiedReviewPhone();
  try {
    vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'false');
    expect((await drawn(createWidgetsStore(environment))).balances).toMatchObject({
      state: 'normal',
      review: null,
      owe: ['₹1,480.00'],
      saved: 'Saved 9:41',
    });
  } finally {
    phone.dispose();
  }
});

it('keeps the To review verification time separate from Home through a live offline restart', async () => {
  const { phone, environment } = await verifiedReviewPhone();
  try {
    const reviewTime = new Date(2026, 10, 13, 9, 49).getTime();
    const store = createWidgetsStore(environment);
    // The chip has no time label of its own; the public store read pins the retained metadata.
    await vi.waitFor(async () =>
      expect((await store.read()).copy?.review).toEqual({ count: 3, verifiedAt: reviewTime }),
    );
    phone.connect(false);
    await new Promise<void>((done) => setImmediate(done));
    const restarted = phone.open();
    phone.clock.now = drawTime;
    await restarted.restore();
    await vi.waitFor(async () => {
      expect((await store.read()).copy?.review).toEqual({ count: 3, verifiedAt: reviewTime });
      expect((await drawn(store)).balances).toMatchObject({
        review: 'To review\u00a0· 3',
        saved: 'Saved 9:41',
      });
    });
  } finally {
    phone.dispose();
  }
});

it('does not verify a zero when a refused Group is removed from the in-memory To review list', async () => {
  const { server, phone, environment, controller } = await verifiedReviewPhone();
  const groupId = server.world.groups[0]._id;
  server.fault('GET', '/api/user/to-review', 'offline');
  try {
    server.reply('GET', `/api/groups/${groupId}`, () =>
      Response.json({ error: 'Access denied', code: 'FORBIDDEN' }, { status: 403 }),
    );
    phone.clock.now = drawTime;
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().toReview.read.total).toBe(0);
    await new Promise<void>((done) => setImmediate(done));
    expect((await createWidgetsStore(environment).read()).copy?.review).toEqual({
      count: 3,
      verifiedAt: new Date(2026, 10, 13, 9, 49).getTime(),
    });
  } finally {
    phone.dispose();
  }
});

async function keepPhoneDraftOffline(f: Awaited<ReturnType<typeof verifiedReviewPhone>>) {
  const groupId = f.server.world.groups[0]._id;
  const tags = [
    {
      _id: 'c00000000000000000000001',
      name: 'Shared',
      isArchived: false,
      createdAt: new Date(homeTime).toISOString(),
    },
  ];
  Object.assign(f.server.world.groups[0], { tags });
  f.server.world.tags[groupId] = { canManage: true, tags };
  await f.controller.openExpense(groupId);
  await f.controller.updateExpenseDraft({
    description: 'Lunch kept on this phone',
    amount: '10',
    tagId: 'c00000000000000000000001',
  });
  f.phone.connect(false);
  await f.controller.keepExpenseAsSharedDraft();
  await vi.waitFor(() => expect(f.controller.toReviewModel().counts.onThisPhone).toBe(1));
}

async function keepPhoneDraft(f: Awaited<ReturnType<typeof verifiedReviewPhone>>) {
  await keepPhoneDraftOffline(f);
  f.phone.connect(true);
  await f.controller.refreshToReview();
  await vi.waitFor(() => expect(f.controller.toReviewModel().counts.total).toBe(4));
}

it('counts three verified server items and one Finish-later item on this phone in the widget and its destination', async () => {
  const f = await verifiedReviewPhone();
  try {
    await keepPhoneDraft(f);
    await vi.waitFor(async () =>
      expect((await drawn(createWidgetsStore(f.environment))).balances.review).toBe(
        'To review\u00a0· 4',
      ),
    );
    f.phone.connect(false);
    f.phone.clock.now = drawTime;
    await vi.waitFor(async () =>
      expect((await createWidgetsStore(f.environment).read()).copy?.review).toEqual({
        count: 4,
        verifiedAt: new Date(2026, 10, 13, 9, 49).getTime(),
      }),
    );
    f.phone.connect(true);
    await f.controller.openWidget('review');
    expect(f.controller.toReviewModel().items).toHaveLength(4);
    expect(f.controller.toReviewModel().counts.onThisPhone).toBe(1);
  } finally {
    f.phone.dispose();
  }
});

it('follows the app card after the member saves the on-phone Draft and To review answers again', async () => {
  const f = await verifiedReviewPhone();
  try {
    await keepPhoneDraft(f);
    await vi.waitFor(async () =>
      expect((await drawn(createWidgetsStore(f.environment))).balances.review).toBe(
        'To review\u00a0· 4',
      ),
    );
    const group = f.server.world.groups[0];
    f.server.reply('POST', `/api/groups/${group._id}/expenses`, ({ body }) =>
      Response.json(
        {
          status: 201,
          data: expenseReceipt(
            group,
            body,
            'b00000000000000000000099',
            f.server.world.people.alex.id,
          ),
        },
        { status: 201 },
      ),
    );
    await f.controller.openExpense(group._id);
    await f.controller.saveExpense();
    expect(f.controller.getSnapshot().expense.receiptId).not.toBeNull();
    await f.controller.refreshToReview();
    await vi.waitFor(() =>
      expect(f.controller.toReviewModel().counts).toMatchObject({ total: 3, onThisPhone: 0 }),
    );
    await vi.waitFor(async () =>
      expect((await drawn(createWidgetsStore(f.environment))).balances.review).toBe(
        'To review\u00a0· 3',
      ),
    );
  } finally {
    f.phone.dispose();
  }
});

it('shows one on-phone item beside a verified zero and keeps the server verification time', async () => {
  const f = await verifiedReviewPhone();
  try {
    await keepPhoneDraft(f);
    f.server.world.toReview = { total: 0, groups: [] };
    f.phone.clock.now = drawTime;
    await f.controller.refreshToReview();
    expect(f.controller.toReviewModel().counts).toMatchObject({ total: 1, onThisPhone: 1 });
    await vi.waitFor(async () => {
      const store = createWidgetsStore(f.environment);
      expect((await drawn(store)).balances.review).toBe('To review\u00a0· 1');
      expect((await store.read()).copy?.review).toEqual({ count: 1, verifiedAt: drawTime });
    });
    f.phone.connect(false);
    f.phone.clock.now = drawTime + 60_000;
    await f.controller.openExpense(f.server.world.groups[0]._id);
    await f.controller.discardExpenseDraft();
    await f.controller.closeExpense();
    await f.controller.refreshToReview();
    expect(f.controller.toReviewModel().counts.onThisPhone).toBe(0);
    await vi.waitFor(async () =>
      expect((await createWidgetsStore(f.environment).read()).copy?.review).toEqual({
        count: 0,
        verifiedAt: drawTime,
      }),
    );
  } finally {
    f.phone.dispose();
  }
});

it('counts an unconfirmed Expense save exactly as the app counts it on this phone', async () => {
  const f = await verifiedReviewPhone();
  try {
    await keepPhoneDraft(f);
    const groupId = f.server.world.groups[0]._id;
    await f.controller.openExpense(groupId);
    f.server.fault('POST', `/api/groups/${groupId}/expenses`, 'lost-reply');
    await f.controller.saveExpense();
    expect(f.controller.getSnapshot().expense.status).toBe('uncertain');
    await f.controller.refreshToReview();
    await vi.waitFor(() =>
      expect(f.controller.toReviewModel().counts).toMatchObject({ total: 4, onThisPhone: 1 }),
    );
    await vi.waitFor(async () =>
      expect((await drawn(createWidgetsStore(f.environment))).balances.review).toBe(
        'To review\u00a0· 4',
      ),
    );
  } finally {
    f.phone.dispose();
  }
});

it('never carries either part of the count to another account', async () => {
  const f = await verifiedReviewPhone();
  try {
    await keepPhoneDraft(f);
    await vi.waitFor(async () =>
      expect((await drawn(createWidgetsStore(f.environment))).balances.review).toBe(
        'To review\u00a0· 4',
      ),
    );
    await f.controller.signOut();
    f.server.world.toReview = { total: 0, groups: [] };
    await f.controller.signIn('sam');
    await f.controller.refreshToReview();
    expect(f.controller.toReviewModel().counts).toMatchObject({ total: 0, onThisPhone: 0 });
    await vi.waitFor(async () => {
      const store = createWidgetsStore(f.environment);
      expect((await store.read()).copy?.accountId).toBe(f.server.world.people.sam.id);
      expect((await drawn(store)).balances.review).toBeNull();
    });
  } finally {
    f.phone.dispose();
  }
});

it.each(['gain', 'lose'] as const)(
  'keeps the previous chip when a cold offline session has no verified server part and the phone will %s a Draft',
  async (change) => {
    const f = await verifiedReviewPhone();
    try {
      const groupId = f.server.world.groups[0]._id;
      if (change === 'lose') await keepPhoneDraft(f);
      else await f.controller.openGroup(groupId);
      const before = change === 'lose' ? 4 : 3;
      await vi.waitFor(async () =>
        expect((await drawn(createWidgetsStore(f.environment))).balances.review).toBe(
          `To review\u00a0· ${before}`,
        ),
      );
      await vi.waitFor(async () =>
        expect(
          await f.phone.stores.savedQueries.load(
            f.server.world.people.alex.id,
            `/api/groups/${groupId}`,
          ),
        ).not.toBeNull(),
      );
      f.phone.connect(false);
      const restarted = f.phone.open();
      await restarted.restore();
      if (change === 'gain') await keepPhoneDraftOffline({ ...f, controller: restarted });
      else {
        await restarted.openExpense(groupId);
        await restarted.discardExpenseDraft();
        await restarted.closeExpense();
        await restarted.refreshToReview();
      }
      await vi.waitFor(() =>
        expect(restarted.toReviewModel().counts.onThisPhone).toBe(change === 'gain' ? 1 : 0),
      );
      await new Promise<void>((done) => setImmediate(done));
      expect((await drawn(createWidgetsStore(f.environment))).balances.review).toBe(
        `To review\u00a0· ${before}`,
      );
      f.phone.connect(true);
      await restarted.refreshHome();
      await vi.waitFor(() => expect(restarted.getSnapshot().offline.active).toBe(false));
      await restarted.refreshToReview();
      const after = change === 'gain' ? 4 : 3;
      await vi.waitFor(() => expect(restarted.toReviewModel().counts.total).toBe(after));
      await vi.waitFor(async () =>
        expect((await drawn(createWidgetsStore(f.environment))).balances.review).toBe(
          `To review\u00a0· ${after}`,
        ),
      );
    } finally {
      f.phone.dispose();
    }
  },
);

it.each(['sign-out', '401'] as const)(
  'does not let a late To review answer after %s verify a count for the next session',
  async (ending) => {
    const f = await verifiedReviewPhone();
    const held = f.server.hold('GET', '/api/user/to-review');
    let next: ReturnType<typeof f.server.hold> | undefined;
    try {
      const pending = f.controller.refreshToReview();
      await held.arrived;
      if (ending === 'sign-out') await f.controller.signOut();
      else {
        f.server.auth.expired = true;
        await f.controller.refreshHome();
        f.server.auth.expired = false;
      }
      expect(f.controller.getSnapshot().auth.status).toBe('signed-out');
      f.server.world.toReview = { total: 0, groups: [] };
      next = f.server.hold('GET', '/api/user/to-review');
      await f.controller.signIn(ending === 'sign-out' ? 'alex' : 'sam');
      await next.arrived;
      held.release();
      await pending;
      await new Promise<void>((done) => setImmediate(done));
      // No new To review answer yet: the old response cannot seed this session's count.
      await vi.waitFor(async () =>
        expect((await createWidgetsStore(f.environment).read()).copy?.accountId).toBe(
          f.controller.getSnapshot().auth.user?.id,
        ),
      );
      expect((await createWidgetsStore(f.environment).read()).copy?.review).toBeUndefined();
      expect((await drawn(createWidgetsStore(f.environment))).balances.review).toBeNull();
      next.release();
      await f.controller.refreshToReview();
      await vi.waitFor(async () =>
        expect((await createWidgetsStore(f.environment).read()).copy?.review?.count).toBe(0),
      );
    } finally {
      held.release();
      next?.release();
      f.phone.dispose();
    }
  },
);

it('preserves an archived Group’s Month through query eviction and removes it on refusal or account change', async () => {
  const copy = savedWidgetCopy();
  copy.months = {
    maple: {
      month: '2026-11',
      verifiedAt: groupTime,
      count: 12,
      mainCurrency: 'INR',
      mainCurrencyOnly: false,
      totals: [{ currency: 'INR', totalMinor: 2354000 }],
      shareMinor: 785000,
    },
  };
  const store = createWidgetsStore('development');
  await store.write(copy);
  await store.write({ ...copy, groups: {}, months: {} });
  expect((await createWidgetsStore('development').read()).copy?.months).toEqual(copy.months);
  await store.write({
    version: 1,
    accountId: 'alex',
    home: null,
    groups: {},
    months: {},
    lostGroupIds: ['maple'],
  });
  expect((await store.read()).copy?.months).toEqual({});
  await store.write(copy);
  await store.write({ version: 1, accountId: 'sam', home: null, groups: {}, months: {} });
  expect((await store.read()).copy?.months).toEqual({});
  await store.clear();
  expect((await store.read()).copy).toBeNull();
});

it('retains Tags for every previously read Group across restarts, while fresh reads and refusals replace them', async () => {
  const first = createWidgetsStore('development');
  await first.write({
    version: 1,
    accountId: 'alex',
    home: null,
    tags: {
      maple: { verifiedAt: 1, rows: [{ id: 'rent', name: 'Rent' }] },
      trip: { verifiedAt: 1, rows: [{ id: 'taxi', name: 'Taxi' }] },
    },
  });
  const restarted = createWidgetsStore('development');
  await restarted.write({
    version: 1,
    accountId: 'alex',
    home: null,
    tags: { maple: { verifiedAt: 2, rows: [] } },
  });
  expect((await restarted.read()).copy?.tags).toEqual({
    maple: { verifiedAt: 2, rows: [] },
    trip: { verifiedAt: 1, rows: [{ id: 'taxi', name: 'Taxi' }] },
  });
  await restarted.write({
    version: 1,
    accountId: 'alex',
    home: null,
    tags: { maple: { verifiedAt: 1, rows: [{ id: 'rent', name: 'Rent' }] } },
  });
  expect((await restarted.read()).copy?.tags?.maple).toEqual({ verifiedAt: 2, rows: [] });
  await restarted.write({ version: 1, accountId: 'alex', home: null, lostGroupIds: ['trip'] });
  expect((await restarted.read()).copy?.tags).toEqual({ maple: { verifiedAt: 2, rows: [] } });
  await restarted.setSession({ status: 'expired' });
  expect((await restarted.read()).copy?.tags).toEqual({ maple: { verifiedAt: 2, rows: [] } });
  await restarted.write({ version: 1, accountId: 'sam', home: null });
  expect((await restarted.read()).copy?.tags).toBeUndefined();
  await restarted.clear();
  expect((await restarted.read()).copy).toBeNull();
});

it('reads duplicate stored Tag ids once, keeping chosen order across store instances', async () => {
  const store = createWidgetsStore('q5');
  await store.saveSetup({
    kind: 'quick',
    widgetId: 5,
    accountId: 'alex',
    groupId: 'maple',
    tagIds: ['a', 'a', 'b', 'c', 'b', 'd'],
  });
  expect(await createWidgetsStore('q5').setup(5)).toMatchObject({ tagIds: ['a', 'b', 'c', 'd'] });
});

const recentCopy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: null,
  recents: {
    maple: {
      verifiedAt: 1234,
      rows: [
        {
          id: 'lunch',
          kind: 'expense',
          description: 'Private beach lunch',
          payer: 'Meera',
          payerId: 'meera',
          amountMinor: 280000,
          currency: 'INR',
          date: '2026-11-14',
        },
      ],
    },
  },
};
const recentSetup = (widgetId: number, showRecentExpenses = true) => ({
  kind: 'group' as const,
  widgetId,
  accountId: 'alex',
  groupId: 'maple',
  showRecentExpenses,
});
const descriptionOnDisk = () =>
  JSON.stringify(
    native.databases.get('splitbook-widgets.db')!.prepare('SELECT copy FROM widget_state').all(),
  ).includes('Private beach lunch');

it('SQLite stores descriptions only for the setup account’s opt-in Groups', async () => {
  const store = createWidgetsStore('recent');
  await store.write(recentCopy);
  expect(descriptionOnDisk()).toBe(false);
  await store.saveSetup(recentSetup(7));
  await store.write(recentCopy);
  expect(descriptionOnDisk()).toBe(true);
  expect(await store.recentGroups('alex', [7])).toEqual(['maple']);
  expect(await store.recentGroups('alex', [])).toEqual([]);
  expect(await store.recentGroups('sam', [7])).toEqual([]);
  await store.write({ ...recentCopy, accountId: 'sam' });
  expect(descriptionOnDisk()).toBe(false);
});

it.each(['off', 'remove', 'reconcile'] as const)(
  'SQLite deletes descriptions when the last opt-in is gone through %s',
  async (operation) => {
    const store = createWidgetsStore('recent');
    await store.saveSetup(recentSetup(7));
    await store.saveSetup(recentSetup(8));
    await store.write(recentCopy);
    const remove = async (id: number) => {
      if (operation === 'off') await store.saveSetup(recentSetup(id, false));
      else if (operation === 'remove') await store.removeSetup(id);
      else await store.reconcileSetups(id === 7 ? [8] : []);
    };
    await remove(7);
    expect(descriptionOnDisk()).toBe(true);
    await remove(8);
    expect(descriptionOnDisk()).toBe(false);
    await store.write(recentCopy);
    expect(descriptionOnDisk()).toBe(false);
  },
);

it('SQLite consults the current preference when a delayed copy write completes', async () => {
  const store = createWidgetsStore('recent');
  await store.saveSetup(recentSetup(7));
  let arrive!: () => void, release!: () => void;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  native.copyWrite = {
    when: (value) => value.includes('Private beach lunch'),
    arrive,
    waiting,
    complete() {},
  };
  const writing = store.write(recentCopy);
  await arrived;
  await store.saveSetup(recentSetup(7, false));
  release();
  await writing;
  expect(descriptionOnDisk()).toBe(false);
});

it('SQLite retains descriptions for an expired session and deletes them with the account copy', async () => {
  const store = createWidgetsStore('recent');
  await store.saveSetup(recentSetup(7));
  await store.write(recentCopy);
  await store.setSession({ status: 'expired' });
  expect(descriptionOnDisk()).toBe(true);
  await store.clear();
  expect(descriptionOnDisk()).toBe(false);
  expect(await store.setup(7)).toMatchObject({ showRecentExpenses: true });
});

it('SQLite removes a Group’s descriptions from every widget copy when its read is refused', async () => {
  const store = createWidgetsStore('recent');
  await store.saveSetup(recentSetup(7));
  await store.write(recentCopy);
  expect(descriptionOnDisk()).toBe(true);
  await store.write({ ...recentCopy, lostGroupIds: ['maple'] });
  expect(descriptionOnDisk()).toBe(false);
});

it('reconfiguring a physical widget replaces an older build’s opt-in and purges its descriptions', async () => {
  const oldBuild = createWidgetsStore('old-api');
  const currentBuild = createWidgetsStore('new-api');
  await oldBuild.saveSetup(recentSetup(7));
  await oldBuild.write(recentCopy);
  expect(descriptionOnDisk()).toBe(true);
  await currentBuild.saveSetup(recentSetup(7, false));
  expect(descriptionOnDisk()).toBe(false);
  expect(await oldBuild.setup(7)).toBeNull();
  expect(await currentBuild.setup(7)).toMatchObject({ showRecentExpenses: false });
  await currentBuild.removeSetup(7);
  expect(await currentBuild.setup(7)).toBeNull();
});

it('an unreadable setup cannot authorize descriptions or block another widget’s valid preference', async () => {
  const store = createWidgetsStore('recent');
  await store.saveSetup(recentSetup(7));
  native.databases
    .get('splitbook-widgets.db')!
    .prepare('INSERT INTO widget_setup(environment,widget_id,setup) VALUES (?,?,?)')
    .run('recent', 8, '{unreadable');
  await store.write(recentCopy);
  expect(descriptionOnDisk()).toBe(true);
  expect(await store.recentGroups('alex', [7, 8])).toEqual(['maple']);
  await store.saveSetup(recentSetup(7, false));
  expect(descriptionOnDisk()).toBe(false);
});

it('replaces the unversioned Recent triggers on upgrade, then keeps versioned triggers on reopen', async () => {
  const store = createWidgetsStore('development');
  await store.saveSetup(recentSetup(7));
  await store.write(recentCopy);
  const db = native.databases.get('splitbook-widgets.db')!;
  db.exec(
    'DROP TRIGGER widget_recent_setup_removed; CREATE TRIGGER widget_recent_setup_removed AFTER DELETE ON widget_setup BEGIN SELECT 1; END; PRAGMA user_version = 0;',
  );
  const upgraded = createWidgetsStore('development');
  await upgraded.read();
  expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
  expect(
    db.prepare("SELECT sql FROM sqlite_master WHERE name = 'widget_recent_setup_removed'").get(),
  ).toMatchObject({ sql: expect.stringContaining('UPDATE widget_state') });
  await upgraded.removeSetup(7);
  expect((await upgraded.read()).copy?.recents).toEqual({});
  await createWidgetsStore('development').read();
  expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
});

it('rolls back a failed trigger migration and retries it on the next store open', async () => {
  const store = createWidgetsStore('development');
  await store.read();
  const db = native.databases.get('splitbook-widgets.db')!;
  db.exec('PRAGMA user_version = 0');
  native.failMigration = true;
  const upgrading = createWidgetsStore('development');
  await expect(upgrading.read()).rejects.toThrow('missing_migration_table');
  expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 });
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE name = 'widget_recent_copy'").get(),
  ).toBeDefined();
  await upgrading.read();
  expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
});

it.each(['sign-out', 'account-change'] as const)(
  'strips names from every stored Person setup before the signed-out redraw on %s',
  async (action) => {
    const server = fakeSplitbook();
    const accountId = server.world.people.alex.id;
    const store = createWidgetsStore('person-current');
    const other = createWidgetsStore('person-other');
    const signedOutRows: unknown[][] = [];
    const storedRows = () =>
      native.databases
        .get('splitbook-widgets.db')!
        .prepare('SELECT setup FROM widget_setup ORDER BY widget_id')
        .all()
        .map((row) => JSON.parse(String(row.setup)));
    const adapter = createWidgetsNative('person-current');
    const phone = testPhone(server, {
      now: homeTime,
      parts: {
        widgets: {
          ...adapter,
          redraw: async () => {
            if ((await store.read()).session.status === 'signed-out')
              signedOutRows.push(storedRows());
          },
        },
      },
    });
    try {
      const c = phone.open();
      await c.signIn('alex');
      await store.saveSetup({
        kind: 'person',
        widgetId: 81,
        accountId,
        person: { id: server.world.people.sam.id, firstName: 'Sam', initials: 'SC' },
        hideAmounts: true,
      });
      await other.setSession({
        status: 'authenticated',
        accountId: 'older-account',
        loading: false,
      });
      await other.saveSetup({
        kind: 'person',
        widgetId: 82,
        accountId: 'older-account',
        person: { id: 'priya', firstName: 'Priya', initials: 'PS' },
        hideAmounts: false,
      });
      expect(JSON.stringify(storedRows())).toMatch(/firstName.*Sam/);
      expect(JSON.stringify(storedRows())).toMatch(/firstName.*Priya/);
      signedOutRows.length = 0;
      if (action === 'sign-out') await c.signOut();
      else await c.signIn('sam');
      const expected = [
        {
          kind: 'person',
          widgetId: 81,
          accountId,
          person: { id: server.world.people.sam.id },
          hideAmounts: true,
        },
        {
          kind: 'person',
          widgetId: 82,
          accountId: 'older-account',
          person: { id: 'priya' },
          hideAmounts: false,
        },
      ];
      expect(storedRows()).toEqual(expected);
      expect(signedOutRows.length).toBeGreaterThan(0);
      for (const rows of signedOutRows) expect(rows).toEqual(expected);
    } finally {
      phone.dispose();
    }
  },
);

it('restores a stripped Person label from a trusted read after the same account signs in again', async () => {
  const server = fakeSplitbook(),
    environment = 'person-restored';
  const store = createWidgetsStore(environment);
  const adapter = createWidgetsNative(environment);
  const phone = testPhone(server, {
    now: homeTime,
    parts: { widgets: { ...adapter, redraw: async () => undefined } },
  });
  const setup = {
    kind: 'person' as const,
    widgetId: 83,
    accountId: server.world.people.alex.id,
    person: { id: server.world.people.sam.id, firstName: 'Sam', initials: 'SC' },
    hideAmounts: true,
  };
  try {
    const c = phone.open();
    await c.signIn('alex');
    await store.saveSetup(setup);
    await c.signOut();
    expect((await store.setup(83))?.kind).toBe('person');
    await c.signIn('alex');
    await c.openGroup(server.world.groups[0]._id);
    await vi.waitFor(async () => expect(await store.setup(83)).toEqual(setup));
  } finally {
    phone.dispose();
  }
});

it('cannot put a Person label back from a stale setup confirmation after the purge', async () => {
  const store = createWidgetsStore('person-late');
  const setup = {
    kind: 'person' as const,
    widgetId: 84,
    accountId: 'alex',
    person: { id: 'sam', firstName: 'Sam', initials: 'SC' },
    hideAmounts: true,
  };
  await store.setSession({ status: 'authenticated', accountId: 'alex', loading: false });
  await store.saveSetup(setup);
  await store.clear();
  await store.saveSetup(setup);
  expect(await store.setup(84)).toEqual({ ...setup, person: { id: 'sam' } });
});

it('keeps stored Person labels on a 401 while the widget reveals no person', async () => {
  const server = fakeSplitbook(),
    environment = 'person-expired';
  const store = createWidgetsStore(environment),
    adapter = createWidgetsNative(environment);
  const phone = testPhone(server, {
    now: homeTime,
    parts: { widgets: { ...adapter, redraw: async () => undefined } },
  });
  const setup = {
    kind: 'person' as const,
    widgetId: 85,
    accountId: server.world.people.alex.id,
    person: { id: server.world.people.sam.id, firstName: 'Sam', initials: 'SC' },
    hideAmounts: false,
  };
  try {
    const c = phone.open();
    await c.signIn('alex');
    await vi.waitFor(async () => expect((await store.read()).session.status).toBe('authenticated'));
    await store.saveSetup(setup);
    server.auth.expired = true;
    await c.refreshHome();
    await vi.waitFor(async () => expect((await store.read()).session.status).toBe('expired'));
    const row = native.databases
      .get('splitbook-widgets.db')!
      .prepare('SELECT setup FROM widget_setup WHERE widget_id = 85')
      .get()!;
    expect(JSON.parse(String(row.setup))).toEqual(setup);
    const { copy, session } = await store.read();
    expect(personWidget(copy, setup, { width: 360, height: 224 }, session, homeTime)).toMatchObject(
      { state: 'expired', name: null, initials: null, payments: [] },
    );
  } finally {
    phone.dispose();
  }
});

it('does not restore refused Person membership from the old saved list on an offline restart', async () => {
  const server = fakeSplitbook(),
    environment = 'person-refused';
  const groupId = server.world.groups[0]._id;
  server.world.home = {
    buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0, net: -30 }],
    groups: [{ groupId, balances: [{ currency: 'INR', balance: -30 }] }],
  };
  const store = createWidgetsStore(environment),
    adapter = createWidgetsNative(environment);
  let redraws = 0;
  const phone = testPhone(server, {
    now: homeTime,
    parts: {
      widgets: {
        ...adapter,
        redraw: async () => {
          redraws++;
        },
      },
    },
  });
  try {
    const first = phone.open();
    await first.signIn('alex');
    await vi.waitFor(async () =>
      expect(
        await phone.stores.savedQueries.load(server.world.people.alex.id, '/api/groups'),
      ).not.toBeNull(),
    );
    const savedList = await phone.stores.savedQueries.load(
      server.world.people.alex.id,
      '/api/groups',
    );
    await vi.waitFor(async () =>
      expect((await store.read()).copy?.home?.byGroup?.[groupId]).toEqual([
        { currency: 'INR', balanceMinor: -3000 },
      ]),
    );
    const savedHome = await phone.stores.savedQueries.load(
      server.world.people.alex.id,
      '/api/user/balances',
    );
    await first.openGroup(groupId);
    await vi.waitFor(async () =>
      expect((await store.read()).copy?.groupPeople?.[groupId]).toBeDefined(),
    );
    phone.clock.now = homeTime + 1000;
    server.reply('GET', `/api/groups/${groupId}`, () =>
      Response.json({ error: 'Not a member' }, { status: 403 }),
    );
    await first.back();
    server.reply('GET', '/api/groups', () => Response.json({ status: 200, data: [] }));
    server.reply('GET', '/api/user/balances', () =>
      Response.json({ error: 'Unavailable' }, { status: 500 }),
    );
    await first.refresh('pull');
    await vi.waitFor(async () =>
      expect((await store.read()).copy?.lostGroupIds).toContain(groupId),
    );
    first.dispose();
    // Surviving disk state when the process ends before a replacement list is saved.
    await phone.stores.savedQueries.save(server.world.people.alex.id, '/api/groups', savedList);
    await phone.stores.savedQueries.save(
      server.world.people.alex.id,
      '/api/user/balances',
      savedHome,
    );
    server.online = false;
    const restarted = phone.open();
    await restarted.restore();
    await vi.waitFor(async () =>
      expect((await store.read()).copy?.savedGroups?.rows.some((g) => g.id === groupId)).toBe(
        false,
      ),
    );
    expect((await store.read()).copy?.home).toBeNull();
    expect((await store.read()).copy?.groups?.[groupId]).toBeUndefined();
    expect((await store.read()).copy?.tags?.[groupId]).toBeUndefined();
    expect((await store.read()).copy?.lostGroupIds).toContain(groupId);
    expect((await store.read()).copy?.groupPeople?.[groupId]).toBeUndefined();
    expect(widgetPeople((await store.read()).copy, server.world.people.alex.id)).toEqual([]);
    const before = redraws;
    await phone.open().restore();
    await vi.waitFor(() => expect(redraws).toBeGreaterThan(before));
    expect((await store.read()).copy?.groupPeople?.[groupId]).toBeUndefined();
    expect((await store.read()).copy?.peopleRefusedAt?.[groupId]).toBe(homeTime + 1000);
    server.online = true;
    phone.clock.now = homeTime + 2000;
    server.reply('GET', `/api/groups/${groupId}`, () =>
      Response.json({ status: 200, data: server.world.groups[0] }),
    );
    const returning = phone.open();
    await returning.restore();
    await returning.openGroup(groupId, false);
    await vi.waitFor(async () =>
      expect((await store.read()).copy?.groupPeople?.[groupId]).toBeDefined(),
    );
    expect((await store.read()).copy?.peopleRefusedAt?.[groupId]).toBeUndefined();
  } finally {
    phone.dispose();
  }
});

it.each([
  ['Home', 'success'],
  ['Finish later', 'success'],
  ['Home', '500'],
  ['Finish later', '500'],
] as const)(
  'confirms an omitted Group held only by a cold native %s part (%s), retaining it until the answer',
  async (part, outcome) => {
    vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
    const server = fakeSplitbook(),
      environment = 'confirm-cold-' + part,
      accountId = server.world.people.alex.id,
      groupId = server.world.groups[0]._id;
    const store = createWidgetsStore(environment),
      adapter = createWidgetsNative(environment);
    const phone = testPhone(server, {
      now: homeTime,
      parts: { widgets: { ...adapter, redraw: async () => {} } },
    });
    let homeHold: ReturnType<typeof server.hold> | undefined,
      groupHold: ReturnType<typeof server.hold> | undefined;
    try {
      const first = phone.open();
      await first.signIn('alex');
      if (part === 'Finish later') {
        await first.openGroup(groupId);
        await first.openExpense(groupId);
        await first.updateExpenseDraft({ description: 'Unfinished groceries', amount: '123' });
        await first.closeExpense(true);
        await first.back();
      }
      first.dispose();
      await phone.stores.savedQueries.clear();
      const saved: WidgetCopy = {
        version: 1,
        accountId,
        home:
          part === 'Home'
            ? {
                verifiedAt: homeTime - 1000,
                groupCount: 1,
                byGroup: { [groupId]: [{ currency: 'INR', balanceMinor: -3000 }] },
                currencies: [{ currency: 'INR', owedMinor: 0, oweMinor: 3000 }],
              }
            : null,
        ...(part === 'Finish later' ? { finishLater: { groupId, groupName: 'Maple House' } } : {}),
      };
      await store.write(saved);
      server.reply('GET', '/api/groups', () => Response.json({ status: 200, data: [] }));
      if (outcome === '500')
        server.reply(
          'GET',
          `/api/groups/${groupId}`,
          () => Response.json({ error: 'Failed' }, { status: 500 }),
          { once: true },
        );
      homeHold = server.hold('GET', '/api/user/balances');
      groupHold = server.hold('GET', `/api/groups/${groupId}`);
      const start = server.requests.length,
        restarted = phone.open(),
        restoring = restarted.restore();
      await vi.waitFor(() =>
        expect(
          server.requests.slice(start).filter((r) => r.path === `/api/groups/${groupId}`),
        ).toHaveLength(1),
      );
      if (part === 'Home')
        expect((await store.read()).copy?.home?.byGroup?.[groupId]).toEqual([
          { currency: 'INR', balanceMinor: -3000 },
        ]);
      else expect((await store.read()).copy?.finishLater).toEqual(saved.finishLater);
      groupHold.release();
      homeHold.release();
      await restoring;
      if (outcome === '500') {
        await restarted.refresh('pull');
        await vi.waitFor(() =>
          expect(
            server.requests.slice(start).filter((r) => r.path === `/api/groups/${groupId}`),
          ).toHaveLength(2),
        );
      }
      if (part === 'Finish later')
        await vi.waitFor(async () =>
          expect((await store.read()).copy?.finishLater).toEqual(saved.finishLater),
        );
      expect((await store.read()).copy?.lostGroupIds).not.toContain(groupId);
    } finally {
      groupHold?.release();
      homeHold?.release();
      phone.dispose();
    }
  },
);

it.each([false, true])(
  'keeps archived=%s final figures while quarantining active parts and Tags on cold restore',
  async (archived) => {
    const server = fakeSplitbook(),
      environment = 'confirm-untrusted',
      accountId = server.world.people.alex.id,
      groupId = server.world.groups[0]._id;
    const tagId = 'e00000000000000000000001';
    server.reply('GET', `/api/groups/${groupId}`, () =>
      Response.json({
        status: 200,
        data: {
          ...server.world.groups[0],
          tags: [
            {
              _id: tagId,
              name: 'Groceries',
              isArchived: false,
              revision: 0,
              createdAt: new Date(homeTime).toISOString(),
            },
          ],
        },
      }),
    );
    const store = createWidgetsStore(environment),
      adapter = createWidgetsNative(environment);
    const phone = testPhone(server, {
      now: homeTime,
      parts: { widgets: { ...adapter, redraw: async () => {} } },
    });
    try {
      const first = phone.open();
      await first.signIn('alex');
      await first.openGroup(groupId);
      await vi.waitFor(async () =>
        expect((await store.read()).copy?.groups?.[groupId]).toBeDefined(),
      );
      expect((await store.read()).copy?.tags?.[groupId]).toBeDefined();
      if (archived) {
        const saved = (await store.read()).copy!;
        await store.write({
          ...saved,
          groups: { [groupId]: { ...saved.groups![groupId], archived: true } },
          months: {
            [groupId]: {
              month: '2026-11',
              verifiedAt: homeTime,
              count: 12,
              mainCurrency: 'INR',
              mainCurrencyOnly: true,
              totals: [{ currency: 'INR', totalMinor: 3000 }],
            },
          },
        });
      }

      const finalCopy = (await store.read()).copy!;
      await phone.stores.tagRequests.save(accountId, groupId, {
        command: {
          requestId: '00000000-0000-4000-8000-000000000001',
          intent: { action: 'rename', tagId, expectedRevision: 0, name: 'Meals' },
        },
      });
      first.dispose();
      server.online = false;
      phone.clock.now = homeTime + 1000;
      const restarted = phone.open();
      await restarted.restore();
      await vi.waitFor(async () =>
        expect((await store.read()).session.status).toBe('authenticated'),
      );
      await vi.waitFor(async () =>
        expect((await store.read()).copy?.tags?.[groupId]).toBeUndefined(),
      );
      const copy = (await store.read()).copy;
      if (archived) {
        expect(copy?.groups?.[groupId]).toEqual(finalCopy.groups![groupId]);
        expect(copy?.months?.[groupId]).toEqual(finalCopy.months![groupId]);
      } else {
        expect(copy?.groups?.[groupId]).toBeUndefined();
        expect(copy?.months?.[groupId]).toBeUndefined();
      }
      expect(await phone.stores.tagRequests.load(accountId, groupId)).not.toBeNull();
    } finally {
      phone.dispose();
    }
  },
);

it.each(['403', 'archived'] as const)(
  'never substitutes yesterday’s Home totals after a live replacement and %s eviction, including the next cold start',
  async (outcome) => {
    const server = fakeSplitbook(),
      environment = 'home-eviction-' + outcome,
      groupId = server.world.groups[0]._id,
      accountId = server.world.people.alex.id,
      store = createWidgetsStore(environment),
      adapter = createWidgetsNative(environment);
    const home = (amount: number) => ({
      buckets: [{ currency: 'INR', youOwe: amount, youAreOwed: 0, net: -amount }],
      groups: [{ groupId, name: 'Maple House', balances: [{ currency: 'INR', balance: -amount }] }],
    });
    server.world.home = home(30);
    const phone = testPhone(server, {
      now: homeTime,
      parts: { widgets: { ...adapter, redraw: async () => {} } },
    });
    let held: ReturnType<typeof server.hold> | undefined;
    try {
      const first = phone.open();
      await first.signIn('alex');
      await first.openGroup(groupId);
      await vi.waitFor(async () =>
        expect((await store.read()).copy?.home?.currencies).toEqual([
          { currency: 'INR', oweMinor: 3000, owedMinor: 0 },
        ]),
      );
      first.dispose();
      phone.clock.now = homeTime + 86_400_000;
      server.world.home = home(90);
      const restarted = phone.open();
      await restarted.restore();
      await vi.waitFor(async () =>
        expect((await store.read()).copy?.home).toMatchObject({
          verifiedAt: homeTime + 86_400_000,
          currencies: [{ currency: 'INR', oweMinor: 9000, owedMinor: 0 }],
        }),
      );
      server.reply('GET', '/api/groups', () => Response.json({ status: 200, data: [] }));
      server.reply('GET', `/api/groups/${groupId}`, () =>
        outcome === '403'
          ? Response.json({ error: 'Not a member' }, { status: 403 })
          : Response.json({ status: 200, data: { ...server.world.groups[0], isArchived: true } }),
      );
      held = server.hold('GET', '/api/user/balances');
      const refreshing = restarted.refresh('pull');
      await held.arrived;
      await vi.waitFor(async () => {
        const copy = (await store.read()).copy;
        if (outcome === '403') expect(copy?.lostGroupIds).toContain(groupId);
        else expect(copy?.groups?.[groupId]?.archived).toBe(true);
      });
      server.online = false;
      held.release('lost-reply');
      await refreshing;
      await vi.waitFor(async () => expect((await store.read()).copy?.home).toBeNull());
      restarted.dispose();
      const again = phone.open();
      await again.restore();
      await vi.waitFor(async () =>
        expect((await store.read()).session).toMatchObject({ status: 'authenticated', accountId }),
      );
      expect((await store.read()).copy?.home).toBeNull();
      expect((await drawn(store)).balances).toMatchObject({ owed: [], owe: [], saved: null });
    } finally {
      held?.release();
      phone.dispose();
    }
  },
);

it('keeps a cold offline Home with its original time only until the first live Home answer', async () => {
  const server = fakeSplitbook(),
    environment = 'initial-home',
    groupId = server.world.groups[0]._id;
  server.world.home = {
    buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0, net: -30 }],
    groups: [{ groupId, name: 'Maple House', balances: [{ currency: 'INR', balance: -30 }] }],
  };
  const store = createWidgetsStore(environment),
    adapter = createWidgetsNative(environment),
    phone = testPhone(server, {
      now: homeTime,
      parts: { widgets: { ...adapter, redraw: async () => {} } },
    });
  try {
    const first = phone.open();
    await first.signIn('alex');
    await vi.waitFor(async () =>
      expect((await store.read()).copy?.home?.verifiedAt).toBe(homeTime),
    );
    first.dispose();
    server.online = false;
    phone.clock.now = homeTime + 86_400_000;
    const restarted = phone.open();
    await restarted.restore();
    await vi.waitFor(async () =>
      expect((await store.read()).copy?.home).toMatchObject({
        verifiedAt: homeTime,
        currencies: [{ currency: 'INR', oweMinor: 3000, owedMinor: 0 }],
      }),
    );
    server.world.home = {
      buckets: [{ currency: 'INR', youOwe: 90, youAreOwed: 0, net: -90 }],
      groups: [{ groupId, name: 'Maple House', balances: [{ currency: 'INR', balance: -90 }] }],
    };
    server.online = true;
    await restarted.refresh('pull');
    await vi.waitFor(async () =>
      expect((await store.read()).copy?.home).toMatchObject({
        verifiedAt: homeTime + 86_400_000,
        currencies: [{ currency: 'INR', oweMinor: 9000, owedMinor: 0 }],
      }),
    );
  } finally {
    phone.dispose();
  }
});

it.each(['list', 'detail'] as const)(
  'keeps a refusal fenced when an old saved %s has a later wall clock after a clock correction',
  async (source) => {
    const server = fakeSplitbook(),
      environment = 'clock-fence-' + source,
      accountId = server.world.people.alex.id,
      groupId = server.world.groups[0]._id;
    const store = createWidgetsStore(environment),
      adapter = createWidgetsNative(environment),
      phone = testPhone(server, {
        now: homeTime + 1000,
        parts: { widgets: { ...adapter, redraw: async () => {} } },
      });
    try {
      const first = phone.open();
      await first.signIn('alex');
      await first.openGroup(groupId);
      await vi.waitFor(async () =>
        expect((await store.read()).copy?.groups?.[groupId]).toBeDefined(),
      );
      const list = await phone.stores.savedQueries.load(accountId, '/api/groups'),
        detail = await phone.stores.savedQueries.load(accountId, `/api/groups/${groupId}`),
        balances = await phone.stores.savedQueries.load(
          accountId,
          `/api/groups/${groupId}/balances`,
        );
      phone.clock.now = homeTime;
      server.reply('GET', `/api/groups/${groupId}`, () =>
        Response.json({ error: 'Not a member' }, { status: 403 }),
      );
      await first.openGroup(groupId, false);
      await vi.waitFor(async () =>
        expect((await store.read()).copy?.peopleRefusedAt?.[groupId]).toBe(homeTime),
      );
      first.dispose();
      await phone.stores.savedQueries.clear();
      if (source === 'list') await phone.stores.savedQueries.save(accountId, '/api/groups', list);
      else {
        await phone.stores.savedQueries.save(accountId, `/api/groups/${groupId}`, detail);
        await phone.stores.savedQueries.save(
          accountId,
          `/api/groups/${groupId}/balances`,
          balances,
        );
      }
      phone.clock.now = homeTime + 2000;
      server.online = false;
      const restarted = phone.open();
      await restarted.restore();
      await vi.waitFor(async () =>
        expect((await store.read()).session.status).toBe('authenticated'),
      );
      // Drain any saved-only projection through another command before inspecting the stored rows.
      await restarted.refresh('pull');
      const copy = (await store.read()).copy;
      expect(copy?.lostGroupIds).toContain(groupId);
      expect(copy?.peopleRefusedAt?.[groupId]).toBe(homeTime);
      expect(copy?.groups?.[groupId]).toBeUndefined();
      expect(copy?.groupPeople?.[groupId]).toBeUndefined();
      expect(copy?.tags?.[groupId]).toBeUndefined();
      server.online = true;
      phone.clock.now = homeTime + 3000;
      server.reply('GET', `/api/groups/${groupId}`, () =>
        Response.json({ status: 200, data: server.world.groups[0] }),
      );
      await restarted.openGroup(groupId, false);
      await vi.waitFor(async () =>
        expect((await store.read()).copy?.groupPeople?.[groupId]).toBeDefined(),
      );
      expect((await store.read()).copy?.peopleRefusedAt?.[groupId]).toBeUndefined();
    } finally {
      phone.dispose();
    }
  },
);

it('withholds a legacy Home whose refused Group was filtered out of byGroup while its money remained', async () => {
  const server = fakeSplitbook(),
    environment = 'legacy-filtered-home',
    accountId = server.world.people.alex.id,
    groupId = server.world.groups[0]._id,
    store = createWidgetsStore(environment),
    adapter = createWidgetsNative(environment),
    phone = testPhone(server, {
      now: homeTime + 2000,
      parts: { widgets: { ...adapter, redraw: async () => {} } },
    });
  try {
    const first = phone.open();
    await first.signIn('alex');
    first.dispose();
    await phone.stores.savedQueries.clear();
    await store.write({
      version: 1,
      accountId,
      lostGroupIds: [groupId],
      peopleRefusedAt: { [groupId]: homeTime },
      savedGroups: {
        verifiedAt: homeTime + 1000,
        rows: [
          {
            id: groupId,
            name: 'Maple House',
            theme: 'home',
            archived: false,
            members: 3,
            currencies: 1,
          },
        ],
      },
      home: {
        verifiedAt: homeTime + 1000,
        groupCount: 1,
        byGroup: {},
        currencies: [{ currency: 'INR', owedMinor: 0, oweMinor: 3000 }],
      },
    });
    server.online = false;
    const restarted = phone.open();
    await restarted.restore();
    await restarted.refresh('pull');
    await vi.waitFor(async () => expect((await store.read()).copy?.home).toBeNull());
    expect((await store.read()).copy?.savedGroups?.rows).toEqual([]);
  } finally {
    phone.dispose();
  }
});

it.each(['Group', 'list'] as const)(
  'does not revalidate old parts or Home when a live %s regains access during native restoration',
  async (via) => {
    const server = fakeSplitbook(),
      environment = 'regained-before-native',
      accountId = server.world.people.alex.id,
      groupId = server.world.groups[0]._id,
      store = createWidgetsStore(environment),
      adapter = createWidgetsNative(environment);
    let blocking = false,
      arrived!: () => void,
      release!: () => void;
    const reached = new Promise<void>((r) => {
        arrived = r;
      }),
      waiting = new Promise<void>((r) => {
        release = r;
      });
    const phone = testPhone(server, {
      now: homeTime + 2000,
      parts: {
        widgets: {
          ...adapter,
          redraw: async () => {},
          readCopy: async () => {
            const copy = await adapter.readCopy!();
            if (blocking) {
              blocking = false;
              arrived();
              await waiting;
            }
            return copy;
          },
        },
      },
    });
    let held: ReturnType<typeof server.hold> | undefined, restoring: Promise<void> | undefined;
    try {
      const first = phone.open();
      await first.signIn('alex');
      await first.openGroup(groupId);
      first.dispose();
      await store.write({
        version: 1,
        accountId,
        lostGroupIds: [groupId],
        peopleRefusedAt: { [groupId]: homeTime + 1000 },
        home: {
          verifiedAt: homeTime,
          groupCount: 1,
          byGroup: { [groupId]: [{ currency: 'INR', balanceMinor: -3000 }] },
          currencies: [{ currency: 'INR', oweMinor: 3000, owedMinor: 0 }],
        },
      });
      await phone.stores.savedQueries.save(accountId, '/api/user/balances', {
        version: 1,
        accountId,
        path: '/api/user/balances',
        groupId: null,
        refreshedAt: homeTime,
        value: {
          status: 200,
          data: {
            buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0, net: -30 }],
            groups: [{ groupId, balances: [{ currency: 'INR', balance: -30 }] }],
          },
        },
      });
      blocking = true;
      held = server.hold('GET', '/api/user/balances');
      const restarted = phone.open();
      restoring = restarted.restore();
      await reached;
      if (via === 'Group') await restarted.openGroup(groupId, false);
      else await vi.waitFor(() => expect(restarted.getSnapshot().groups.status).toBe('ready'));
      release();
      await vi.waitFor(async () =>
        expect((await store.read()).copy?.groupPeople?.[groupId]).toBeDefined(),
      );
      expect((await store.read()).copy?.peopleRefusedAt?.[groupId]).toBeUndefined();
      if (via === 'list') expect((await store.read()).copy?.groups?.[groupId]).toBeUndefined();
      expect((await store.read()).copy?.home).toBeNull();
      restarted.dispose();
      server.online = false;
      held.release('lost-reply');
      held = undefined;
      await restoring;
      restoring = undefined;
      const again = phone.open();
      await again.restore();
      await again.refresh('pull');
      expect((await store.read()).copy?.home).toBeNull();
    } finally {
      release();
      held?.release('lost-reply');
      await restoring;
      phone.dispose();
    }
  },
);

it.each(['403', 'archived'] as const)(
  'keeps the %s eviction across a process end while an already admitted SQLite copy write finishes late',
  async (outcome) => {
    const server = fakeSplitbook(),
      environment = 'late-sql-' + outcome,
      groupId = server.world.groups[0]._id,
      store = createWidgetsStore(environment),
      adapter = createWidgetsNative(environment),
      phone = testPhone(server, {
        now: homeTime,
        parts: { widgets: { ...adapter, redraw: async () => {} } },
      });
    server.world.home = {
      buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0, net: -30 }],
      groups: [{ groupId, balances: [{ currency: 'INR', balance: -30 }] }],
    };
    let held: ReturnType<typeof holdCopyWrite> | undefined;
    try {
      const first = phone.open();
      await first.signIn('alex');
      await first.openGroup(groupId);
      await vi.waitFor(async () =>
        expect((await store.read()).copy?.groups?.[groupId]).toBeDefined(),
      );
      const original = (await store.read()).copy!.groups![groupId];
      phone.clock.now = balanceTime;
      held = holdCopyWrite(balanceTime);
      const refreshing = first.refreshHome();
      await held.arrived;
      server.reply('GET', `/api/groups/${groupId}`, () =>
        outcome === '403'
          ? Response.json({ error: 'Not a member' }, { status: 403 })
          : Response.json({ status: 200, data: { ...server.world.groups[0], isArchived: true } }),
      );
      await first.openGroup(groupId, false);
      expect(first.getSnapshot().detail.status).toBe('denied');
      first.dispose();
      held.release();
      await held.completed;
      await refreshing;
      const after = (await store.read()).copy;
      if (outcome === '403') {
        expect(after?.lostGroupIds).toContain(groupId);
        expect(after?.groups?.[groupId]).toBeUndefined();
        expect(after?.groupPeople?.[groupId]).toBeUndefined();
      } else expect(after?.groups?.[groupId]).toEqual({ ...original, archived: true });
      expect(after?.home).toBeNull();
      server.online = false;
      const restarted = phone.open();
      await restarted.restore();
      const copy = (await store.read()).copy;
      if (outcome === '403') {
        expect(copy?.lostGroupIds).toContain(groupId);
        expect(copy?.groups?.[groupId]).toBeUndefined();
      } else expect(copy?.groups?.[groupId]).toEqual({ ...original, archived: true });
      expect(copy?.home).toBeNull();
    } finally {
      held?.release();
      phone.dispose();
    }
  },
);

it.each(['sign-out', 'account-change'] as const)(
  'purges an in-flight durable widget eviction before %s completes',
  async (action) => {
    const server = fakeSplitbook(),
      environment = 'pending-eviction-' + action,
      groupId = server.world.groups[0]._id,
      store = createWidgetsStore(environment),
      adapter = createWidgetsNative(environment);
    let arrive!: () => void, release!: () => void;
    const arrived = new Promise<void>((r) => {
        arrive = r;
      }),
      waiting = new Promise<void>((r) => {
        release = r;
      });
    const phone = testPhone(server, {
      now: homeTime,
      parts: {
        widgets: {
          ...adapter,
          redraw: async () => {},
          evictGroup: async (account, id, eviction) => {
            arrive();
            await waiting;
            await adapter.evictGroup!(account, id, eviction);
          },
        },
      },
    });
    try {
      const c = phone.open();
      await c.signIn('alex');
      await c.openGroup(groupId);
      await vi.waitFor(async () =>
        expect((await store.read()).copy?.groups?.[groupId]).toBeDefined(),
      );
      server.reply(
        'GET',
        `/api/groups/${groupId}`,
        () => Response.json({ error: 'Not a member' }, { status: 403 }),
        { once: true },
      );
      const refusing = c.openGroup(groupId, false);
      await arrived;
      const changing = action === 'sign-out' ? c.signOut() : c.signIn('sam');
      // Allow every other purge operation to finish while this native operation is still held.
      await vi.waitFor(() => expect(c.getSnapshot().auth.status).not.toBe('authenticated'));
      await new Promise((r) => setTimeout(r, 10));
      release();
      await Promise.all([refusing, changing]);
      const rows = native.databases
        .get('splitbook-widgets.db')!
        .prepare('SELECT COUNT(*) AS count FROM widget_group_evictions WHERE environment = ?')
        .get(environment) as { count: number };
      expect(rows.count).toBe(0);
      if (action === 'sign-out') expect((await store.read()).copy).toBeNull();
      else expect((await store.read()).copy?.accountId).toBe(server.world.people.sam.id);
    } finally {
      release();
      phone.dispose();
    }
  },
);

it('admits a new live Home after eviction and preserves that exact read on the next offline start', async () => {
  const server = fakeSplitbook(),
    environment = 'home-after-eviction',
    accountId = server.world.people.alex.id,
    groupId = server.world.groups[0]._id,
    other = { ...server.world.groups[0], _id: 'b00000000000000000000009', name: 'Cabin Weekend' };
  server.world.groups.push(other);
  server.world.home = {
    buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0, net: -30 }],
    groups: [{ groupId, balances: [{ currency: 'INR', balance: -30 }] }],
  };
  const store = createWidgetsStore(environment),
    adapter = createWidgetsNative(environment),
    phone = testPhone(server, {
      now: homeTime,
      parts: { widgets: { ...adapter, redraw: async () => {} } },
    });
  try {
    const first = phone.open();
    await first.signIn('alex');
    await first.openGroup(groupId);
    phone.clock.now = homeTime + 1000;
    server.reply('GET', `/api/groups/${groupId}`, () =>
      Response.json({ error: 'Not a member' }, { status: 403 }),
    );
    await first.openGroup(groupId, false);
    await vi.waitFor(async () =>
      expect((await store.read()).copy?.lostGroupIds).toContain(groupId),
    );
    server.world.groupsByAccount[accountId] = [other];
    server.world.home = {
      buckets: [{ currency: 'INR', youOwe: 20, youAreOwed: 0, net: -20 }],
      groups: [{ groupId: other._id, balances: [{ currency: 'INR', balance: -20 }] }],
    };
    await first.back();
    await first.refresh('pull');
    await vi.waitFor(async () =>
      expect((await store.read()).copy?.home).toMatchObject({
        verifiedAt: homeTime + 1000,
        currencies: [{ currency: 'INR', oweMinor: 2000, owedMinor: 0 }],
        byGroup: { [other._id]: [{ currency: 'INR', balanceMinor: -2000 }] },
      }),
    );
    first.dispose();
    server.online = false;
    phone.clock.now = homeTime + 2000;
    const restarted = phone.open();
    await restarted.restore();
    await restarted.refresh('pull');
    expect((await store.read()).copy?.home).toMatchObject({
      verifiedAt: homeTime + 1000,
      currencies: [{ currency: 'INR', oweMinor: 2000, owedMinor: 0 }],
    });
    expect((await store.read()).copy?.lostGroupIds).toContain(groupId);
  } finally {
    phone.dispose();
  }
});

it.each(['re-added', 'spurious', 'unarchived', 'clock-back', 'unarchived-clock-back'] as const)(
  'releases %s membership and live Home from a live list without opening the Group',
  async (trigger) => {
    const server = fakeSplitbook(),
      environment = 'release-' + trigger,
      groupId = server.world.groups[0]._id,
      accountId = server.world.people.alex.id,
      store = createWidgetsStore(environment),
      adapter = createWidgetsNative(environment),
      phone = testPhone(server, {
        now: homeTime,
        parts: { widgets: { ...adapter, redraw: async () => {} } },
      });
    try {
      const tagId = 'e00000000000000000000001';
      Object.assign(server.world.groups[0], {
        tags: [
          {
            _id: tagId,
            name: 'Old',
            createdAt: new Date(homeTime).toISOString(),
            isArchived: false,
          },
        ],
      });
      const c = phone.open();
      await c.signIn('alex');
      await c.openGroup(groupId);
      server.reply(
        'GET',
        `/api/groups/${groupId}`,
        () =>
          trigger.startsWith('unarchived')
            ? Response.json({ status: 200, data: { ...server.world.groups[0], isArchived: true } })
            : Response.json({ error: 'Not a member' }, { status: 403 }),
        { once: true },
      );
      phone.clock.now = homeTime + 1000;
      await c.openGroup(groupId, false);
      await vi.waitFor(async () => expect((await store.read()).copy?.home).toBeNull());
      Object.assign(server.world.groups[0], {
        tags: [
          {
            _id: tagId,
            name: 'New',
            createdAt: new Date(homeTime).toISOString(),
            isArchived: false,
          },
        ],
      });
      server.world.home = {
        buckets: [{ currency: 'INR', youOwe: 42, youAreOwed: 0, net: -42 }],
        groups: [{ groupId, balances: [{ currency: 'INR', balance: -42 }] }],
      };
      phone.clock.now = trigger.endsWith('clock-back') ? homeTime - 86400000 : homeTime + 2000;
      const start = server.requests.length;
      await c.back();
      await c.refresh('pull');
      await vi.waitFor(async () => {
        const copy = (await store.read()).copy;
        expect(copy?.home?.currencies).toEqual([{ currency: 'INR', oweMinor: 4200, owedMinor: 0 }]);
        expect(copy?.tags?.[groupId]?.rows).toEqual([{ id: tagId, name: 'New' }]);
        expect(copy?.lostGroupIds).not.toContain(groupId);
        if (trigger.startsWith('unarchived')) expect(copy?.groups?.[groupId]).toBeUndefined();
        expect(copy?.savedGroups?.rows.find((g) => g.id === groupId)?.archived).toBe(false);
      });
      expect(
        server.requests.slice(start).filter((r) => r.path === `/api/groups/${groupId}`),
      ).toHaveLength(0);
      expect((await store.read()).copy?.accountId).toBe(accountId);
    } finally {
      phone.dispose();
    }
  },
);

it('does not let a delayed eviction overwrite a newer ordinary copy', async () => {
  const store = createWidgetsStore('eviction-interleave'),
    id = 'maple';
  await store.write({
    version: 1,
    accountId: 'alex',
    home: {
      verifiedAt: homeTime,
      groupCount: 1,
      currencies: [{ currency: 'INR', oweMinor: 3000, owedMinor: 0 }],
    },
  });
  const held = holdCopyWrite(
    homeTime,
    (copy) => copy.home === null && !!copy.lostGroupIds?.includes(id),
  );
  const evicting = store.evictGroup('alex', id, { kind: 'lost', at: homeTime + 1000 });
  try {
    await Promise.race([held.arrived, evicting]);
    await store.write(
      {
        version: 1,
        accountId: 'alex',
        home: {
          verifiedAt: homeTime + 2000,
          groupCount: 1,
          currencies: [{ currency: 'INR', oweMinor: 2000, owedMinor: 0 }],
        },
        review: { verifiedAt: homeTime + 2000, count: 7 },
      },
      { homeVerified: true },
    );
    held.release();
    await evicting;
    expect((await store.read()).copy?.home?.currencies).toEqual([
      { currency: 'INR', oweMinor: 2000, owedMinor: 0 },
    ]);
    expect((await store.read()).copy?.review?.count).toBe(7);
  } finally {
    held.release();
  }
});
