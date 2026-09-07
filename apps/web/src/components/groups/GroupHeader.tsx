'use client';

import Link from 'next/link';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Avatar from '@mui/material/Avatar';
import AvatarGroup from '@mui/material/AvatarGroup';
import MoneyText from '@/components/common/MoneyText';
import { getMoneyTone } from '@splitbook/shared/money';
import { formatCurrency } from '@splitbook/shared/currency';

export interface GroupHeaderAmount {
  amount: number;
  currency: string;
}

export interface GroupHeaderMember {
  _id: string;
  name: string;
  image?: string;
}

interface GroupHeaderProps {
  name: string;
  /** Theme display name, e.g. "Household" — shown as the header overline. */
  themeLabel: string;
  themeIcon: string;
  currency: string;
  /** compact: dashboard group cards · full: group workspace header */
  variant?: 'compact' | 'full';
  /** Makes the whole header a link to the group. */
  href?: string;
  dateLabel?: string | null;
  members?: GroupHeaderMember[];
  /** Signed-in user, rendered as "You" in the member list. */
  userId?: string;
  inviteCode?: string | null;
  /** Signed personal balance; null/undefined or ~0 renders "Settled". */
  balance?: GroupHeaderAmount | null;
  /** Data has not loaded; never describe an unknown balance as settled. */
  balanceUnavailable?: boolean;
  /** Square off the bottom corners when content sits directly below (group cards). */
  joinedBottom?: boolean;
}

function BalanceBlock({
  balance,
  unavailable,
}: {
  balance?: GroupHeaderAmount | null;
  unavailable: boolean;
}) {
  const tone = balance ? getMoneyTone(balance.amount) : 'neutral';
  return (
    <Box>
      <Typography
        component="span"
        sx={{
          display: 'block',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'text.disabled',
          fontWeight: 600,
        }}
      >
        Your balance
      </Typography>
      {unavailable || !balance || tone === 'neutral' ? (
        <Typography
          sx={(theme) => ({
            ...(theme.typography.money as React.CSSProperties),
            fontSize: '1.125rem',
            fontWeight: 600,
            color: 'text.primary',
          })}
        >
          {unavailable ? 'Balance unavailable' : 'Settled'}
        </Typography>
      ) : (
        <MoneyText
          amount={balance.amount}
          currency={balance.currency}
          signed
          sx={{ display: 'block', fontSize: '1.125rem', fontWeight: 600 }}
        />
      )}
    </Box>
  );
}

/**
 * Neutral ledger header for non-trip themes — the sibling of TripStrip.
 * Carries the same four facts (name, members, currency, your balance) plus
 * the invite code, in a plain Paper with the shared money typography.
 * No perforations, no route codes.
 */
export default function GroupHeader({
  name,
  themeLabel,
  themeIcon,
  currency,
  variant = 'compact',
  href,
  dateLabel,
  members = [],
  userId,
  inviteCode,
  balance,
  balanceUnavailable = false,
  joinedBottom = false,
}: GroupHeaderProps) {
  const isFull = variant === 'full';

  const tone = balance ? getMoneyTone(balance.amount) : 'neutral';
  const balanceDescription = balanceUnavailable
    ? 'Balance unavailable'
    : !balance || tone === 'neutral'
      ? 'Settled up'
      : tone === 'positive'
        ? `You're owed ${formatCurrency(balance.amount, balance.currency)}`
        : `You owe ${formatCurrency(Math.abs(balance.amount), balance.currency)}`;

  const memberNames = members.map((member) =>
    member._id === userId ? 'You' : member.name.split(' ')[0],
  );
  const peopleLabel = `${members.length} ${members.length === 1 ? 'person' : 'people'}`;

  const ariaLabel = [`${name}, ${themeLabel}`, dateLabel, peopleLabel, `${balanceDescription}.`]
    .filter(Boolean)
    .join(', ');

  if (!isFull) {
    return (
      <Box
        component={href ? Link : 'div'}
        href={href}
        aria-label={ariaLabel}
        role={href ? undefined : 'region'}
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.5,
          minHeight: 88,
          textDecoration: 'none',
          color: 'text.primary',
          ...(joinedBottom
            ? { borderBottom: '1px solid', borderColor: 'divider' }
            : { borderRadius: '12px' }),
          ...(href
            ? {
                cursor: 'pointer',
                transition: 'background-color 160ms ease',
                '&:hover': { bgcolor: 'action.hover' },
                '&:focus-visible': { outlineOffset: 3 },
              }
            : {}),
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography component="span" aria-hidden="true" sx={{ fontSize: '1.25rem' }}>
              {themeIcon}
            </Typography>
            <Typography
              fontWeight={700}
              noWrap
              sx={{ fontSize: '1.125rem', letterSpacing: '-0.02em' }}
            >
              {name}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {[themeLabel, currency, members.length ? peopleLabel : null, dateLabel]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
          <BalanceBlock balance={balance} unavailable={balanceUnavailable} />
        </Box>
      </Box>
    );
  }

  return (
    <Paper
      variant="outlined"
      component={href ? Link : 'div'}
      href={href}
      aria-label={ariaLabel}
      role={href ? undefined : 'region'}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr auto' },
        gap: { xs: 2, sm: 3 },
        p: { xs: 2, sm: 3 },
        boxShadow: 2,
        textDecoration: 'none',
        color: 'text.primary',
        ...(href
          ? {
              cursor: 'pointer',
              transition: 'transform 160ms ease',
              '&:hover': { transform: 'translateY(-1px)' },
              '&:focus-visible': { outlineOffset: 3 },
            }
          : {}),
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="overline"
          component="p"
          color="text.disabled"
          sx={{ display: 'block' }}
        >
          {themeIcon} {themeLabel}
        </Typography>
        <Typography variant="h5" color="text.primary" sx={{ mt: 0.5 }}>
          {name}
        </Typography>
        {dateLabel && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {dateLabel}
          </Typography>
        )}

        <Stack
          direction="row"
          sx={{
            flexWrap: 'wrap',
            columnGap: 3,
            rowGap: 1.5,
            mt: 2,
            alignItems: 'center',
          }}
        >
          {members.length > 0 && (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
              <AvatarGroup
                max={5}
                sx={{ '& .MuiAvatar-root': { width: 28, height: 28, fontSize: 12 } }}
              >
                {members.map((member) => (
                  <Avatar
                    key={member._id}
                    src={member.image}
                    alt={member.name}
                    sx={{ width: 28, height: 28 }}
                  >
                    {member.name?.[0]}
                  </Avatar>
                ))}
              </AvatarGroup>
              <Typography variant="body2" color="text.secondary" noWrap>
                {memberNames.join(' · ')}
              </Typography>
            </Stack>
          )}
          <Box component="span">
            <Box
              component="strong"
              sx={{ display: 'block', fontWeight: 600, fontSize: '0.875rem' }}
            >
              Currency
            </Box>
            <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
              {currency}
            </Box>
          </Box>
          {inviteCode && (
            <Box component="span">
              <Box
                component="strong"
                sx={{ display: 'block', fontWeight: 600, fontSize: '0.875rem' }}
              >
                Invite
              </Box>
              <Box
                component="span"
                sx={(theme) => ({
                  ...(theme.typography.money as React.CSSProperties),
                  color: 'text.secondary',
                  fontSize: '0.875rem',
                })}
              >
                {inviteCode}
              </Box>
            </Box>
          )}
        </Stack>
      </Box>

      <Box
        sx={{
          minWidth: { sm: 140 },
          pl: { sm: 3 },
          pt: { xs: 2, sm: 0 },
          borderLeft: { sm: '1px solid' },
          borderTop: { xs: '1px solid', sm: 'none' },
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <BalanceBlock balance={balance} unavailable={balanceUnavailable} />
      </Box>
    </Paper>
  );
}
