'use client';

import { format } from 'date-fns';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CloseIcon from '@mui/icons-material/Close';
import { memberLabel } from '@splitbook/shared/activity-timeline';
import { paymentRecord, type CrossCurrencyRecord } from '@splitbook/shared/cross-currency-payment';

interface PaymentRecordCardProps {
  record: CrossCurrencyRecord;
  /** Who recorded the payment, and when. */
  recordedBy: { _id?: string; name?: string } | null | undefined;
  recordedAt: string;
  viewerId: string;
  onClose: () => void;
}

const kvSx = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 2,
  py: 1.25,
  '& + &': { borderTop: 1, borderColor: 'divider' },
} as const;

/**
 * A payment that cleared a Debt in another currency, opened from Activity (#727): who paid
 * whom, both amounts, the rate used and the suggestion beside it, the Debt between the two
 * before and after, and that the rate is kept as recorded.
 */
export default function PaymentRecordCard({
  record,
  recordedBy,
  recordedAt,
  viewerId,
  onClose,
}: PaymentRecordCardProps) {
  const card = paymentRecord(record, viewerId);
  const recorder = memberLabel(recordedBy?._id, recordedBy?.name, viewerId) ?? 'a former member';
  const when = format(new Date(recordedAt), 'EEE d MMM, HH:mm');

  return (
    <Box
      component="section"
      aria-labelledby="payment-record-heading"
      sx={{ border: 1, borderColor: 'divider', borderRadius: '16px', bgcolor: 'background.paper' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, px: 2.5, pt: 2, pb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            id="payment-record-heading"
            component="h2"
            sx={{ m: 0, fontSize: '1rem', fontWeight: 600, color: 'text.primary' }}
          >
            Payment
          </Typography>
          <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
            Recorded by {recorder === 'You' ? 'you' : recorder} · {when}
          </Typography>
        </Box>
        <IconButton aria-label="Close Payment" onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75, px: 2.5, pb: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 600 }}>
          <span>{card.payer}</span>
          <ArrowForwardIcon aria-hidden sx={{ fontSize: 16, color: 'text.disabled' }} />
          <span>{card.payee}</span>
        </Box>
        <Box>
          <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>Paid</Typography>
          <Typography sx={(theme) => ({ ...theme.typography.money, m: 0, fontSize: '1.5rem' })}>
            {card.paid}
          </Typography>
          <Typography sx={{ m: 0, fontSize: '0.875rem', color: 'text.secondary' }}>
            {card.clears}
          </Typography>
        </Box>
        <Box component="dl" sx={{ m: 0 }}>
          <Box sx={kvSx}>
            <Box component="dt" sx={{ color: 'text.secondary' }}>
              Rate used
            </Box>
            <Box component="dd" sx={{ m: 0, textAlign: 'right' }}>
              <Box
                component="span"
                sx={(theme) => ({ ...theme.typography.money, fontWeight: 600 })}
              >
                {card.rateUsed}
              </Box>{' '}
              <Box
                component="span"
                sx={{
                  display: 'inline-block',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  px: 1,
                  borderRadius: '999px',
                  bgcolor: card.badge === 'Suggested' ? 'tint.positive' : 'tint.warning',
                }}
              >
                {card.badge}
              </Box>
            </Box>
          </Box>
          {card.suggested && (
            <Box sx={kvSx}>
              <Box component="dt" sx={{ color: 'text.secondary' }}>
                Suggested
              </Box>
              <Box component="dd" sx={{ m: 0, textAlign: 'right' }}>
                <Box component="span" sx={(theme) => ({ ...theme.typography.money })}>
                  {card.suggested.rate}
                </Box>
                <Typography
                  component="span"
                  sx={{ display: 'block', fontSize: '0.75rem', color: 'text.secondary' }}
                >
                  {card.suggested.source}
                </Typography>
                {card.suggested.attribution && (
                  <Link
                    href={card.suggested.attribution.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ fontSize: '0.75rem', fontWeight: 600 }}
                  >
                    {card.suggested.attribution.text}
                  </Link>
                )}
              </Box>
            </Box>
          )}
          <Box sx={kvSx}>
            <Box component="dt" sx={{ color: 'text.secondary' }}>
              Amount cleared
            </Box>
            <Box component="dd" sx={(theme) => ({ ...theme.typography.money, m: 0 })}>
              {card.cleared}
            </Box>
          </Box>
          <Box sx={kvSx}>
            <Box component="dt" sx={{ color: 'text.secondary' }}>
              Amount paid
            </Box>
            <Box component="dd" sx={(theme) => ({ ...theme.typography.money, m: 0 })}>
              {card.paidAmount}
            </Box>
          </Box>
        </Box>
        <Box
          sx={{
            px: 1.75,
            py: 1.5,
            borderRadius: '12px',
            bgcolor: 'surface.muted',
            fontSize: '0.875rem',
          }}
        >
          {card.pair && (
            <Box component="span" sx={{ display: 'block' }}>
              {card.pair.label}{' '}
              <Box component="span" sx={(theme) => ({ ...theme.typography.money })}>
                {card.pair.before}
              </Box>{' '}
              →{' '}
              <Box
                component="span"
                sx={(theme) => ({ ...theme.typography.money, color: 'status.positive' })}
              >
                {card.pair.after}
              </Box>
            </Box>
          )}
          <Box component="span" sx={{ display: 'block', color: 'text.secondary' }}>
            {card.unchanged}
          </Box>
        </Box>
        <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
          {card.kept}
        </Typography>
      </Box>
    </Box>
  );
}
