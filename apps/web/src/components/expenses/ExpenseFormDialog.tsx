'use client';
import ExpenseFields from './ExpenseFields';
import KeepExpenseDraft, { useKeepExpenseDraft } from '@/components/drafts/KeepExpenseDraft';

import { useState } from 'react';
import KeptInToReview from '@/components/drafts/KeptInToReview';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { toDateParam } from '@splitbook/shared/date';
import { formatCurrency } from '@splitbook/shared/currency';
import {
  expenseCurrencyChoices,
  groupCurrencies,
  startingExpenseCurrency,
} from '@splitbook/shared/group-currencies';
import { readAmountEntry } from '@splitbook/shared/amount-entry';
import {
  ExpenseDraft,
  type SavedDraftExpense,
  type ExpenseDraftValues,
} from '@splitbook/shared/expense-draft';
import { useExpenseDraftSave } from './use-expense-draft-save';
import { getDefaultExpenseTag } from './expense-form-helpers';
import type { GroupRead } from '@splitbook/shared/group-read';
import { apiFetch } from '@/lib/utils/api-fetch';

// ─── Types ─────────────────────────────────────────────
interface ExpenseFormDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  group: GroupRead;
  userId: string;
  expense?: Record<string, unknown> | null; // If provided → edit mode
  /**
   * Default date for a NEW expense (`yyyy-MM-dd`), e.g. the last day of a
   * past month when the form opens from a Household month view. Ignored in
   * edit mode; the user can still override it.
   */
  defaultDate?: string | null;
  /** Name the Group under the title, for a form opened away from the Group's page (#304). */
  showGroupName?: boolean;
  /** Called once the save is confirmed, just before the form closes. */
  onSaved?: () => void;
  onKept?: () => void;
  /**
   * A new Expense's draft begun elsewhere, such as Quick add's "More options" (#320). The form
   * opens with its values, and an unconfirmed save in it stays the same request, so sending it
   * unchanged can't record it twice. Ignored in edit mode.
   */
  initialDraft?: ExpenseDraft | null;
}

// ─── Component ─────────────────────────────────────────
export default function ExpenseFormDialog(props: ExpenseFormDialogProps) {
  const [kept, setKept] = useState(false);
  return (
    <>
      {props.open && (
        <ExpenseDraftDialog
          key={JSON.stringify([props.groupId, props.userId, props.expense?._id ?? null])}
          {...props}
          onKept={() => {
            if (props.onKept) props.onKept();
            else setKept(true);
          }}
        />
      )}
      <KeptInToReview groupId={kept ? props.groupId : null} onClose={() => setKept(false)} />
    </>
  );
}

function ExpenseDraftDialog({
  open,
  onClose,
  groupId,
  group,
  userId,
  expense: initialExpense = null,
  defaultDate = null,
  showGroupName = false,
  onSaved,
  onKept,
  initialDraft = null,
}: ExpenseFormDialogProps) {
  const members = group.members;
  const groupTags = group.tags;
  // A new Expense starts in the currency of the member's latest Expense here, while the Group
  // lists it, else in the main currency; nothing new is stored for it (#710, #719).
  const currencies = groupCurrencies(group);
  const startCurrency = startingExpenseCurrency(group, group.latestExpenseCurrency);

  const [draft, setDraft] = useState(() =>
    initialDraft && !initialExpense
      ? initialDraft
      : ExpenseDraft.open(
          {
            groupId,
            accountId: userId,
            memberIds: members.map((member) => member.user._id),
            currency: startCurrency,
            currencies,
            defaultTag: getDefaultExpenseTag(groupTags),
            date: defaultDate ?? toDateParam(new Date()),
          },
          initialExpense as unknown as SavedDraftExpense | null,
        ),
  );
  const { description, amount, currency, tag } = draft.values;
  // The field says why it can't take the amount; Save waits for one it can (#528).
  const amountUnreadable = readAmountEntry(amount, currency).status === 'invalid';
  const { error, conflict, loading, invalidStoredMoney } = draft;
  const expense = draft.base;
  const isEditMode = !!expense;
  const finishEnabled = process.env.NEXT_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true' && !isEditMode;
  const [initialValues] = useState(() =>
    JSON.stringify(
      ExpenseDraft.open({
        groupId,
        accountId: userId,
        memberIds: members.map((member) => member.user._id),
        currency: startCurrency,
        currencies,
        defaultTag: getDefaultExpenseTag(groupTags),
        date: defaultDate ?? toDateParam(new Date()),
      }).values,
    ),
  );
  const [closing, setClosing] = useState(false);
  const keep = useKeepExpenseDraft({
    draft,
    groupId,
    accountId: userId,
    enabled: finishEnabled,
    onKept: () => {
      onKept?.();
      onClose();
    },
  });
  const requestClose = () => {
    if (finishEnabled && (keep.busy || loading)) return;
    if (finishEnabled && JSON.stringify(draft.values) !== initialValues) setClosing(true);
    else onClose();
  };

  const edit = (change: Partial<ExpenseDraftValues>) => setDraft((current) => current.edit(change));
  const { save, transportBusy, mounted } = useExpenseDraftSave(setDraft);

  const handleSubmit = async () => {
    if (sessionStorage.getItem(`splitbook.draft-request:${userId}:${groupId}`)) {
      window.alert(
        finishEnabled
          ? 'Check To review to confirm whether your earlier item was kept before saving this expense. Everything you typed is still here.'
          : 'Resolve the unconfirmed request in this Group’s Drafts before saving this Expense.',
      );
      return;
    }
    const outcome = await save(
      draft,
      groupTags.flatMap((option) => (option._id ? [option._id] : [])),
    );
    if (outcome.status !== 'saved') return;
    onSaved?.();
    onClose();
  };

  const currencyChoices = expenseCurrencyChoices(group, group.latestExpenseCurrency, currency);
  const currencyHint =
    !isEditMode &&
    !initialDraft &&
    currencies.length > 1 &&
    currency === startCurrency &&
    startCurrency === group.latestExpenseCurrency
      ? `Started in ${currency}, the currency of your latest Expense here.`
      : null;
  const preview = draft.preview();
  const previewAmount = (id: string): string => {
    const row = preview.money?.splitBetween.find((row) => row.user === id);
    return row ? formatCurrency(row.amount, currency) : '—';
  };
  const reloadLatest = async () => {
    if (!expense || transportBusy.current) return;
    transportBusy.current = true;
    try {
      const response = await apiFetch(`/api/groups/${groupId}/expenses/${expense._id}`);
      if (!response.ok) throw new Error('Could not reload this Expense.');
      const latest = (await response.json()).data;
      if (mounted.current) setDraft((current) => current.reload(latest));
    } catch (error) {
      if (mounted.current)
        setDraft((current) =>
          current.reloadFailed(error instanceof Error ? error.message : 'Could not reload'),
        );
    } finally {
      transportBusy.current = false;
    }
  };

  // ─── Render ────────────────────────────────────────
  const form = (
    <Dialog
      open={open}
      onClose={requestClose}
      maxWidth="sm"
      fullWidth
      fullScreen={false}
      slotProps={{
        paper: {
          sx: {
            m: { xs: 1, sm: 2 },
            maxHeight: {
              xs: 'calc(100% - 16px - env(safe-area-inset-bottom, 0px))',
              sm: 'calc(100% - 64px)',
            },
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pb: 1,
        }}
      >
        {showGroupName ? (
          <Box component="span" sx={{ minWidth: 0 }}>
            {isEditMode ? 'Edit expense' : 'Add expense'}
            <Typography
              component="span"
              variant="body2"
              color="text.secondary"
              noWrap
              sx={{ display: 'block' }}
            >
              {group.name}
            </Typography>
          </Box>
        ) : isEditMode ? (
          'Edit expense'
        ) : (
          'Add expense'
        )}
        <IconButton onClick={requestClose} size="small" aria-label="Close expense form">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers inert={keep.busy}>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && (
            <Box
              role="alert"
              sx={{
                bgcolor: 'tint.negative',
                color: 'status.negative',
                px: 2,
                py: 1.5,
                borderRadius: 2,
                fontSize: 14,
              }}
            >
              {error}
              {conflict && <Button onClick={() => void reloadLatest()}>Reload latest</Button>}
            </Box>
          )}

          {/* The amount field says itself why it can't take the amount (#528), once (#719). */}
          {amount && !amountUnreadable && preview.error && preview.error !== error && (
            <Box role="status" sx={{ color: 'status.negative' }}>
              {preview.error}
            </Box>
          )}

          <ExpenseFields
            values={draft.values}
            edit={edit}
            chooseSplitMethod={(method) => setDraft((current) => current.chooseSplitMethod(method))}
            members={members}
            groupTags={groupTags}
            userId={userId}
            groupCategory={group.category}
            isEditMode={isEditMode}
            currentTag={expense?.tag as string | undefined}
            currentTagId={expense?.tagId as string | undefined}
            previewAmount={previewAmount}
            currencyChoices={currencyChoices}
            currencyHint={currencyHint}
          />
        </Stack>
      </DialogContent>

      {finishEnabled && (
        <Box sx={{ px: 3, py: 1 }}>
          <KeepExpenseDraft state={keep} />
        </Box>
      )}
      <DialogActions
        sx={{
          p: 2,
          pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 2 },
          position: { xs: 'sticky', sm: 'static' },
          bottom: 0,
          bgcolor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
          gap: 1,
        }}
      >
        <Button onClick={requestClose} color="inherit" sx={{ minHeight: 40 }}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={
            keep.busy ||
            keep.pending ||
            loading ||
            invalidStoredMoney ||
            !description.trim() ||
            !amount ||
            amountUnreadable ||
            !tag
          }
          sx={{
            minHeight: 40,
            textTransform: 'none',
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            '&:hover': { bgcolor: 'primary.dark' },
          }}
        >
          {loading ? <CircularProgress size={20} /> : isEditMode ? 'Save changes' : 'Save expense'}
        </Button>
      </DialogActions>
    </Dialog>
  );
  return (
    <>
      {form}
      <Dialog
        open={closing}
        onClose={() => {
          if (!keep.busy) setClosing(false);
        }}
        maxWidth="xs"
        fullWidth
        aria-labelledby="finish-later-title"
      >
        <DialogTitle id="finish-later-title">Finish this expense later?</DialogTitle>
        <DialogContent>
          <KeepExpenseDraft state={keep} />
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button
            color="inherit"
            sx={{ color: 'status.negative' }}
            disabled={keep.busy || loading}
            onClick={onClose}
          >
            Delete
          </Button>
          <Button disabled={keep.busy} onClick={() => setClosing(false)}>
            Keep editing
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
