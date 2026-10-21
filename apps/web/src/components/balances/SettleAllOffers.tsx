'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { RADIUS } from '@/lib/theme/tokens';
import { settleAllWords, type SettleAllOffer } from '@/components/settlements/settle-all';

/**
 * Settle up's offers on Balances (#734, board "Web · Settle both currencies at once"): each
 * person the member owes, or who owes them, in two currencies or more, and one payment that can
 * clear every one of those Debts.
 */
export default function SettleAllOffers({
  offers,
  disabled,
  onSettle,
}: {
  offers: SettleAllOffer[];
  disabled: boolean;
  onSettle: (offer: SettleAllOffer) => void;
}) {
  if (offers.length === 0) return null;
  return (
    <Box component="ul" aria-label="Settle up" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {offers.map((offer) => {
        const words = settleAllWords(offer);
        return (
          <Box
            component="li"
            key={`${offer.paidBy}:${offer.paidTo}`}
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1.5,
              px: 2,
              py: 1.5,
              border: 1,
              borderColor: 'divider',
              borderRadius: `${RADIUS.md}px`,
              bgcolor: 'background.paper',
              '& + li': { mt: 1 },
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 36,
                height: 36,
                flex: 'none',
                borderRadius: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'tint.brand',
                color: 'primary.main',
              }}
            >
              <SwapHorizIcon sx={{ fontSize: 20 }} />
            </Box>
            <Typography sx={{ flex: '1 1 260px', minWidth: 0, m: 0, fontSize: '0.875rem' }}>
              <Box component="span" sx={{ fontWeight: 600 }}>
                {words.lead}
              </Box>{' '}
              <Box component="span" sx={(theme) => ({ ...theme.typography.money })}>
                {words.amounts}
              </Box>
              . {words.offer}
            </Typography>
            <Button
              disabled={disabled}
              aria-label={`${words.action} with ${offer.other}`}
              onClick={() => onSettle(offer)}
              sx={{
                minHeight: 40,
                px: 2,
                flexShrink: 0,
                borderRadius: `${RADIUS.sm}px`,
                bgcolor: 'tint.brand',
                color: 'primary.main',
                '&:hover': { bgcolor: 'tint.brand', boxShadow: 'inset 0 0 0 1px currentColor' },
              }}
            >
              {words.action}
            </Button>
          </Box>
        );
      })}
    </Box>
  );
}
