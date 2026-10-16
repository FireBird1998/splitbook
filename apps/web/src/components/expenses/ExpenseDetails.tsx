'use client';
import PreparedBy from './PreparedBy';

import { useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoneyText from '@/components/common/MoneyText';
import { formatDateTime } from '@splitbook/shared/date';
import { getCategory } from '@splitbook/shared/categories';
import { moneyParticipantId } from '@splitbook/shared/exact-money';
import { expenseHistory } from '@splitbook/shared/expense-detail';

interface Person {
  _id: string;
  name?: string;
  image?: string | null;
}

/** An Expense as the list or its own read returns it; the history comes from its own read. */
export interface ExpenseDetailsRecord {
  preparedBy?: unknown;
  _id: string;
  description: string;
  currency: string;
  category: string;
  tag?: string;
  splitMethod: string;
  paidBy: Array<{ user: Person | string | null; amount: number }>;
  splitBetween: Array<{
    user: Person | string | null;
    amount: number;
    percentage?: number;
    shares?: number;
  }>;
  notes?: string;
  receiptUrl?: string | null;
  recurringExpense?: string | null;
  createdAt?: string;
  createdBy?: Person | string | null;
  editHistory?: Array<{
    editedBy: Person | string | null;
    editedAt: string;
    changes: Record<string, { old?: unknown; new?: unknown }>;
  }>;
}

const SPLIT_METHOD_LABELS: Record<string, string> = {
  equal: 'Equally',
  unequal: 'By amounts',
  exact: 'By amounts',
  percentage: 'By percentage',
  shares: 'By shares',
};

const sectionTitle = {
  fontWeight: 600,
  color: 'text.secondary',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  mb: 1,
  display: 'block',
} as const;

interface ExpenseDetailsProps {
  /** The element id the row's toggle controls. */
  id: string;
  expense: ExpenseDetailsRecord;
  userId: string;
  /** Recurring markers show only while recurring Expenses are switched on (#289). */
  recurringExpensesEnabled: boolean;
  /** Whether the Expense's own read, with its history, has loaded, failed or is on its way. */
  history: 'loading' | 'ready' | 'failed';
  onRetryHistory: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

/**
 * An Expense opened below its card on a phone (#310; a computer opens the side panel, #311):
 * who paid, who owes what, the Category, Notes, a receipt, its history, and Edit and Delete.
 */
export default function ExpenseDetails({
  id,
  expense,
  userId,
  recurringExpensesEnabled,
  history,
  onRetryHistory,
  onEdit,
  onDelete,
}: ExpenseDetailsProps) {
  const [showHistory, setShowHistory] = useState(false);
  /** A person by name, with the viewer as "You", matched by id; a former member has none. */
  const memberName = (person: unknown) => {
    const personId = moneyParticipantId(person);
    if (personId && personId === userId) return 'You';
    const name = (person as { name?: unknown } | null)?.name;
    return typeof person === 'object' && typeof name === 'string' ? name : 'Former member';
  };
  const category = getCategory(expense.category);
  // Each edit as the computer panel words it (#454); the shared history ends with who added it,
  // which this card shows above.
  const edits = expenseHistory({
    currency: expense.currency,
    createdAt: expense.createdAt ?? '',
    editHistory: expense.editHistory,
  }).slice(0, -1);

  return (
    <Stack
      id={id}
      component="section"
      aria-label={`${expense.description} details`}
      spacing={2}
      sx={{ pt: 1.5, pb: 2 }}
    >
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Chip
          label={category ? `${category.icon} ${category.label}` : expense.category}
          size="small"
          variant="outlined"
        />
        {expense.tag && <Chip label={expense.tag} size="small" variant="outlined" />}
        {recurringExpensesEnabled && expense.recurringExpense && (
          <Chip label="Repeats monthly" size="small" variant="outlined" />
        )}
      </Stack>

      <PreparedBy value={expense.preparedBy} />
      <Box>
        <Typography variant="caption" sx={sectionTitle}>
          Paid by
        </Typography>
        <Stack spacing={0.75}>
          {expense.paidBy.map((row, index) => (
            <PersonAmount
              key={index}
              name={memberName(row.user as Person)}
              image={typeof row.user === 'object' ? row.user?.image : null}
              amount={row.amount}
              currency={expense.currency}
            />
          ))}
        </Stack>
      </Box>

      <Box>
        <Typography variant="caption" sx={sectionTitle}>
          Split ({SPLIT_METHOD_LABELS[expense.splitMethod] ?? expense.splitMethod})
        </Typography>
        <Stack spacing={0.75}>
          {expense.splitBetween.map((row, index) => (
            <PersonAmount
              key={index}
              name={memberName(row.user as Person)}
              image={typeof row.user === 'object' ? row.user?.image : null}
              amount={row.amount}
              currency={expense.currency}
              note={
                row.percentage !== undefined
                  ? `${row.percentage}%`
                  : row.shares !== undefined
                    ? `${row.shares} shares`
                    : undefined
              }
            />
          ))}
        </Stack>
      </Box>

      {!!expense.notes && (
        <Box>
          <Typography variant="caption" sx={sectionTitle}>
            Notes
          </Typography>
          <Typography variant="body2" color="text.primary" sx={{ whiteSpace: 'pre-wrap' }}>
            {expense.notes}
          </Typography>
        </Box>
      )}

      {!!expense.receiptUrl && (
        <Typography
          component="a"
          href={expense.receiptUrl}
          target="_blank"
          rel="noopener noreferrer"
          variant="body2"
          sx={{ color: 'primary.main', alignSelf: 'flex-start' }}
        >
          View receipt
        </Typography>
      )}

      <Divider />

      <Box>
        {expense.createdBy && expense.createdAt && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Added by <strong>{memberName(expense.createdBy)}</strong> ·{' '}
            {formatDateTime(expense.createdAt)}
          </Typography>
        )}
        {history === 'failed' ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
            <Typography role="alert" variant="caption" color="status.negative">
              This Expense’s history could not be loaded.
            </Typography>
            <Button size="small" onClick={onRetryHistory}>
              Try again
            </Button>
          </Stack>
        ) : history === 'loading' ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Loading its history…
          </Typography>
        ) : (
          edits.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Button
                size="small"
                onClick={() => setShowHistory(!showHistory)}
                aria-expanded={showHistory}
                endIcon={showHistory ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                sx={{ px: 0 }}
              >
                {showHistory ? 'Hide' : 'Show'} edit history ({edits.length} edit
                {edits.length !== 1 ? 's' : ''})
              </Button>
              <Collapse in={showHistory}>
                <Stack spacing={1.5} sx={{ mt: 1, borderLeft: 2, borderColor: 'divider', pl: 2 }}>
                  {edits.map((edit, index) => (
                    <Box key={`${edit.at}-${index}`}>
                      <Typography variant="caption" color="text.secondary">
                        <strong>{memberName(edit.by)}</strong> {edit.action} ·{' '}
                        {formatDateTime(edit.at)}
                      </Typography>
                      {edit.change && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', overflowWrap: 'anywhere' }}
                        >
                          <Box
                            component="span"
                            sx={
                              edit.change.kind === 'amount'
                                ? (theme) => theme.typography.money
                                : undefined
                            }
                          >
                            {edit.change.before} → {edit.change.after}
                          </Box>
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Stack>
              </Collapse>
            </Box>
          )
        )}
      </Box>

      {(onEdit || onDelete) && (
        <Stack direction="row" spacing={1}>
          {onEdit && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<EditOutlinedIcon />}
              onClick={onEdit}
            >
              Edit
            </Button>
          )}
          {onDelete && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<DeleteOutlineIcon />}
              onClick={onDelete}
              sx={{ color: 'status.negative', borderColor: 'border.strong' }}
            >
              Delete
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function PersonAmount({
  name,
  image,
  amount,
  currency,
  note,
}: {
  name: string;
  image?: string | null;
  amount: number;
  currency: string;
  note?: string;
}) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
        <Avatar src={image ?? undefined} alt="" sx={{ width: 24, height: 24, fontSize: 11 }}>
          {name[0]}
        </Avatar>
        <Typography variant="body2" color="text.primary" noWrap>
          {name}
        </Typography>
        {note && (
          <Typography variant="caption" color="text.secondary">
            ({note})
          </Typography>
        )}
      </Stack>
      <MoneyText amount={amount} currency={currency} tone="neutral" variant="body2" />
    </Stack>
  );
}
