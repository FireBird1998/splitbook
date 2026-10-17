import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CallSplitOutlinedIcon from '@mui/icons-material/CallSplitOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CurrencyExchangeOutlinedIcon from '@mui/icons-material/CurrencyExchangeOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import { formatCurrency } from '@splitbook/shared/currency';
import {
  calculateSplitAmountsMinor,
  parseAmountMinor,
  sumMinorAmounts,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import MoneyText from '@/components/common/MoneyText';
import { PRODUCT_NAME } from '@/lib/product';
import LandingSection, { landingCard } from './LandingSection';

type Share = { user: string; shares?: number };

/** Each share as Splitbook's own split works it out, in exact paise. */
const split = (method: 'equal' | 'shares', amount: number, shares: Share[]) =>
  calculateSplitAmountsMinor(method, parseAmountMinor(amount, 'INR'), shares).map((share) => ({
    ...share,
    amount: toMajorAmount(share.amountMinor, 'INR'),
  }));

/** ₹1,000 between three: the first share takes the extra paisa. */
const thirds = split('equal', 1000, [{ user: 'a' }, { user: 'b' }, { user: 'c' }]);

/** The example Expense: Groceries ₹1,000 paid by Sam, split by shares 2:1:1:1. */
const GROCERIES = 1000;
const groceries = split('shares', GROCERIES, [
  { user: 'You', shares: 2 },
  { user: 'Priya', shares: 1 },
  { user: 'Sam', shares: 1 },
  { user: 'Alex', shares: 1 },
]);

const POINTS: { icon: typeof GroupOutlinedIcon; text: ReactNode }[] = [
  {
    icon: CallSplitOutlinedIcon,
    text: 'Equally, by shares, by percent or exact amounts, between everyone or just the people who were there.',
  },
  {
    icon: PaymentsOutlinedIcon,
    text: 'More than one payer? Say who paid what, and the split still adds up.',
  },
  {
    icon: CheckCircleOutlineIcon,
    text: `Every paisa lands somewhere. ₹1,000 between three is ${thirds
      .map((share) => formatCurrency(share.amount, 'INR'))
      .join(' + ')}, never ₹999.99.`,
  },
  {
    icon: CurrencyExchangeOutlinedIcon,
    text: 'Each Group keeps its own currency, and balances never add currencies together.',
  },
];

function GroceriesCard() {
  return (
    <Box sx={{ ...landingCard, boxShadow: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Goa Weekend · Food
          </Typography>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" gap={2}>
            <Typography variant="h6" component="p" sx={{ m: 0 }}>
              Groceries
            </Typography>
            <MoneyText
              amount={GROCERIES}
              currency="INR"
              tone="neutral"
              color="text.primary"
              variant="h6"
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Paid by Sam · Split by shares
          </Typography>
        </Box>
        <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {groceries.map((row) => (
            <Box
              component="li"
              key={row.user}
              sx={{
                display: 'grid',
                gridTemplateColumns: '32px 1fr auto',
                alignItems: 'center',
                gap: 1.5,
                py: 1,
                borderTop: 1,
                borderColor: 'divider',
              }}
            >
              <Box
                aria-hidden
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'tint.brand',
                  color: 'primary.main',
                  fontWeight: 600,
                }}
              >
                {row.user[0]}
              </Box>
              <Typography variant="body2">
                {row.user}{' '}
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  {row.shares} {row.shares === 1 ? 'share' : 'shares'}
                </Box>
              </Typography>
              <MoneyText amount={row.amount} currency="INR" tone="neutral" color="text.primary" />
            </Box>
          ))}
        </Box>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ color: 'status.positive' }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <CheckCircleOutlineIcon fontSize="small" aria-hidden />
            <Typography variant="body2">Adds up to the Expense</Typography>
          </Stack>
          <MoneyText
            amount={toMajorAmount(sumMinorAmounts(groceries.map((row) => row.amountMinor)), 'INR')}
            currency="INR"
            tone="neutral"
            color="text.primary"
          />
        </Stack>
      </Stack>
    </Box>
  );
}

/** "Split it the way it happened": split methods, payers, exact paise and currencies (#446). */
export default function LandingSplit() {
  return (
    <LandingSection
      id="how"
      eyebrow="Split"
      title="Split it the way it actually happened."
      intro={`Dinner for four, a cab for three, groceries where one person ate twice as much: each Expense keeps its own split, and ${PRODUCT_NAME} keeps the arithmetic.`}
    >
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 4, md: 7 },
          alignItems: 'center',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.1fr) minmax(0, 1fr)' },
        }}
      >
        <Stack component="ul" spacing={2.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {POINTS.map(({ icon: Icon, text }, index) => (
            <Stack component="li" key={index} direction="row" spacing={1.75}>
              <Icon color="primary" aria-hidden sx={{ mt: 0.25 }} />
              <Typography variant="body1" color="text.primary">
                {text}
              </Typography>
            </Stack>
          ))}
        </Stack>
        <GroceriesCard />
      </Box>
    </LandingSection>
  );
}
