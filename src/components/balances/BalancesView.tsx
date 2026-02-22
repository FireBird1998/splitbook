"use client";

import useSWR from "swr";
import { useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";
import Button from "@mui/material/Button";
import { formatCurrency } from "@/lib/utils/currency";
import SettleUpDialog from "@/components/settlements/SettleUpDialog";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BalancesViewProps {
  groupId: string;
  userId: string;
  group: Record<string, unknown>;
}

export default function BalancesView({ groupId, userId, group }: BalancesViewProps) {
  const [settleDialog, setSettleDialog] = useState<{ open: boolean; toUser?: Record<string, unknown>; amount?: number }>({
    open: false,
  });

  const { data, isLoading, mutate } = useSWR(
    `/api/groups/${groupId}/balances`,
    fetcher,
    { refreshInterval: 15_000 }
  );

  const balances = data?.data?.balances || [];
  const debts = data?.data?.debts || [];
  const currency = data?.data?.currency || (group.defaultCurrency as string);

  const userBalance = balances.find(
    (b: { user: { _id: string }; balance: number }) => b.user._id === userId
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

  if (balances.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 6, textAlign: "center" }}>
        <Typography component="span" sx={{ fontSize: "2.5rem", display: "block", mb: 2 }}>⚖️</Typography>
        <Typography variant="subtitle1" fontWeight={500} color="text.primary" sx={{ mb: 1 }}>
          All settled up!
        </Typography>
        <Typography color="text.secondary">No outstanding balances in this group.</Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={3}>
      {/* Your Balance */}
      {userBalance && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Your balance
          </Typography>
          <Typography
            variant="h5"
            fontWeight={700}
            sx={{
              color: userBalance.balance > 0
                ? "success.main"
                : userBalance.balance < 0
                  ? "error.main"
                  : "text.secondary",
            }}
          >
            {userBalance.balance > 0
              ? `+${formatCurrency(userBalance.balance, currency)}`
              : userBalance.balance < 0
                ? formatCurrency(userBalance.balance, currency)
                : "All settled ✓"}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {userBalance.balance > 0
              ? "Others owe you"
              : userBalance.balance < 0
                ? "You owe others"
                : ""}
          </Typography>
        </Paper>
      )}

      {/* Member Balances */}
      <Box>
        <Typography variant="body2" fontWeight={600} color="text.primary" sx={{ mb: 1.5 }}>
          Member Balances
        </Typography>
        <Stack spacing={1}>
          {balances.map((b: { user: { _id: string; name: string; image?: string }; balance: number }) => (
            <Paper
              key={b.user._id}
              variant="outlined"
              sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <Typography variant="body2" color="text.primary">
                {b.user._id === userId ? "You" : b.user.name}
              </Typography>
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{
                  color: b.balance > 0 ? "success.main" : b.balance < 0 ? "error.main" : "text.disabled",
                }}
              >
                {b.balance > 0
                  ? `+${formatCurrency(b.balance, currency)}`
                  : b.balance < 0
                    ? formatCurrency(b.balance, currency)
                    : "Settled ✓"}
              </Typography>
            </Paper>
          ))}
        </Stack>
      </Box>

      {/* Simplified Debts */}
      {debts.length > 0 && (
        <Box>
          <Typography variant="body2" fontWeight={600} color="text.primary" sx={{ mb: 1.5 }}>
            Simplified Debts ({debts.length} payment{debts.length !== 1 ? "s" : ""} to settle)
          </Typography>
          <Stack spacing={1}>
            {debts.map((d: { from: { _id: string; name: string }; to: { _id: string; name: string }; amount: number }, i: number) => (
              <Paper
                key={i}
                variant="outlined"
                sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" fontWeight={500} color="text.primary">
                    {d.from._id === userId ? "You" : d.from.name}
                  </Typography>
                  <Typography variant="body2" color="text.disabled">→</Typography>
                  <Typography variant="body2" fontWeight={500} color="text.primary">
                    {d.to._id === userId ? "You" : d.to.name}
                  </Typography>
                  <Typography variant="body2" fontWeight={600} color="error.main" sx={{ ml: 1 }}>
                    {formatCurrency(d.amount, currency)}
                  </Typography>
                </Box>
                {d.from._id === userId && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() =>
                      setSettleDialog({ open: true, toUser: d.to, amount: d.amount })
                    }
                    sx={{
                      borderColor: "secondary.main",
                      color: "secondary.main",
                      "&:hover": { borderColor: "secondary.dark", backgroundColor: "rgba(0,191,165,0.04)" },
                      fontSize: 12,
                    }}
                  >
                    Settle Up
                  </Button>
                )}
              </Paper>
            ))}
          </Stack>
        </Box>
      )}

      <SettleUpDialog
        open={settleDialog.open}
        onClose={() => setSettleDialog({ open: false })}
        groupId={groupId}
        group={group}
        toUser={settleDialog.toUser}
        defaultAmount={settleDialog.amount}
        onSettled={() => mutate()}
      />
    </Stack>
  );
}
