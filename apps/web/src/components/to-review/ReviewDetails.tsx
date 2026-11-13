'use client';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useEffect, useId, useRef, useState } from 'react';
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
  refreshMatches,
  onRetryStart,
}: {
  groupId: string;
  id: string;
  description: string;
  /** Members' names, with the viewer as "You". */
  names: Readonly<Record<string, string>>;
  onLoaded: (id: string, loaded: boolean) => void;
  disabled: boolean;
  refreshMatches: () => Promise<unknown>;
  onRetryStart: (button: HTMLButtonElement) => void;
}) {
  const { data, error, isValidating, mutate } = useSWR(
    expenseRecordKey(WEB_QUERY_ACCOUNT, groupId, id),
    fetchWebExpenseRecord,
    { shouldRetryOnError: false },
  );
  const record = data?.data;
  const deleted = record?.isDeleted === true;
  const expense = record && !deleted ? record : undefined;
  const loaded = !!expense;
  const [retrying, setRetrying] = useState(false);
  const inFlight = useRef(false);
  const statusId = useId();
  const descriptionId = `${statusId}-description`;
  useEffect(() => {
    onLoaded(id, loaded);
    return () => onLoaded(id, false);
  }, [id, loaded, onLoaded]);
  async function retry(button: HTMLButtonElement) {
    if (disabled || isValidating || inFlight.current) return;
    inFlight.current = true;
    onRetryStart(button);
    setRetrying(true);
    try {
      // Each read publishes its own result. A failure must not prevent the other read.
      await Promise.allSettled([mutate(), refreshMatches()]);
    } finally {
      inFlight.current = false;
      setRetrying(false);
    }
  }
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
        <Typography variant="body2">
          {formatCurrency(expense.amount, expense.currency)}
          {SEPARATOR}
          {formatDate(expenseLocalDate(expense.date))}
          {SEPARATOR}Added by {addedBy}
        </Typography>
      ) : (
        <Typography id={statusId} variant="body2" role="status">
          {retrying || isValidating
            ? 'Loading matching Expense…'
            : deleted
              ? 'This Expense is deleted.'
              : error
                ? 'Could not load this Expense. Check it in Expenses before saving.'
                : 'Loading matching Expense…'}
        </Typography>
      )}
      {((!expense && (error || deleted)) || retrying) && (
        <Button
          aria-disabled={disabled || isValidating || retrying}
          aria-busy={isValidating || retrying}
          aria-describedby={expense ? descriptionId : `${descriptionId} ${statusId}`}
          onClick={(event) => void retry(event.currentTarget)}
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
  refreshMatches,
  onRetryStart,
}: {
  item: ToReviewItem;
  items: ToReviewItem[];
  names: Readonly<Record<string, string>>;
  /** The Group's currency. */
  currency?: string;
  onExpenseLoaded: (id: string, loaded: boolean) => void;
  disabled: boolean;
  refreshMatches: () => Promise<unknown>;
  onRetryStart: (button: HTMLButtonElement) => void;
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
            refreshMatches={refreshMatches}
            onRetryStart={onRetryStart}
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
