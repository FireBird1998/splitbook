"use client";

import { useState } from "react";
import useSWR from "swr";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDateTime } from "@/lib/utils/date";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const CATEGORY_ICONS: Record<string, string> = {
  food: "🍕",
  transport: "🚗",
  accommodation: "🏨",
  travel: "✈️",
  entertainment: "🎬",
  shopping: "🛍️",
  housing: "🏠",
  health: "🏥",
  education: "📚",
  other: "📋",
};

const CATEGORY_LABELS: Record<string, string> = {
  food: "Food & Drink",
  transport: "Transport",
  accommodation: "Accommodation",
  travel: "Travel",
  entertainment: "Entertainment",
  shopping: "Shopping",
  housing: "Housing",
  health: "Health",
  education: "Education",
  other: "Other",
};

const SPLIT_METHOD_LABELS: Record<string, string> = {
  equal: "Equal",
  unequal: "Unequal",
  percentage: "Percentage",
  shares: "Shares",
  exact: "Exact",
};

const FIELD_LABELS: Record<string, string> = {
  description: "Description",
  amount: "Amount",
  currency: "Currency",
  category: "Category",
  date: "Date",
  splitMethod: "Split method",
  tag: "Tag",
  notes: "Notes",
  paidBy: "Paid by",
  splitBetween: "Split between",
};

interface ExpenseDetailDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  expenseId: string | null;
  userId: string;
  group: Record<string, unknown>;
  onEdit: (expense: Record<string, unknown>) => void;
  onDelete: (expense: Record<string, unknown>) => void;
}

export default function ExpenseDetailDialog({
  open,
  onClose,
  groupId,
  expenseId,
  userId,
  group,
  onEdit,
  onDelete,
}: ExpenseDetailDialogProps) {
  const [showHistory, setShowHistory] = useState(false);

  const { data, isLoading } = useSWR(
    open && expenseId ? `/api/groups/${groupId}/expenses/${expenseId}` : null,
    fetcher
  );

  const expense = data?.data;

  if (!open) return null;

  if (isLoading || !expense) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogContent>
          <div className="space-y-4 animate-pulse py-8">
            <div className="h-6 w-48 bg-gray-200 rounded" />
            <div className="h-4 w-32 bg-gray-200 rounded" />
            <div className="h-20 bg-gray-200 rounded" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const category = expense.category as string;
  const paidBy = (expense.paidBy || []) as Array<{ user: { _id: string; name: string; image?: string }; amount: number }>;
  const splitBetween = (expense.splitBetween || []) as Array<{
    user: { _id: string; name: string; image?: string };
    amount: number;
    percentage?: number;
    shares?: number;
  }>;
  const tag = (expense.tag as string) || "";
  const editHistory = (expense.editHistory || []) as Array<{
    editedBy: { _id: string; name: string } | string;
    editedAt: string;
    changes: Record<string, { old: unknown; new: unknown }>;
  }>;
  const createdBy = expense.createdBy as { _id: string; name: string; image?: string } | undefined;

  const memberName = (user: { _id: string; name: string }) =>
    user._id === userId ? "You" : user.name;

  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "number") return String(val);
    if (typeof val === "string") return val;
    if (Array.isArray(val)) return val.join(", ") || "—";
    return JSON.stringify(val);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pb: 1 }}>
        <span className="text-base font-semibold">Expense Detail</span>
        <div className="flex gap-1">
          <IconButton size="small" onClick={() => onEdit(expense)} title="Edit">
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => onDelete(expense)} title="Delete" sx={{ color: "error.main" }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </div>
      </DialogTitle>

      <DialogContent dividers>
        <div className="space-y-5">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">{CATEGORY_ICONS[category] || "📋"}</span>
              <h2 className="text-lg font-bold text-gray-900">{expense.description}</h2>
            </div>
            <p className="text-xl font-bold text-gray-900">
              {formatCurrency(expense.amount, expense.currency)}
            </p>
            <p className="text-sm text-gray-500 mt-0.5">
              {formatDateTime(expense.date)}
            </p>
          </div>

          {/* Metadata */}
          <div className="flex items-center gap-2 flex-wrap">
            <Chip
              label={`${CATEGORY_ICONS[category] || ""} ${CATEGORY_LABELS[category] || category}`}
              size="small"
              variant="outlined"
            />
            {tag && (
              <Chip label={tag} size="small" variant="outlined" sx={{ fontSize: 11 }} />
            )}
          </div>

          <Divider />

          {/* Paid By */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Paid by
            </h3>
            <div className="space-y-2">
              {paidBy.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar src={p.user.image} sx={{ width: 28, height: 28, fontSize: 12 }}>
                      {p.user.name?.[0]}
                    </Avatar>
                    <span className="text-sm text-gray-900">{memberName(p.user)}</span>
                  </div>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrency(p.amount, expense.currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <Divider />

          {/* Split */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Split ({SPLIT_METHOD_LABELS[expense.splitMethod] || expense.splitMethod})
            </h3>
            <div className="space-y-2">
              {splitBetween.map((s, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar src={s.user.image} sx={{ width: 28, height: 28, fontSize: 12 }}>
                      {s.user.name?.[0]}
                    </Avatar>
                    <span className="text-sm text-gray-900">{memberName(s.user)}</span>
                    {s.percentage !== undefined && (
                      <span className="text-xs text-gray-400">({s.percentage}%)</span>
                    )}
                    {s.shares !== undefined && (
                      <span className="text-xs text-gray-400">({s.shares} shares)</span>
                    )}
                  </div>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrency(s.amount, expense.currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {expense.notes && (
            <>
              <Divider />
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Notes
                </h3>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{expense.notes}</p>
              </div>
            </>
          )}

          {/* Receipt */}
          {expense.receiptUrl && (
            <>
              <Divider />
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Receipt
                </h3>
                <a
                  href={expense.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
                >
                  📎 View Receipt
                </a>
              </div>
            </>
          )}

          <Divider />

          {/* History */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              History
            </h3>
            {createdBy && (
              <p className="text-xs text-gray-500">
                Created by <strong>{memberName(createdBy)}</strong> · {formatDateTime(expense.createdAt)}
              </p>
            )}

            {editHistory.length > 0 && (
              <div className="mt-2">
                <Button
                  size="small"
                  onClick={() => setShowHistory(!showHistory)}
                  endIcon={showHistory ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  sx={{ textTransform: "none", fontSize: 12, color: "#6C63FF" }}
                >
                  {showHistory ? "Hide" : "Show"} edit history ({editHistory.length} edit{editHistory.length !== 1 ? "s" : ""})
                </Button>

                {showHistory && (
                  <div className="mt-2 space-y-3 border-l-2 border-gray-200 pl-4">
                    {editHistory.map((edit, i) => {
                      const editorName = typeof edit.editedBy === "string"
                        ? edit.editedBy
                        : memberName(edit.editedBy);

                      return (
                        <div key={i}>
                          <p className="text-xs text-gray-600">
                            ✏️ Edited by <strong>{editorName}</strong> · {formatDateTime(edit.editedAt)}
                          </p>
                          <ul className="mt-1 text-xs text-gray-500 list-none">
                            {Object.entries(edit.changes).map(([field, { old: oldVal, new: newVal }]) => (
                              <li key={field}>
                                • {FIELD_LABELS[field] || field}: {formatValue(oldVal)} → {formatValue(newVal)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

