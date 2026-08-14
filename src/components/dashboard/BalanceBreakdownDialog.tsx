'use client';

import Link from 'next/link';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import MoneyText from '@/components/common/MoneyText';
import type { CurrencyBreakdownEntry } from '@/types';

export type BreakdownDirection = 'owe' | 'owed';

interface BalanceBreakdownDialogProps {
  open: boolean;
  onClose: () => void;
  direction: BreakdownDirection;
  currency: string;
  total: number;
  entries: CurrencyBreakdownEntry[];
}

const COPY: Record<BreakdownDirection, { title: string; subtitle: string; empty: string }> = {
  owe: {
    title: 'You owe',
    subtitle: 'Who you pay, and which trip each amount comes from.',
    empty: 'You do not owe anyone in this currency.',
  },
  owed: {
    title: "You're owed",
    subtitle: 'Who pays you, and which trip each amount comes from.',
    empty: 'No one owes you in this currency.',
  },
};

export default function BalanceBreakdownDialog({
  open,
  onClose,
  direction,
  currency,
  total,
  entries,
}: BalanceBreakdownDialogProps) {
  const copy = COPY[direction];
  const tone = direction === 'owe' ? 'negative' : 'positive';
  const titleId = `balance-breakdown-${direction}-title`;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      <DialogTitle component="div" sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={2}>
          <Typography id={titleId} component="h2" variant="h6">
            {copy.title} · {currency}
          </Typography>
          <MoneyText amount={total} currency={currency} tone={tone} variant="h6" fontWeight={700} />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {copy.subtitle}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            {copy.empty}
          </Typography>
        ) : (
          <Stack spacing={0} divider={<Divider flexItem />}>
            {entries.map((entry) => (
              <Box key={entry.counterpartyId} sx={{ py: 1.75 }}>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={2}
                >
                  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
                    <Avatar
                      aria-hidden="true"
                      sx={{
                        width: 32,
                        height: 32,
                        fontSize: 13,
                        bgcolor: 'tint.brand',
                        color: 'primary.main',
                      }}
                    >
                      {entry.counterpartyName[0]}
                    </Avatar>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} color="text.primary" noWrap>
                        {entry.counterpartyName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {direction === 'owe' ? 'You pay them' : 'They pay you'}
                      </Typography>
                    </Box>
                  </Stack>
                  <MoneyText
                    amount={entry.amount}
                    currency={currency}
                    tone={tone}
                    variant="subtitle1"
                    fontWeight={700}
                    sx={{ flexShrink: 0 }}
                  />
                </Stack>

                <Stack spacing={0.5} sx={{ mt: 1, pl: { xs: 0, sm: 6 } }}>
                  {entry.groups.map((group) => (
                    <Stack
                      key={`${entry.counterpartyId}-${group.groupId}`}
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      spacing={1.5}
                    >
                      <Typography
                        component={Link}
                        href={`/groups/${group.groupId}?tab=balances`}
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        sx={{
                          textDecoration: 'none',
                          '&:hover': { textDecoration: 'underline' },
                        }}
                      >
                        {group.groupName}
                      </Typography>
                      <MoneyText
                        amount={group.amount}
                        currency={currency}
                        tone="neutral"
                        variant="caption"
                        color="text.secondary"
                        sx={{ flexShrink: 0 }}
                      />
                    </Stack>
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
