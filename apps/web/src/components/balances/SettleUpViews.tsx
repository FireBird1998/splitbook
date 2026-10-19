'use client';

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import SegmentedControl from '@/components/charts/SegmentedControl';
import MoneyText from '@/components/common/MoneyText';
import { TabCard } from './TabCard';

export interface Debt {
  from: { _id: string; name: string };
  to: { _id: string; name: string };
  amount: number;
}

type View = 'suggested' | 'before';
interface Props {
  currency: string;
  viewerId: string;
  /** Missing on older replies; the existing Suggested view remains available. */
  debts?: Debt[];
  suggestedCount: number;
  children?: ReactNode;
  initialView?: View;
}

/** Adds the explanation of Debts around the existing Suggested list and actions. */
export default function SettleUpViews({
  currency,
  viewerId,
  debts,
  suggestedCount,
  children,
  initialView = 'suggested',
}: Props) {
  const [view, setView] = useState<View>(initialView);
  const hasViews = debts !== undefined && suggestedCount > 0;
  const showingSuggested = !hasViews || view === 'suggested';
  const fewer = hasViews && suggestedCount < debts.length;
  return (
    <TabCard
      headingId="settle-up-heading"
      title="Settle up"
      subtitle={
        showingSuggested && suggestedCount > 0
          ? `${currency} · Record one once it’s paid`
          : currency
      }
    >
      {hasViews && (
        <Box sx={{ px: 2.5, pb: 2 }}>
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
      )}
      {showingSuggested ? (
        children
      ) : (
        <Box
          component="ul"
          aria-label="Debts before simplifying"
          sx={{ listStyle: 'none', m: 0, p: 0 }}
        >
          {debts?.map((debt) => (
            <Box
              component="li"
              key={`${debt.from._id}-${debt.to._id}`}
              sx={{ px: 2.5, py: 2, '& + li': { borderTop: 1, borderColor: 'divider' } }}
            >
              <Typography component="p" sx={{ m: 0, fontSize: '0.875rem' }}>
                {debt.from._id === viewerId ? 'You owe' : `${debt.from.name} owes`}{' '}
                {debt.to._id === viewerId ? 'you' : debt.to.name}{' '}
                <MoneyText
                  component="span"
                  amount={debt.amount}
                  currency={currency}
                  tone="neutral"
                  sx={{ fontSize: '1rem', fontWeight: 500 }}
                />
              </Typography>
            </Box>
          ))}
        </Box>
      )}
      {fewer && (
        <Typography sx={{ m: 0, px: 2.5, pb: 2.5, fontSize: '0.875rem', color: 'text.secondary' }}>
          {suggestedCount} {suggestedCount === 1 ? 'payment settles' : 'payments settle'} the same{' '}
          {debts?.length} {debts?.length === 1 ? 'debt' : 'debts'}. Everyone ends settled up either
          way.
        </Typography>
      )}
    </TabCard>
  );
}
