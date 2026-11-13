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
