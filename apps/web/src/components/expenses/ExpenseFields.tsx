'use client';
import { useId, useState } from 'react';
import type { GroupCategory } from '@splitbook/shared/types';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { PREDEFINED_ITEMS } from '@splitbook/shared/predefined-items';
import {
  CURRENCIES,
  getCurrency,
  formatCurrency,
  getCurrencyPrecision,
} from '@splitbook/shared/currency';
import { parseDecimalUnits, sumMinorAmounts } from '@splitbook/shared/exact-money';
import { readAmountEntry } from '@splitbook/shared/amount-entry';
import type { ExpenseSplitMethod } from '@splitbook/shared/split-calculation';
import { type ExpenseDraftValues } from '@splitbook/shared/expense-draft';

import {
  tagOptionValue,
  getSelectableExpenseTags,
  isAdvancedSplit,
  resolveExpenseCategory,
  resolvePredefinedTag,
} from './expense-form-helpers';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupTagOption } from './expense-form-helpers';
import { EXPENSE_CATEGORIES } from '@splitbook/shared/categories';
import { memberLabel } from '@splitbook/shared/activity-timeline';

export interface ExpenseFieldsProps {
  values: Omit<ExpenseDraftValues, 'splitMethod'> & {
    splitMethod: ExpenseDraftValues['splitMethod'] | '';
  };
  edit: (change: Partial<ExpenseDraftValues>) => void;
  chooseSplitMethod: (method: ExpenseSplitMethod) => void;
  members: Array<{ user: { _id: string; name: string } }>;
  groupTags: GroupTagOption[];
  /** Who pays when the Expense names nobody, and is called "You". */
  userId: string;
  /**
   * The member called "You", by id, when it isn't `userId`: To review names the viewer without
   * making them the payer of an item that has none (#591).
   */
  viewerId?: string;
  groupCategory?: GroupCategory;
  isEditMode: boolean;
  review?: boolean;
  /** In review, the Group's currency: the field offers only it, and a different one the item has. */
  groupCurrency?: string;
  currentTag?: string | null;
  currentTagId?: string | null;
  previewAmount: (id: string) => string;
}
/** The Add expense fields, shared with To review. Persistence belongs to the caller. */
export default function ExpenseFields({
  values,
  edit,
  chooseSplitMethod,
  members,
  groupTags,
  userId,
  viewerId = userId,
  groupCategory,
  isEditMode,
  currentTag,
  currentTagId,
  previewAmount,
  review = false,
  groupCurrency,
}: ExpenseFieldsProps) {
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
  } = values;
  // Why the amount can't be taken, in Record payment's words, from the one shared reading (#528).
  const amountReasonId = useId();
  const amountReading = readAmountEntry(amount, currency);
  const amountReason = amountReading.status === 'invalid' ? amountReading.message : '';
  const groupNoun = getGroupTheme(groupCategory ?? 'other').nouns.singular;
  const groupNounTitle = groupNoun.charAt(0).toUpperCase() + groupNoun.slice(1);
  // Add expense locks the Group's currency. To review does too, unless the item has another one,
  // which the member can only change to the Group's (#512).
  const currencyCodes = !review
    ? [currency]
    : groupCurrency
      ? [...new Set([currency, groupCurrency])]
      : CURRENCIES.map((option) => option.code);
  let currencyHelp = isEditMode ? 'Expense currency' : `${groupNounTitle} currency`;
  if (review && groupCurrency)
    currencyHelp =
      currency === groupCurrency
        ? `${groupNounTitle} currency`
        : `This ${groupNounTitle} uses ${groupCurrency}`;
  const [showSplitOptions, setShowSplitOptions] = useState(isEditMode);
  const [showMoreOptions, setShowMoreOptions] = useState(isEditMode);
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
  const amountMinor = exactSum(
    [amount],
    getCurrency(currency) ? getCurrencyPrecision(currency) : 2,
  );
  const unequalMinor = exactSum(
    selectedMembers.map((id) => customAmounts[id]),
    getCurrency(currency) ? getCurrencyPrecision(currency) : 2,
  );
  const percentageUnits = exactSum(
    selectedMembers.map((id) => customPercentages[id]),
    2,
  );
  const payerMinor = multiPayerMode
    ? exactSum(
        payers.map((payer) => payer.amount),
        getCurrency(currency) ? getCurrencyPrecision(currency) : 2,
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
  const payerSummary = !payers.length
    ? 'Who paid?'
    : multiPayerMode
      ? `${payers.length} people paid`
      : `${payerName} paid`;

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

  const handleMemberToggle = (memberId: string, checked: boolean) =>
    edit({
      selectedMembers: checked
        ? [...selectedMembers, memberId]
        : selectedMembers.filter((id) => id !== memberId),
    });

  const handleSplitMethodChange = (_: unknown, val: string | null) => {
    if (val) chooseSplitMethod(val as ExpenseSplitMethod);
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
    edit({
      payers: (payers.length ? payers : [{ user: '', amount: '' }]).map((p, i) =>
        i === index ? { ...p, [field]: value } : p,
      ),
    });
  };

  // ─── Helpers ──────────────────────────────────────
  function memberName(id: string) {
    const name = members.find((m) => m.user._id === id)?.user.name;
    return memberLabel(id, name, viewerId) ?? 'Unknown';
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

  const selectableTags = getSelectableExpenseTags(groupTags, currentTag, currentTagId);

  return (
    <Stack spacing={2.5}>
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
            scrollbarColor: (theme) => `${(theme.vars ?? theme).palette.border.strong} transparent`,
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
      <Stack direction={review ? 'column' : { xs: 'column', sm: 'row' }} spacing={1.5}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <TextField
            label="Amount"
            value={amount}
            onChange={(e) => edit({ amount: e.target.value })}
            required
            type="number"
            size="small"
            error={!!amountReason}
            sx={{
              '& input': (theme) => ({
                ...(theme.typography.money as React.CSSProperties),
                fontSize: '1.25rem',
                fontWeight: 600,
              }),
            }}
            slotProps={{
              htmlInput: {
                min: 10 ** -(getCurrency(currency) ? getCurrencyPrecision(currency) : 2),
                step: 10 ** -(getCurrency(currency) ? getCurrencyPrecision(currency) : 2),
                'aria-describedby': amountReason ? amountReasonId : undefined,
              },
            }}
          />
          {/* Always present, so even its first message is announced, and polite, so it never
              interrupts typing (#528, as Record payment, #514). */}
          <Typography
            id={amountReasonId}
            component="p"
            aria-live="polite"
            sx={{
              m: 0,
              mt: amountReason ? 0.5 : 0,
              mx: 1.75,
              fontSize: '0.75rem',
              color: 'error.main',
            }}
          >
            {amountReason}
          </Typography>
        </Box>
        <TextField
          select
          label="Currency"
          value={currency}
          size="small"
          disabled={currencyCodes.length < 2}
          onChange={(event) => edit({ currency: event.target.value })}
          helperText={currencyHelp}
          sx={{ width: review ? '100%' : { xs: '100%', sm: 120 } }}
        >
          {CURRENCIES.filter((option) => currencyCodes.includes(option.code)).map((option) => (
            <MenuItem key={option.code} value={option.code}>
              {option.flag} {option.code}
            </MenuItem>
          ))}
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
                  label={review ? 'Paid by' : undefined}
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
                      label={review ? 'Paid by' : undefined}
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
                          'aria-label': review ? `Paid by ${memberName(payer.user)}` : undefined,
                          min: 10 ** -(getCurrency(currency) ? getCurrencyPrecision(currency) : 2),
                          step: 10 ** -(getCurrency(currency) ? getCurrencyPrecision(currency) : 2),
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
                        payers: [{ user: payers[0]?.user || userId, amount: '' }],
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
              {/* To review keeps an item's stored method: Add expense saves unequal, a
                  Connected assistant sends exact, and both are Unequal (#508). */}
              <ToggleButton
                value={review && splitMethod !== 'unequal' ? 'exact' : 'unequal'}
                sx={{ textTransform: 'none', fontSize: 12 }}
              >
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
                      slotProps={
                        review
                          ? { input: { 'aria-label': `Share with ${memberName(id)}` } }
                          : undefined
                      }
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
                          htmlInput: {
                            'aria-label': review
                              ? `${id === viewerId ? 'Your' : `${memberName(id)}'s`} share`
                              : undefined,
                            min: 0,
                            step:
                              10 ** -(getCurrency(currency) ? getCurrencyPrecision(currency) : 2),
                          },
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
                            htmlInput: {
                              min: 0,
                              max: 100,
                              step: 0.1,
                              'aria-label': review ? `Percentage for ${memberName(id)}` : undefined,
                            },
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
                          slotProps={{
                            htmlInput: {
                              min: 1,
                              step: 1,
                              'aria-label': review ? `Shares for ${memberName(id)}` : undefined,
                            },
                          }}
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
          {review && (
            <TextField
              select
              label="Category"
              value={values.category}
              onChange={(event) => edit({ category: event.target.value })}
              size="small"
              fullWidth
            >
              {EXPENSE_CATEGORIES.map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {category.label}
                </MenuItem>
              ))}
            </TextField>
          )}
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
  );
}
