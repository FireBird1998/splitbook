'use client';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import useSWR from 'swr';
import { expenseRecordKey } from '@splitbook/shared/query-keys';
import { formatDate } from '@splitbook/shared/date';
import { formatCurrency } from '@splitbook/shared/currency';
import { reviewDate } from '@splitbook/shared/to-review';
import type { ExpenseDraftValues, DraftReview } from '@splitbook/shared/validators/expense-draft';
import type { ToReviewItem } from '@splitbook/shared/to-review-read';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { fetchWebExpenseRecord } from '@/lib/web-read';

export function reviewSource(item: ToReviewItem) {
  const by = item.draft.preparedBy;
  return by.kind === 'assistant' ? `From ${by.name}` : 'You set this aside';
}
export function reviewAmount(values: ExpenseDraftValues = {}) {
  return values.amount !== undefined && values.currency
    ? formatCurrency(values.amount, values.currency)
    : 'Amount missing';
}
export function ReviewFacts({
  item,
  names,
}: {
  item: ToReviewItem | DraftReview;
  names: Readonly<Record<string, string>>;
}) {
  const v = item.draft.values ?? {};
  return (
    <Box sx={{ overflowWrap: 'anywhere' }}>
      <Typography fontWeight={600}>
        {v.description || 'Description missing'} · {reviewAmount(v)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {reviewDate(v.date)} · {reviewSource(item)}
      </Typography>
      <Typography variant="body2">
        Paid by {v.paidBy?.map((p) => names[p.user] ?? 'a member').join(', ') || 'not specified'} ·{' '}
        {v.splitMethod || 'Split missing'}
        {v.splitBetween?.length
          ? ` between ${v.splitBetween.map((p) => names[p.user] ?? 'a member').join(', ')}`
          : ''}
      </Typography>
    </Box>
  );
}
function ExpenseMatch({
  groupId,
  id,
  description,
}: {
  groupId: string;
  id: string;
  description: string;
}) {
  const { data, error } = useSWR(
    expenseRecordKey(WEB_QUERY_ACCOUNT, groupId, id),
    fetchWebExpenseRecord,
  );
  const expense = data?.data;
  const author = expense?.createdBy;
  return (
    <Box>
      <Typography fontWeight={600}>{expense?.description ?? description}</Typography>
      {expense ? (
        <Typography variant="body2">
          {formatCurrency(expense.amount, expense.currency)} · {formatDate(expense.date)} · Added by{' '}
          {typeof author === 'object' && author?.name ? author.name : 'a member'}
        </Typography>
      ) : (
        <Typography variant="body2">
          {error
            ? 'Could not load this Expense. Check it in Expenses before saving.'
            : 'Loading matching Expense…'}
        </Typography>
      )}
    </Box>
  );
}
export function ReviewMatches({
  item,
  items,
  names,
}: {
  item: ToReviewItem;
  items: ToReviewItem[];
  names: Readonly<Record<string, string>>;
}) {
  return (
    <Box
      component="section"
      aria-label="Possible duplicates"
      sx={{ p: 2, bgcolor: 'tint.info', borderRadius: 2 }}
    >
      <Typography component="h3" variant="subtitle1">
        This might already be here
      </Typography>
      {item.duplicates.map((match) =>
        match.kind === 'expense' ? (
          <ExpenseMatch key={match.id} groupId={item.draft.groupId} {...match} />
        ) : (
          <Box key={match.id}>
            {items.find((other) => other.draft.id === match.id) ? (
              <ReviewFacts
                item={items.find((other) => other.draft.id === match.id)!}
                names={names}
              />
            ) : (
              <Typography>{match.description} · Another item in To review</Typography>
            )}
          </Box>
        ),
      )}
    </Box>
  );
}
