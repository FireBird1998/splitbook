"use client";

import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { formatCurrency } from "@/lib/utils/currency";

interface DeleteExpenseDialogProps {
  open: boolean;
  onClose: () => void;
  expense: Record<string, unknown> | null;
  groupId: string;
  onDeleted: (expenseId: string) => void;
}

export default function DeleteExpenseDialog({
  open,
  onClose,
  expense,
  groupId,
  onDeleted,
}: DeleteExpenseDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!expense) return null;

  const handleDelete = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        `/api/groups/${groupId}/expenses/${expense._id}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to delete expense");
        return;
      }

      onDeleted(expense._id as string);
      onClose();
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Expense</DialogTitle>
      <DialogContent>
        {error && (
          <div className="bg-red-50 text-red-600 px-3 py-2 rounded-lg text-sm mb-3">{error}</div>
        )}
        <p className="text-sm text-gray-700">
          Are you sure you want to delete{" "}
          <strong>&ldquo;{expense.description as string}&rdquo;</strong>{" "}
          ({formatCurrency(expense.amount as number, expense.currency as string)})?
        </p>
        <p className="text-xs text-gray-500 mt-2">
          This can be undone shortly after deletion.
        </p>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleDelete}
          variant="contained"
          color="error"
          disabled={loading}
        >
          {loading ? <CircularProgress size={20} /> : "Delete"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

