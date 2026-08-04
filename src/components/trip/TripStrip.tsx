'use client';

import Link from 'next/link';
import Box from '@mui/material/Box';
import { deriveTripCodes } from '@/lib/utils/trip-codes';
import { formatSignedCurrency, getMoneyTone } from '@/lib/utils/money';
import { formatCurrency } from '@/lib/utils/currency';

export interface TripStripAmount {
  amount: number;
  currency: string;
}

interface TripStripProps {
  name: string;
  currency: string;
  /** compact: dashboard trip cards · full: trip workspace header */
  variant?: 'compact' | 'full';
  /** Makes the whole strip a link to the trip. */
  href?: string;
  dateLabel?: string | null;
  memberCount?: number;
  memberNames?: string[];
  inviteCode?: string | null;
  /** Signed personal balance; null/undefined or ~0 renders "Settled". */
  balance?: TripStripAmount | null;
  /** Trip-wide spend total shown on the full variant stub. */
  tripTotal?: TripStripAmount | null;
  /** Square off the bottom corners when content sits directly below (trip cards). */
  joinedBottom?: boolean;
}

const MOBILE_QUERY = '@media (max-width:640px)';

function MetaItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box component="span">
      <Box
        component="strong"
        sx={{
          display: 'block',
          color: 'strip.text',
          fontWeight: 600,
          fontSize: '0.875rem',
        }}
      >
        {label}
      </Box>
      <Box
        component="span"
        sx={
          mono
            ? (theme) => ({ ...(theme.typography.money as React.CSSProperties) })
            : undefined
        }
      >
        {value}
      </Box>
    </Box>
  );
}

function StubLabel({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'block',
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'strip.muted',
        fontWeight: 600,
      }}
    >
      {children}
    </Box>
  );
}

/**
 * The private-beta signature element: an itinerary / boarding-pass strip
 * for trip cards and trip headers. Colors come from `palette.strip` tokens
 * only — light and dark are designed together.
 */
export default function TripStrip({
  name,
  currency,
  variant = 'compact',
  href,
  dateLabel,
  memberCount,
  memberNames,
  inviteCode,
  balance,
  tripTotal,
  joinedBottom = false,
}: TripStripProps) {
  const { from, to } = deriveTripCodes(name);
  const isFull = variant === 'full';

  const tone = balance ? getMoneyTone(balance.amount) : 'neutral';
  const balanceText = !balance || tone === 'neutral' ? 'Settled' : formatSignedCurrency(balance.amount, balance.currency);
  const balanceDescription = !balance || tone === 'neutral'
    ? 'Settled up'
    : tone === 'positive'
      ? `You're owed ${formatCurrency(balance.amount, balance.currency)}`
      : `You owe ${formatCurrency(Math.abs(balance.amount), balance.currency)}`;

  const peopleLabel =
    memberCount !== undefined ? `${memberCount} ${memberCount === 1 ? 'person' : 'people'}` : null;

  const ariaLabel = [
    `${name} trip, ${from} to ${to}`,
    dateLabel,
    peopleLabel,
    `${balanceDescription}.`,
  ]
    .filter(Boolean)
    .join(', ');

  const root = (
    <Box
      component={href ? Link : 'div'}
      href={href}
      aria-label={ariaLabel}
      role={href ? undefined : 'region'}
      sx={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        background: (theme) => theme.palette.strip.bg,
        color: 'strip.text',
        borderRadius: '12px',
        ...(joinedBottom ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : {}),
        overflow: 'hidden',
        boxShadow: 2,
        minHeight: isFull ? 108 : 88,
        textDecoration: 'none',
        ...(href
          ? {
              cursor: 'pointer',
              transition: 'transform 160ms ease',
              '&:hover': { transform: 'translateY(-1px)' },
              '&:focus-visible': { outlineOffset: 3 },
            }
          : {}),
        '&::before, &::after': {
          content: '""',
          position: 'absolute',
          width: 16,
          height: 16,
          borderRadius: '50%',
          backgroundColor: 'strip.perforation',
          left: 'calc(72% - 8px)',
          zIndex: 2,
        },
        '&::before': { top: -8 },
        '&::after': { bottom: -8 },
        [MOBILE_QUERY]: {
          gridTemplateColumns: '1fr',
          '&::before': { left: -8, top: 'calc(68% - 8px)' },
          '&::after': { left: 'auto', right: -8, top: 'calc(68% - 8px)', bottom: 'auto' },
        },
      }}
    >
      {/* Main panel */}
      <Box
        sx={{
          py: 2,
          px: { xs: 2, sm: 3 },
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          position: 'relative',
          minWidth: 0,
          '&::after': {
            content: '""',
            position: 'absolute',
            top: 12,
            bottom: 12,
            right: 0,
            borderRight: '2px dashed',
            borderColor: 'strip.stub',
          },
          [MOBILE_QUERY]: {
            '&::after': {
              top: 'auto',
              left: 12,
              right: 12,
              bottom: 0,
              borderRight: 'none',
              borderBottom: '2px dashed',
              borderColor: 'strip.stub',
            },
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 1.5,
            fontWeight: 700,
            fontSize: isFull ? '1.375rem' : '1.125rem',
            letterSpacing: '-0.02em',
          }}
        >
          <span>{from}</span>
          <Box
            component="span"
            aria-hidden="true"
            sx={{
              flex: '0 0 auto',
              color: 'strip.muted',
              fontSize: '0.875rem',
              fontWeight: 500,
              letterSpacing: '0.12em',
            }}
          >
            ···· ✈ ····
          </Box>
          <span>{to}</span>
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            columnGap: 3,
            rowGap: 1.5,
            fontSize: '0.875rem',
            color: 'strip.muted',
          }}
        >
          <MetaItem
            label={name}
            value={[dateLabel, !isFull ? peopleLabel : null].filter(Boolean).join(' · ')}
          />
          {isFull && memberNames && memberNames.length > 0 && (
            <MetaItem label="Members" value={memberNames.join(' · ')} />
          )}
          {!isFull && <MetaItem label="Currency" value={currency} />}
          {isFull && inviteCode && <MetaItem label="Invite" value={inviteCode} mono />}
        </Box>
      </Box>

      {/* Stub */}
      <Box
        sx={{
          width: '28%',
          minWidth: 120,
          maxWidth: 180,
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 1.5,
          backgroundColor: 'strip.stub',
          [MOBILE_QUERY]: {
            width: '100%',
            maxWidth: 'none',
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 2,
            pt: 1.5,
          },
        }}
      >
        <Box>
          <StubLabel>Your balance</StubLabel>
          <Box
            sx={(theme) => ({
              ...(theme.typography.money as React.CSSProperties),
              fontSize: '1.125rem',
              fontWeight: 600,
              animation: 'balance-settle 400ms ease-out both',
            })}
          >
            {balanceText}
          </Box>
        </Box>
        {isFull && tripTotal ? (
          <Box>
            <StubLabel>Trip total</StubLabel>
            <Box
              sx={(theme) => ({
                ...(theme.typography.money as React.CSSProperties),
                fontSize: '0.875rem',
                fontWeight: 600,
              })}
            >
              {formatCurrency(tripTotal.amount, tripTotal.currency)}
            </Box>
          </Box>
        ) : (
          <Box
            sx={(theme) => ({
              ...(theme.typography.money as React.CSSProperties),
              fontSize: '0.875rem',
              fontWeight: 600,
              letterSpacing: '0.06em',
            })}
          >
            {from} · {to}
          </Box>
        )}
      </Box>
    </Box>
  );

  return root;
}
