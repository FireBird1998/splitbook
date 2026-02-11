"use client";

import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import { getSortedCurrencies } from "@/lib/utils/currency";

interface SettleUpDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  group: Record<string, unknown>;
  toUser?: Record<string, unknown>;
  defaultAmount?: number;
  onSettled: () => void;
}

export default function SettleUpDialog({
  open,
  onClose,
  groupId,
  group,
  toUser,
  defaultAmount,
  onSettled,
}: SettleUpDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState(defaultAmount?.toString() || "");
  const [currency, setCurrency] = useState(group.defaultCurrency as string);
  const [note, setNote] = useState("");

  const currencies = getSortedCurrencies(
    group.defaultCurrency as string,
    (group.alternateCurrencies || []) as string[]
  );

  const handleSubmit = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/groups/${groupId}/settlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paidTo: (toUser as { _id: string })?._id,
          amount: parseFloat(amount),
          currency,
          note,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to record settlement");
        return;
      }

      onSettled();
      onClose();
      setAmount("");
      setNote("");
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Settle Up</DialogTitle>
      <DialogContent>
        <div className="space-y-4 pt-2">
          {error && (
            <div className="bg-red-50 text-red-600 px-3 py-2 rounded-lg text-sm">{error}</div>
          )}

          <p className="text-sm text-gray-600">
            You are paying <strong>{(toUser as { name?: string })?.name || "..."}</strong>
          </p>

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              size="small"
              required
              slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
            />
            <TextField
              select
              label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              size="small"
            >
              {currencies.map((c) => (
                <MenuItem key={c.code} value={c.code}>
                  {c.flag} {c.code}
                </MenuItem>
              ))}
            </TextField>
          </div>

          <TextField
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            fullWidth
            size="small"
            placeholder="e.g. Paid via UPI"
          />
        </div>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
          sx={{ backgroundColor: "#00BFA5", "&:hover": { backgroundColor: "#009688" } }}
        >
          {loading ? <CircularProgress size={20} /> : "Record Payment"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

