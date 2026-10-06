'use client';

import type { CSSProperties } from 'react';
import type { Theme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { formatCurrency } from '@splitbook/shared/currency';
import type { HomeCurrencyBalance } from '@splitbook/shared/dashboard';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { formatSignedCurrency } from '@splitbook/shared/money';
import { RADIUS } from '@/lib/theme/tokens';
import { HomeCard, HomeCardBody, HomeCardEmpty, HomeCardError, HomeCardLoading } from './HomeCard';
import { useHomeBalances, type CardRead, type HomeBalances } from './home-reads';

/** IBM Plex Mono with tabular figures, the theme's money type. */
const money = (theme: Theme): CSSProperties => theme.typography.money;

/** "3 Groups": the Groups where the member's balance in the currency isn't zero. */
export function groupCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'Group' : 'Groups'}`;
}

function toneColor(minor: number, tone: 'negative' | 'positive') {
  return minor === 0 ? 'text.secondary' : `status.${tone}`;
}

/** One currency: Net, large, then You owe and Owed to you, exact and never converted. */
function CurrencyBalance({ balance }: { balance: HomeCurrencyBalance }) {
  const { currency, netMinor, youOweMinor, owedToYouMinor, groupCount } = balance;
  const labelId = `home-balance-${currency}`;
  const amount = (minor: number) => formatCurrency(toMajorAmount(minor, currency), currency);
  return (
    <Box
      role="group"
      aria-labelledby={labelId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.75,
        px: 2.25,
        py: 2,
        minWidth: 0,
        borderRadius: `${RADIUS.md}px`,
        bgcolor: 'surface.muted',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography
          id={labelId}
          component="span"
          sx={(theme) => ({
            ...money(theme),
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'text.secondary',
            bgcolor: 'background.paper',
            borderRadius: `${RADIUS.sm}px`,
            px: 1,
            py: 0.375,
          })}
        >
          {currency}
        </Typography>
        <Typography component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
          {groupCountLabel(groupCount)}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <Typography component="span" sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>
          Net
        </Typography>
        <Typography
          component="span"
          sx={(theme) => ({
            ...money(theme),
            fontSize: { xs: '2rem', sm: '2.5rem' },
            lineHeight: 1.05,
            letterSpacing: '-0.04em',
            overflowWrap: 'anywhere',
            color:
              netMinor < 0 ? 'status.negative' : netMinor > 0 ? 'status.positive' : 'text.primary',
          })}
        >
          {formatSignedCurrency(toMajorAmount(netMinor, currency), currency)}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <Typography component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
            You owe
          </Typography>
          <Typography
            component="span"
            sx={(theme) => ({
              ...money(theme),
              fontSize: '0.875rem',
              color: toneColor(youOweMinor, 'negative'),
            })}
          >
            {amount(youOweMinor)}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          <Typography component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
            Owed to you
          </Typography>
          <Typography
            component="span"
            sx={(theme) => ({
              ...money(theme),
              fontSize: '0.875rem',
              color: toneColor(owedToYouMinor, 'positive'),
            })}
          >
            {amount(owedToYouMinor)}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

interface BalancesCardViewProps {
  balances: CardRead<HomeBalances>;
  onRetry: () => void;
}

/** Your balances, in whichever state its read is in. */
export function BalancesCardView({ balances, onRetry }: BalancesCardViewProps) {
  return (
    <HomeCard
      id="home-balances"
      title="Your balances"
      aside={
        <Typography component="p" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
          Each currency on its own. Nothing is converted.
        </Typography>
      }
    >
      {balances.status === 'loading' ? (
        <HomeCardLoading label="Loading your balances" blocks={1} height={168} />
      ) : balances.status === 'error' ? (
        <HomeCardError message="Your balances could not be loaded." onRetry={onRetry} />
      ) : balances.value.currencies.length === 0 ? (
        balances.value.groupCount === 0 ? (
          <HomeCardEmpty
            title="No balances yet"
            description="Create or join a Group, and what you owe and are owed shows here."
          />
        ) : (
          <HomeCardEmpty
            icon={<CheckCircleOutlineIcon aria-hidden sx={{ color: 'status.positive' }} />}
            title="You’re settled up"
            description="Nobody owes you, and you owe nobody, in any of your Groups."
          />
        )
      ) : (
        <HomeCardBody>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
              gap: 1.5,
            }}
          >
            {balances.value.currencies.map((balance) => (
              <CurrencyBalance key={balance.currency} balance={balance} />
            ))}
          </Box>
        </HomeCardBody>
      )}
    </HomeCard>
  );
}

/** Home's "Your balances" card: the member's balance per currency, with the net amount. */
export default function BalancesCard() {
  const { balances, retry } = useHomeBalances();
  return <BalancesCardView balances={balances} onRetry={retry} />;
}
