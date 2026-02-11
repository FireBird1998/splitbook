"use client";

import useSWR from "swr";
import { useState } from "react";
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
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl p-4 animate-pulse h-16" />
        ))}
      </div>
    );
  }

  if (balances.length === 0) {
    return (
      <div className="bg-white rounded-xl p-12 text-center">
        <span className="text-4xl mb-4 block">⚖️</span>
        <h3 className="text-lg font-medium text-gray-900 mb-2">All settled up!</h3>
        <p className="text-gray-500">No outstanding balances in this group.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Your Balance */}
      {userBalance && (
        <div className="bg-white rounded-xl p-6 border border-gray-100">
          <p className="text-sm text-gray-500 mb-1">Your balance</p>
          <p
            className={`text-2xl font-bold ${
              userBalance.balance > 0
                ? "text-green-600"
                : userBalance.balance < 0
                  ? "text-red-500"
                  : "text-gray-500"
            }`}
          >
            {userBalance.balance > 0
              ? `+${formatCurrency(userBalance.balance, currency)}`
              : userBalance.balance < 0
                ? formatCurrency(userBalance.balance, currency)
                : "All settled ✓"}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {userBalance.balance > 0
              ? "Others owe you"
              : userBalance.balance < 0
                ? "You owe others"
                : ""}
          </p>
        </div>
      )}

      {/* Member Balances */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Member Balances</h3>
        <div className="space-y-2">
          {balances.map((b: { user: { _id: string; name: string; image?: string }; balance: number }) => (
            <div
              key={b.user._id}
              className="bg-white rounded-xl px-4 py-3 border border-gray-100 flex items-center justify-between"
            >
              <span className="text-sm text-gray-900">{b.user._id === userId ? "You" : b.user.name}</span>
              <span
                className={`text-sm font-semibold ${
                  b.balance > 0 ? "text-green-600" : b.balance < 0 ? "text-red-500" : "text-gray-400"
                }`}
              >
                {b.balance > 0
                  ? `+${formatCurrency(b.balance, currency)}`
                  : b.balance < 0
                    ? formatCurrency(b.balance, currency)
                    : "Settled ✓"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Simplified Debts */}
      {debts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Simplified Debts ({debts.length} payment{debts.length !== 1 ? "s" : ""} to settle)
          </h3>
          <div className="space-y-2">
            {debts.map((d: { from: { _id: string; name: string }; to: { _id: string; name: string }; amount: number }, i: number) => (
              <div
                key={i}
                className="bg-white rounded-xl px-4 py-3 border border-gray-100 flex items-center justify-between"
              >
                <div className="text-sm">
                  <span className="font-medium text-gray-900">
                    {d.from._id === userId ? "You" : d.from.name}
                  </span>
                  <span className="text-gray-400 mx-2">→</span>
                  <span className="font-medium text-gray-900">
                    {d.to._id === userId ? "You" : d.to.name}
                  </span>
                  <span className="ml-2 font-semibold text-red-500">
                    {formatCurrency(d.amount, currency)}
                  </span>
                </div>
                {d.from._id === userId && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() =>
                      setSettleDialog({ open: true, toUser: d.to, amount: d.amount })
                    }
                    sx={{
                      borderColor: "#00BFA5",
                      color: "#00BFA5",
                      "&:hover": { borderColor: "#009688", backgroundColor: "rgba(0,191,165,0.04)" },
                      fontSize: 12,
                    }}
                  >
                    Settle Up
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
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
    </div>
  );
}

