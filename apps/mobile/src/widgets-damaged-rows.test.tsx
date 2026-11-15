import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildWidgetTree,
  type WidgetTree,
} from 'react-native-android-widget/src/api/build-widget-tree';
import type { WidgetInfo, WidgetRepresentation } from 'react-native-android-widget/src/api/types';
import type { WidgetTaskHandler } from 'react-native-android-widget/src/api/register-widget-task-handler';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';
import type { WidgetSetupRecord } from '@splitbook/shared/widget-setup';

const native = vi.hoisted(() => {
  vi.stubGlobal('__DEV__', true);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  return {
    databases: new Map<string, DatabaseSync>(),
    handler: null as WidgetTaskHandler | null,
    info: vi.fn<() => Promise<WidgetInfo[]>>(async () => []),
    request: vi.fn(() => {
      throw new Error('Widgets and setup must not fetch');
    }),
  };
});
// As in widgets-native.test.ts: real SQLite, with only Expo's async bridge replaced.
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
        runAsync: async (sql: string, ...values: (string | number | null)[]) =>
          db.prepare(sql).run(...values),
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
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo/fetch', () => ({ fetch: native.request }));
vi.mock('expo-font', () => ({ useFonts: () => [true] }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('@expo-google-fonts/outfit/400Regular', () => ({ Outfit_400Regular: 1 }));
vi.mock('@expo-google-fonts/outfit/700Bold', () => ({ Outfit_700Bold: 2 }));
vi.mock('react-native-android-widget/src/api/register-widget-task-handler', () => ({
  registerWidgetTaskHandler: (handler: WidgetTaskHandler) => {
    native.handler = handler;
  },
}));
vi.mock('react-native-android-widget/src/api/get-widget-info', () => ({
  getWidgetInfo: native.info,
}));
vi.mock('react-native-android-widget/src/api/request-widget-update-by-id', () => ({
  requestWidgetUpdateById: vi.fn(),
}));

import { createWidgetsStore } from './widgets-native';
import { mobileBuildSettings, widgetKey } from './config';
import { registerAndroidWidgets } from './widgets';
import { WidgetSetup } from './widget-setup';

const environment = widgetKey(mobileBuildSettings, true);
const now = Date.parse('2026-11-15T06:30:00Z');
const kinds = ['Balances', 'Group', 'Quick', 'Person'] as const;
type Kind = (typeof kinds)[number];
type Damage = (typeof observations)[number][1] | 'intact';
const phones = ['same account', 'signed out', 'other account'] as const;
type Phone = (typeof phones)[number];
const alex = { status: 'authenticated', accountId: 'alex', loading: false } satisfies WidgetSession;
const copy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: {
    verifiedAt: now,
    groupCount: 1,
    byGroup: { maple: [{ currency: 'INR', balanceMinor: -148000 }] },
    currencies: [{ currency: 'INR', owedMinor: 0, oweMinor: 148000 }],
  },
  savedGroups: {
    verifiedAt: now,
    rows: [
      {
        id: 'maple',
        name: 'Maple House',
        theme: 'home',
        archived: false,
        members: 2,
        currencies: 1,
      },
    ],
  },
  groups: {
    maple: {
      id: 'maple',
      name: 'Maple House',
      theme: 'home',
      archived: false,
      mainCurrency: 'INR',
      verifiedAt: now,
      balancesVerifiedAt: now,
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
  groupPeople: {
    maple: {
      name: 'Maple House',
      archived: false,
      verifiedAt: now,
      people: [
        { id: 'alex', firstName: 'Alex', initials: 'AR' },
        { id: 'sam', firstName: 'Sam', initials: 'SC' },
      ],
    },
  },
};
function setupFor(kind: Kind): WidgetSetupRecord {
  switch (kind) {
    case 'Balances':
      return { kind: 'balances', widgetId: 7, hideAmounts: false };
    case 'Group':
      return {
        kind: 'group',
        widgetId: 7,
        accountId: 'alex',
        groupId: 'maple',
        hideAmounts: false,
      };
    case 'Quick':
      return { kind: 'quick', widgetId: 7, accountId: 'alex', groupId: 'maple' };
    case 'Person':
      return {
        kind: 'person',
        widgetId: 7,
        accountId: 'alex',
        person: { id: 'sam', firstName: 'Sam', initials: 'SC' },
        hideAmounts: false,
      };
  }
}
function sessionFor(phone: Phone): WidgetSession {
  return phone === 'signed out'
    ? { status: 'signed-out' }
    : { ...alex, accountId: phone === 'other account' ? 'priya' : 'alex' };
}
function damaged(row: 'session' | 'setup', damage: Damage, kind: Kind, phone: Phone) {
  if (damage === 'invalid JSON') return '{unreadable';
  if (damage === 'empty string') return '';
  if (damage === 'JSON null') return 'null';
  if (damage === 'missing required fields')
    return JSON.stringify(
      row === 'session' ? { status: 'authenticated' } : { kind: setupFor(kind).kind },
    );
  if (damage === 'wrong loading type') return JSON.stringify({ ...alex, loading: 'false' });
  if (damage === 'wrong widget id') return JSON.stringify({ ...setupFor(kind), widgetId: 8 });
  const value = row === 'session' ? sessionFor(phone) : setupFor(kind);
  if (damage === 'intact') return JSON.stringify(value);
  if (damage === 'unknown version') return JSON.stringify({ ...value, version: 99 });
  return JSON.stringify(
    row === 'session'
      ? { status: 'authenticated', accountId: 42, loading: 'false' }
      : {
          ...value,
          ...(kind === 'Balances'
            ? { hideAmounts: 'true' }
            : kind === 'Person'
              ? { person: null }
              : { groupId: 42 }),
        },
  );
}
const infoFor = (kind: Kind): WidgetInfo => ({
  widgetId: 7,
  widgetName: kind,
  width: 360,
  height: 464,
  screenInfo: {
    screenHeightDp: 914,
    screenWidthDp: 411,
    density: 1,
    densityDpi: 160,
    fontScale: 1,
  },
});
const texts = (node: WidgetTree): string[] => [
  ...((node.props as { text?: string }).text ? [(node.props as { text: string }).text] : []),
  ...(node.children ?? []).flatMap(texts),
];
const spoken = (node: WidgetTree): string[] => [
  ...((node.props as { accessibilityLabel?: string }).accessibilityLabel
    ? [(node.props as { accessibilityLabel: string }).accessibilityLabel]
    : []),
  ...(node.children ?? []).flatMap(spoken),
];
const screenText = (root: ReactTestInstance) =>
  root
    .findAll((n) => (n.type as unknown) === 'Text')
    .flatMap((n) => n.children.filter((c): c is string => typeof c === 'string'));
const failure = (error: unknown) => (error instanceof Error ? error.name : String(error));
let screen: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('__DEV__', true);
  vi.stubGlobal('fetch', native.request);
  vi.stubEnv('TZ', 'UTC');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  native.request.mockClear();
  native.info.mockResolvedValue([]);
});
afterEach(() => {
  if (screen)
    act(() => {
      screen!.unmount();
    });
  screen = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(() => {
  for (const db of native.databases.values()) db.close();
});
async function observe(
  row: 'session' | 'setup',
  damage: Damage,
  kind: Kind,
  phone: Phone,
  purge = false,
) {
  native.databases
    .get('splitbook-widgets.db')
    ?.exec(
      'DELETE FROM widget_setup; DELETE FROM widget_state; DELETE FROM widget_group_evictions;',
    );
  const store = createWidgetsStore(environment);
  await store.setSession(alex);
  await store.write(copy);
  await store.saveSetup(setupFor(kind));
  registerAndroidWidgets();
  let displayed: { text: string[]; spoken: string[] } | undefined;
  const renderWidget = vi.fn((representation: WidgetRepresentation) => {
    if (!('light' in representation) || !representation.dark)
      throw new Error('The widget did not supply both themes');
    const light = buildWidgetTree(representation.light),
      dark = buildWidgetTree(representation.dark);
    expect(texts(dark)).toEqual(texts(light));
    expect(spoken(dark)).toEqual(spoken(light));
    displayed = { text: texts(light), spoken: spoken(light) };
  });
  const draw = () =>
    native.handler!({ widgetInfo: infoFor(kind), widgetAction: 'WIDGET_RESIZED', renderWidget });
  await draw();
  const previous = displayed;
  expect(previous!.text.join(' ')).toContain(kind === 'Quick' ? 'Maple House' : '₹1,480.00');
  renderWidget.mockClear();
  await store.setSession(sessionFor(phone));
  const raw = damaged(row, damage, kind, phone);
  const db = native.databases.get('splitbook-widgets.db')!;
  if (row === 'session')
    db.prepare('UPDATE widget_state SET session = ? WHERE environment = ?').run(raw, environment);
  else
    db.prepare('UPDATE widget_setup SET setup = ? WHERE environment = ? AND widget_id = 7').run(
      raw,
      environment,
    );
  if (purge) {
    await store.clear();
    await store.setSession(sessionFor(phone));
    expect((await store.read()).copy).toBeNull();
  }
  const rawRow = () =>
    row === 'session'
      ? ((
          db
            .prepare('SELECT session AS value FROM widget_state WHERE environment = ?')
            .get(environment) as { value: string } | undefined
        )?.value ?? null)
      : ((
          db
            .prepare(
              'SELECT setup AS value FROM widget_setup WHERE environment = ? AND widget_id = 7',
            )
            .get(environment) as { value: string } | undefined
        )?.value ?? null);
  let storageError: string | null = null;
  let stored: unknown;
  try {
    stored = row === 'session' ? (await store.read()).session : await store.setup(7);
  } catch (error) {
    storageError = failure(error);
  }
  let drawError: string | null = null;
  try {
    await draw();
  } catch (error) {
    drawError = failure(error);
  }
  expect(rawRow()).toBe(raw);
  const keptPreviousFrame = displayed === previous;
  if (keptPreviousFrame) expect(displayed).toEqual(previous);
  const setResult = vi.fn();
  const mountSetup = async () => {
    await act(async () => {
      screen = create(
        <WidgetSetup widgetInfo={infoFor(kind)} setResult={setResult} renderWidget={vi.fn()} />,
      );
    });
  };
  await mountSetup();
  const setupText = screenText(screen!.root);
  const buttons = screen!.root.findAll(
    (n) =>
      (n.type as unknown) === 'Pressable' &&
      n.props.accessibilityRole === 'button' &&
      n.props.accessibilityLabel !== 'Cancel widget setup',
  );
  const save = buttons.find((button) =>
    screenText(button).some((text) => text === 'Save' || text === 'Add widget'),
  );
  const button = buttons.at(-1);
  const buttonText = button ? screenText(button).join(' ') : null;
  const buttonDisabled = button ? button.props.disabled === true : null;
  expect(rawRow()).toBe(raw);
  if (save && !save.props.disabled)
    await act(async () => {
      await save.props.onPress();
    });
  expect(native.request).not.toHaveBeenCalled();
  const afterSave = screenText(screen!.root);
  return {
    storageError,
    stored,
    drawError,
    renderAttempts: renderWidget.mock.calls.length,
    keptPreviousFrame,
    drawn: displayed!,
    setup: {
      text: setupText.join('\n'),
      button: buttonText,
      disabled: buttonDisabled,
      afterSave: afterSave.join('\n') === setupText.join('\n') ? 'unchanged' : afterSave.join('\n'),
      result: setResult.mock.calls.map((call) => call[0]),
    },
    rowAfterSave: rawRow() === raw ? 'kept' : rawRow() === null ? 'removed' : 'overwritten',
    rowAfterOpening: 'kept',
    requests: native.request.mock.calls.length,
    async recover() {
      // Opening the app republishes its trusted session and the reads it already makes.
      await store.setSession(alex);
      await store.write(copy);
      act(() => screen!.unmount());
      setResult.mockClear();
      await mountSetup();
      const save = screen!.root
        .findAll((n) => (n.type as unknown) === 'Pressable')
        .find(
          (n) =>
            n.props.accessibilityRole === 'button' &&
            screenText(n).some((text) => text === 'Save' || text === 'Add widget'),
        )!;
      expect(save).toBeDefined();
      expect(save.props.disabled).not.toBe(true);
      await act(async () => {
        await save.props.onPress();
      });
      expect(setResult).toHaveBeenCalledExactlyOnceWith('ok');
      const saved = await store.setup(7);
      expect(saved).toMatchObject({ kind: setupFor(kind).kind, widgetId: 7 });
      if (saved && saved.kind !== 'balances') expect(saved.accountId).toBe('alex');
      expect((await store.read()).session).toEqual(alex);
      await draw();
      expect(native.request).not.toHaveBeenCalled();
      return { saved, drawn: displayed! };
    },
  };
}

// The owner's fallback applies to unusable fields; an extra version is still accepted.
const observations = [
  ['session', 'invalid JSON'],
  ['session', 'missing required fields'],
  ['session', 'wrong types'],
  ['session', 'wrong loading type'],
  ['session', 'unknown version'],
  ['session', 'empty string'],
  ['session', 'JSON null'],
  ['setup', 'invalid JSON'],
  ['setup', 'missing required fields'],
  ['setup', 'wrong types'],
  ['setup', 'wrong widget id'],
  ['setup', 'unknown version'],
  ['setup', 'empty string'],
  ['setup', 'JSON null'],
] as const;
const cases = observations.flatMap(([row, damage]) =>
  kinds.flatMap((kind) => phones.map((phone) => ({ row, damage, kind, phone }))),
);
const privateWords = /Maple House|Sam|₹/;
function replaced(observed: Awaited<ReturnType<typeof observe>>) {
  expect(observed.storageError).toBeNull();
  expect(observed.drawError).toBeNull();
  expect(observed.renderAttempts).toBe(1);
  expect(observed.keptPreviousFrame).toBe(false);
  expect(observed.setup.text).not.toMatch(/Could not read|Could not save/);
  expect(observed.rowAfterOpening).toBe('kept');
  expect(observed.requests).toBe(0);
}
for (const { row, damage, kind, phone } of cases) {
  const usable = damage === 'unknown version';
  const outcome = usable
    ? 'accepts extra version metadata and keeps the account guard'
    : row === 'session'
      ? 'replaces the old frame with signed out; app session publication recovers'
      : 'replaces the old frame with Set up this widget again; saving repairs the row';
  it(`${kind} · ${row} · ${damage} · ${phone}: ${outcome}`, async () => {
    const observed = await observe(row, damage, kind, phone);
    replaced(observed);
    if (!usable) {
      expect(JSON.stringify(observed.drawn)).not.toMatch(privateWords);
      if (row === 'session') {
        expect(observed.stored).toEqual({ status: 'signed-out' });
        expect(observed.drawn.text.join(' ')).toContain('Sign in');
        expect(observed.setup.text).not.toMatch(privateWords);
        expect(observed.rowAfterSave).toBe('kept');
      } else {
        expect(observed.stored).toBeNull();
        expect(observed.drawn.text.join(' ')).toBe('Set up this widget again');
        expect(observed.drawn.spoken).toContain('Set up this widget again');
        if (phone === 'same account' || kind === 'Balances') {
          expect(observed.setup.button).toBe('Add widget');
          expect(observed.setup.disabled).toBe(false);
          expect(observed.setup.result).toEqual(['ok']);
          expect(observed.rowAfterSave).toBe('overwritten');
        } else {
          expect(observed.setup.button).toBe('Open Splitbook');
          expect(observed.setup.text).not.toMatch(privateWords);
          expect(observed.rowAfterSave).toBe('kept');
        }
      }
    } else if (phone === 'same account') {
      expect(observed.drawn.text.join(' ')).toContain(
        kind === 'Quick' ? 'Maple House' : '₹1,480.00',
      );
    } else expect(JSON.stringify(observed.drawn)).not.toMatch(privateWords);
    const recovered = await observed.recover();
    expect(recovered.drawn.text.join(' ')).toContain(
      kind === 'Quick' ? 'Add expense' : '₹1,480.00',
    );
  });
}
it.each(kinds.flatMap((kind) => phones.map((phone) => ({ kind, phone }))))(
  '$kind · intact rows · $phone: replaces the frame and keeps the account guard',
  async ({ kind, phone }) => {
    const observed = await observe('session', 'intact', kind, phone);
    replaced(observed);
    if (phone !== 'same account') expect(JSON.stringify(observed.drawn)).not.toMatch(privateWords);
    else
      expect(observed.drawn.text.join(' ')).toContain(
        kind === 'Quick' ? 'Maple House' : '₹1,480.00',
      );
  },
);
it.each(
  kinds.flatMap((kind) =>
    (['invalid JSON', 'empty string', 'JSON null'] as const).flatMap((damage) =>
      (['signed out', 'other account'] as const).map((phone) => ({ kind, damage, phone })),
    ),
  ),
)(
  '$kind · $damage setup · $phone: a copy purge replaces the old frame even when setup is unreadable',
  async ({ kind, damage, phone }) => {
    const observed = await observe('setup', damage, kind, phone, true);
    replaced(observed);
    expect(JSON.stringify(observed.drawn)).not.toMatch(privateWords);
    expect(observed.drawn.text.join(' ')).toBe('Set up this widget again');
    await observed.recover();
  },
);

it('keeps absent Overview preferences on the legacy update path without treating them as damaged', async () => {
  native.databases
    .get('splitbook-widgets.db')
    ?.exec(
      'DELETE FROM widget_setup; DELETE FROM widget_state; DELETE FROM widget_group_evictions;',
    );
  const store = createWidgetsStore(environment);
  await store.setSession(alex);
  await store.write(copy);
  expect(await store.readSetup(7)).toEqual({ setup: null, unreadable: false });
  registerAndroidWidgets();
  native.info.mockResolvedValue([infoFor('Balances')]);
  const renderWidget = vi.fn((representation: WidgetRepresentation) => {
    if (!('light' in representation)) throw new Error('Missing widget themes');
    expect(texts(buildWidgetTree(representation.light))).toContain('₹1,480.00');
  });
  await native.handler!({
    widgetInfo: infoFor('Balances'),
    widgetAction: 'WIDGET_UPDATE',
    renderWidget,
  });
  expect(renderWidget).toHaveBeenCalledOnce();
  expect(await store.setup(7)).toEqual({ kind: 'balances', widgetId: 7, hideAmounts: false });
  expect(native.request).not.toHaveBeenCalled();
});
it('does not overwrite a damaged Overview preference during its legacy update check', async () => {
  native.databases
    .get('splitbook-widgets.db')
    ?.exec(
      'DELETE FROM widget_setup; DELETE FROM widget_state; DELETE FROM widget_group_evictions;',
    );
  const store = createWidgetsStore(environment);
  await store.setSession(alex);
  await store.write(copy);
  await store.saveSetup(setupFor('Balances'));
  const db = native.databases.get('splitbook-widgets.db')!;
  db.prepare('UPDATE widget_setup SET setup = ? WHERE environment = ? AND widget_id = 7').run(
    '{unreadable',
    environment,
  );
  registerAndroidWidgets();
  native.info.mockResolvedValue([infoFor('Balances')]);
  const renderWidget = vi.fn((representation: WidgetRepresentation) => {
    if (!('light' in representation)) throw new Error('Missing widget themes');
    const tree = buildWidgetTree(representation.light);
    expect(texts(tree).join(' ')).toBe('Set up this widget again');
    expect(JSON.stringify(tree)).not.toMatch(privateWords);
  });
  await native.handler!({
    widgetInfo: infoFor('Balances'),
    widgetAction: 'WIDGET_UPDATE',
    renderWidget,
  });
  expect(renderWidget).toHaveBeenCalledOnce();
  expect(await store.readSetup(7)).toEqual({ setup: null, unreadable: true });
  expect(
    (
      db
        .prepare('SELECT setup FROM widget_setup WHERE environment = ? AND widget_id = 7')
        .get(environment) as { setup: string }
    ).setup,
  ).toBe('{unreadable');
  expect(native.request).not.toHaveBeenCalled();
});
