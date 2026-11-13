'use client';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useId } from 'react';
import useSWR from 'swr';
import { expenseRecordKey } from '@splitbook/shared/query-keys';
import { formatDate } from '@splitbook/shared/date';
import { formatCurrency, formatCurrencyAsEntered } from '@splitbook/shared/currency';
import { reviewDate, reviewSplitMethod } from '@splitbook/shared/to-review';
import type { ExpenseDraftValues, DraftReview } from '@splitbook/shared/validators/expense-draft';
import type { ToReviewItem } from '@splitbook/shared/to-review-read';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { fetchWebExpenseRecord } from '@/lib/web-read';
import { expenseLocalDate } from '@splitbook/shared/expense-day';
import { moneyParticipantId } from '@splitbook/shared/exact-money';
import { SEPARATOR } from '@splitbook/shared/separator';

export function reviewSource(item: ToReviewItem) {
  const by = item.draft.preparedBy;
  return by.kind === 'assistant' ? `From ${by.name}` : 'You set this aside';
}
/** An item without a currency is in its Group's, as on Add expense (#512). */
export function reviewAmount(values: ExpenseDraftValues = {}, groupCurrency?: string) {
  const currency = values.currency || groupCurrency;
  return values.amount !== undefined && currency
    ? formatCurrencyAsEntered(values.amount, currency)
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
        {v.description || 'Description missing'}
        {SEPARATOR}
        {reviewAmount(v, currency)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {reviewDate(v.date)}
        {SEPARATOR}
        {reviewSource(item)}
      </Typography>
      <Typography variant="body2">
        Paid by {v.paidBy?.map((p) => names[p.user] ?? 'a member').join(', ') || 'not specified'}
        {SEPARATOR}
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
  names,
  onLoaded,
  disabled,
}: {
  groupId: string;
  id: string;
  description: string;
  /** Members' names, with the viewer as "You". */
  names: Readonly<Record<string, string>>;
  onLoaded: (id: string, loaded: boolean) => void;
  disabled: boolean;
}) {
  const { data, error, isValidating, mutate } = useSWR(
    expenseRecordKey(WEB_QUERY_ACCOUNT, groupId, id),
    fetchWebExpenseRecord,
    { shouldRetryOnError: false },
  );
  const expense = data?.data;
  const loaded = !!expense;
  const statusId = useId();
  const descriptionId = `${statusId}-description`;
  useEffect(() => {
    onLoaded(id, loaded);
    return () => onLoaded(id, false);
  }, [id, loaded, onLoaded]);
  const author = expense?.createdBy;
  // A current member as To review names them ("You" for the viewer), else the name on the record.
  const addedBy =
    names[moneyParticipantId(author)] ??
    (typeof author === 'object' && author?.name ? author.name : 'a member');
  return (
    <Box>
      <Typography id={descriptionId} fontWeight={600}>
        {expense?.description ?? description}
      </Typography>
      {expense ? (
        <Typography variant="body2" role="status">
          {formatCurrency(expense.amount, expense.currency)}
          {SEPARATOR}
          {formatDate(expenseLocalDate(expense.date))}
          {SEPARATOR}Added by {addedBy}
        </Typography>
      ) : (
        <Typography id={statusId} variant="body2" role="status" tabIndex={0}>
          {error && !isValidating
            ? 'Could not load this Expense. Check it in Expenses before saving.'
            : 'Loading matching Expense…'}
        </Typography>
      )}
      {!expense && error && (
        <Button
          disabled={disabled || isValidating}
          aria-describedby={`${descriptionId} ${statusId}`}
          onClick={() => void mutate()}
        >
          Try again
        </Button>
      )}
    </Box>
  );
}
export function ReviewMatches({
  item,
  items,
  names,
  currency,
  onExpenseLoaded,
  disabled,
}: {
  item: ToReviewItem;
  items: ToReviewItem[];
  names: Readonly<Record<string, string>>;
  /** The Group's currency. */
  currency?: string;
  onExpenseLoaded: (id: string, loaded: boolean) => void;
  disabled: boolean;
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
          <ExpenseMatch
            key={match.id}
            groupId={item.draft.groupId}
            names={names}
            onLoaded={onExpenseLoaded}
            disabled={disabled}
            {...match}
          />
        ) : (
          <Box key={match.id}>
            {items.find((other) => other.draft.id === match.id) ? (
              <ReviewFacts
                item={items.find((other) => other.draft.id === match.id)!}
                names={names}
                currency={currency}
              />
            ) : (
              <Typography>
                {match.description}
                {SEPARATOR}Another item in To review
              </Typography>
            )}
          </Box>
        ),
      )}
    </Box>
  );
}
