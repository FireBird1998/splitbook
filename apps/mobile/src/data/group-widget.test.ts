import { beforeAll, afterAll, expect, it } from 'vitest';
import { groupWidget, type WidgetGroupPart } from '@splitbook/shared/group-widget';
const previousZone = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Asia/Kolkata'; });
afterAll(() => { process.env.TZ = previousZone; });
const now = Date.parse('2026-11-08T04:11:00Z');
export const part: WidgetGroupPart = {
  id: 'maple', name: 'Maple House', theme: 'home', archived: false, mainCurrency: 'INR',
  verifiedAt: now, balancesVerifiedAt: now,
  currencies: [{ currency: 'INR', balanceMinor: -148000, payments: [
    { from: 'alex', to: 'priya', fromName: 'Alex Rivera', toName: 'Priya Shah', amountMinor: 106000 },
    { from: 'alex', to: 'sam', fromName: 'Alex Rivera', toName: 'Sam Chen', amountMinor: 42000 },
    { from: 'sam', to: 'priya', fromName: 'Sam Chen', toName: 'Priya Shah', amountMinor: 90000 },
  ] }],
};
export const setup = { kind: 'group' as const, accountId: 'alex', groupId: 'maple', widgetId: 7 };
it('shows only my Suggested payments with first names, and never a payment between others', () => {
 const view = groupWidget(part, setup, '4x2', { status: 'authenticated', accountId:'alex', loading:false }, now);
 expect(view).toMatchObject({ state:'normal', name:'Maple House', balance:'You owe ₹1,480.00', payments:[
   { label:'You pay Priya', amount:'₹1,060.00' }, { label:'You pay Sam', amount:'₹420.00' },
 ], addExpense:true, saved:'Saved 9:41' });
});
