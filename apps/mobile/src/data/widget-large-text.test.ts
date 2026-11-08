import { expect, it } from 'vitest';
import { balancesWidget, type WidgetCopy } from '@splitbook/shared/balances-widget';
import { groupWidget, type WidgetGroupPart } from '@splitbook/shared/group-widget';
import { quickWidget } from '@splitbook/shared/quick-widget';
const now = Date.parse('2026-11-08T04:11:00Z');
const auth = { status: 'authenticated' as const, accountId: 'alex', loading: false };
const setup = { kind: 'group' as const, widgetId: 7, accountId: 'alex', groupId: 'maple' };
const part: WidgetGroupPart = {
  id: 'maple',
  name: 'Maple House',
  theme: 'home',
  archived: false,
  mainCurrency: 'INR',
  verifiedAt: now,
  balancesVerifiedAt: now,
  currencies: ['INR', 'EUR', 'JPY'].map((currency) => ({
    currency,
    balanceMinor: -148000,
    payments: [1, 2].map((i) => ({
      from: 'alex',
      to: 'member' + i,
      fromName: 'Alex Rivera',
      toName: 'Fictional Member ' + i,
      amountMinor: 74000,
    })),
  })),
};
const copy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: {
    verifiedAt: now,
    groupCount: 4,
    currencies: ['INR', 'EUR', 'JPY'].map((currency) => ({
      currency,
      owedMinor: 240000,
      oweMinor: 148000,
    })),
  },
  groups: { maple: part },
  review: { count: 3, verifiedAt: now },
};
it.each([
  ['2x1', 1, 1],
  ['2x1', 1.3, 1],
  ['2x1', 2, 1],
  ['2x2', 1, 2],
  ['2x2', 1.3, 1],
  ['2x2', 2, 1],
  ['4x2', 1, 3],
  ['4x2', 1.3, 2],
  ['4x2', 2, 1],
] as const)('limits Balances %s at %s text to %s currency lines per side', (size, scale, lines) => {
  const v = balancesWidget(copy, { kind: 'balances' }, size, auth, now, scale);
  expect(v.owed).toHaveLength(lines);
  expect(v.owe).toHaveLength(lines);
  expect(v.layout.showReview).toBe(scale === 1 && size !== '2x1');
  if (scale > 1) expect(v.owedOverflow).toContain(String(3 - lines));
});
it.each([
  ['2x2', 1, 0],
  ['2x2', 1.3, 0],
  ['2x2', 2, 0],
  ['4x2', 1, 2],
  ['4x2', 1.3, 1],
  ['4x2', 2, 0],
  ['4x3', 1, 4],
  ['4x3', 1.3, 2],
  ['4x3', 2, 1],
] as const)('limits Group %s at %s text to %s payment lines', (size, scale, lines) => {
  const v = groupWidget(part, setup, size, auth, now, scale);
  expect(v.payments).toHaveLength(lines);
  if (scale > 1 && size !== '2x2') expect(v.more).toContain(String(6 - lines));
  expect(v.layout.showDescription).toBe(scale < 2 && (size !== '2x2' || scale === 1));
});
it.each([1, 1.3, 2])('keeps the entire spoken summary when visual lines drop at %s', (scale) => {
  expect(balancesWidget(copy, { kind: 'balances' }, '2x2', auth, now, scale).summary).toBe(
    balancesWidget(copy, { kind: 'balances' }, '2x2', auth, now).summary,
  );
  expect(groupWidget(part, setup, '4x3', auth, now, scale).summary).toBe(
    groupWidget(part, setup, '4x3', auth, now).summary,
  );
});
it.each([1, 1.3, 2])('drops Add expense state text in 1x1 and caps 2x1 names at %s', (scale) => {
  const quick = { ...setup, kind: 'quick' as const };
  const blocked = quickWidget(copy, quick, '1x1', { status: 'expired' }, scale);
  expect(blocked.layout.showTitle).toBe(scale === 1);
  expect(blocked.layout.showSubtitle).toBe(false);
  const wide = quickWidget(copy, quick, '2x1', auth, scale);
  expect(wide.layout.subtitleMaxLines).toBe(2);
  expect(wide.layout.showTitle).toBe(scale < 2);
  expect(wide.summary).toBe('Add expense in Maple House');
});
it('keeps compact expired Balances to two text lines without a stacked lock tile', () => {
  const v = balancesWidget(copy, { kind: 'balances' }, '2x1', { status: 'expired' }, now);
  expect(v.layout.showTile).toBe(false);
  expect(v.layout.showHeader).toBe(false);
  expect(v.title).toBe('Sign in again');
  expect(v.description).toBe('to see balances');
});

it('treats Android’s float representation of 130% as large text', () => {
  const androidScale = 1.2999999523162842;
  expect(
    balancesWidget(copy, { kind: 'balances' }, '2x2', auth, now, androidScale).owed,
  ).toHaveLength(1);
  expect(groupWidget(part, setup, '4x2', auth, now, androidScale).payments).toHaveLength(1);
  expect(
    quickWidget(copy, { ...setup, kind: 'quick' }, '1x1', { status: 'expired' }, androidScale)
      .layout.showTitle,
  ).toBe(false);
});

it('keeps the compact Group action on one readable line at 200% without losing saved time', () => {
  const v = groupWidget(part, setup, '2x2', auth, now, 2);
  expect(v.layout).toMatchObject({
    actionFontSize: 10,
    actionPaddingHorizontal: 6,
    showSaved: true,
  });
  expect(v.addExpense).toBe(true);
});

it('drops optional privacy captions in tight large-text layouts but keeps them in speech', () => {
  const b = balancesWidget(copy, { kind: 'balances', hideAmounts: true }, '2x1', auth, now, 2);
  expect(b.layout).toMatchObject({ showHeader: false, showPrivacyLabel: false, hiddenFontSize: 8 });
  expect(b.summary).toContain('Amounts hidden');
  const g = groupWidget(part, { ...setup, hideAmounts: true }, '2x2', auth, now, 2);
  expect(g.layout.showPrivacyLabel).toBe(false);
  expect(g.summary).toContain('Amounts and names hidden');
});

it('gives both hidden Balances columns equal room in the compact widget at 200%', () => {
  const v = balancesWidget(copy, { kind: 'balances', hideAmounts: true }, '2x1', auth, now, 2);
  expect(v.layout.equalColumns).toBe(true);
});
