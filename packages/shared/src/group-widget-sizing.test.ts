import { afterAll, beforeAll, expect, it } from 'vitest';
import { groupWidget, type WidgetGroupPart } from './group-widget';
const zone = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Asia/Kolkata'; });
afterAll(() => { process.env.TZ = zone; });
const now = Date.parse('2026-11-13T04:11:00Z');
const auth = { status: 'authenticated' as const, accountId: 'alex', loading: false };
const setup = { kind: 'group' as const, accountId: 'alex', groupId: 'maple', widgetId: 7 };
const part: WidgetGroupPart = {
  id: 'maple', name: 'Maple House', theme: 'home', archived: false,
  mainCurrency: 'INR', verifiedAt: now, balancesVerifiedAt: now,
  currencies: [{ currency: 'INR', balanceMinor: -148000,
    payments: Array.from({ length: 12 }, (_, index) => ({ from: 'alex', to: 'person'+index, fromName: 'Alex', toName: 'Sam', toInitials: 'SC', amountMinor: 1000 })) }],
};
it('uses a tall real size for more payment rows and shares all leftover height among them', () => {
  const view = groupWidget(part, setup, { width: 372, height: 512 }, auth, now);
  expect(view.payments.length).toBeGreaterThan(4);
  expect(view.layout.sections.map(({ id }) => id)).toEqual(['header', 'payments', 'action']);
  expect(view.layout.sections.reduce((sum, s) => sum + s.height, 0) + view.layout.gap * 2 + view.layout.padding * 2).toBe(512);
});
