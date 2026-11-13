import { afterEach, expect, it, vi } from 'vitest';
import type { WidgetTaskHandler } from 'react-native-android-widget/src/api/register-widget-task-handler';
import {
  buildWidgetTree,
  type WidgetTree,
} from 'react-native-android-widget/src/api/build-widget-tree';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';

const native = vi.hoisted(() => ({
  handler: null as WidgetTaskHandler | null,
  read: vi.fn(),
  info: vi.fn(),
}));
vi.mock('./config', () => ({ mobileBuildSettings: {}, widgetKey: () => 'development' }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('./widgets-native', () => ({
  createWidgetsStore: () => ({
    read: native.read,
    setup: async () => ({ kind: 'group', widgetId: 7, accountId: 'alex', groupId: 'goa' }),
  }),
}));
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
const texts = (node: WidgetTree): string[] => [
  ...((node.props as { text?: string }).text ? [(node.props as { text: string }).text] : []),
  ...(node.children ?? []).flatMap(texts),
];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('redraws both themes from the same saved copy on a midnight update without opening the app or requesting data', async () => {
  vi.stubEnv('TZ', 'Asia/Kolkata');
  vi.stubGlobal('__DEV__', false);
  const fetch = vi.fn(() => {
    throw new Error('A widget must not request data');
  });
  vi.stubGlobal('fetch', fetch);
  vi.useFakeTimers();
  const copy: WidgetCopy = {
    version: 1,
    accountId: 'alex',
    home: null,
    months: {
      goa: {
        month: '2026-11',
        verifiedAt: 1,
        count: 12,
        mainCurrency: 'INR',
        mainCurrencyOnly: false,
        totals: [{ currency: 'INR', totalMinor: 1840000 }],
        shareMinor: 460000,
      },
    },
    groups: {
      goa: {
        id: 'goa',
        name: 'Goa Friends Trip',
        theme: 'trip',
        archived: false,
        mainCurrency: 'INR',
        verifiedAt: 1,
        balancesVerifiedAt: 1,
        currencies: [],
        tripDates: { start: '2026-11-08', end: '2026-11-10' },
      },
    },
  };
  const original = structuredClone(copy);
  native.read.mockResolvedValue({
    copy,
    session: { status: 'authenticated', accountId: 'alex', loading: false },
  });
  const info = {
    widgetName: 'Group',
    widgetId: 7,
    width: 360,
    height: 224,
    screenInfo: {
      fontScale: 1,
      density: 2.625,
      densityDpi: 420,
      screenWidthDp: 411,
      screenHeightDp: 914,
    },
  };
  native.info.mockResolvedValue([info]);
  const { registerAndroidWidgets } = await import('./widgets');
  registerAndroidWidgets();
  for (const [instant, expected] of [
    ['2026-11-08T18:29:59Z', 'Day 1 of 3'],
    ['2026-11-08T18:30:00Z', 'Day 2 of 3'],
  ]) {
    vi.setSystemTime(new Date(instant));
    const renderWidget = vi.fn();
    await native.handler!({ widgetInfo: info, widgetAction: 'WIDGET_UPDATE', renderWidget });
    const result = renderWidget.mock.calls[0]![0];
    expect(texts(buildWidgetTree(result.light))).toContain(expected);
    expect(texts(buildWidgetTree(result.dark))).toContain(expected);
  }
  native.info.mockResolvedValue([{ ...info, height: 344 }]);
  for (const [instant, expected, absent] of [
    ['2026-11-30T18:29:59Z', '₹18,400.00', 'Open the Group to update'],
    ['2026-11-30T18:30:00Z', 'Open the Group to update', '₹18,400.00'],
  ]) {
    vi.setSystemTime(new Date(instant));
    const renderWidget = vi.fn();
    await native.handler!({ widgetInfo: info, widgetAction: 'WIDGET_UPDATE', renderWidget });
    const result = renderWidget.mock.calls[0]![0];
    for (const theme of [result.light, result.dark]) {
      expect(texts(buildWidgetTree(theme))).toContain(expected);
      expect(texts(buildWidgetTree(theme))).not.toContain(absent);
    }
  }
  expect(copy).toEqual(original);
  expect(fetch).not.toHaveBeenCalled();
});
