import { expect, it, vi } from 'vitest';
import {
  buildWidgetTree,
  type WidgetTree,
} from 'react-native-android-widget/src/api/build-widget-tree';
import { lightTokens, darkTokens } from '@splitbook/shared/design-tokens';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';
import { drawGroup } from './group-widget-draw';
vi.mock('expo-constants', () => ({ default: {} }));

// Measure the converted native tree, including the spacers the widget library inserts for
// space-between. Those extra children must fit the view's fixed-height action section.
function minimumHeight(tree: WidgetTree, pixelRatio = 1): number {
  const p = tree.props as {
    fontSize?: number;
    text?: string;
    orientation?: string;
    separator?: { size: number };
    padding?: { top: number; bottom: number };
  };
  const children = tree.children ?? [];
  const heights = children.map((child) => minimumHeight(child, pixelRatio));
  const content = p.text
    ? Math.ceil((p.fontSize ?? 12) * 1.3 * pixelRatio) / pixelRatio
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

it.each([lightTokens, darkTokens])(
  'fits the Trip badge and balance within the native header in $mode',
  (tokens) => {
    vi.stubGlobal('__DEV__', false);
    vi.stubEnv('TZ', 'Asia/Kolkata');
    try {
      const tree = buildWidgetTree(
        drawGroup(
          {
            ...copy,
            groups: {
              maple: {
                ...copy.groups!.maple!,
                name: 'Goa Friends Trip',
                theme: 'trip',
                tripDates: { start: '2026-11-13', end: '2026-11-15' },
              },
            },
          },
          { kind: 'group', widgetId: 7, groupId: 'maple', accountId: 'alex' },
          { width: 360, height: 344, pixelRatio: 2.625 },
          { status: 'authenticated', accountId: 'alex', loading: false },
          now,
          tokens,
        ),
      );
      const header = tree.children!.find((node) => drawnText(node).includes('Day 1 of 3'))!;
      expect(header).toBeDefined();
      expect(minimumHeight(header, 2.625)).toBeLessThanOrEqual(
        (header.props as { height: number }).height,
      );
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  },
);

it.each([lightTokens, darkTokens])(
  'draws Month columns and their saved time in $mode',
  (tokens) => {
    vi.stubGlobal('__DEV__', false);
    vi.stubEnv('TZ', 'Asia/Kolkata');
    const saved: WidgetCopy = {
      ...copy,
      months: {
        maple: {
          month: '2026-11',
          verifiedAt: now - 180_000,
          count: 12,
          mainCurrency: 'INR',
          mainCurrencyOnly: true,
          totals: [
            { currency: 'INR', totalMinor: 2354000 },
            { currency: 'EUR', totalMinor: 32000 },
            { currency: 'JPY', totalMinor: 42000 },
          ],
          shareMinor: 785000,
        },
      },
    };
    const tree = buildWidgetTree(
      drawGroup(
        saved,
        { kind: 'group', accountId: 'alex', groupId: 'maple', widgetId: 7 },
        { width: 360, height: 344 },
        { status: 'authenticated', accountId: 'alex', loading: false },
        now,
        tokens,
      ),
    );
    expect(drawnText(tree)).toEqual(
      expect.arrayContaining([
        'PAYMENTS',
        'THIS MONTH',
        'Group spent',
        'Your share',
        '₹23,540.00',
        '€320.00',
        '¥42,000',
        '₹7,850.00',
        'Main currency only',
      ]),
    );
    for (const label of ['Group spent', 'Your share']) {
      const panel = allNodes(tree).find((node) =>
        node.children?.some((child) => (child.props as { text?: string }).text === label),
      );
      expect(panel?.props).toMatchObject({
        backgroundColor: tokens.surfaceMuted,
        padding: { top: 8, bottom: 8, left: 8, right: 8 },
      });
    }
    const section = tree.children!.find((child) => drawnText(child).includes('THIS MONTH'))!;
    expect(minimumHeight(section)).toBeLessThanOrEqual(
      (section.props as { height: number }).height,
    );
    expect(drawnText(tree)).toEqual(expect.arrayContaining(['Saved 9:41', 'Saved 9:38']));
    vi.unstubAllEnvs();
    expect(drawnText(tree).filter((text) => text === 'PAYMENTS')).toHaveLength(1);
    expect(drawnText(tree).filter((text) => text === 'THIS MONTH')).toHaveLength(1);
    vi.unstubAllGlobals();
  },
);

it('opens the Group through the missing-Month prompt and hides Month amounts and labels for the count view', () => {
  vi.stubGlobal('__DEV__', false);
  const setup = { kind: 'group' as const, accountId: 'alex', groupId: 'maple', widgetId: 7 };
  const session = { status: 'authenticated' as const, accountId: 'alex', loading: false };
  const empty = buildWidgetTree(
    drawGroup(copy, setup, { width: 360, height: 344 }, session, now, lightTokens),
  );
  expect(drawnText(empty)).toContain('Open the Group to update');
  expect(empty.props).toMatchObject({
    clickAction: 'OPEN_URI',
    clickActionData: { uri: expect.stringContaining('/group/maple/group') },
  });
  const hidden = buildWidgetTree(
    drawGroup(
      {
        ...copy,
        months: {
          maple: {
            month: '2026-11',
            verifiedAt: now,
            count: 12,
            mainCurrency: 'INR',
            mainCurrencyOnly: false,
            totals: [{ currency: 'INR', totalMinor: 2354000 }],
            shareMinor: 785000,
          },
        },
      },
      { ...setup, hideAmounts: true },
      { width: 360, height: 344 },
      session,
      now,
      lightTokens,
    ),
  );
  expect(drawnText(hidden).join(' ').replace(/\s/g, ' ')).toContain('12 Expenses this Month');
  expect(drawnText(hidden).join(' ')).not.toMatch(/₹|Group spent|Your share|Priya|Sam/);
  vi.unstubAllGlobals();
});

it.each([310, 330])('fits a partial Month and its overflow words at %s dp height', (height) => {
  vi.stubGlobal('__DEV__', false);
  const month = {
    month: '2026-11',
    verifiedAt: now,
    count: 12,
    mainCurrency: 'INR',
    mainCurrencyOnly: true,
    totals: [
      { currency: 'INR', totalMinor: 1840000 },
      { currency: 'EUR', totalMinor: 32000 },
      { currency: 'JPY', totalMinor: 42000 },
      { currency: 'USD', totalMinor: 50000 },
      { currency: 'GBP', totalMinor: 30000 },
    ],
    ...(height === 330 ? { shareMinor: 610000 } : {}),
  };
  const tree = buildWidgetTree(
    drawGroup(
      { ...copy, months: { maple: month } },
      { kind: 'group', accountId: 'alex', groupId: 'maple', widgetId: 7 },
      { width: 360, height },
      { status: 'authenticated', accountId: 'alex', loading: false },
      now,
      lightTokens,
    ),
  );
  const section = tree.children!.find((node) => drawnText(node).includes('THIS MONTH'))!;
  expect(section).toBeDefined();
  expect(drawnText(section).join(' ').replace(/\s/g, ' ')).toContain(
    height === 330 ? '+4 more' : 'In 5 currencies',
  );
  expect(minimumHeight(section)).toBeLessThanOrEqual((section.props as { height: number }).height);
  vi.unstubAllGlobals();
});

it.each([lightTokens, darkTokens])(
  'keeps the multi-currency Month cards at the same height in $mode',
  (tokens) => {
    vi.stubGlobal('__DEV__', false);
    vi.stubEnv('TZ', 'Asia/Kolkata');
    try {
      const tree = buildWidgetTree(
        drawGroup(
          {
            ...copy,
            months: {
              maple: {
                month: '2026-11',
                verifiedAt: now - 180000,
                count: 12,
                mainCurrency: 'INR',
                mainCurrencyOnly: true,
                totals: [
                  { currency: 'INR', totalMinor: 1840000 },
                  { currency: 'EUR', totalMinor: 32000 },
                  { currency: 'JPY', totalMinor: 42000 },
                ],
                shareMinor: 610000,
              },
            },
          },
          { kind: 'group', widgetId: 7, groupId: 'maple', accountId: 'alex' },
          { width: 360, height: 584 },
          { status: 'authenticated', accountId: 'alex', loading: false },
          now,
          tokens,
        ),
      );
      const cards = ['Group spent', 'Your share'].map((label) =>
        allNodes(tree).find(
          (node) =>
            node.children?.[0] &&
            drawnText(node.children[0])[0] === label &&
            !drawnText(node).includes(label === 'Group spent' ? 'Your share' : 'Group spent'),
        ),
      );
      expect(cards).not.toContain(undefined);
      const heights = cards.map((card) => (card!.props as { height?: number }).height);
      expect(heights[0]).toBeGreaterThan(0);
      expect(heights[1]).toBe(heights[0]);
      for (const card of cards) expect(minimumHeight(card!)).toBeLessThanOrEqual(heights[0]!);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  },
);

it.each([lightTokens, darkTokens])(
  'draws two-line Recent rows and Group-only tap targets in $mode',
  (tokens) => {
    vi.stubGlobal('__DEV__', false);
    const recent = {
      verifiedAt: now - 180000,
      rows: [
        {
          id: 'private-expense-identity',
          kind: 'expense' as const,
          description: 'Beach shack lunch',
          payer: 'Meera',
          payerId: 'meera',
          amountMinor: 280000,
          currency: 'INR',
          date: '2026-11-13',
        },
        {
          id: 'private-payment-identity',
          kind: 'settlement' as const,
          description: 'Rohan paid Meera',
          payer: 'Rohan',
          payerId: 'rohan',
          amountMinor: 50000,
          currency: 'INR',
          date: '2026-11-13',
        },
      ],
    };
    const tree = buildWidgetTree(
      drawGroup(
        { ...copy, recents: { maple: recent } },
        {
          kind: 'group',
          accountId: 'alex',
          groupId: 'maple',
          widgetId: 7,
          showRecentExpenses: true,
        },
        { width: 360, height: 584 },
        { status: 'authenticated', accountId: 'alex', loading: false },
        now,
        tokens,
      ),
    );
    expect(drawnText(tree)).toContain('Beach shack lunch');
    expect(drawnText(tree)).toContain('Meera paid\u00a0· Today');
    expect(drawnText(tree)).toContain('Payment\u00a0· Today');
    const rows = allNodes(tree).filter(
      (n) =>
        n.children?.some((child) => drawnText(child).includes('Beach shack lunch')) &&
        (n.props as { clickAction?: string }).clickAction === 'OPEN_URI',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const uri = (row.props as { clickActionData: { uri: string } }).clickActionData.uri;
      expect(new URL(uri).pathname).toBe('/group/maple/group');
      expect(uri).not.toContain('private-expense-identity');
    }
    vi.unstubAllGlobals();
  },
);
