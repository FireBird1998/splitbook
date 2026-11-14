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
function minimumHeight(tree: WidgetTree, scale = 1): number {
  const p = tree.props as {
    text?: string;
    fontSize?: number;
    orientation?: string;
    separator?: { size: number };
    padding?: { top: number; bottom: number };
  };
  const heights = (tree.children ?? []).map((child) => minimumHeight(child, scale));
  return (
    (p.text
      ? Math.ceil((p.fontSize ?? 12) * scale * 1.3)
      : p.orientation === 'HORIZONTAL'
        ? Math.max(0, ...heights)
        : heights.reduce((sum, h) => sum + h, 0) +
          Math.max(0, heights.length - 1) * (p.separator?.size ?? 0)) +
    (p.padding?.top ?? 0) +
    (p.padding?.bottom ?? 0)
  );
}
it('keeps wrapped message lines in the measured small message block', () => {
  vi.stubGlobal('__DEV__', false);
  const view = overviewWidget(
    { ...copy, accountId: 'sam' },
    { kind: 'balances', widgetId: 7 },
    { width: 172, height: 104 },
    auth,
    now,
  );
  const tree = buildWidgetTree(drawOverview(view, lightTokens));
  expect(minimumHeight(tree.children![0])).toBeLessThanOrEqual(view.layout.sections[0].height);
});

it.each(
  (['signed-out', 'expired'] as const).flatMap((status) =>
    [1, 1.3, 2].map((scale) => ({ status, scale })),
  ),
)(
  'fits the entire native $status button at $scale text within its reserved footer',
  ({ status, scale }) => {
    vi.stubGlobal('__DEV__', false);
    const view = overviewWidget(
      copy,
      { kind: 'balances', widgetId: 7 },
      { width: 360, height: 584 },
      { status },
      now,
      scale,
    );
    const tree = buildWidgetTree(drawOverview(view, lightTokens));
    const i = view.layout.sections.findIndex((s) => s.id === 'footer');
    expect(minimumHeight(tree.children![i], scale)).toBeLessThanOrEqual(
      view.layout.sections[i].height,
    );
  },
);
