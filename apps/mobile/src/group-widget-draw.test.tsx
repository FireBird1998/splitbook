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
const drawnText = (node: WidgetTree): string[] => [
  ...((node.props as { text?: string }).text ? [(node.props as { text: string }).text] : []),
  ...(node.children ?? []).flatMap(drawnText),
];
const allNodes = (node: WidgetTree): WidgetTree[] => [
  node,
  ...(node.children ?? []).flatMap(allNodes),
];

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
  { width: 172, height: 344, scale: 1, compact: true },
  { width: 266, height: 344, scale: 1.3, compact: true },
  { width: 360, height: 344, scale: 1.3, compact: false },
  { width: 360, height: 344, scale: 2, compact: true },
])(
  'draws board payment surfaces and a divider at $width dp and $scale text',
  ({ width, height, scale, compact }) => {
    vi.stubGlobal('__DEV__', false);
    const tree = buildWidgetTree(
      drawGroup(
        copy,
        { kind: 'group', accountId: 'alex', groupId: 'maple', widgetId: 7 },
        { width, height },
        { status: 'authenticated', accountId: 'alex', loading: false },
        now,
        lightTokens,
        scale,
      ),
    );
    const panel = allNodes(tree).find(
      (node) =>
        node.children?.filter((child) =>
          drawnText(child).some((text) => /(?:Pay|pay) (Priya|Sam)/.test(text)),
        ).length === 2,
    )!;
    expect(panel).toBeDefined();
    expect((panel.props as { backgroundColor?: string }).backgroundColor).toBe(
      compact ? undefined : lightTokens.surfaceMuted,
    );
    expect(
      allNodes(panel).some(
        (node) =>
          (node.props as { height?: number; backgroundColor?: string }).height === 1 &&
          (node.props as { backgroundColor?: string }).backgroundColor === lightTokens.border,
      ),
    ).toBe(true);
    vi.unstubAllGlobals();
  },
);
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
    expect(drawnText(tree).filter((text) => text === 'Open to update')).toHaveLength(
      count === 2 ? 1 : 0,
    );
    vi.unstubAllGlobals();
  },
);

it.each([225, 240])(
  'draws the people count in secondary grey when no payment amount fits at %s dp',
  (width) => {
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
        { width, height: 344 },
        { status: 'authenticated', accountId: 'alex', loading: false },
        now,
        lightTokens,
        width === 240 ? 1 : 2,
      ),
    );
    expect(drawnText(tree)).toContain('to 2\u00a0people');
    expect(
      allNodes(tree).find((node) => (node.props as { text?: string }).text === 'to 2\u00a0people')
        ?.props,
    ).toMatchObject({ color: lightTokens.textSecondary });
    vi.unstubAllGlobals();
  },
);

it('gives the stacked archived name and tag the full width of their header column', () => {
  vi.stubGlobal('__DEV__', false);
  const archived: WidgetCopy = {
    ...copy,
    groups: { maple: { ...copy.groups!.maple!, archived: true } },
  };
  const tree = buildWidgetTree(
    drawGroup(
      archived,
      { kind: 'group', accountId: 'alex', groupId: 'maple', widgetId: 7 },
      { width: 172, height: 224 },
      { status: 'authenticated', accountId: 'alex', loading: false },
      now,
      lightTokens,
      2,
    ),
  );
  const header = allNodes(tree).find(
    (node) =>
      node.children?.some((child) => drawnText(child).join(' ') === 'Maple House') &&
      node.children?.some((child) => drawnText(child).join(' ') === 'Archived'),
  );
  expect(header?.props).toMatchObject({ orientation: 'VERTICAL', width: 'match_parent' });
  vi.unstubAllGlobals();
});

it('keeps the Group name in a width-constrained single-line native text view for ellipsis', () => {
  vi.stubGlobal('__DEV__', false);
  const name = 'MountainAdventureClub';
  const tree = buildWidgetTree(
    drawGroup(
      { ...copy, groups: { maple: { ...copy.groups!.maple!, name } } },
      { kind: 'group', accountId: 'alex', groupId: 'maple', widgetId: 7 },
      { width: 110, height: 110 },
      { status: 'authenticated', accountId: 'alex', loading: false },
      now,
      lightTokens,
      2,
    ),
  );
  expect(
    allNodes(tree).find((node) => (node.props as { text?: string }).text === name)?.props,
  ).toMatchObject({ width: 'match_parent', maxLines: 1, truncate: 'END' });
  expect(drawnText(tree)).not.toContain('Group');
  vi.unstubAllGlobals();
});
