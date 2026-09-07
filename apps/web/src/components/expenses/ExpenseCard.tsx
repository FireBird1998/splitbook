'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MuiMenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import MoneyText from '@/components/common/MoneyText';
import { formatCurrency } from '@/lib/utils/currency';
import { formatDateTime } from '@/lib/utils/date';

const CATEGORY_ICONS: Record<string, string> = {
  food: '🍕',
  transport: '🚗',
  accommodation: '🏨',
  travel: '✈️',
  entertainment: '🎬',
  shopping: '🛍️',
  housing: '🏠',
  health: '🏥',
  education: '📚',
  other: '📋',
};

const SPLIT_METHOD_LABELS: Record<string, string> = {
  equal: 'Equal',
  unequal: 'Unequal',
  percentage: 'Percentage',
  shares: 'Shares',
  exact: 'Exact',
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
  const icon = CATEGORY_ICONS[category] || '📋';
  const paidBy =
    (expense.paidBy as Array<{
      user: { _id: string; name: string; image?: string };
      amount: number;
    }>) || [];
  const splitBetween =
    (expense.splitBetween as Array<{
      user: { _id: string; name: string; image?: string };
      amount: number;
      percentage?: number;
      shares?: number;
    }>) || [];
  const tag = (expense.tag as string) || '';
  const hasReceipt = !!expense.receiptUrl;
  const isRecurring = !!expense.recurringExpense;
  const editHistory = (expense.editHistory || []) as Array<{
    editedBy: { _id: string; name: string } | string;
    editedAt: string;
    changes: Record<string, { old: unknown; new: unknown }>;
  }>;
  const createdBy = expense.createdBy as { _id: string; name: string; image?: string } | undefined;

  const userSplit = splitBetween.find((s) => s.user._id === userId);
  const userPaid = paidBy.find((p) => p.user._id === userId);
  const userOwes = (userSplit?.amount || 0) - (userPaid?.amount || 0);

  const mainPayer = paidBy[0];
  const payerName = mainPayer?.user._id === userId ? 'You' : mainPayer?.user.name;

  const memberName = (user: { _id: string; name: string }) =>
    user._id === userId ? 'You' : user.name;

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
  };

  const handleMenuClose = () => setMenuAnchor(null);

  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val.join(', ') || '—';
    return JSON.stringify(val);
  };

  const FIELD_LABELS: Record<string, string> = {
    description: 'Description',
    amount: 'Amount',
    currency: 'Currency',
    category: 'Category',
    date: 'Date',
    splitMethod: 'Split method',
    tag: 'Tag',
    notes: 'Notes',
    paidBy: 'Paid by',
    splitBetween: 'Split between',
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        transition: 'all 0.2s',
        borderColor: isExpanded ? 'primary.light' : 'divider',
        ...(isExpanded ? { boxShadow: 1 } : { '&:hover': { boxShadow: 1 } }),
      }}
    >
      {/* ─── Collapsed Summary Row ────────────────── */}
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`${expense.description as string}, ${formatCurrency(
          expense.amount as number,
          expense.currency as string,
        )}. ${isExpanded ? 'Collapse' : 'Expand'} expense details.`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        sx={{ p: { xs: 1.5, sm: 2 }, cursor: 'pointer' }}
        onClick={onToggleExpand}
      >
        <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="span" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, mt: 0.25 }}>
            {icon}
          </Typography>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="body2"
              fontWeight={500}
              color="text.primary"
              noWrap
              sx={{ fontSize: { xs: 13, sm: 14 } }}
            >
              {expense.description as string}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                mt: 0.25,
                fontSize: { xs: 11, sm: 12 },
                display: { xs: 'none', sm: 'block' },
              }}
            >
              {payerName} paid{' '}
              {formatCurrency(expense.amount as number, expense.currency as string)}
              {paidBy.length > 1 && ` (+${paidBy.length - 1} more)`}
              {' · '}Split {splitBetween.length} way
              {splitBetween.length !== 1 ? 's' : ''}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                mt: 0.25,
                fontSize: 11,
                display: { xs: 'block', sm: 'none' },
              }}
            >
              {payerName} paid · {splitBetween.length} way
              {splitBetween.length !== 1 ? 's' : ''}
            </Typography>
          </Box>
        </Stack>
        <Stack
          direction="row"
          alignItems="flex-start"
          spacing={0.5}
          sx={{ flexShrink: 0, ml: 0.5 }}
        >
          <Box sx={{ textAlign: 'right' }}>
            <MoneyText
              amount={expense.amount as number}
              currency={expense.currency as string}
              tone="neutral"
              variant="body2"
              fontWeight={600}
              sx={{ fontSize: { xs: 13, sm: 14 } }}
            />
            {Math.abs(userOwes) >= 0.01 && (
              <Typography
                component="span"
                fontWeight={500}
                sx={{
                  display: 'block',
                  color: userOwes > 0 ? 'error.main' : 'success.main',
                  fontSize: { xs: 10, sm: 12 },
                }}
              >
                {userOwes > 0 ? 'You owe ' : 'You get back '}
                <MoneyText
                  amount={Math.abs(userOwes)}
                  currency={expense.currency as string}
                  tone="neutral"
                  color="inherit"
                  variant="inherit"
                />
              </Typography>
            )}
          </Box>
          {(onEdit || onDelete) && (
            <>
              <IconButton
                size="small"
                onClick={handleMenuOpen}
                aria-label="Expense actions"
                aria-haspopup="true"
                aria-expanded={!!menuAnchor}
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
                      <DeleteIcon fontSize="small" sx={{ color: 'error.main' }} />
                    </ListItemIcon>
                    <ListItemText sx={{ color: 'error.main' }}>Delete</ListItemText>
                  </MuiMenuItem>
                )}
              </Menu>
            </>
          )}
        </Stack>
      </Stack>

      {/* Tag (always visible in collapsed state) */}
      {!isExpanded && (tag || hasReceipt || isRecurring) && (
        <Stack direction="row" spacing={0.75} sx={{ px: 2, pb: 1.5 }} flexWrap="wrap">
          {tag && (
            <Chip label={tag} size="small" variant="outlined" sx={{ fontSize: 11, height: 22 }} />
          )}
          {isRecurring && (
            <Chip
              label="🔁 Recurring"
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
        </Stack>
      )}

      {/* ─── Expanded Detail ──────────────────────── */}
      <Collapse in={isExpanded}>
        <Stack spacing={2} sx={{ px: 2, pb: 2 }}>
          <Divider />

          {/* Metadata chips */}
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Chip
              label={`${CATEGORY_ICONS[category] || ''} ${category}`}
              size="small"
              variant="outlined"
            />
            {tag && <Chip label={tag} size="small" variant="outlined" sx={{ fontSize: 11 }} />}
            {isRecurring && (
              <Chip label="🔁 Recurring" size="small" variant="outlined" sx={{ fontSize: 11 }} />
            )}
            {hasReceipt && (
              <Chip label="📎 Receipt" size="small" variant="outlined" sx={{ fontSize: 11 }} />
            )}
          </Stack>

          {/* Paid By */}
          <Box>
            <Typography
              variant="caption"
              fontWeight={600}
              color="text.secondary"
              sx={{
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                mb: 1,
                display: 'block',
              }}
            >
              Paid by
            </Typography>
            <Stack spacing={0.75}>
              {paidBy.map((p, i) => (
                <Stack key={i} direction="row" alignItems="center" justifyContent="space-between">
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Avatar src={p.user.image} sx={{ width: 24, height: 24, fontSize: 11 }}>
                      {p.user.name?.[0]}
                    </Avatar>
                    <Typography variant="body2" color="text.primary">
                      {memberName(p.user)}
                    </Typography>
                  </Stack>
                  <MoneyText
                    amount={p.amount}
                    currency={expense.currency as string}
                    tone="neutral"
                    variant="body2"
                    fontWeight={500}
                  />
                </Stack>
              ))}
            </Stack>
          </Box>

          {/* Split */}
          <Box>
            <Typography
              variant="caption"
              fontWeight={600}
              color="text.secondary"
              sx={{
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                mb: 1,
                display: 'block',
              }}
            >
              Split (
              {SPLIT_METHOD_LABELS[expense.splitMethod as string] ||
                (expense.splitMethod as string)}
              )
            </Typography>
            <Stack spacing={0.75}>
              {splitBetween.map((s, i) => (
                <Stack key={i} direction="row" alignItems="center" justifyContent="space-between">
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Avatar src={s.user.image} sx={{ width: 24, height: 24, fontSize: 11 }}>
                      {s.user.name?.[0]}
                    </Avatar>
                    <Typography variant="body2" color="text.primary">
                      {memberName(s.user)}
                    </Typography>
                    {s.percentage !== undefined && (
                      <Typography variant="caption" color="text.disabled">
                        ({s.percentage}%)
                      </Typography>
                    )}
                    {s.shares !== undefined && (
                      <Typography variant="caption" color="text.disabled">
                        ({s.shares} shares)
                      </Typography>
                    )}
                  </Stack>
                  <MoneyText
                    amount={s.amount}
                    currency={expense.currency as string}
                    tone="neutral"
                    variant="body2"
                    fontWeight={500}
                  />
                </Stack>
              ))}
            </Stack>
          </Box>

          {/* Notes */}
          {!!expense.notes && (
            <Box>
              <Typography
                variant="caption"
                fontWeight={600}
                color="text.secondary"
                sx={{
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  mb: 0.5,
                  display: 'block',
                }}
              >
                Notes
              </Typography>
              <Typography variant="body2" color="text.primary" sx={{ whiteSpace: 'pre-wrap' }}>
                {expense.notes as string}
              </Typography>
            </Box>
          )}

          {/* Receipt */}
          {!!expense.receiptUrl && (
            <Box>
              <Typography
                component="a"
                href={expense.receiptUrl as string}
                target="_blank"
                rel="noopener noreferrer"
                variant="body2"
                onClick={(e) => e.stopPropagation()}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1,
                  color: 'primary.main',
                  textDecoration: 'none',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                📎 View Receipt
              </Typography>
            </Box>
          )}

          <Divider />

          {/* History */}
          <Box>
            {createdBy && (
              <Typography variant="caption" color="text.secondary">
                Created by <strong>{memberName(createdBy)}</strong> ·{' '}
                {formatDateTime(expense.createdAt as string)}
              </Typography>
            )}

            {editHistory.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Button
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowHistory(!showHistory);
                  }}
                  endIcon={showHistory ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  sx={{ fontSize: 12, color: 'primary.main', px: 0 }}
                >
                  {showHistory ? 'Hide' : 'Show'} edit history ({editHistory.length} edit
                  {editHistory.length !== 1 ? 's' : ''})
                </Button>

                <Collapse in={showHistory}>
                  <Stack spacing={1.5} sx={{ mt: 1, borderLeft: 2, borderColor: 'divider', pl: 2 }}>
                    {editHistory.map((edit, i) => {
                      const editorName =
                        typeof edit.editedBy === 'string'
                          ? edit.editedBy
                          : memberName(edit.editedBy);

                      return (
                        <Box key={i}>
                          <Typography variant="caption" color="text.secondary">
                            ✏️ Edited by <strong>{editorName}</strong> ·{' '}
                            {formatDateTime(edit.editedAt)}
                          </Typography>
                          <Box component="ul" sx={{ mt: 0.5, pl: 0, listStyle: 'none' }}>
                            {Object.entries(edit.changes).map(
                              ([field, { old: oldVal, new: newVal }]) => (
                                <Typography
                                  component="li"
                                  key={field}
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  • {FIELD_LABELS[field] || field}: {formatValue(oldVal)} →{' '}
                                  {formatValue(newVal)}
                                </Typography>
                              ),
                            )}
                          </Box>
                        </Box>
                      );
                    })}
                  </Stack>
                </Collapse>
              </Box>
            )}
          </Box>

          {/* Action buttons */}
          <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
            {onEdit && (
              <Button
                size="small"
                startIcon={<EditIcon sx={{ fontSize: 16 }} />}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(expense);
                }}
                sx={{ fontSize: 13, color: 'primary.main' }}
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
                sx={{ fontSize: 13 }}
              >
                Delete
              </Button>
            )}
          </Stack>
        </Stack>
      </Collapse>
    </Paper>
  );
}
