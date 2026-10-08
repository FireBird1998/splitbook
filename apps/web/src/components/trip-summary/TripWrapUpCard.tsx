'use client';

import Link from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import { PaysArrow, PersonAvatar } from '@/components/balances/TabCard';
import {
  HomeCard,
  HomeCardEmpty,
  HomeCardError,
  HomeCardLoading,
  HomeList,
  homeRowSx,
} from '@/components/dashboard/HomeCard';
import type { TripCardState, WrapUp, WrapUpRow } from './trip-summary';

/*
 * "Trip wrap-up" on a Trip's Insights tab (#316, design canvas "Web portal", Trip Group): the
 * payments Balances suggests to settle the trip, in its one currency. Record payment goes to
 * Balances with the pair filled in (#312), and is offered only on a payment the member makes or
 * receives: a payment between two other people is shown with who can record it, never a Record
 * link (the parties-only rule). Share wrap-up (#319) opens the Trip's statement for the whole
 * trip; it only reads, so every member has it.
 */

interface TripWrapUpCardProps {
  currency: string | null;
  model: WrapUp | null;
  state: TripCardState;
  onRetry: () => void;
  /** The Trip's whole-trip statement, in the viewer's time zone: Share wrap-up's link. */
  shareHref: string | null;
}

const moneySx = (theme: { typography: { money: object } }) => ({ ...theme.typography.money });

export default function TripWrapUpCard({
  currency,
  model,
  state,
  onRetry,
  shareHref,
}: TripWrapUpCardProps) {
  const ready = state === 'ready' && model;
  return (
    <HomeCard
      id="trip-wrap-up"
      title="Trip wrap-up"
      width="narrow"
      subtitle={ready ? model.subtitle : undefined}
    >
      {ready ? (
        <>
          <SuggestedPayments currency={currency} model={model} />
          {shareHref ? <ShareWrapUp href={shareHref} /> : null}
        </>
      ) : state === 'empty' ? (
        <HomeCardEmpty
          title="No Expenses yet"
          description="Once the trip has Expenses, who pays whom to settle it shows here."
        />
      ) : state === 'failed' ? (
        <HomeCardError message="The wrap-up could not be loaded." onRetry={onRetry} />
      ) : (
        <HomeCardLoading label="Loading the wrap-up" blocks={2} height={48} />
      )}
    </HomeCard>
  );
}

/** The payments that settle the trip, or that everyone is settled up. */
function SuggestedPayments({ currency, model }: { currency: string | null; model: WrapUp }) {
  return model.rows.length > 0 ? (
    <>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '4px 12px',
          px: 2.5,
          pt: 0.5,
        }}
      >
        <Typography
          component="h3"
          sx={{
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'text.secondary',
          }}
        >
          Suggested payments{currency ? ` · ${currency}` : ''}
        </Typography>
        <Typography component="p" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
          Record one once it’s paid
        </Typography>
      </Box>
      <HomeList label="Suggested payments">
        {model.rows.map((row) => (
          <PaymentRow key={row.key} row={row} />
        ))}
      </HomeList>
      {model.otherCurrencies ? (
        <Typography
          component="p"
          sx={{ px: 2.5, pt: 1, fontSize: '0.75rem', color: 'text.secondary' }}
        >
          {model.otherCurrencies}
        </Typography>
      ) : null}
    </>
  ) : (
    <HomeCardEmpty
      icon={<TaskAltOutlinedIcon sx={{ color: 'status.positive' }} />}
      title="Everyone is settled up"
      description={
        model.otherCurrencies ??
        `No one owes anyone in ${currency ?? 'this trip’s currency'}. Nothing to record.`
      }
    />
  );
}

/**
 * Share wrap-up (#319; the canvas's tonal button under the payments): the Trip's statement for
 * the whole trip, in the same tab, to print or save as a PDF and send to the Group.
 */
function ShareWrapUp({ href }: { href: string }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1,
        mx: 2.5,
        mt: 1.5,
        pt: 2,
        pb: 1,
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      <Button
        component={Link}
        href={href}
        fullWidth
        startIcon={<ShareOutlinedIcon />}
        aria-describedby="trip-wrap-up-share-note"
        sx={{
          bgcolor: 'tint.brand',
          color: 'primary.main',
          '&:hover': { bgcolor: 'tint.brand', boxShadow: 'inset 0 0 0 1px currentColor' },
        }}
      >
        Share wrap-up
      </Button>
      <Typography
        id="trip-wrap-up-share-note"
        component="p"
        sx={{ fontSize: '0.75rem', lineHeight: 1.35, color: 'text.secondary' }}
      >
        Opens the trip’s statement to print or save as a PDF: what was spent, everyone’s Paid and
        Share, and who pays whom.
      </Typography>
    </Box>
  );
}

function PaymentRow({ row }: { row: WrapUpRow }) {
  return (
    <Box component="li" sx={homeRowSx}>
      <Box aria-hidden sx={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
        <PersonAvatar name={row.payer} />
        <PaysArrow />
        <PersonAvatar name={row.payee} />
      </Box>
      <Box sx={{ flex: '1 1 140px', minWidth: 0 }}>
        <Typography noWrap sx={{ fontWeight: 600, color: 'text.primary', fontSize: '0.9375rem' }}>
          {row.title}
        </Typography>
        <Box component="p" sx={[{ m: 0, fontSize: '0.9375rem', color: 'text.primary' }, moneySx]}>
          {row.amountText}
        </Box>
        {row.note ? (
          <Typography component="p" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
            {row.note}
          </Typography>
        ) : null}
      </Box>
      {row.record ? (
        <Button
          component={Link}
          href={row.record.href}
          variant="text"
          size="small"
          aria-label={row.record.label}
          sx={{ flex: 'none', ml: 'auto', minHeight: 44 }}
        >
          Record
        </Button>
      ) : null}
    </Box>
  );
}
