'use client';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import useSWR from 'swr';
import { expenseRecordKey } from '@splitbook/shared/query-keys';
import { formatDate } from '@splitbook/shared/date';
import { formatCurrency } from '@splitbook/shared/currency';
import { reviewDate, reviewSplitMethod } from '@splitbook/shared/to-review';
import type { ExpenseDraftValues, DraftReview } from '@splitbook/shared/validators/expense-draft';
import type { ToReviewItem } from '@splitbook/shared/to-review-read';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { fetchWebExpenseRecord } from '@/lib/web-read';
import { expenseLocalDate } from '@splitbook/shared/expense-day';

export function reviewSource(item: ToReviewItem) {
  const by = item.draft.preparedBy;
  return by.kind === 'assistant' ? `From ${by.name}` : 'You set this aside';
}
/** An item without a currency is in its Group's, as on Add expense (#512). */
export function reviewAmount(values: ExpenseDraftValues = {}, groupCurrency?: string) {
  const currency = values.currency || groupCurrency;
  return values.amount !== undefined && currency
    ? formatCurrency(values.amount, currency)
    : 'Amount missing';
}
export function ReviewFacts({
  item,
  names,
  currency,
}: {
  item: ToReviewItem | DraftReview;
  names: Readonly<Record<string, string>>;
  /** The Group's currency. */
  currency?: string;
}) {
  const v = item.draft.values ?? {};
  return (
    <Box sx={{ overflowWrap: 'anywhere' }}>
      <Typography fontWeight={600}>
        {v.description || 'Description missing'} · {reviewAmount(v, currency)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {reviewDate(v.date)} · {reviewSource(item)}
      </Typography>
      <Typography variant="body2">
        Paid by {v.paidBy?.map((p) => names[p.user] ?? 'a member').join(', ') || 'not specified'} ·{' '}
        {reviewSplitMethod(v.splitMethod)}
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
          {formatCurrency(expense.amount, expense.currency)} ·{' '}
          {formatDate(expenseLocalDate(expense.date))} · Added by{' '}
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
  currency,
}: {
  item: ToReviewItem;
  items: ToReviewItem[];
  names: Readonly<Record<string, string>>;
  /** The Group's currency. */
  currency?: string;
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
                currency={currency}
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
