'use client';

import useSWR from 'swr';
import { useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import MoneyText from '@/components/common/MoneyText';
import { formatDate } from '@/lib/utils/date';
import SettleUpDialog from '@/components/settlements/SettleUpDialog';
import { fetcher } from '@/lib/utils/fetcher';
import { canRecordSettlement } from '@/lib/utils/settlement-authorization';

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

function PersonChip({ name }: { name: string }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Avatar
        aria-hidden="true"
        sx={{ width: 32, height: 32, fontSize: 13, bgcolor: 'tint.brand', color: 'primary.main' }}
      >
        {name[0]}
      </Avatar>
      <Typography variant="body2" fontWeight={600} color="text.primary">
        {name}
      </Typography>
    </Stack>
  );
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
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="body2" fontWeight={600} color="text.primary">
          Settlement history
        </Typography>
        {settlements.length > 0 && (
          <Chip
            label="Settled"
            size="small"
            sx={{ height: 22, fontSize: '0.7rem', bgcolor: 'tint.positive', color: 'success.main' }}
          />
        )}
      </Stack>
      <Stack spacing={1.25}>
        {settlementsError && <Alert severity="warning">Could not load settlement history.</Alert>}
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
              <MoneyText
                amount={settlement.amount}
                currency={settlement.currency || currency}
                tone="positive"
                variant="body2"
                fontWeight={700}
              />
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
          <Typography color="text.secondary">No one owes anyone in this trip right now.</Typography>
        </Box>
        {settlementHistory}
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      {hasMixedCurrencies && <Alert severity="warning">{MIXED_CURRENCY_WARNING}</Alert>}

      {userBalance && (
        <Box sx={{ animation: 'balance-settle 400ms ease-out both' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Your balance
          </Typography>
          <MoneyText
            amount={userBalance.balance}
            currency={currency}
            signed
            variant="h5"
            fontWeight={700}
            sx={{ display: 'block' }}
          />
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
          <Stack
            direction="row"
            alignItems="baseline"
            justifyContent="space-between"
            sx={{ mb: 0.5 }}
          >
            <Typography variant="body2" fontWeight={600} color="text.primary">
              Who pays whom
            </Typography>
            <Chip
              label={`${debts.length} open`}
              size="small"
              sx={{ height: 22, fontSize: '0.7rem', bgcolor: 'tint.negative', color: 'error.main' }}
            />
          </Stack>
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
                      borderRadius: '12px',
                      px: 2,
                      py: 1.75,
                      bgcolor: 'background.paper',
                    }}
                  >
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1.5}
                      alignItems={{ xs: 'stretch', sm: 'center' }}
                      justifyContent="space-between"
                    >
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1.5}
                        sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
                      >
                        <PersonChip name={displayName(d.from)} />
                        <Typography
                          component="span"
                          variant="caption"
                          color="text.disabled"
                          aria-hidden="true"
                          sx={{ letterSpacing: '0.08em' }}
                        >
                          pays →
                        </Typography>
                        <PersonChip name={displayName(d.to)} />
                        <MoneyText
                          amount={d.amount}
                          currency={currency}
                          tone="neutral"
                          variant="h6"
                          fontWeight={600}
                          sx={{ ml: { sm: 'auto' } }}
                        />
                      </Stack>
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
                          sx={{ flexShrink: 0 }}
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
                {Math.abs(b.balance) < 0.005 ? (
                  <Typography variant="body2" fontWeight={600} color="text.disabled">
                    Settled
                  </Typography>
                ) : (
                  <MoneyText
                    amount={b.balance}
                    currency={currency}
                    signed
                    variant="body2"
                    fontWeight={600}
                  />
                )}
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
