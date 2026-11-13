import { afterEach, expect, it, vi } from 'vitest';
import {
  buildWidgetTree,
  type WidgetTree,
} from 'react-native-android-widget/src/api/build-widget-tree';
import { overviewWidget } from '@splitbook/shared/overview-widget';
import { lightTokens } from '@splitbook/shared/design-tokens';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';
import { drawOverview } from './overview-widget-draw';
vi.mock('expo-constants', () => ({ default: {} }));
afterEach(() => vi.unstubAllGlobals());
const now = Date.parse('2026-11-13T04:11:00Z');
const copy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: {
    verifiedAt: now,
    groupCount: 1,
    currencies: [{ currency: 'INR', owedMinor: 240000, oweMinor: 148000 }],
  },
};
const auth: WidgetSession = { status: 'authenticated', accountId: 'alex', loading: false };
const labels = (node: WidgetTree): string[] => [
  ...((node.props as { text?: string }).text ? [(node.props as { text: string }).text] : []),
  ...(node.children ?? []).flatMap(labels),
];
it.each([
  'normal',
  'loading',
  'signed-out',
  'expired',
  'no-copy',
  'other-account',
  'all-square',
  'no-groups',
] as const)(
  'builds the native Overview tree for %s without requiring an absent loading section',
  (state) => {
    vi.stubGlobal('__DEV__', false);
    const session: WidgetSession =
      state === 'signed-out' || state === 'expired'
        ? { status: state }
        : { ...auth, loading: state === 'loading' };
    const saved =
      state === 'loading' || state === 'no-copy'
        ? null
        : state === 'other-account'
          ? { ...copy, accountId: 'sam' }
          : state === 'all-square' || state === 'no-groups'
            ? {
                ...copy,
                home: { ...copy.home!, groupCount: state === 'no-groups' ? 0 : 1, currencies: [] },
              }
            : copy;
    const view = overviewWidget(
      saved,
      { kind: 'balances', widgetId: 7 },
      { width: 360, height: 344 },
      session,
      now,
    );
    const tree = buildWidgetTree(drawOverview(view, lightTokens));
    expect(labels(tree)).toContain('Overview');
    if (state === 'normal') expect(labels(tree)).toContain('₹2,400.00');
    if (state === 'signed-out' || state === 'expired' || state === 'other-account')
      expect(labels(tree)).not.toContain('₹2,400.00');
  },
);
