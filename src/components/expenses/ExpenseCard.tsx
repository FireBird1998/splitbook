"use client";

import { useState } from "react";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MuiMenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDateTime } from "@/lib/utils/date";

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

const SPLIT_METHOD_LABELS: Record<string, string> = {
  equal: "Equal",
  unequal: "Unequal",
  percentage: "Percentage",
  shares: "Shares",
  exact: "Exact",
};

interface ExpenseCardProps {
  expense: Record<string, unknown>;
  userId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit?: (expense: Record<string, unknown>) => void;
  onDelete?: (expense: Record<string, unknown>) => void;
}

export default function ExpenseCard({
  expense,
  userId,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
}: ExpenseCardProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const category = expense.category as string;
  const icon = CATEGORY_ICONS[category] || "📋";
  const paidBy = (expense.paidBy as Array<{ user: { _id: string; name: string; image?: string }; amount: number }>) || [];
  const splitBetween = (expense.splitBetween as Array<{
    user: { _id: string; name: string; image?: string };
    amount: number;
    percentage?: number;
    shares?: number;
  }>) || [];
  const tag = (expense.tag as string) || "";
  const hasReceipt = !!expense.receiptUrl;
  const editHistory = (expense.editHistory || []) as Array<{
    editedBy: { _id: string; name: string } | string;
    editedAt: string;
    changes: Record<string, { old: unknown; new: unknown }>;
  }>;
  const createdBy = expense.createdBy as { _id: string; name: string; image?: string } | undefined;

  // What the current user owes/is owed
  const userSplit = splitBetween.find((s) => s.user._id === userId);
  const userPaid = paidBy.find((p) => p.user._id === userId);
  const userOwes = (userSplit?.amount || 0) - (userPaid?.amount || 0);

  // Who paid display
  const mainPayer = paidBy[0];
  const payerName = mainPayer?.user._id === userId ? "You" : mainPayer?.user.name;

  const memberName = (user: { _id: string; name: string }) =>
    user._id === userId ? "You" : user.name;

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
  };

  const handleMenuClose = () => setMenuAnchor(null);

  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "number") return String(val);
    if (typeof val === "string") return val;
    if (Array.isArray(val)) return val.join(", ") || "—";
    return JSON.stringify(val);
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

  return (
    <div
      className={`bg-white rounded-xl border transition-all ${isExpanded ? "border-indigo-200 shadow-sm" : "border-gray-100 hover:shadow-sm"
        }`}
    >
      {/* ─── Collapsed Summary Row ────────────────── */}
      <div
        className="flex items-start justify-between p-4 cursor-pointer"
        onClick={onToggleExpand}
      >
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="text-2xl mt-0.5">{icon}</span>
          <div className="min-w-0 flex-1">
            <h4 className="font-medium text-gray-900 text-sm truncate">
              {expense.description as string}
            </h4>
            <p className="text-xs text-gray-500 mt-0.5">
              {payerName} paid{" "}
              {formatCurrency(expense.amount as number, expense.currency as string)}
              {paidBy.length > 1 && ` (+${paidBy.length - 1} more)`}
              {" · "}Split {splitBetween.length} way{splitBetween.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-1 shrink-0">
          <div className="text-right">
            <p className="text-sm font-semibold text-gray-900">
              {formatCurrency(expense.amount as number, expense.currency as string)}
            </p>
            {Math.abs(userOwes) >= 0.01 && (
              <p
                className={`text-xs font-medium ${userOwes > 0 ? "text-red-500" : "text-green-600"
                  }`}
              >
                {userOwes > 0
                  ? `You owe ${formatCurrency(userOwes, expense.currency as string)}`
                  : `You get back ${formatCurrency(-userOwes, expense.currency as string)}`}
              </p>
            )}
          </div>
          {(onEdit || onDelete) && (
            <>
              <IconButton
                size="small"
                onClick={handleMenuOpen}
                sx={{ ml: 0.5, mt: -0.5 }}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
              <Menu
                anchorEl={menuAnchor}
                open={!!menuAnchor}
                onClose={handleMenuClose}
                onClick={(e) => e.stopPropagation()}
                slotProps={{ paper: { sx: { minWidth: 140 } } }}
              >
                {onEdit && (
                  <MuiMenuItem
                    onClick={() => {
                      handleMenuClose();
                      onEdit(expense);
                    }}
                  >
                    <ListItemIcon>
                      <EditIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Edit</ListItemText>
                  </MuiMenuItem>
                )}
                {onDelete && (
                  <MuiMenuItem
                    onClick={() => {
                      handleMenuClose();
                      onDelete(expense);
                    }}
                  >
                    <ListItemIcon>
                      <DeleteIcon fontSize="small" sx={{ color: "error.main" }} />
                    </ListItemIcon>
                    <ListItemText sx={{ color: "error.main" }}>Delete</ListItemText>
                  </MuiMenuItem>
                )}
              </Menu>
            </>
          )}
        </div>
      </div>

      {/* Tag (always visible in collapsed state) */}
      {!isExpanded && (tag || hasReceipt) && (
        <div className="flex items-center gap-1.5 px-4 pb-3 flex-wrap">
          {tag && (
            <Chip
              label={tag}
              size="small"
              variant="outlined"
              sx={{ fontSize: 11, height: 22 }}
            />
          )}
          {hasReceipt && (
            <Chip
              label="📎 Receipt"
              size="small"
              variant="outlined"
              sx={{ fontSize: 11, height: 22 }}
            />
          )}
        </div>
      )}

      {/* ─── Expanded Detail ──────────────────────── */}
      <Collapse in={isExpanded}>
        <div className="px-4 pb-4 space-y-4">
          <Divider />

          {/* Metadata chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <Chip
              label={`${CATEGORY_ICONS[category] || ""} ${category}`}
              size="small"
              variant="outlined"
            />
            {tag && (
              <Chip label={tag} size="small" variant="outlined" sx={{ fontSize: 11 }} />
            )}
            {hasReceipt && (
              <Chip label="📎 Receipt" size="small" variant="outlined" sx={{ fontSize: 11 }} />
            )}
          </div>

          {/* Paid By */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Paid by
            </h4>
            <div className="space-y-1.5">
              {paidBy.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar src={p.user.image} sx={{ width: 24, height: 24, fontSize: 11 }}>
                      {p.user.name?.[0]}
                    </Avatar>
                    <span className="text-sm text-gray-900">{memberName(p.user)}</span>
                  </div>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrency(p.amount, expense.currency as string)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Split */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Split ({SPLIT_METHOD_LABELS[expense.splitMethod as string] || (expense.splitMethod as string)})
            </h4>
            <div className="space-y-1.5">
              {splitBetween.map((s, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar src={s.user.image} sx={{ width: 24, height: 24, fontSize: 11 }}>
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
                    {formatCurrency(s.amount, expense.currency as string)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {!!expense.notes && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Notes
              </h4>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{expense.notes as string}</p>
            </div>
          )}

          {/* Receipt */}
          {!!expense.receiptUrl && (
            <div>
              <a
                href={expense.receiptUrl as string}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
                onClick={(e) => e.stopPropagation()}
              >
                📎 View Receipt
              </a>
            </div>
          )}

          <Divider />

          {/* History */}
          <div>
            {createdBy && (
              <p className="text-xs text-gray-500">
                Created by <strong>{memberName(createdBy)}</strong> · {formatDateTime(expense.createdAt as string)}
              </p>
            )}

            {editHistory.length > 0 && (
              <div className="mt-2">
                <Button
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowHistory(!showHistory);
                  }}
                  endIcon={showHistory ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  sx={{ textTransform: "none", fontSize: 12, color: "#6C63FF", px: 0 }}
                >
                  {showHistory ? "Hide" : "Show"} edit history ({editHistory.length} edit{editHistory.length !== 1 ? "s" : ""})
                </Button>

                <Collapse in={showHistory}>
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
                </Collapse>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            {onEdit && (
              <Button
                size="small"
                startIcon={<EditIcon sx={{ fontSize: 16 }} />}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(expense);
                }}
                sx={{ textTransform: "none", fontSize: 13, color: "#6C63FF" }}
              >
                Edit
              </Button>
            )}
            {onDelete && (
              <Button
                size="small"
                startIcon={<DeleteIcon sx={{ fontSize: 16 }} />}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(expense);
                }}
                color="error"
                sx={{ textTransform: "none", fontSize: 13 }}
              >
                Delete
              </Button>
            )}
          </div>
        </div>
      </Collapse>
    </div>
  );
}
