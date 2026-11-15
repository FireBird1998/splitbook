import { Component, type ReactNode } from 'react';
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
  getWidgetInfo: async () => [],
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
// Only test scaffolding catches render errors: production has no substitute setup error screen.
class SetupBoundary extends Component<
  { children: ReactNode; caught: string[] },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.caught.push(failure(error));
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
let screen: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('__DEV__', true);
  vi.stubGlobal('fetch', native.request);
  vi.stubEnv('TZ', 'UTC');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  native.request.mockClear();
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
  const renderErrors: string[] = [];
  const setResult = vi.fn();
  await act(async () => {
    screen = create(
      <SetupBoundary caught={renderErrors}>
        <WidgetSetup widgetInfo={infoFor(kind)} setResult={setResult} renderWidget={vi.fn()} />
      </SetupBoundary>,
    );
  });
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
      renderErrors,
      button: buttonText,
      disabled: buttonDisabled,
      afterSave: afterSave.join('\n') === setupText.join('\n') ? 'unchanged' : afterSave.join('\n'),
      result: setResult.mock.calls.map((call) => call[0]),
    },
    rowAfterSave: rawRow() === raw ? 'kept' : rawRow() === null ? 'removed' : 'overwritten',
    rawAfterSave: rawRow(),
    rowAfterOpening: 'kept',
    requests: native.request.mock.calls.length,
  };
}

// These names describe the observations, including failures; none specifies a new fallback.
const observations = [
  [
    'session',
    'invalid JSON',
    'rejects the read and redraw with SyntaxError, keeping the last frame',
  ],
  [
    'session',
    'missing required fields',
    'accepts a missing account id but draws the other-account message',
  ],
  ['session', 'wrong types', 'accepts a numeric account id but draws the other-account message'],
  ['session', 'unknown version', 'ignores an extra version and uses the remaining session fields'],
  ['session', 'empty string', 'draws signed out without rewriting the empty session'],
  [
    'session',
    'JSON null',
    'returns a null session, then redraw and setup rendering throw TypeError',
  ],
  ['setup', 'invalid JSON', 'rejects the read and redraw with SyntaxError, keeping the last frame'],
  ['setup', 'missing required fields', 'accepts missing setup fields without deleting the row'],
  [
    'setup',
    'wrong types',
    'accepts wrong field types; a matching Person redraw throws while other kinds still draw',
  ],
  ['setup', 'unknown version', 'ignores an extra version and uses the remaining setup fields'],
  ['setup', 'empty string', 'rejects the read and redraw with SyntaxError, keeping the last frame'],
  ['setup', 'JSON null', 'rejects the read and redraw with TypeError, keeping the last frame'],
] as const;
const cases = observations.flatMap(([row, damage, observed]) =>
  kinds.flatMap((kind) => phones.map((phone) => ({ row, damage, kind, phone, observed }))),
);
for (const { row, damage, kind, phone, observed } of cases) {
  it(`${kind} · ${row} · ${damage} · ${phone}: ${observed}`, async () => {
    expect(await observe(row, damage, kind, phone)).toMatchSnapshot();
  });
}
it.each(kinds.flatMap((kind) => phones.map((phone) => ({ kind, phone }))))(
  '$kind · intact rows · $phone: draws current-account data or replaces the old frame with the account guard',
  async ({ kind, phone }) => {
    const observed = await observe('session', 'intact', kind, phone);
    expect(observed.keptPreviousFrame).toBe(false);
    if (phone !== 'same account')
      expect(JSON.stringify(observed.drawn)).not.toMatch(/Maple House|Sam|₹/);
    expect(observed).toMatchSnapshot();
  },
);
it.each(
  kinds.flatMap((kind) =>
    (['invalid JSON', 'empty string', 'JSON null'] as const).flatMap((damage) =>
      (['signed out', 'other account'] as const).map((phone) => ({ kind, damage, phone })),
    ),
  ),
)(
  '$kind · $damage setup · $phone: even a real copy purge cannot replace the last frame while setup is unreadable',
  async ({ kind, damage, phone }) => {
    const observed = await observe('setup', damage, kind, phone, true);
    expect(observed.keptPreviousFrame).toBe(true);
    expect(observed.drawn.text.join(' ')).toContain(kind === 'Quick' ? 'Maple House' : '₹1,480.00');
    expect(observed).toMatchSnapshot();
  },
);
