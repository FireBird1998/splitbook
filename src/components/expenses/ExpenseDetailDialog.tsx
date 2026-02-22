"use client";

import { useState } from "react";
import useSWR from "swr";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";
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
          <Stack spacing={2} sx={{ py: 4 }}>
            <Skeleton variant="text" width={192} height={24} />
            <Skeleton variant="text" width={128} height={20} />
            <Skeleton variant="rounded" height={80} />
          </Stack>
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
        <Typography variant="subtitle1" fontWeight={600}>Expense Detail</Typography>
        <Stack direction="row" spacing={0.5}>
          <IconButton size="small" onClick={() => onEdit(expense)} title="Edit">
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => onDelete(expense)} title="Delete" sx={{ color: "error.main" }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5}>
          {/* Header */}
          <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <Typography component="span" sx={{ fontSize: "1.5rem" }}>
                {CATEGORY_ICONS[category] || "📋"}
              </Typography>
              <Typography variant="subtitle1" fontWeight={700} color="text.primary">
                {expense.description}
              </Typography>
            </Stack>
            <Typography variant="h6" fontWeight={700} color="text.primary">
              {formatCurrency(expense.amount, expense.currency)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {formatDateTime(expense.date)}
            </Typography>
          </Box>

          {/* Metadata */}
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Chip
              label={`${CATEGORY_ICONS[category] || ""} ${CATEGORY_LABELS[category] || category}`}
              size="small"
              variant="outlined"
            />
            {tag && (
              <Chip label={tag} size="small" variant="outlined" sx={{ fontSize: 11 }} />
            )}
          </Stack>

          <Divider />

          {/* Paid By */}
          <Box>
            <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.05em", mb: 1, display: "block" }}>
              Paid by
            </Typography>
            <Stack spacing={1}>
              {paidBy.map((p, i) => (
                <Stack key={i} direction="row" alignItems="center" justifyContent="space-between">
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Avatar src={p.user.image} sx={{ width: 28, height: 28, fontSize: 12 }}>
                      {p.user.name?.[0]}
                    </Avatar>
                    <Typography variant="body2" color="text.primary">{memberName(p.user)}</Typography>
                  </Stack>
                  <Typography variant="body2" fontWeight={500} color="text.primary">
                    {formatCurrency(p.amount, expense.currency)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>

          <Divider />

          {/* Split */}
          <Box>
            <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.05em", mb: 1, display: "block" }}>
              Split ({SPLIT_METHOD_LABELS[expense.splitMethod] || expense.splitMethod})
            </Typography>
            <Stack spacing={1}>
              {splitBetween.map((s, i) => (
                <Stack key={i} direction="row" alignItems="center" justifyContent="space-between">
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Avatar src={s.user.image} sx={{ width: 28, height: 28, fontSize: 12 }}>
                      {s.user.name?.[0]}
                    </Avatar>
                    <Typography variant="body2" color="text.primary">{memberName(s.user)}</Typography>
                    {s.percentage !== undefined && (
                      <Typography variant="caption" color="text.disabled">({s.percentage}%)</Typography>
                    )}
                    {s.shares !== undefined && (
                      <Typography variant="caption" color="text.disabled">({s.shares} shares)</Typography>
                    )}
                  </Stack>
                  <Typography variant="body2" fontWeight={500} color="text.primary">
                    {formatCurrency(s.amount, expense.currency)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>

          {/* Notes */}
          {expense.notes && (
            <>
              <Divider />
              <Box>
                <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.05em", mb: 1, display: "block" }}>
                  Notes
                </Typography>
                <Typography variant="body2" color="text.primary" sx={{ whiteSpace: "pre-wrap" }}>
                  {expense.notes}
                </Typography>
              </Box>
            </>
          )}

          {/* Receipt */}
          {expense.receiptUrl && (
            <>
              <Divider />
              <Box>
                <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.05em", mb: 1, display: "block" }}>
                  Receipt
                </Typography>
                <Typography
                  component="a"
                  href={expense.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="body2"
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 1,
                    color: "primary.main",
                    textDecoration: "none",
                    "&:hover": { textDecoration: "underline" },
                  }}
                >
                  📎 View Receipt
                </Typography>
              </Box>
            </>
          )}

          <Divider />

          {/* History */}
          <Box>
            <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.05em", mb: 1, display: "block" }}>
              History
            </Typography>
            {createdBy && (
              <Typography variant="caption" color="text.secondary">
                Created by <strong>{memberName(createdBy)}</strong> · {formatDateTime(expense.createdAt)}
              </Typography>
            )}

            {editHistory.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Button
                  size="small"
                  onClick={() => setShowHistory(!showHistory)}
                  endIcon={showHistory ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  sx={{ fontSize: 12, color: "primary.main" }}
                >
                  {showHistory ? "Hide" : "Show"} edit history ({editHistory.length} edit{editHistory.length !== 1 ? "s" : ""})
                </Button>

                {showHistory && (
                  <Stack spacing={1.5} sx={{ mt: 1, borderLeft: 2, borderColor: "divider", pl: 2 }}>
                    {editHistory.map((edit, i) => {
                      const editorName = typeof edit.editedBy === "string"
                        ? edit.editedBy
                        : memberName(edit.editedBy);

                      return (
                        <Box key={i}>
                          <Typography variant="caption" color="text.secondary">
                            ✏️ Edited by <strong>{editorName}</strong> · {formatDateTime(edit.editedAt)}
                          </Typography>
                          <Box component="ul" sx={{ mt: 0.5, pl: 0, listStyle: "none" }}>
                            {Object.entries(edit.changes).map(([field, { old: oldVal, new: newVal }]) => (
                              <Typography component="li" key={field} variant="caption" color="text.secondary">
                                • {FIELD_LABELS[field] || field}: {formatValue(oldVal)} → {formatValue(newVal)}
                              </Typography>
                            ))}
                          </Box>
                        </Box>
                      );
                    })}
                  </Stack>
                )}
              </Box>
            )}
          </Box>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
