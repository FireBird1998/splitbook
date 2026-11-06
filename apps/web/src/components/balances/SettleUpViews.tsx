'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import SegmentedControl from '@/components/charts/SegmentedControl';
import MoneyText from '@/components/common/MoneyText';
import { TabCard } from './TabCard';
import PaymentRow from './PaymentRow';
import { SEPARATOR, counted } from '@splitbook/shared/separator';
import { displayMajorAmount, readLegacyAmountMinor } from '@splitbook/shared/exact-money';
import {
  debtsAfterSimplifying,
  type AfterSimplifying,
} from '@splitbook/shared/debt-after-simplifying';

export interface Debt {
  from: { _id: string; name: string };
  to: { _id: string; name: string };
  amount: number;
}

type View = 'suggested' | 'before';
const NO_PAYMENTS: Debt[] = [];
interface Props {
  currency: string;
  viewerId: string;
  /** Missing on older replies; the existing Suggested view remains available. */
  debts?: Debt[];
  /** The Suggested payments in the same currency, which say what each Debt becomes. */
  suggested?: Debt[];
  suggestedCount: number;
  children?: ReactNode;
  initialView?: View;
}

/**
 * What each Debt becomes after simplifying, from the same reply's Suggested payments in exact
 * minor units of the one currency shown; null for every Debt when an amount doesn't read
 * exactly, so no row claims an outcome it can't show.
 */
function outcomes(debts: Debt[], suggested: Debt[], currency: string): (AfterSimplifying | null)[] {
  const exact = (payment: Debt) => ({
    from: payment.from._id,
    to: payment.to._id,
    currency,
    amountMinor: readLegacyAmountMinor(payment.amount, currency),
  });
  try {
    return debtsAfterSimplifying(debts.map(exact), suggested.map(exact));
  } catch {
    return debts.map(() => null);
  }
}

/** Adds the explanation of Debts around the existing Suggested list and actions. */
export default function SettleUpViews({
  currency,
  viewerId,
  debts,
  suggested = NO_PAYMENTS,
  suggestedCount,
  children,
  initialView = 'suggested',
}: Props) {
  const [view, setView] = useState<View>(initialView);
  const hasViews = debts !== undefined && suggestedCount > 0;
  const showingSuggested = !hasViews || view === 'suggested';
  const fewer = hasViews && suggestedCount < debts.length;
  const after = useMemo(
    () => (debts ? outcomes(debts, suggested, currency) : []),
    [debts, suggested, currency],
  );
  const debtCount = debts?.length ?? 0;
  return (
    <TabCard
      headingId="settle-up-heading"
      title="Settle up"
      subtitle={
        showingSuggested
          ? suggestedCount > 0
            ? `${currency}${SEPARATOR}Record one once it’s paid`
            : currency
          : `${currency}${SEPARATOR}the ${counted(debtCount, 'debt')} as the Expenses left them`
      }
      aside={
        hasViews ? (
          // In the header's action slot; below `sm` it wraps under the title, full width.
          <Box
            className="settle-up-view-switch"
            sx={{ flex: { xs: '1 0 100%', sm: '0 0 auto' }, display: 'flex' }}
          >
            <SegmentedControl
              label="Settle up view"
              value={view}
              onChange={setView}
              options={[
                { value: 'suggested', label: 'Suggested' },
                { value: 'before', label: 'Before simplifying' },
              ]}
            />
          </Box>
        ) : null
      }
    >
      {showingSuggested ? (
        children
      ) : (
        <Box
          component="ul"
          aria-label="Debts before simplifying"
          sx={{ listStyle: 'none', m: 0, p: 0 }}
        >
          {debts?.map((debt, index) => {
            const outcome = after[index];
            return (
              <PaymentRow
                key={`${debt.from._id}-${debt.to._id}`}
                fromName={debt.from.name}
                toName={debt.to.name}
                title={`${debt.from._id === viewerId ? 'You owe' : `${debt.from.name} owes`} ${
                  debt.to._id === viewerId ? 'you' : debt.to.name
                }`}
                sub={
                  outcome?.kind === 'becomes' ? (
                    <>
                      Becomes{' '}
                      <MoneyText
                        component="span"
                        amount={displayMajorAmount(outcome.amountMinor, currency)}
                        currency={currency}
                        tone="neutral"
                        color="inherit"
                        sx={{ fontSize: 'inherit' }}
                      />{' '}
                      after simplifying
                    </>
                  ) : outcome?.kind === 'settled' ? (
                    'Settled by the other payments'
                  ) : null
                }
                end={
                  <MoneyText
                    amount={debt.amount}
                    currency={currency}
                    tone="neutral"
                    sx={{ fontSize: '1rem', fontWeight: 500 }}
                  />
                }
              />
            );
          })}
        </Box>
      )}
      {fewer && (
        <Typography sx={{ m: 0, px: 2.5, pb: 2.5, fontSize: '0.875rem', color: 'text.secondary' }}>
          {counted(suggestedCount, 'payment')} {suggestedCount === 1 ? 'settles' : 'settle'} the
          same {counted(debts?.length ?? 0, 'debt')}. Everyone ends settled up either way.
        </Typography>
      )}
    </TabCard>
  );
}
