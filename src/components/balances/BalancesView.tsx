'use client';

import useSWR from 'swr';
import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import { formatCurrency } from '@/lib/utils/currency';
import { formatDate } from '@/lib/utils/date';
import SettleUpDialog from '@/components/settlements/SettleUpDialog';
import { fetcher } from '@/lib/utils/fetcher';
import { canRecordSettlement } from '@/lib/services/expense-validation';

const MIXED_CURRENCY_WARNING =
  "Some expenses or settlements use a different currency than this group's default. Balances may be inaccurate until those are updated.";

interface BalancesViewProps {
  groupId: string;
  userId: string;
  group: Record<string, unknown>;
}

interface Settlement {
  _id: string;
  paidBy: { _id: string; name: string };
  paidTo: { _id: string; name: string };
  amount: number;
  currency: string;
  note?: string;
  createdAt: string;
  createdBy?: { _id: string; name: string };
}

export default function BalancesView({ groupId, userId, group }: BalancesViewProps) {
  const [settleDialog, setSettleDialog] = useState<{
    open: boolean;
    fromUser?: { _id: string; name: string };
    toUser?: { _id: string; name: string };
    amount?: number;
  }>({
    open: false,
  });

  const { data, isLoading, error, mutate } = useSWR(`/api/groups/${groupId}/balances`, fetcher, {
    refreshInterval: 15_000,
  });
  const {
    data: settlementsData,
    error: settlementsError,
    mutate: mutateSettlements,
  } = useSWR(`/api/groups/${groupId}/settlements`, fetcher);

  const balances = data?.data?.balances || [];
  const debts = data?.data?.debts || [];
  const currency = data?.data?.currency || (group.defaultCurrency as string);
  const hasMixedCurrencies = Boolean(data?.data?.hasMixedCurrencies);
  const settlements = (settlementsData?.data || []) as Settlement[];

  const userBalance = balances.find(
    (b: { user: { _id: string }; balance: number }) => b.user._id === userId,
  );

  if (isLoading) {
    return (
      <Stack spacing={1.5}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rounded" height={64} />
        ))}
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">{error.message}</Alert>;
  }

  const displayName = (user: { _id: string; name: string }) =>
    user._id === userId ? 'You' : user.name;

  const settlementHistory = (
    <Box>
      <Typography variant="body2" fontWeight={600} color="text.primary" sx={{ mb: 1.5 }}>
        Settlement history
      </Typography>
      <Stack spacing={1.25}>
        {settlementsError && (
          <Alert severity="warning">Could not load settlement history.</Alert>
        )}
        {!settlementsError && settlements.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            No settlements yet — record one when someone pays.
          </Typography>
        )}
        {settlements.map((settlement) => (
          <Box
            key={settlement._id}
            sx={{
              py: 1.25,
              borderBottom: '1px solid',
              borderColor: 'divider',
              '&:last-of-type': { borderBottom: 'none' },
            }}
          >
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={0.75}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'center' }}
            >
              <Box>
                <Typography variant="body2" color="text.primary">
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {displayName(settlement.paidBy)}
                  </Box>
                  {' → '}
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {displayName(settlement.paidTo)}
                  </Box>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDate(settlement.createdAt)}
                  {settlement.createdBy
                    ? ` · Recorded by ${displayName(settlement.createdBy)}`
                    : ''}
                  {settlement.note ? ` · ${settlement.note}` : ''}
                </Typography>
              </Box>
              <Typography variant="body2" fontWeight={700} color="success.main">
                {formatCurrency(settlement.amount, settlement.currency || currency)}
              </Typography>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );

  if (balances.length === 0 && debts.length === 0) {
    return (
      <Stack spacing={3}>
        {hasMixedCurrencies && <Alert severity="warning">{MIXED_CURRENCY_WARNING}</Alert>}
        <Box sx={{ py: { xs: 4, sm: 6 }, textAlign: 'center' }}>
          <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 1 }}>
            All settled up
          </Typography>
          <Typography color="text.secondary">
            No one owes anyone in this trip right now.
          </Typography>
        </Box>
        {settlementHistory}
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      {hasMixedCurrencies && <Alert severity="warning">{MIXED_CURRENCY_WARNING}</Alert>}

      {userBalance && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Your balance
          </Typography>
          <Typography
            variant="h5"
            fontWeight={700}
            sx={{
              color:
                userBalance.balance > 0
                  ? 'success.main'
                  : userBalance.balance < 0
                    ? 'error.main'
                    : 'text.secondary',
            }}
          >
            {userBalance.balance > 0
              ? `+${formatCurrency(userBalance.balance, currency)}`
              : userBalance.balance < 0
                ? formatCurrency(userBalance.balance, currency)
                : 'Settled'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {userBalance.balance > 0
              ? 'Others owe you'
              : userBalance.balance < 0
                ? 'You owe others'
                : 'Nothing outstanding for you'}
          </Typography>
        </Box>
      )}

      {debts.length > 0 && (
        <Box>
          <Typography variant="body2" fontWeight={600} color="text.primary" sx={{ mb: 0.5 }}>
            Who pays whom
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            {debts.length} payment{debts.length !== 1 ? 's' : ''} to settle · either person can
            record it
          </Typography>
          <Stack spacing={1.5}>
            {debts.map(
              (
                d: {
                  from: { _id: string; name: string };
                  to: { _id: string; name: string };
                  amount: number;
                },
                i: number,
              ) => {
                const involved = canRecordSettlement(userId, d.from._id, d.to._id);
                return (
                  <Box
                    key={`${d.from._id}-${d.to._id}-${i}`}
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2,
                      px: 2,
                      py: 1.75,
                    }}
                  >
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1.5}
                      alignItems={{ xs: 'stretch', sm: 'center' }}
                      justifyContent="space-between"
                    >
                      <Box>
                        <Typography variant="body1" fontWeight={600} color="text.primary">
                          {displayName(d.from)}
                          <Box
                            component="span"
                            sx={{ mx: 1, color: 'text.secondary', fontWeight: 400 }}
                          >
                            pays
                          </Box>
                          {displayName(d.to)}
                        </Typography>
                        <Typography variant="h6" fontWeight={700} color="text.primary" sx={{ mt: 0.5 }}>
                          {formatCurrency(d.amount, currency)}
                        </Typography>
                      </Box>
                      {involved && (
                        <Button
                          size="medium"
                          variant="contained"
                          onClick={() =>
                            setSettleDialog({
                              open: true,
                              fromUser: d.from,
                              toUser: d.to,
                              amount: d.amount,
                            })
                          }
                          sx={{ textTransform: 'none', minHeight: 40 }}
                        >
                          Record settlement
                        </Button>
                      )}
                    </Stack>
                  </Box>
                );
              },
            )}
          </Stack>
        </Box>
      )}

      <Box>
        <Typography variant="body2" fontWeight={600} color="text.primary" sx={{ mb: 1.5 }}>
          Net positions
        </Typography>
        <Stack spacing={1}>
          {balances.map(
            (b: { user: { _id: string; name: string; image?: string }; balance: number }) => (
              <Stack
                key={b.user._id}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ py: 0.75 }}
              >
                <Typography variant="body2" color="text.primary">
                  {b.user._id === userId ? 'You' : b.user.name}
                </Typography>
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{
                    color:
                      b.balance > 0
                        ? 'success.main'
                        : b.balance < 0
                          ? 'error.main'
                          : 'text.disabled',
                  }}
                >
                  {b.balance > 0
                    ? `+${formatCurrency(b.balance, currency)}`
                    : b.balance < 0
                      ? formatCurrency(b.balance, currency)
                      : 'Settled'}
                </Typography>
              </Stack>
            ),
          )}
        </Stack>
      </Box>

      {settlementHistory}

      <SettleUpDialog
        open={settleDialog.open}
        onClose={() => setSettleDialog({ open: false })}
        groupId={groupId}
        group={group}
        fromUser={settleDialog.fromUser}
        toUser={settleDialog.toUser}
        defaultAmount={settleDialog.amount}
        onSettled={() => {
          mutate();
          mutateSettlements();
        }}
      />
    </Stack>
  );
}
