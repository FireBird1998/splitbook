'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useSWRConfig } from 'swr';
import { PREDEFINED_ITEMS } from '@splitbook/shared/predefined-items';
import { getCurrency, formatCurrency, getCurrencyPrecision } from '@splitbook/shared/currency';
import { parseDecimalUnits, sumMinorAmounts } from '@splitbook/shared/exact-money';
import type { ExpenseSplitMethod } from '@splitbook/shared/split-calculation';
import {
  ExpenseDraft,
  type SavedDraftExpense,
  type ExpenseDraftValues,
} from '@splitbook/shared/expense-draft';
import { buildDuplicateCheckUrl } from './expense-duplicate-check';
import {
  getDefaultExpenseTag,
  tagOptionValue,
  getSelectableExpenseTags,
  isAdvancedSplit,
  resolveExpenseCategory,
  resolvePredefinedTag,
  type GroupTagOption,
} from './expense-form-helpers';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupCategory } from '@splitbook/shared/types';

// ─── Types ─────────────────────────────────────────────
interface Member {
  user: { _id: string; name: string; image?: string };
  role: string;
}

interface ExpenseFormDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  group: Record<string, unknown>;
  userId: string;
  expense?: Record<string, unknown> | null; // If provided → edit mode
  /**
   * Default date for a NEW expense (`yyyy-MM-dd`), e.g. the last day of a
   * past month when the form opens from a Household month view. Ignored in
   * edit mode; the user can still override it.
   */
  defaultDate?: string | null;
}

// ─── Component ─────────────────────────────────────────
export default function ExpenseFormDialog(props: ExpenseFormDialogProps) {
  // The existing dialog lifetime is also the lifetime of its account/Group/Expense draft.
  return props.open ? (
    <ExpenseDraftDialog
      key={JSON.stringify([props.groupId, props.userId, props.expense?._id ?? null])}
      {...props}
    />
  ) : null;
}

function ExpenseDraftDialog({
  open,
  onClose,
  groupId,
  group,
  userId,
  expense: initialExpense = null,
  defaultDate = null,
}: ExpenseFormDialogProps) {
  const { mutate } = useSWRConfig();
  const members = useMemo(() => (group.members || []) as Member[], [group.members]);
  const groupTags = useMemo(() => (group.tags || []) as GroupTagOption[], [group.tags]);
  const defaultCurrency = group.defaultCurrency as string;
  const groupNoun = getGroupTheme(group.category as GroupCategory).nouns.singular;
  const groupNounTitle = groupNoun.charAt(0).toUpperCase() + groupNoun.slice(1);

  const [draft, setDraft] = useState(() =>
    ExpenseDraft.open(
      {
        groupId,
        accountId: userId,
        memberIds: members.map((member) => member.user._id),
        currency: defaultCurrency,
        defaultTag: getDefaultExpenseTag(groupTags),
        date: defaultDate ?? new Date().toISOString().split('T')[0],
      },
      initialExpense as unknown as SavedDraftExpense | null,
    ),
  );
  const {
    description,
    amount,
    currency,
    date,
    splitMethod,
    selectedMembers,
    tag,
    notes,
    payers,
    multiPayerMode,
    customAmounts,
    customPercentages,
    customShares,
  } = draft.values;
  const { error, conflict, loading, invalidStoredMoney } = draft;
  const expense = draft.base;
  const isEditMode = !!expense;
  const edit = (change: Partial<ExpenseDraftValues>) => setDraft((current) => current.edit(change));
  const [showSplitOptions, setShowSplitOptions] = useState(isEditMode);
  const [showMoreOptions, setShowMoreOptions] = useState(isEditMode);
  const transportBusy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ─── Derived Values ────────────────────────────────
  const parsedAmount = parseFloat(amount) || 0;

  // Equal split calculated amount per person

  // Unequal totals
  const unequalTotal = selectedMembers.reduce(
    (sum, id) => sum + (parseFloat(customAmounts[id]) || 0),
    0,
  );

  // Percentage total
  const percentageTotal = selectedMembers.reduce(
    (sum, id) => sum + (parseFloat(customPercentages[id]) || 0),
    0,
  );

  const exactSum = (values: string[], precision: number) => {
    try {
      return sumMinorAmounts(values.map((value) => parseDecimalUnits(value || '0', precision)));
    } catch {
      return Number.NaN;
    }
  };
  const amountMinor = exactSum([amount], getCurrencyPrecision(currency));
  const unequalMinor = exactSum(
    selectedMembers.map((id) => customAmounts[id]),
    getCurrencyPrecision(currency),
  );
  const percentageUnits = exactSum(
    selectedMembers.map((id) => customPercentages[id]),
    2,
  );
  const payerMinor = multiPayerMode
    ? exactSum(
        payers.map((payer) => payer.amount),
        getCurrencyPrecision(currency),
      )
    : amountMinor;
  const splitsBalanced = amountMinor > 0 && unequalMinor === amountMinor;
  const percentagesBalanced = percentageUnits === 10000;
  const payersBalanced = amountMinor > 0 && payerMinor === amountMinor;

  // Shares total
  const sharesTotal = selectedMembers.reduce(
    (sum, id) => sum + (parseInt(customShares[id]) || 0),
    0,
  );
  const perShareAmount = sharesTotal > 0 ? parsedAmount / sharesTotal : 0;

  // Payer total
  const payerTotal = multiPayerMode
    ? payers.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0)
    : parsedAmount;

  // ─── Summary Line ──────────────────────────────────
  const payerName = memberName(payers[0]?.user || userId);
  const payerSummary = multiPayerMode ? `${payers.length} people paid` : `${payerName} paid`;

  const splitMethodLabel: Record<string, string> = {
    equal: 'Split equally',
    unequal: 'Split by amounts',
    percentage: 'Split by %',
    shares: 'Split by shares',
    exact: 'Split exact',
  };

  const memberSummary =
    selectedMembers.length === members.length
      ? `All ${members.length} members`
      : `${selectedMembers.length} of ${members.length} members`;

  // ─── Handlers ──────────────────────────────────────
  const handlePredefinedItem = (itemId: string) => {
    const item = PREDEFINED_ITEMS.find((i) => i.id === itemId);
    if (item) {
      const matchingTag = resolvePredefinedTag(groupTags, item.defaultTag);
      edit({
        description: item.label,
        category: resolveExpenseCategory(itemId),
        ...(matchingTag ? { tag: matchingTag } : {}),
      });
    }
  };

  const handleMemberToggle = (memberId: string, checked: boolean) => {
    setDraft((current) =>
      current.edit({
        selectedMembers: checked
          ? [...current.values.selectedMembers, memberId]
          : current.values.selectedMembers.filter((id) => id !== memberId),
      }),
    );
  };

  const handleSplitMethodChange = (_: unknown, val: string | null) => {
    if (val) setDraft((current) => current.chooseSplitMethod(val as ExpenseSplitMethod));
  };

  const addPayer = () => {
    const usedUsers = payers.map((p) => p.user);
    const available = members.find((m) => !usedUsers.includes(m.user._id));
    if (available) {
      edit({ payers: [...payers, { user: available.user._id, amount: '' }] });
    }
  };

  const removePayer = (index: number) => {
    if (payers.length <= 1) return;
    edit({ payers: payers.filter((_, i) => i !== index) });
  };

  const updatePayer = (index: number, field: 'user' | 'amount', value: string) => {
    edit({ payers: payers.map((p, i) => (i === index ? { ...p, [field]: value } : p)) });
  };

  const handleSubmit = async () => {
    if (transportBusy.current) return;
    const { draft: prepared, submission } = draft.prepare(
      groupTags.flatMap((option) => (option._id ? [option._id] : [])),
      crypto.randomUUID(),
    );
    setDraft(prepared);
    if (!submission) return;
    transportBusy.current = true;
    try {
      if (submission.checkDuplicate) {
        try {
          const response = await fetch(
            buildDuplicateCheckUrl({
              groupId: submission.groupId,
              description: submission.description,
              amount: submission.amount,
              date: submission.date,
              excludeId: submission.expenseId,
            }),
          );
          if (!mounted.current) return;
          if (response.ok) {
            const duplicate = await response.json();
            if (!mounted.current) return;
            if (
              duplicate.data?.isDuplicate &&
              !window.confirm(
                'This looks like a duplicate expense with the same description, amount, and date. Save it anyway?',
              )
            ) {
              setDraft((current) => current.cancel(submission));
              return;
            }
          }
        } catch (error) {
          console.warn('Duplicate expense check failed', error);
        }
      }
      if (!mounted.current) return;
      setDraft((current) => current.attempt(submission));
      const url = `/api/groups/${submission.groupId}/expenses${submission.expenseId ? `/${submission.expenseId}` : ''}`;
      const response = await fetch(url, {
        method: submission.expenseId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(submission.expenseId
            ? { 'If-Match': String(submission.revision) }
            : { 'Idempotency-Key': submission.key }),
        },
        body: submission.body,
      });
      if (!mounted.current) return;
      if (!response.ok) {
        const result = await response.json();
        if (mounted.current)
          setDraft((current) =>
            current.fail(
              submission,
              result.error || `Failed to ${submission.expenseId ? 'update' : 'add'} expense`,
              response.status,
            ),
          );
        return;
      }
      setDraft((current) => current.complete(submission));
      void mutate(
        (key: unknown) =>
          typeof key === 'string' && key.startsWith(`/api/groups/${submission.groupId}`),
      );
      onClose();
    } catch (error) {
      if (mounted.current)
        setDraft((current) =>
          current.fail(
            submission,
            error instanceof Error ? error.message : 'Something went wrong. Please try again.',
          ),
        );
    } finally {
      transportBusy.current = false;
    }
  };

  const preview = draft.preview();
  const previewAmount = (id: string): string => {
    const row = preview.money?.splitBetween.find((row) => row.user === id);
    return row ? formatCurrency(row.amount, currency) : '—';
  };
  const reloadLatest = async () => {
    if (!expense || transportBusy.current) return;
    transportBusy.current = true;
    try {
      const response = await fetch(`/api/groups/${groupId}/expenses/${expense._id}`);
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

  // ─── Helpers ──────────────────────────────────────
  function memberName(id: string) {
    return id === userId ? 'You' : members.find((m) => m.user._id === id)?.user.name || 'Unknown';
  }

  const hasNonDefaultSplit = isAdvancedSplit({
    splitMethod,
    selectedMemberCount: selectedMembers.length,
    memberCount: members.length,
    multiPayerMode,
    primaryPayerId: payers[0]?.user || userId,
    currentUserId: userId,
  });

  const hasNonDefaultMore = notes.trim().length > 0;

  const selectableTags = getSelectableExpenseTags(
    groupTags,
    isEditMode ? (expense?.tag as string | undefined) : null,
    isEditMode ? (expense?.tagId as string | undefined) : null,
  );

  // ─── Render ────────────────────────────────────────
  return (
    <Dialog
      open={open}
      onClose={onClose}
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
        {isEditMode ? 'Edit expense' : 'Add expense'}
        <IconButton onClick={onClose} size="small" aria-label="Close expense form">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
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

          {amount && preview.error && preview.error !== error && (
            <Box role="status" sx={{ color: 'status.negative' }}>
              {preview.error}
            </Box>
          )}

          {/* ─── Quick Pick ─────────────────────────── */}
          {!isEditMode && (
            <Box
              sx={{
                display: 'flex',
                gap: 1,
                overflowX: 'auto',
                pb: 0.5,
                '&::-webkit-scrollbar': {
                  height: 4,
                },
                '&::-webkit-scrollbar-track': {
                  bgcolor: 'transparent',
                },
                '&::-webkit-scrollbar-thumb': {
                  bgcolor: 'border.strong',
                  borderRadius: 2,
                },
                '&::-webkit-scrollbar-thumb:hover': {
                  bgcolor: 'text.disabled',
                },
                scrollbarWidth: 'thin',
                scrollbarColor: (theme) => `${theme.palette.border.strong} transparent`,
              }}
            >
              {PREDEFINED_ITEMS.slice(0, 8).map((item) => (
                <Chip
                  key={item.id}
                  label={`${item.icon} ${item.label}`}
                  variant="outlined"
                  size="small"
                  onClick={() => handlePredefinedItem(item.id)}
                  sx={{ flexShrink: 0, fontSize: 12 }}
                />
              ))}
            </Box>
          )}

          {/* ─── Description ────────────────────────── */}
          <TextField
            label="What was it for?"
            value={description}
            onChange={(e) => edit({ description: e.target.value })}
            required
            fullWidth
            size="small"
            autoFocus={!isEditMode}
          />

          {/* ─── Amount + Currency + Date (fast path) ─ */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Amount"
              value={amount}
              onChange={(e) => edit({ amount: e.target.value })}
              required
              type="number"
              size="small"
              sx={{
                flex: 1,
                '& input': (theme) => ({
                  ...(theme.typography.money as React.CSSProperties),
                  fontSize: '1.25rem',
                  fontWeight: 600,
                }),
              }}
              slotProps={{
                htmlInput: {
                  min: 10 ** -getCurrencyPrecision(currency),
                  step: 10 ** -getCurrencyPrecision(currency),
                },
              }}
            />
            <TextField
              select
              label="Currency"
              value={currency}
              size="small"
              disabled
              helperText={isEditMode ? 'Expense currency' : `${groupNounTitle} currency`}
              sx={{ width: { xs: '100%', sm: 120 } }}
            >
              <MenuItem value={currency}>
                {getCurrency(currency)?.flag} {currency}
              </MenuItem>
            </TextField>
            <TextField
              label="Date"
              type="date"
              value={date}
              onChange={(e) => edit({ date: e.target.value })}
              size="small"
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          {/* ─── Tag chips (fast path) ─────────────── */}
          <Box>
            <Typography
              component="label"
              variant="caption"
              fontWeight={500}
              color="text.secondary"
              sx={{ display: 'block', mb: 1 }}
            >
              Tag
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {selectableTags.map((t) => (
                <Chip
                  key={t._id || t.name}
                  label={t.isArchived ? `${t.name} (archived)` : t.name}
                  size="small"
                  clickable
                  color={tag === tagOptionValue(t) ? 'primary' : 'default'}
                  variant={tag === tagOptionValue(t) ? 'filled' : 'outlined'}
                  onClick={() => edit({ tag: tagOptionValue(t) })}
                  aria-pressed={tag === tagOptionValue(t)}
                />
              ))}
            </Stack>
            {selectableTags.length === 0 && (
              <Typography variant="caption" color="error.main">
                No tags available — create tags in {groupNoun} settings
              </Typography>
            )}
          </Box>

          {/* ─── Summary Line + Change Button ────────── */}
          <Box
            sx={{
              bgcolor: 'surface.muted',
              borderRadius: 2,
              px: 2,
              py: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Box component="p" sx={{ fontSize: 14, color: 'text.secondary', m: 0 }}>
              <Box component="span" sx={{ fontWeight: 600 }}>
                {payerSummary}
              </Box>
              {' · '}
              <span>{splitMethodLabel[splitMethod] || 'Split'}</span>
              {' · '}
              <span>{memberSummary}</span>
            </Box>
            <Button
              size="small"
              onClick={() => setShowSplitOptions(!showSplitOptions)}
              endIcon={showSplitOptions ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              aria-expanded={showSplitOptions}
              aria-label="Advanced split options"
              sx={{
                textTransform: 'none',
                fontSize: 12,
                color: hasNonDefaultSplit ? 'primary.main' : 'text.secondary',
                fontWeight: hasNonDefaultSplit ? 600 : 400,
                minWidth: 'auto',
                ml: 1,
              }}
            >
              {showSplitOptions ? 'Less' : 'Change'}
            </Button>
          </Box>

          {/* ─── TIER 2: Split Options ─────────────── */}
          <Collapse in={showSplitOptions}>
            <Stack
              spacing={2.5}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: '12px',
                p: 2.5,
                bgcolor: 'background.paper',
              }}
            >
              {/* Paid By */}
              <Box>
                <Box
                  component="label"
                  sx={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'text.secondary',
                    mb: 1,
                  }}
                >
                  Paid by
                </Box>
                {!multiPayerMode ? (
                  <Stack spacing={1}>
                    <TextField
                      select
                      value={payers[0]?.user || userId}
                      onChange={(e) => updatePayer(0, 'user', e.target.value)}
                      size="small"
                      fullWidth
                    >
                      {members.map((m) => (
                        <MenuItem key={m.user._id} value={m.user._id}>
                          {memberName(m.user._id)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Button
                      size="small"
                      onClick={() => edit({ multiPayerMode: true })}
                      sx={{
                        textTransform: 'none',
                        fontSize: 12,
                        color: 'primary.main',
                      }}
                      startIcon={<AddIcon sx={{ fontSize: 14 }} />}
                    >
                      Split payment between multiple people
                    </Button>
                  </Stack>
                ) : (
                  <Stack spacing={1.5}>
                    {payers.map((payer, i) => (
                      <Stack key={i} direction="row" spacing={1} alignItems="center">
                        <TextField
                          select
                          value={payer.user}
                          onChange={(e) => updatePayer(i, 'user', e.target.value)}
                          size="small"
                          sx={{ flex: 1 }}
                        >
                          {members.map((m) => (
                            <MenuItem key={m.user._id} value={m.user._id}>
                              {memberName(m.user._id)}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          value={payer.amount}
                          onChange={(e) => updatePayer(i, 'amount', e.target.value)}
                          type="number"
                          size="small"
                          placeholder="Amount"
                          sx={{ width: 120 }}
                          slotProps={{
                            htmlInput: {
                              min: 10 ** -getCurrencyPrecision(currency),
                              step: 10 ** -getCurrencyPrecision(currency),
                            },
                          }}
                        />
                        <IconButton
                          size="small"
                          onClick={() => removePayer(i)}
                          disabled={payers.length <= 1}
                          aria-label={`Remove payer ${memberName(payer.user)}`}
                        >
                          <RemoveCircleOutlineIcon
                            fontSize="small"
                            sx={{
                              color: payers.length <= 1 ? 'text.disabled' : 'error.main',
                            }}
                          />
                        </IconButton>
                      </Stack>
                    ))}
                    {parsedAmount > 0 && (
                      <Box
                        sx={{
                          fontSize: 12,
                          color: !payersBalanced ? 'status.negative' : 'status.positive',
                        }}
                      >
                        Total: {formatCurrency(payerTotal, currency)} /{' '}
                        {formatCurrency(parsedAmount, currency)}
                        {payersBalanced && ' ✓'}
                      </Box>
                    )}
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        onClick={addPayer}
                        disabled={payers.length >= members.length}
                        sx={{
                          textTransform: 'none',
                          fontSize: 12,
                          color: 'primary.main',
                        }}
                        startIcon={<AddIcon sx={{ fontSize: 14 }} />}
                      >
                        Add payer
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          edit({
                            multiPayerMode: false,
                            payers: [{ user: payers[0].user, amount: '' }],
                          });
                        }}
                        sx={{ textTransform: 'none', fontSize: 12 }}
                        color="inherit"
                      >
                        Single payer
                      </Button>
                    </Stack>
                  </Stack>
                )}
              </Box>

              {/* Split Method */}
              <Box>
                <Box
                  component="label"
                  sx={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'text.secondary',
                    mb: 1,
                  }}
                >
                  Split method
                </Box>
                <ToggleButtonGroup
                  value={splitMethod}
                  exclusive
                  onChange={handleSplitMethodChange}
                  size="small"
                  fullWidth
                >
                  <ToggleButton value="equal" sx={{ textTransform: 'none', fontSize: 12 }}>
                    Equal
                  </ToggleButton>
                  <ToggleButton value="unequal" sx={{ textTransform: 'none', fontSize: 12 }}>
                    Unequal
                  </ToggleButton>
                  <ToggleButton value="percentage" sx={{ textTransform: 'none', fontSize: 12 }}>
                    %
                  </ToggleButton>
                  <ToggleButton value="shares" sx={{ textTransform: 'none', fontSize: 12 }}>
                    Shares
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>

              {/* Split Between */}
              <Box>
                <Box
                  component="label"
                  sx={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 500,
                    color: 'text.secondary',
                    mb: 1,
                  }}
                >
                  Split between
                </Box>
                <Stack spacing={1}>
                  {members.map((m) => {
                    const id = m.user._id;
                    const isSelected = selectedMembers.includes(id);

                    return (
                      <Stack key={id} direction="row" alignItems="center" spacing={1}>
                        <Checkbox
                          checked={isSelected}
                          onChange={(e) => handleMemberToggle(id, e.target.checked)}
                          size="small"
                        />
                        <Box
                          sx={{
                            fontSize: 14,
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {memberName(id)}
                        </Box>

                        {splitMethod === 'equal' && isSelected && parsedAmount > 0 && (
                          <Box
                            sx={{
                              fontSize: 12,
                              color: 'text.disabled',
                              flexShrink: 0,
                            }}
                          >
                            {previewAmount(id)}
                          </Box>
                        )}

                        {(splitMethod === 'unequal' || splitMethod === 'exact') && isSelected && (
                          <TextField
                            value={customAmounts[id] || ''}
                            onChange={(e) =>
                              edit({
                                customAmounts: {
                                  ...customAmounts,
                                  [id]: e.target.value,
                                },
                              })
                            }
                            type="number"
                            size="small"
                            placeholder="0.00"
                            sx={{ width: 110 }}
                            slotProps={{
                              htmlInput: { min: 0, step: 10 ** -getCurrencyPrecision(currency) },
                            }}
                          />
                        )}

                        {splitMethod === 'percentage' && isSelected && (
                          <Stack
                            direction="row"
                            alignItems="center"
                            spacing={0.5}
                            sx={{ flexShrink: 0 }}
                          >
                            <TextField
                              value={customPercentages[id] || ''}
                              onChange={(e) =>
                                edit({
                                  customPercentages: {
                                    ...customPercentages,
                                    [id]: e.target.value,
                                  },
                                })
                              }
                              type="number"
                              size="small"
                              placeholder="0"
                              sx={{ width: 70 }}
                              slotProps={{
                                htmlInput: { min: 0, max: 100, step: 0.1 },
                              }}
                            />
                            <Box sx={{ fontSize: 12, color: 'text.disabled' }}>%</Box>
                            {parsedAmount > 0 && (customPercentages[id] || 0) && (
                              <Box sx={{ fontSize: 12, color: 'text.disabled' }}>
                                = {previewAmount(id)}
                              </Box>
                            )}
                          </Stack>
                        )}

                        {splitMethod === 'shares' && isSelected && (
                          <Stack
                            direction="row"
                            alignItems="center"
                            spacing={0.5}
                            sx={{ flexShrink: 0 }}
                          >
                            <TextField
                              value={customShares[id] || ''}
                              onChange={(e) =>
                                edit({
                                  customShares: {
                                    ...customShares,
                                    [id]: e.target.value,
                                  },
                                })
                              }
                              type="number"
                              size="small"
                              placeholder="1"
                              sx={{ width: 70 }}
                              slotProps={{ htmlInput: { min: 1, step: 1 } }}
                            />
                            <Box sx={{ fontSize: 12, color: 'text.disabled' }}>shares</Box>
                            {parsedAmount > 0 && sharesTotal > 0 && (
                              <Box sx={{ fontSize: 12, color: 'text.disabled' }}>
                                = {previewAmount(id)}
                              </Box>
                            )}
                          </Stack>
                        )}
                      </Stack>
                    );
                  })}
                </Stack>

                {/* Split totals / validation feedback */}
                {parsedAmount > 0 && (
                  <Box sx={{ mt: 1 }}>
                    {(splitMethod === 'unequal' || splitMethod === 'exact') && (
                      <Box
                        sx={{
                          fontSize: 12,
                          color: !splitsBalanced ? 'status.negative' : 'status.positive',
                        }}
                      >
                        Total: {formatCurrency(unequalTotal, currency)} /{' '}
                        {formatCurrency(parsedAmount, currency)}
                        {splitsBalanced && ' ✓'}
                      </Box>
                    )}
                    {splitMethod === 'percentage' && (
                      <Box
                        sx={{
                          fontSize: 12,
                          color: !percentagesBalanced ? 'status.negative' : 'status.positive',
                        }}
                      >
                        Total: {percentageTotal.toFixed(2)}% / 100%
                        {percentagesBalanced && ' ✓'}
                      </Box>
                    )}
                    {splitMethod === 'shares' && sharesTotal > 0 && (
                      <Box sx={{ fontSize: 12, color: 'text.secondary' }}>
                        {sharesTotal} share{sharesTotal !== 1 ? 's' : ''} ·{' '}
                        {formatCurrency(perShareAmount, currency)}/share
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            </Stack>
          </Collapse>

          {/* ─── More Options Toggle ───────────────── */}
          <Button
            size="small"
            onClick={() => setShowMoreOptions(!showMoreOptions)}
            endIcon={showMoreOptions ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            aria-expanded={showMoreOptions}
            sx={{
              textTransform: 'none',
              fontSize: 12,
              color: hasNonDefaultMore ? 'primary.main' : 'text.secondary',
              fontWeight: hasNonDefaultMore ? 600 : 400,
              px: 0,
            }}
          >
            {showMoreOptions ? 'Hide options' : 'More options'}
            {hasNonDefaultMore && !showMoreOptions && ' (modified)'}
          </Button>

          {/* ─── TIER 2: More Options ──────────────── */}
          <Collapse in={showMoreOptions}>
            <Stack
              spacing={2}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: '12px',
                p: 2.5,
                bgcolor: 'background.paper',
              }}
            >
              <TextField
                label="Notes (optional)"
                value={notes}
                onChange={(e) => edit({ notes: e.target.value })}
                fullWidth
                size="small"
                multiline
                rows={2}
              />
            </Stack>
          </Collapse>
        </Stack>
      </DialogContent>

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
        <Button onClick={onClose} color="inherit" sx={{ minHeight: 40 }}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading || invalidStoredMoney || !description.trim() || !amount || !tag}
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
}
