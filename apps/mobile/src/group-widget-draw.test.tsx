import { expect, it, vi } from 'vitest';
import {
  buildWidgetTree,
  type WidgetTree,
} from 'react-native-android-widget/src/api/build-widget-tree';
import { lightTokens } from '@splitbook/shared/design-tokens';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';
import { drawGroup } from './group-widget-draw';
vi.mock('expo-constants', () => ({ default: {} }));

// Measure the converted native tree, including the spacers the widget library inserts for
// space-between. Those extra children must fit the view's fixed-height action section.
function minimumHeight(tree: WidgetTree): number {
  const p = tree.props as {
    fontSize?: number;
    text?: string;
    orientation?: string;
    separator?: { size: number };
    padding?: { top: number; bottom: number };
  };
  const children = tree.children ?? [];
  const heights = children.map(minimumHeight);
  const content = p.text
    ? Math.ceil((p.fontSize ?? 12) * 1.3)
    : p.orientation === 'HORIZONTAL'
      ? Math.max(0, ...heights)
      : heights.reduce((sum, h) => sum + h, 0) +
        Math.max(0, children.length - 1) * (p.separator?.size ?? 0);
  return content + (p.padding?.top ?? 0) + (p.padding?.bottom ?? 0);
}
const now = Date.parse('2026-11-13T04:11:00Z');
const copy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: null,
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
            { from: 'alex', to: 'priya', fromName: 'Alex', toName: 'Priya', amountMinor: 106000 },
            { from: 'alex', to: 'sam', fromName: 'Alex', toName: 'Sam', amountMinor: 42000 },
          ],
        },
      ],
    },
  },
};
it.each([
  { width: 172, height: 224 },
  { width: 182, height: 200 },
])('fits the entire native action and overflow line inside $width×$height dp', (size) => {
  vi.stubGlobal('__DEV__', false);
  const tree = buildWidgetTree(
    drawGroup(
      copy,
      { kind: 'group', accountId: 'alex', groupId: 'maple', widgetId: 7 },
      size,
      { status: 'authenticated', accountId: 'alex', loading: false },
      now,
      lightTokens,
    ),
  );
  const action = tree.children!.at(-1)!;
  expect(minimumHeight(action)).toBeLessThanOrEqual((action.props as { height: number }).height);
  vi.unstubAllGlobals();
});

it.each([
  { count: 2, height: 200 },
  { count: 2, height: 304 },
  { count: 12, height: 304 },
])(
  'keeps the older-copy update hint behind an overflow of $count payments at $height dp',
  ({ count, height }) => {
    vi.stubGlobal('__DEV__', false);
    const stale: WidgetCopy = {
      ...copy,
      groups: {
        maple: {
          ...copy.groups!.maple!,
          verifiedAt: now - 172800000,
          balancesVerifiedAt: now - 172800000,
          currencies: [
            {
              ...copy.groups!.maple!.currencies[0]!,
              payments: Array.from(
                { length: count },
                (_, i) => copy.groups!.maple!.currencies[0]!.payments[i % 2]!,
              ),
            },
          ],
        },
      },
    };
    const tree = buildWidgetTree(
      drawGroup(
        stale,
        { kind: 'group', accountId: 'alex', groupId: 'maple', widgetId: 7 },
        { width: 372, height },
        { status: 'authenticated', accountId: 'alex', loading: false },
        now,
        lightTokens,
      ),
    );
    const drawnText = (node: WidgetTree): string[] => [
      ...((node.props as { text?: string }).text ? [(node.props as { text: string }).text] : []),
      ...(node.children ?? []).flatMap(drawnText),
    ];
    expect(drawnText(tree).filter((text) => text === 'Open to update')).toHaveLength(
      count === 2 ? 1 : 0,
    );
    vi.unstubAllGlobals();
  },
);

it('draws the overflow hint when no full payment amount fits an in-between width', () => {
  vi.stubGlobal('__DEV__', false);
  const large: WidgetCopy = {
    ...copy,
    groups: {
      maple: {
        ...copy.groups!.maple!,
        currencies: [
          {
            ...copy.groups!.maple!.currencies[0]!,
            payments: copy.groups!.maple!.currencies[0]!.payments.map((p) => ({
              ...p,
              amountMinor: 123456789012345,
            })),
          },
        ],
      },
    },
  };
  const tree = buildWidgetTree(
    drawGroup(
      large,
      { kind: 'group', accountId: 'alex', groupId: 'maple', widgetId: 7 },
      { width: 266, height: 344 },
      { status: 'authenticated', accountId: 'alex', loading: false },
      now,
      lightTokens,
    ),
  );
  const drawnText = (node: WidgetTree): string[] => [
    ...((node.props as { text?: string }).text ? [(node.props as { text: string }).text] : []),
    ...(node.children ?? []).flatMap(drawnText),
  ];
  expect(drawnText(tree)).toContain('+2\u00a0more\u00a0· ₹');
  vi.unstubAllGlobals();
});
