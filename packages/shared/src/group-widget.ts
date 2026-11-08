import { formatCurrency } from './currency';
import { toMajorAmount } from './exact-money';
import { counted } from './separator';
import { widgetSavedTime, type WidgetSession } from './balances-widget';
import type { GroupCategory } from './types';
export interface GroupWidgetSetup {
  kind: 'group'; widgetId: number; accountId: string; groupId: string;
}
export interface WidgetGroupPart {
  id: string; name: string; theme: GroupCategory; archived: boolean; mainCurrency: string;
  verifiedAt: number; balancesVerifiedAt: number;
  currencies: { currency: string; balanceMinor: number; payments: { from: string | null; to: string | null; fromName: string; toName: string; amountMinor: number }[] }[];
}
export type GroupWidgetSize = '2x2' | '4x2' | '4x3';
export function groupWidget(part: WidgetGroupPart | null | undefined, setup: GroupWidgetSetup, size: GroupWidgetSize, session: WidgetSession, now: number) {
  const own = part?.currencies.flatMap(bucket => bucket.payments.filter(payment => payment.from === setup.accountId || payment.to === setup.accountId).map(payment => ({
    label: payment.from === setup.accountId ? `You pay ${payment.toName.trim().split(/\s+/)[0]}` : `${payment.fromName.trim().split(/\s+/)[0]} pays you`,
    amount: formatCurrency(toMajorAmount(payment.amountMinor, bucket.currency), bucket.currency),
  }))) ?? [];
  const bucket = part?.currencies[0];
  return { state:'normal', name:part?.name ?? null, theme:part?.theme ?? null,
    balance: bucket ? `${bucket.balanceMinor < 0 ? 'You owe' : 'You’re owed'} ${formatCurrency(toMajorAmount(Math.abs(bucket.balanceMinor), bucket.currency), bucket.currency)}` : '',
    payments:own.slice(0, size === '4x3' ? 4 : 2), more:own.length > 2 ? `+${counted(own.length - 2, 'more', 'more')}` : null,
    addExpense:true, saved:part ? widgetSavedTime(part.balancesVerifiedAt, now) : null,
  };
}
