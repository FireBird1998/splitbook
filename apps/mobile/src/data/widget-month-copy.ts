import { getCurrency } from '@splitbook/shared/currency';
import { parseAmountMinor, readUnsupportedAmountMinor } from '@splitbook/shared/exact-money';
import type { WidgetMonthPart } from '@splitbook/shared/group-widget';
import { parseExpensePage } from './financial-dto';
import type { MobileGroup } from './types';

/** The summary already returned with a Month page, including its own verification time. */
export function widgetMonthCopy(
  group: MobileGroup,
  value: unknown,
  accountId: string,
  month: string,
  verifiedAt: number,
): WidgetMonthPart {
  const { summary } = parseExpensePage(value, group.id, group.defaultCurrency);
  const member = summary.byMember.find((row) => row.user.id === accountId);
  return {
    month,
    verifiedAt,
    count: summary.count,
    mainCurrency: group.defaultCurrency,
    mainCurrencyOnly: group.alternateCurrencies.length > 0 || summary.totalsByCurrency.length > 1,
    totals:
      summary.totalsByCurrency.length === 0 && summary.count === 0
        ? [{ currency: group.defaultCurrency, totalMinor: 0 }]
        : summary.totalsByCurrency.map((row) => ({
            currency: row.currency,
            totalMinor: getCurrency(row.currency)
              ? parseAmountMinor(row.totalAmount, row.currency)
              : readUnsupportedAmountMinor({ amount: row.totalAmount }),
          })),
    ...(member ? { shareMinor: parseAmountMinor(member.share, group.defaultCurrency) } : {}),
  };
}
