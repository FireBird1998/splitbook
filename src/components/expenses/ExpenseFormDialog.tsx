'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useSWRConfig } from 'swr';
import { EXPENSE_CATEGORIES } from '@/lib/constants/categories';
import { PREDEFINED_ITEMS } from '@/lib/constants/predefined-items';
import { getCurrency, formatCurrency } from '@/lib/utils/currency';

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
}

// ─── Component ─────────────────────────────────────────
export default function ExpenseFormDialog({
  open,
  onClose,
  groupId,
  group,
  userId,
  expense = null,
}: ExpenseFormDialogProps) {
  const { mutate } = useSWRConfig();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isEditMode = !!expense;

  const members = useMemo(() => (group.members || []) as Member[], [group.members]);
  const defaultCurrency = group.defaultCurrency as string;
  const defaultCurrencyDetails = getCurrency(defaultCurrency);

  // ─── Form State ────────────────────────────────────
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [category, setCategory] = useState('other');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
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
    setDate(new Date().toISOString().split('T')[0]);
    setSplitMethod('equal');
    setSelectedMembers(members.map((m) => m.user._id));
    setTag('');
    setNotes('');
    setPayers([{ user: userId, amount: '' }]);
    setMultiPayerMode(false);
    setCustomAmounts({});
    setCustomPercentages({});
    setCustomShares({});
    setShowSplitOptions(false);
    setShowMoreOptions(false);
    setError('');
  }, [defaultCurrency, members, userId]);

  // Pre-fill form when editing
  useEffect(() => {
    if (!open) return;

    if (expense) {
      setDescription((expense.description as string) || '');
      setAmount(String(expense.amount || ''));
      setCurrency(defaultCurrency);
      setCategory((expense.category as string) || 'other');
      const expDate = expense.date
        ? new Date(expense.date as string).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      setDate(expDate);
      setSplitMethod((expense.splitMethod as string) || 'equal');
      setTag((expense.tag as string) || '');
      setNotes((expense.notes as string) || '');

      // Payers
      const expPayers = (expense.paidBy || []) as Array<{
        user: { _id: string } | string;
        amount: number;
      }>;
      if (expPayers.length > 1) {
        setMultiPayerMode(true);
        setPayers(
          expPayers.map((p) => ({
            user: typeof p.user === 'string' ? p.user : p.user._id,
            amount: String(p.amount),
          })),
        );
      } else if (expPayers.length === 1) {
        const payerUser =
          typeof expPayers[0].user === 'string' ? expPayers[0].user : expPayers[0].user._id;
        setPayers([{ user: payerUser, amount: String(expPayers[0].amount) }]);
        setMultiPayerMode(false);
      }

      // Split between
      const expSplit = (expense.splitBetween || []) as Array<{
        user: { _id: string } | string;
        amount: number;
        percentage?: number;
        shares?: number;
      }>;
      setSelectedMembers(expSplit.map((s) => (typeof s.user === 'string' ? s.user : s.user._id)));

      const amounts: Record<string, string> = {};
      const percentages: Record<string, string> = {};
      const shares: Record<string, string> = {};
      for (const s of expSplit) {
        const uid = typeof s.user === 'string' ? s.user : s.user._id;
        amounts[uid] = String(s.amount || '');
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
  }, [expense, open, defaultCurrency, resetForm]);

  // ─── Derived Values ────────────────────────────────
  const parsedAmount = parseFloat(amount) || 0;

  // Equal split calculated amount per person
  const equalPerPerson = selectedMembers.length > 0 ? parsedAmount / selectedMembers.length : 0;

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
      setCategory(item.category);
      // Auto-select tag if the group has a matching one
      const groupTags = (
        (group.tags || []) as Array<{
          _id: string;
          name: string;
          isArchived: boolean;
        }>
      ).filter((t) => !t.isArchived);
      const matchingTag = groupTags.find(
        (t) => t.name.toLowerCase() === item.defaultTag.toLowerCase(),
      );
      if (matchingTag) setTag(matchingTag.name);
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
      if (parsedAmount > 0 && Math.abs(unequalTotal - parsedAmount) > 0.01) {
        return `Amounts must add up to ${formatCurrency(parsedAmount, currency)} (currently ${formatCurrency(unequalTotal, currency)})`;
      }
    }
    if (splitMethod === 'percentage') {
      if (Math.abs(percentageTotal - 100) > 0.01) {
        return `Percentages must add up to 100% (currently ${percentageTotal.toFixed(1)}%)`;
      }
    }
    if (splitMethod === 'shares') {
      if (sharesTotal === 0) return 'Each member needs at least 1 share';
    }
    return '';
  };

  const getPayerValidationError = (): string => {
    if (multiPayerMode && parsedAmount > 0 && Math.abs(payerTotal - parsedAmount) > 0.01) {
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
          amount: parseFloat(customAmounts[id]) || 0,
        }));
      case 'percentage':
        return selectedMembers.map((id) => ({
          user: id,
          percentage: parseFloat(customPercentages[id]) || 0,
        }));
      case 'shares':
        return selectedMembers.map((id) => ({
          user: id,
          shares: parseInt(customShares[id]) || 1,
        }));
      case 'equal':
      default:
        return selectedMembers.map((id) => ({ user: id }));
    }
  };

  const handleSubmit = async () => {
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

    const payload = {
      description,
      amount: parsedAmount,
      currency: defaultCurrency,
      category,
      date,
      paidBy: multiPayerMode
        ? payers.map((p) => ({
            user: p.user,
            amount: parseFloat(p.amount) || 0,
          }))
        : [{ user: payers[0].user, amount: parsedAmount }],
      splitMethod,
      splitBetween: buildSplitBetween(),
      tag,
      notes,
    };

    try {
      const url = isEditMode
        ? `/api/groups/${groupId}/expenses/${expense!._id}`
        : `/api/groups/${groupId}/expenses`;

      const res = await fetch(url, {
        method: isEditMode ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || `Failed to ${isEditMode ? 'update' : 'add'} expense`);
        return;
      }

      mutate((key: unknown) => typeof key === 'string' && key.startsWith(`/api/groups/${groupId}`));
      resetForm();
      onClose();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Helpers ──────────────────────────────────────
  function memberName(id: string) {
    return id === userId ? 'You' : members.find((m) => m.user._id === id)?.user.name || 'Unknown';
  }

  // Check if split options differ from defaults (to show indicator)
  const hasNonDefaultSplit =
    splitMethod !== 'equal' ||
    selectedMembers.length !== members.length ||
    multiPayerMode ||
    payers[0]?.user !== userId;

  // Check if more options differ from defaults
  const hasNonDefaultMore =
    category !== 'other' ||
    notes.trim().length > 0 ||
    date !== new Date().toISOString().split('T')[0];

  // ─── Render ────────────────────────────────────────
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pb: 1,
        }}
      >
        {isEditMode ? 'Edit Expense' : 'Add Expense'}
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && (
            <Box
              sx={{
                bgcolor: 'error.lighter',
                color: 'error.main',
                px: 2,
                py: 1.5,
                borderRadius: 2,
                fontSize: 14,
              }}
            >
              {error}
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
                  bgcolor: 'grey.300',
                  borderRadius: 2,
                },
                '&::-webkit-scrollbar-thumb:hover': {
                  bgcolor: 'grey.400',
                },
                scrollbarWidth: 'thin',
                scrollbarColor: (theme) => `${theme.palette.grey[300]} transparent`,
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

          {/* ─── Amount + Currency ──────────────────── */}
          <Stack direction="row" spacing={1.5}>
            <TextField
              label="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              type="number"
              size="small"
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
            />
            <TextField
              select
              label="Currency"
              value={currency}
              size="small"
              disabled
              helperText="Group default"
              sx={{ width: 120 }}
            >
              <MenuItem value={defaultCurrency}>
                {defaultCurrencyDetails?.flag} {defaultCurrency}
              </MenuItem>
            </TextField>
          </Stack>

          {/* ─── Summary Line + Change Button ────────── */}
          <Box
            sx={{
              bgcolor: 'grey.50',
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
                borderRadius: 3,
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
                          slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
                        />
                        <IconButton
                          size="small"
                          onClick={() => removePayer(i)}
                          disabled={payers.length <= 1}
                        >
                          <RemoveCircleOutlineIcon
                            fontSize="small"
                            sx={{
                              color: payers.length <= 1 ? 'grey.400' : 'error.main',
                            }}
                          />
                        </IconButton>
                      </Stack>
                    ))}
                    {parsedAmount > 0 && (
                      <Box
                        sx={{
                          fontSize: 12,
                          color:
                            Math.abs(payerTotal - parsedAmount) > 0.01
                              ? 'error.main'
                              : 'success.main',
                        }}
                      >
                        Total: {formatCurrency(payerTotal, currency)} /{' '}
                        {formatCurrency(parsedAmount, currency)}
                        {Math.abs(payerTotal - parsedAmount) <= 0.01 && ' ✓'}
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
                            {formatCurrency(equalPerPerson, currency)}
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
                            slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
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
                                ={' '}
                                {formatCurrency(
                                  ((parseFloat(customPercentages[id]) || 0) / 100) * parsedAmount,
                                  currency,
                                )}
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
                                ={' '}
                                {formatCurrency(
                                  (parseInt(customShares[id]) || 0) * perShareAmount,
                                  currency,
                                )}
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
                          color:
                            Math.abs(unequalTotal - parsedAmount) > 0.01
                              ? 'error.main'
                              : 'success.main',
                        }}
                      >
                        Total: {formatCurrency(unequalTotal, currency)} /{' '}
                        {formatCurrency(parsedAmount, currency)}
                        {Math.abs(unequalTotal - parsedAmount) <= 0.01 && ' ✓'}
                      </Box>
                    )}
                    {splitMethod === 'percentage' && (
                      <Box
                        sx={{
                          fontSize: 12,
                          color:
                            Math.abs(percentageTotal - 100) > 0.01 ? 'error.main' : 'success.main',
                        }}
                      >
                        Total: {percentageTotal.toFixed(1)}% / 100%
                        {Math.abs(percentageTotal - 100) <= 0.01 && ' ✓'}
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

          {/* ─── Tag (mandatory) ──────────────────── */}
          <TextField
            select
            label="Tag *"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            size="small"
            fullWidth
            error={!tag && !!error}
            helperText={!tag && !!error ? 'Tag is required' : ''}
          >
            <MenuItem value="" disabled>
              Select a tag...
            </MenuItem>
            {(
              (group.tags || []) as Array<{
                _id: string;
                name: string;
                isArchived: boolean;
              }>
            )
              .filter((t) => !t.isArchived)
              .map((t) => (
                <MenuItem key={t._id} value={t.name}>
                  {t.name}
                </MenuItem>
              ))}
            {(
              (group.tags || []) as Array<{
                _id: string;
                name: string;
                isArchived: boolean;
              }>
            ).filter((t) => !t.isArchived).length === 0 && (
              <MenuItem value="" disabled>
                No tags available — create tags in group settings
              </MenuItem>
            )}
          </TextField>

          {/* ─── More Options Toggle ───────────────── */}
          <Button
            size="small"
            onClick={() => setShowMoreOptions(!showMoreOptions)}
            endIcon={showMoreOptions ? <ExpandLessIcon /> : <ExpandMoreIcon />}
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
                borderRadius: 3,
                p: 2.5,
                bgcolor: 'background.paper',
              }}
            >
              <Stack direction="row" spacing={1.5}>
                <TextField
                  label="Date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  size="small"
                  sx={{ flex: 1 }}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  select
                  label="Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  size="small"
                  sx={{ flex: 1 }}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.icon} {c.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>

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

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading || !description.trim() || !amount || !tag}
          sx={{
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            '&:hover': { bgcolor: 'primary.dark' },
          }}
        >
          {loading ? <CircularProgress size={20} /> : isEditMode ? 'Save Changes' : 'Save Expense'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
