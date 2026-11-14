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

it.each(['no-copy', 'other-account'] as const)(
  'keeps the existing sentence position for %s',
  (state) => {
    vi.stubGlobal('__DEV__', false);
    const saved =
      state === 'no-copy' ? null : state === 'other-account' ? { ...copy, accountId: 'sam' } : copy;
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

const withPayments: WidgetCopy = {
  ...copy,
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
          balanceMinor: -106000,
          payments: [
            {
              from: 'alex',
              to: 'priya',
              fromName: 'Alex',
              toName: 'Priya',
              fromInitials: 'AR',
              toInitials: 'PS',
              amountMinor: 106000,
            },
            {
              from: 'meera',
              to: 'alex',
              fromName: 'Meera',
              toName: 'Alex',
              fromInitials: 'MI',
              toInitials: 'AR',
              amountMinor: 200000,
            },
          ],
        },
      ],
    },
  },
};
const nodes = (tree: WidgetTree): WidgetTree[] => [tree, ...(tree.children ?? []).flatMap(nodes)];
it.each([1, 2])('draws the planned payment rows and settle links at %s text', (scale) => {
  vi.stubGlobal('__DEV__', false);
  const view = overviewWidget(
    withPayments,
    { kind: 'balances', widgetId: 7 },
    { width: 360, height: 584 },
    auth,
    now,
    scale,
  );
  const tree = buildWidgetTree(drawOverview(view, lightTokens));
  expect(view.payments).toHaveLength(2);
  expect(labels(tree)).toContain(scale === 1 ? 'You pay Priya' : 'Pay Priya');
  expect(labels(tree)).toContain('₹1,060.00');
  expect(labels(tree)).toContain(scale === 1 ? 'Meera pays you' : 'From Meera');
  const links = nodes(tree).map(
    (n) => (n.props as { clickActionData?: { uri?: string } }).clickActionData?.uri,
  );
  expect(links).toContain('splitbook://widget/group/maple/settle/alex/priya/INR');
  expect(links).toContain('splitbook://widget/group/maple/settle/meera/alex/INR');
});
it('draws hidden payment counts without any initials names amounts or settle link', () => {
  vi.stubGlobal('__DEV__', false);
  const view = overviewWidget(
    withPayments,
    { kind: 'balances', widgetId: 7, hideAmounts: true },
    { width: 360, height: 584 },
    auth,
    now,
  );
  const tree = buildWidgetTree(drawOverview(view, lightTokens));
  expect(labels(tree)).toContain('You pay 1 person');
  expect(labels(tree)).toContain('1 person pays you');
  expect(labels(tree).join(' ')).not.toMatch(/Priya|Meera|Maple|Alex|PS|MI|AR|₹|1,060|2,000/);
  expect(JSON.stringify(tree)).not.toContain('/settle/');
});

it.each([
  [344, false],
  [584, true],
] as const)(
  'draws a whole 200-percent footer only after its payments fit at %s dp',
  (height, shown) => {
    vi.stubGlobal('__DEV__', false);
    const v = overviewWidget(
      { ...withPayments, review: { count: 3, verifiedAt: now } },
      { kind: 'balances', widgetId: 7 },
      { width: 360, height, pixelRatio: 2.625 },
      auth,
      now,
      2,
    );
    const tree = buildWidgetTree(drawOverview(v, lightTokens));
    expect(v.payments).toHaveLength(2);
    expect(labels(tree).includes('＋ Add expense')).toBe(shown);
    if (shown) {
      const i = v.layout.sections.findIndex((s) => s.id === 'footer');
      expect(labels(tree.children![i])).toContain('To review\u00a0· 3');
      expect(minimumHeight(tree.children![i], 2, 2.625)).toBeLessThanOrEqual(
        v.layout.sections[i].height,
      );
    }
  },
);

it.each([false, true])(
  'keeps the Finish later chip in the whole footer with review=%s',
  (review) => {
    vi.stubGlobal('__DEV__', false);
    const view = overviewWidget(
      {
        ...copy,
        review: review ? { count: 3, verifiedAt: now } : undefined,
        finishLater: { groupId: 'maple', groupName: 'Maple House' },
      },
      { kind: 'balances', widgetId: 7 },
      { width: 360, height: 344 },
      auth,
      now,
      1,
    );
    const tree = buildWidgetTree(drawOverview(view, lightTokens));
    expect(labels(tree)).toContain('Finish later');
    if (review) expect(labels(tree)).toContain('To review\u00a0· 3');
    expect(labels(tree)).toContain('＋ Add expense');
    const i = view.layout.sections.findIndex((s) => s.id === 'footer');
    expect(minimumHeight(tree.children![i], 1)).toBeLessThanOrEqual(view.layout.sections[i].height);
  },
);
it('draws admitted Group names, theme icons and Home amounts with their Group tap targets', () => {
  vi.stubGlobal('__DEV__', false);
  const c: WidgetCopy = {
    ...copy,
    home: { ...copy.home!, byGroup: { maple: [{ currency: 'INR', balanceMinor: -148000 }] } },
    savedGroups: {
      verifiedAt: now,
      rows: [
        {
          id: 'maple',
          name: 'Maple House',
          theme: 'home',
          archived: false,
          members: 3,
          currencies: 1,
        },
      ],
    },
  };
  const view = overviewWidget(
    c,
    { kind: 'balances', widgetId: 7 },
    { width: 360, height: 464 },
    auth,
    now,
  );
  expect(view.groups).toHaveLength(1);
  const tree = buildWidgetTree(drawOverview(view, lightTokens));
  expect(labels(tree)).toContain('Groups');
  expect(labels(tree)).toContain('Maple House');
  expect(labels(tree)).toContain('You owe');
  expect(labels(tree)).toContain('₹1,480.00');
});

it('draws one Home update prompt for an older copy without per-Group figures', () => {
  vi.stubGlobal('__DEV__', false);
  const c: WidgetCopy = {
    ...withPayments,
    savedGroups: {
      verifiedAt: now,
      rows: [
        {
          id: 'maple',
          name: 'Maple House',
          theme: 'home',
          archived: false,
          members: 3,
          currencies: 1,
        },
      ],
    },
  };
  const v = overviewWidget(
    c,
    { kind: 'balances', widgetId: 7 },
    { width: 360, height: 584 },
    auth,
    now,
  );
  const tree = buildWidgetTree(drawOverview(v, lightTokens));
  const groupSection = tree.children![v.layout.sections.findIndex((s) => s.id === 'groups')];
  expect(labels(groupSection)).toContain('Maple House');
  expect(labels(groupSection)).not.toContain('Open the Group to update');
  expect(labels(tree).filter((label) => label === 'Open to update')).toHaveLength(1);
});

it('draws Nothing saved yet as a left-aligned text block without an icon', () => {
  vi.stubGlobal('__DEV__', false);
  const v = overviewWidget(
    null,
    { kind: 'balances', widgetId: 7 },
    { width: 360, height: 584 },
    auth,
    now,
  );
  expect(v.layout.showStateTile).toBe(false);
  const tree = buildWidgetTree(drawOverview(v, lightTokens));
  const message = tree.children![v.layout.sections.findIndex((s) => s.id === 'message')];
  expect(labels(message)).toContain('Nothing saved yet');
  expect(labels(message)).not.toContain('!');
  expect(labels(message).join(' ')).toContain(
    'Open Splitbook to load your balances, payments and Groups.',
  );
});

it.each([360, 720])(
  'aligns the large-text footer on one line when it fits, otherwise at the left at %s dp',
  (width) => {
    vi.stubGlobal('__DEV__', false);
    const v = overviewWidget(
      { ...withPayments, review: { count: 3, verifiedAt: now } },
      { kind: 'balances', widgetId: 7 },
      { width, height: 584 },
      auth,
      now,
      2,
    );
    const tree = buildWidgetTree(drawOverview(v, lightTokens));
    const section = tree.children![v.layout.sections.findIndex((s) => s.id === 'footer')];
    const footer = section.children![0];
    expect((footer.props as { orientation: string }).orientation).toBe(
      width === 720 ? 'HORIZONTAL' : 'VERTICAL',
    );
    if (width === 360) {
      const action = footer.children!.at(-1)!;
      expect((action.props as { gravity: number }).gravity & 7).toBe(3);
    }
  },
);

it.each([344, 464])(
  'draws hidden payment counts as measured rows inside a growing panel at %s dp',
  (height) => {
    vi.stubGlobal('__DEV__', false);
    const v = overviewWidget(
      withPayments,
      { kind: 'balances', widgetId: 7, hideAmounts: true },
      { width: 360, height },
      auth,
      now,
    );
    const tree = buildWidgetTree(drawOverview(v, lightTokens));
    const i = v.layout.sections.findIndex((s) => s.id === 'payment-counts');
    expect(i).toBeGreaterThanOrEqual(0);
    const panel = nodes(tree.children![i]).find(
      (n) =>
        (n.props as { backgroundColor?: string }).backgroundColor === lightTokens.surfaceMuted &&
        labels(n).includes('You pay 1 person'),
    );
    expect(panel).toBeDefined();
    expect(labels(panel!)).toContain('1 person pays you');
    expect(minimumHeight(tree.children![i])).toBeLessThanOrEqual(v.layout.sections[i].height);
    // Whole-pixel row rounding may leave less than one row's pixel per count.
    expect(v.layout.sections.find((s) => s.id === 'space')!.height).toBeLessThanOrEqual(1);
  },
);

it.each([172, 360])(
  'keeps the Finish later pencil and announces one Expense without its Group at %s dp',
  (width) => {
    vi.stubGlobal('__DEV__', false);
    const v = overviewWidget(
      {
        ...copy,
        review: { count: 3, verifiedAt: now },
        finishLater: { groupId: 'maple', groupName: 'Maple House' },
      },
      { kind: 'balances', widgetId: 7 },
      { width, height: 464 },
      auth,
      now,
    );
    const tree = buildWidgetTree(drawOverview(v, lightTokens));
    expect(v.finishLater).not.toBeNull();
    const chip = nodes(tree).find(
      (n) =>
        (n.props as { accessibilityLabel?: string }).accessibilityLabel === '1 Expense to finish',
    );
    expect(chip).toBeDefined();
    expect(JSON.stringify(chip)).not.toContain('Maple House');
    if (width === 360) {
      expect(v.layout.footerAcross).toBe(true);
      expect(labels(chip!)).toContain('Finish later');
      expect(JSON.stringify(chip)).toContain('M4 20h4L19 9l-4-4L4 16z');
    } else expect(labels(chip!)).toContain('✎');
    expect(v.summary).toContain('1 Expense to finish');
  },
);

it('keeps the quiet balance in one measured panel line with the note at the right', () => {
  vi.stubGlobal('__DEV__', false);
  const v = overviewWidget(
    { ...copy, home: { ...copy.home!, currencies: [] } },
    { kind: 'balances', widgetId: 7 },
    { width: 360, height: 464 },
    auth,
    now,
  );
  const tree = buildWidgetTree(drawOverview(v, lightTokens));
  const section = v.layout.sections.find((s) => s.id === 'message')!;
  const message = tree.children![v.layout.sections.indexOf(section)];
  const panel = nodes(message).find(
    (n) => (n.props as { backgroundColor?: string }).backgroundColor === lightTokens.surfaceMuted,
  );
  expect(panel).toBeDefined();
  expect(labels(panel!)).toContain('You’re all square');
  expect(labels(panel!)).toContain('in every currency');
  expect(labels(panel!)).toContain('✓');
  expect((panel!.props as { orientation: string }).orientation).toBe('HORIZONTAL');
  expect(minimumHeight(message)).toBeLessThanOrEqual(section.height);
  expect(section.height).toBeLessThan(50);
});

it('paints the footer inbox at its measured scaled size while the plus follows the action text', () => {
  vi.stubGlobal('__DEV__', false);
  const v = overviewWidget(
    { ...copy, review: { count: 3, verifiedAt: now } },
    { kind: 'balances', widgetId: 7 },
    { width: 360, height: 584 },
    auth,
    now,
    2,
  );
  const tree = buildWidgetTree(drawOverview(v, lightTokens));
  const footer = tree.children![v.layout.sections.findIndex((s) => s.id === 'footer')];
  const icons = nodes(footer).filter(
    (n) => !!n.props && typeof n.props === 'object' && 'svgString' in n.props,
  );
  expect(icons).toHaveLength(1);
  expect(icons[0].props).toMatchObject({ width: 28, height: 28 });
  expect(labels(footer)).toContain('＋ Add expense');
});

it.each([1, 1.3, 2])(
  'draws and measures the Overview mark at the title text scale (%s)',
  (scale) => {
    vi.stubGlobal('__DEV__', false);
    const v = overviewWidget(
      copy,
      { kind: 'balances', widgetId: 7 },
      { width: 360, height: 584, pixelRatio: 2.625 },
      auth,
      now,
      scale,
    );
    const header = buildWidgetTree(drawOverview(v, lightTokens)).children![0];
    const mark = nodes(header).find(
      (n) => !!n.props && typeof n.props === 'object' && 'svgString' in n.props,
    )!;
    const expected = scale === 1 ? 16 : scale === 1.3 ? 20.952380952380953 : 32;
    expect(mark.props).toMatchObject({ width: expected, height: expected });
    expect(v.layout.sections[0].height).toBeGreaterThanOrEqual(expected);
  },
);
