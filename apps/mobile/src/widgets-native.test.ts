import { widgetDimensions } from './test-utils/widget-size';
import { afterEach, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';
import { balancesWidget } from '@splitbook/shared/balances-widget';
import { groupWidget } from '@splitbook/shared/group-widget';
import { quickWidget } from '@splitbook/shared/quick-widget';
import { fakeSplitbook } from './test-utils/fake-splitbook';
import { testPhone } from './test-utils/test-phone';
import { expenseReceipt } from './test-utils/expense-receipt';

const native = vi.hoisted(() => ({
  databases: new Map<string, DatabaseSync>(),
  exists: true,
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
        execAsync: async (sql: string) => db.exec(sql),
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
    group: groupWidget(part, placedGroup, widgetDimensions('4x2'), session, drawTime),
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

function holdCopyWrite(verifiedAt: number) {
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
    when: (value) => (JSON.parse(value) as WidgetCopy).home?.verifiedAt === verifiedAt,
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
