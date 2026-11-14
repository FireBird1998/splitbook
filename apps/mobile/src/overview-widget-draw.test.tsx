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
function minimumHeight(tree: WidgetTree, scale = 1, ratio = 1): number {
  const p = tree.props as {
    text?: string;
    fontSize?: number;
    orientation?: string;
    separator?: { size: number };
    padding?: { top: number; bottom: number };
  };
  const heights = (tree.children ?? []).map((child) => minimumHeight(child, scale, ratio));
  return (
    (p.text
      ? Math.ceil((p.fontSize ?? 12) * scale * 1.3 * ratio) / ratio
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

it.each(['signed-out', 'expired'] as const)(
  'keeps the %s sentence in the title column beside its tile',
  (status) => {
    vi.stubGlobal('__DEV__', false);
    const v = overviewWidget(
      copy,
      { kind: 'balances', widgetId: 7 },
      { width: 360, height: 584 },
      { status },
      now,
    );
    const tree = buildWidgetTree(drawOverview(v, lightTokens));
    const message = tree.children![v.layout.sections.findIndex((s) => s.id === 'message')];
    const descendants = (node: WidgetTree): WidgetTree[] => [
      node,
      ...(node.children ?? []).flatMap(descendants),
    ];
    const horizontal = descendants(message).find(
      (node) =>
        (node.props as { orientation?: string }).orientation === 'HORIZONTAL' &&
        labels(node).includes(v.title!),
    )!;
    expect(horizontal.props).toMatchObject({ orientation: 'HORIZONTAL' });
    const textColumn = horizontal.children!.at(-1)!;
    expect(labels(textColumn)).toContain(
      status === 'expired' ? 'Sign in again' : 'Sign in to Splitbook',
    );
    for (const line of v.layout.descriptionLines) expect(labels(textColumn)).toContain(line);
    expect(minimumHeight(message)).toBeLessThanOrEqual(
      v.layout.sections.find((s) => s.id === 'message')!.height,
    );
  },
);
it('shows No Groups yet as text without an icon tile', () => {
  vi.stubGlobal('__DEV__', false);
  const v = overviewWidget(
    { ...copy, home: { ...copy.home!, groupCount: 0, currencies: [] } },
    { kind: 'balances', widgetId: 7 },
    { width: 360, height: 584 },
    auth,
    now,
  );
  const tree = buildWidgetTree(drawOverview(v, lightTokens));
  const message = tree.children![v.layout.sections.findIndex((s) => s.id === 'message')];
  expect(labels(message)).toContain('No Groups yet');
  expect(labels(message)).not.toContain('!');
  expect(v.layout.showStateTile).toBe(false);
});
it('fits the whole ordinary native footer with To review and Add expense at 130 percent', () => {
  vi.stubGlobal('__DEV__', false);
  const v = overviewWidget(
    { ...copy, review: { count: 3, verifiedAt: now } },
    { kind: 'balances', widgetId: 7 },
    { width: 360, height: 344, pixelRatio: 2.625 },
    auth,
    now,
    1.3,
  );
  const tree = buildWidgetTree(drawOverview(v, lightTokens));
  const footer = tree.children![v.layout.sections.findIndex((s) => s.id === 'footer')];
  expect(labels(footer)).toContain('To review\u00a0· 3');
  expect(labels(footer)).toContain('＋ Add expense');
  expect(minimumHeight(footer, 1.3, 2.625)).toBeLessThanOrEqual(
    v.layout.sections.find((s) => s.id === 'footer')!.height,
  );
});

it.each(['all-square', 'no-copy', 'other-account'] as const)(
  'keeps the existing sentence position for %s',
  (state) => {
    vi.stubGlobal('__DEV__', false);
    const saved =
      state === 'no-copy'
        ? null
        : state === 'other-account'
          ? { ...copy, accountId: 'sam' }
          : { ...copy, home: { ...copy.home!, currencies: [] } };
    const v = overviewWidget(
      saved,
      { kind: 'balances', widgetId: 7 },
      { width: 360, height: 584 },
      auth,
      now,
    );
    const tree = buildWidgetTree(drawOverview(v, lightTokens));
    const message = tree.children![v.layout.sections.findIndex((s) => s.id === 'message')];
    const descendants = (node: WidgetTree): WidgetTree[] => [
      node,
      ...(node.children ?? []).flatMap(descendants),
    ];
    const horizontal = descendants(message).find(
      (node) =>
        (node.props as { orientation?: string }).orientation === 'HORIZONTAL' &&
        labels(node).includes(v.title!),
    )!;
    for (const line of v.layout.descriptionLines) {
      expect(labels(message)).toContain(line);
      expect(labels(horizontal.children!.at(-1)!)).not.toContain(line);
    }
  },
);
