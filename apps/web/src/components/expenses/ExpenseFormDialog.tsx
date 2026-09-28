'use client';

import { useState, useEffect, useEffectEvent, useCallback, useMemo, useRef } from 'react';
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
import {
  normalizeExpenseMoney,
  parseAmountMinor,
  parseDecimalUnits,
  sumMinorAmounts,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import {
  calculateSplitAmounts,
  type SplitParticipantInput,
  type ExpenseSplitMethod,
} from '@splitbook/shared/split-calculation';
import { toDateParam } from '@splitbook/shared/date';
import { buildDuplicateCheckUrl } from './expense-duplicate-check';
import {
  getDefaultExpenseTag,
  getStoredExpenseMoneyFields,
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

interface Payer {
  user: string;
  amount: string;
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
export default function ExpenseFormDialog({
  open,
  onClose,
  groupId,
  group,
  userId,
  expense: initialExpense = null,
  defaultDate = null,
}: ExpenseFormDialogProps) {
  const { mutate } = useSWRConfig();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [invalidStoredMoney, setInvalidStoredMoney] = useState(false);
  const [reloadedExpense, setReloadedExpense] = useState<Record<string, unknown> | null>(null);
  const expense =
    reloadedExpense?._id === initialExpense?._id
      ? (reloadedExpense ?? initialExpense)
      : initialExpense;
  const submission = useRef<{ payload: string; key: string; attempted: boolean } | null>(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    setReloadedExpense(null);
    submission.current = null;
    setConflict(false);
  }, [open, initialExpense?._id]);

  const isEditMode = !!expense;

  const members = useMemo(() => (group.members || []) as Member[], [group.members]);
  const groupTags = useMemo(() => (group.tags || []) as GroupTagOption[], [group.tags]);
  const defaultCurrency = group.defaultCurrency as string;
  const groupNoun = getGroupTheme(group.category as GroupCategory).nouns.singular;
  const groupNounTitle = groupNoun.charAt(0).toUpperCase() + groupNoun.slice(1);

  // ─── Form State ────────────────────────────────────
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [category, setCategory] = useState('other');
  const [date, setDate] = useState(() => toDateParam(new Date()));
  const [splitMethod, setSplitMethod] = useState<string>('equal');
  const [selectedMembers, setSelectedMembers] = useState<string[]>(members.map((m) => m.user._id));
  const [tag, setTag] = useState('');
  const [notes, setNotes] = useState('');

  // Multiple payers
  const [payers, setPayers] = useState<Payer[]>([{ user: userId, amount: '' }]);
  const [multiPayerMode, setMultiPayerMode] = useState(false);

  // Split-method-specific per-member values
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [customPercentages, setCustomPercentages] = useState<Record<string, string>>({});
  const [customShares, setCustomShares] = useState<Record<string, string>>({});

  // ─── Two-Tier Expansion State ─────────────────────
  const [showSplitOptions, setShowSplitOptions] = useState(false);
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  // ─── Reset / Prefill ───────────────────────────────
  const resetForm = useCallback(() => {
    setDescription('');
    setAmount('');
    setCurrency(defaultCurrency);
    setCategory('other');
    // A month view passes the month's last day; otherwise default to today.
    setDate(defaultDate ?? toDateParam(new Date()));
    setSplitMethod('equal');
    setSelectedMembers(members.map((m) => m.user._id));
    setTag(getDefaultExpenseTag(groupTags));
    setNotes('');
    setPayers([{ user: userId, amount: '' }]);
    setMultiPayerMode(false);
    setCustomAmounts({});
    setCustomPercentages({});
    setCustomShares({});
    setShowSplitOptions(false);
    setShowMoreOptions(false);
    setError('');
    setInvalidStoredMoney(false);
  }, [defaultCurrency, defaultDate, groupTags, members, userId]);

  // Read current defaults on initialization without subscribing the draft to
  // background Group refreshes (Tag/member changes must not discard input).
  const initializeForm = useEffectEvent(() => {
    setError('');
    setInvalidStoredMoney(false);
    if (expense) {
      const expenseCurrency = (expense.currency as string) || defaultCurrency;
      const expPayers = (expense.paidBy || []) as Array<{
        user: { _id: string } | string;
        amount?: number;
        amountMinor?: number;
      }>;
      const expSplit = (expense.splitBetween || []) as Array<{
        user: { _id: string } | string;
        amount?: number;
        amountMinor?: number;
        percentage?: number;
        shares?: number;
      }>;
      let moneyFields: ReturnType<typeof getStoredExpenseMoneyFields>;
      try {
        moneyFields = getStoredExpenseMoneyFields({
          currency: expenseCurrency,
          amount: expense.amount as number | undefined,
          amountMinor: expense.amountMinor as number | undefined,
          moneyVersion: expense.moneyVersion as number | undefined,
          paidBy: expPayers,
          splitBetween: expSplit,
        });
      } catch {
        resetForm();
        setDescription((expense.description as string) || '');
        setInvalidStoredMoney(true);
        setError('This expense contains invalid stored amounts and cannot be edited.');
        return;
      }
      setDescription((expense.description as string) || '');
      setAmount(moneyFields.amount);
      setCurrency(expenseCurrency);
      setCategory((expense.category as string) || 'other');
      const expDate = expense.date
        ? new Date(expense.date as string).toISOString().split('T')[0]
        : (defaultDate ?? toDateParam(new Date()));
      setDate(expDate);
      setSplitMethod((expense.splitMethod as string) || 'equal');
      setTag((expense.tagId as string) || (expense.tag as string) || '');
      setNotes((expense.notes as string) || '');

      // Payers
      if (expPayers.length > 1) {
        setMultiPayerMode(true);
        setPayers(
          expPayers.map((p, index) => ({
            user: typeof p.user === 'string' ? p.user : p.user._id,
            amount: moneyFields.paidBy[index],
          })),
        );
      } else if (expPayers.length === 1) {
        const payerUser =
          typeof expPayers[0].user === 'string' ? expPayers[0].user : expPayers[0].user._id;
        setPayers([{ user: payerUser, amount: moneyFields.paidBy[0] }]);
        setMultiPayerMode(false);
      }

      // Split between
      setSelectedMembers(expSplit.map((s) => (typeof s.user === 'string' ? s.user : s.user._id)));

      const amounts: Record<string, string> = {};
      const percentages: Record<string, string> = {};
      const shares: Record<string, string> = {};
      for (const [index, s] of expSplit.entries()) {
        const uid = typeof s.user === 'string' ? s.user : s.user._id;
        amounts[uid] = moneyFields.splitBetween[index];
        if (s.percentage !== undefined) percentages[uid] = String(s.percentage);
        if (s.shares !== undefined) shares[uid] = String(s.shares);
      }
      setCustomAmounts(amounts);
      setCustomPercentages(percentages);
      setCustomShares(shares);

      // In edit mode, expand sections by default
      setShowSplitOptions(true);
      setShowMoreOptions(true);
    } else {
      resetForm();
    }
  });

  useEffect(() => {
    if (open) initializeForm();
  }, [open, initialExpense?._id, reloadedExpense]);

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
      setDescription(item.label);
      setCategory(resolveExpenseCategory(itemId));
      const matchingTag = resolvePredefinedTag(groupTags, item.defaultTag);
      if (matchingTag) setTag(matchingTag);
    }
  };

  const handleMemberToggle = (memberId: string, checked: boolean) => {
    if (checked) {
      setSelectedMembers((prev) => [...prev, memberId]);
    } else {
      setSelectedMembers((prev) => prev.filter((id) => id !== memberId));
    }
  };

  const handleSplitMethodChange = (_: unknown, val: string | null) => {
    if (!val) return;
    setSplitMethod(val);
    setCustomAmounts({});
    setCustomPercentages({});
    setCustomShares({});
  };

  const addPayer = () => {
    const usedUsers = payers.map((p) => p.user);
    const available = members.find((m) => !usedUsers.includes(m.user._id));
    if (available) {
      setPayers([...payers, { user: available.user._id, amount: '' }]);
    }
  };

  const removePayer = (index: number) => {
    if (payers.length <= 1) return;
    setPayers(payers.filter((_, i) => i !== index));
  };

  const updatePayer = (index: number, field: 'user' | 'amount', value: string) => {
    setPayers(payers.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };

  // ─── Validation ────────────────────────────────────
  const getSplitValidationError = (): string => {
    if (selectedMembers.length === 0) return 'Select at least one member';
    if (splitMethod === 'unequal' || splitMethod === 'exact') {
      if (parsedAmount > 0 && !splitsBalanced) {
        return `Amounts must add up to ${formatCurrency(parsedAmount, currency)} (currently ${formatCurrency(unequalTotal, currency)})`;
      }
    }
    if (splitMethod === 'percentage') {
      if (!percentagesBalanced) {
        return `Percentages must add up to 100% (currently ${percentageTotal.toFixed(2)}%)`;
      }
    }
    if (splitMethod === 'shares') {
      if (sharesTotal === 0) return 'Each member needs at least 1 share';
    }
    return '';
  };

  const getPayerValidationError = (): string => {
    if (multiPayerMode && parsedAmount > 0 && !payersBalanced) {
      return `Payer amounts must add up to ${formatCurrency(parsedAmount, currency)} (currently ${formatCurrency(payerTotal, currency)})`;
    }
    return '';
  };

  // ─── Build payload & submit ────────────────────────
  const buildSplitBetween = () => {
    switch (splitMethod) {
      case 'unequal':
      case 'exact':
        return selectedMembers.map((id) => ({
          user: id,
          amount: toMajorAmount(parseAmountMinor(customAmounts[id] || '0', currency), currency),
        }));
      case 'percentage':
        return selectedMembers.map((id) => ({
          user: id,
          percentage: Number(customPercentages[id] || '0'),
        }));
      case 'shares':
        return selectedMembers.map((id) => ({
          user: id,
          shares: Number(customShares[id] || '1'),
        }));
      case 'equal':
      default:
        return selectedMembers.map((id) => ({ user: id }));
    }
  };

  const handleSubmit = async () => {
    if (invalidStoredMoney) return;
    if (!description.trim() || !amount || parsedAmount <= 0) {
      setError('Please fill in description and a valid amount.');
      return;
    }

    if (!tag) {
      setError('Please select a tag.');
      return;
    }

    const splitError = getSplitValidationError();
    if (splitError) {
      setError(splitError);
      return;
    }

    const payerError = getPayerValidationError();
    if (payerError) {
      setError(payerError);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const money = normalizeExpenseMoney({
        amount,
        currency,
        paidBy: multiPayerMode ? payers : [{ user: payers[0].user, amount }],
        splitMethod: splitMethod as ExpenseSplitMethod,
        splitBetween: buildSplitBetween(),
      });
      const payload = {
        description,
        ...money,
        currency,
        category,
        date,
        splitMethod,
        ...(groupTags.some((option) => option._id === tag) || expense?.tagId === tag
          ? { tagId: tag }
          : { tag }),
        notes,
      };

      const body = JSON.stringify(payload);
      const retryingCreate =
        !isEditMode && submission.current?.payload === body && submission.current.attempted;
      if (submission.current?.payload !== body)
        submission.current = { payload: body, key: crypto.randomUUID(), attempted: false };
      if (!retryingCreate)
        try {
          const duplicateRes = await fetch(
            buildDuplicateCheckUrl({
              groupId,
              description: description.trim(),
              amount: parsedAmount,
              date,
              excludeId: isEditMode ? String(expense!._id) : undefined,
            }),
          );

          if (duplicateRes.ok) {
            const duplicateData = await duplicateRes.json();
            if (duplicateData.data?.isDuplicate) {
              const shouldContinue = window.confirm(
                'This looks like a duplicate expense with the same description, amount, and date. Save it anyway?',
              );
              if (!shouldContinue) return;
            }
          }
        } catch (duplicateErr) {
          console.warn('Duplicate expense check failed', duplicateErr);
        }

      const url = isEditMode
        ? `/api/groups/${groupId}/expenses/${expense!._id}`
        : `/api/groups/${groupId}/expenses`;

      submission.current.attempted = true;
      const res = await fetch(url, {
        method: isEditMode ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(isEditMode
            ? { 'If-Match': String(expense?.revision ?? 0) }
            : { 'Idempotency-Key': submission.current.key }),
        },
        body,
      });

      if (!res.ok) {
        const data = await res.json();
        setConflict(res.status === 409 || res.status === 428);
        setError(data.error || `Failed to ${isEditMode ? 'update' : 'add'} expense`);
        return;
      }

      mutate((key: unknown) => typeof key === 'string' && key.startsWith(`/api/groups/${groupId}`));
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const previewAmount = (id: string): string => {
    try {
      const split = calculateSplitAmounts<SplitParticipantInput>(
        splitMethod as ExpenseSplitMethod,
        toMajorAmount(parseAmountMinor(amount, currency), currency),
        buildSplitBetween(),
        currency,
      );
      return formatCurrency(split.find((row) => row.user === id)?.amount ?? 0, currency);
    } catch {
      return '—';
    }
  };
  const reloadLatest = async () => {
    if (!expense) return;
    try {
      const response = await fetch(`/api/groups/${groupId}/expenses/${expense._id}`);
      if (!response.ok) throw new Error('Could not reload this Expense.');
      setReloadedExpense((await response.json()).data);
      setConflict(false);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reload');
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
            onChange={(e) => setDescription(e.target.value)}
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
              onChange={(e) => setAmount(e.target.value)}
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
              onChange={(e) => setDate(e.target.value)}
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
                  onClick={() => setTag(tagOptionValue(t))}
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
                      onClick={() => setMultiPayerMode(true)}
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
                          setMultiPayerMode(false);
                          setPayers([{ user: payers[0].user, amount: '' }]);
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
                              setCustomAmounts({
                                ...customAmounts,
                                [id]: e.target.value,
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
                                setCustomPercentages({
                                  ...customPercentages,
                                  [id]: e.target.value,
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
                                setCustomShares({
                                  ...customShares,
                                  [id]: e.target.value,
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
                onChange={(e) => setNotes(e.target.value)}
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
