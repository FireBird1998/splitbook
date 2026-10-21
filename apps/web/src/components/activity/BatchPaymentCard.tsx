'use client';

import { format } from 'date-fns';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CloseIcon from '@mui/icons-material/Close';
import { memberLabel } from '@splitbook/shared/activity-timeline';
import type { SettlementBatchWords } from '@splitbook/shared/settlement-batch-words';

interface BatchPaymentCardProps {
  words: SettlementBatchWords;
  /** Who recorded the payment, and when. */
  recordedBy: { _id?: string; name?: string } | null | undefined;
  recordedAt: string;
  viewerId: string;
  onClose: () => void;
}

/**
 * A payment that settled several Debts at once, opened from Activity (#734): who paid whom, what
 * in all, each Debt it cleared and its rate, in the words its row says. Each Debt's currency
 * moved by its own amount only, and each rate is kept as recorded.
 */
export default function BatchPaymentCard({
  words,
  recordedBy,
  recordedAt,
  viewerId,
  onClose,
}: BatchPaymentCardProps) {
  const recorder = memberLabel(recordedBy?._id, recordedBy?.name, viewerId) ?? 'a former member';
  const when = format(new Date(recordedAt), 'EEE d MMM, HH:mm');
  // "₹3,322.00 to clear …", or only "to clear …" while part of it is in older Activity.
  const split = words.amounts.indexOf('to clear ');
  const paid = split > 0 ? words.amounts.slice(0, split).trim() : null;
  const cleared = words.amounts.slice(Math.max(split, 0));

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
          <span>{words.payer}</span>
          <ArrowForwardIcon aria-hidden sx={{ fontSize: 16, color: 'text.disabled' }} />
          <span>{words.payee === 'you' ? 'You' : (words.payee ?? 'Former member')}</span>
        </Box>
        <Box>
          {paid && (
            <>
              <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
                Paid
              </Typography>
              <Typography sx={(theme) => ({ ...theme.typography.money, m: 0, fontSize: '1.5rem' })}>
                {paid}
              </Typography>
            </>
          )}
          <Typography sx={{ m: 0, color: 'text.secondary' }}>{cleared}</Typography>
        </Box>
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {words.debts.map((debt) => (
            <Box
              component="li"
              key={debt}
              sx={{ py: 1.25, '& + li': { borderTop: 1, borderColor: 'divider' } }}
            >
              {debt}
            </Box>
          ))}
        </Box>
        {words.rest && (
          <Typography sx={{ m: 0, fontSize: '0.875rem', color: 'text.secondary' }}>
            {words.rest}
          </Typography>
        )}
        <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
          Each currency’s balances moved only by its own Debt. The rates are kept as recorded.
        </Typography>
      </Box>
    </Box>
  );
}
