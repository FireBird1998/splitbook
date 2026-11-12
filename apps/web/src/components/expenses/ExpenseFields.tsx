'use client';
import { useId, useState } from 'react';
import type { GroupCategory } from '@splitbook/shared/types';
import { MoneyTextField } from '@/components/ui/MoneyInput';
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
  amountReadAloud,
  getCurrency,
  formatCurrency,
  getCurrencyPrecision,
  prefixBesideChip,
  wholeUnit,
} from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type { ExpenseSplitMethod } from '@splitbook/shared/split-calculation';
import {
  readExpenseEntry,
  roundingNote,
  type IncompleteExpenseEntry,
  type ExpenseEntry,
} from '@splitbook/shared/expense-entry';
import { type ExpenseCurrencyChoice } from '@splitbook/shared/group-currencies';
import Menu from '@mui/material/Menu';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import CheckIcon from '@mui/icons-material/Check';

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
import { NO_BREAK_SPACE, SEPARATOR, counted } from '@splitbook/shared/separator';
import { scrollBox } from '@/components/common/scroll-box';

type ExpenseFieldsInput = {
  entry: IncompleteExpenseEntry;
  reading: ReturnType<typeof readExpenseEntry>;
  editEntry: (change: Partial<ExpenseEntry>) => void;
};
export type ExpenseFieldsProps = ExpenseFieldsInput & {
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
  /**
   * The currencies the Expense can be in, as Add and Edit expense offer them beside the amount
   * (#719). Without them, only the Expense's own currency is offered.
   */
  currencyChoices?: ExpenseCurrencyChoice[];
  /** Why the form started in its currency, such as the member's latest Expense's (#719). */
  currencyHint?: string | null;
  /**
   * The picker's "Add a currency…" (#722), with what it does, such as "Adds it to Lisbon & Tokyo
   * for everyone": it adds one to the Group for this Expense. Absent where none can be added.
   */
  addCurrency?: { note: string; onAdd: () => void };
  currentTag?: string | null;
  currentTagId?: string | null;
  /** In review, payers the item names more than once: each shows once, and Paid by says so (#894). */
  listedTwice?: readonly string[];
  /** Review guidance for a problem retained in the original split rows. */
  splitProblem?: string;
};
/** The Add expense fields, shared with To review. Persistence belongs to the caller. */
export default function ExpenseFields({
  entry,
  editEntry: edit,
  chooseSplitMethod,
  members,
  groupTags,
  userId,
  viewerId = userId,
  groupCategory,
  isEditMode,
  currentTag,
  currentTagId,
  reading,
  review = false,
  groupCurrency,
  currencyChoices,
  currencyHint = null,
  addCurrency,
  listedTwice = [],
  splitProblem,
}: ExpenseFieldsProps) {
  const {
    description,
    amount,
    currency,
    date,
    participantIds,
    tagId: tag,
    notes,
    payers,
    multiPayer,
    splitValues,
  } = entry;
  const splitMethod = entry.splitMethod;
  const previewAmount = (id: string) =>
    reading.split.shares[id] === undefined
      ? '—'
      : formatCurrency(toMajorAmount(reading.split.shares[id]!, entry.currency), entry.currency);
  const amountReasonId = useId();
  const amountReading = reading.fields.amountReading;
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
  // Add and Edit expense keep the currency beside the amount, and read them together (#719).
  const choices = currencyChoices ?? [];
  const known = getCurrency(currency);
  const chosen = choices.find((choice) => choice.code === currency) ?? {
    code: currency,
    name: known?.name ?? currency,
  };
  // Beside the chip, the prefix only where it isn't the code the chip says (#884).
  const prefix = prefixBesideChip(chosen.code);
  // A Group in one currency still opens the picker to add one (#722).
  const changeable = choices.length > 1 || !!addCurrency;
  const [currencyMenu, setCurrencyMenu] = useState<HTMLElement | null>(null);
  const currencyListId = useId();
  const unit = wholeUnit(currency);
  const [showSplitOptions, setShowSplitOptions] = useState(isEditMode);
  const [showMoreOptions, setShowMoreOptions] = useState(isEditMode);
  const {
    percentageTotal,
    unequalMinor,
    payerMinor,
    parsedAmount,
    splitsBalanced,
    percentagesBalanced,
    payersBalanced,
    sharesTotal,
    perShareAmount,
  } = reading.fields;
  const totalText = (minor: number) => {
    try {
      return formatCurrency(toMajorAmount(minor, currency), currency);
    } catch {
      return '—';
    }
  };

  // ─── Summary Line ──────────────────────────────────
  const countedPayers = multiPayer ? reading.payers.entries : payers;
  const payerName = memberName((multiPayer ? countedPayers[0]?.user : entry.payerId) || userId);
  // One payer is named even among several rows' mode, never "1 people paid" (#894).
  const payerSummary = !multiPayer
    ? entry.payerId
      ? `${payerName} paid`
      : 'Who paid?'
    : !countedPayers.length
      ? 'Who paid?'
      : multiPayer && countedPayers.length > 1
        ? `${countedPayers.length}${NO_BREAK_SPACE}people paid`
        : `${payerName} paid`;

  const splitMethodLabel: Record<string, string> = {
    equal: 'Split equally',
    unequal: 'Split by amounts',
    percentage: 'Split by %',
    shares: 'Split by shares',
    exact: 'Split exact',
  };

  const leftover = reading.split.status.kind === 'adds-up' ? reading.split.status.leftover : null;
  const note = leftover
    ? roundingNote(
        leftover,
        (id) => (id === viewerId ? 'you' : memberName(id)),
        (minor) => formatCurrency(toMajorAmount(minor, currency), currency),
      )
    : null;

  const memberSummary =
    participantIds.length === members.length
      ? `All ${members.length}${NO_BREAK_SPACE}members`
      : `${participantIds.length} of ${members.length}${NO_BREAK_SPACE}members`;

  // ─── Handlers ──────────────────────────────────────
  const handlePredefinedItem = (itemId: string) => {
    const item = PREDEFINED_ITEMS.find((i) => i.id === itemId);
    if (item) {
      const matchingTag = resolvePredefinedTag(groupTags, item.defaultTag);
      edit({
        description: item.label,
        category: resolveExpenseCategory(itemId),
        ...(matchingTag ? { tagId: matchingTag } : {}),
      });
    }
  };

  const handleMemberToggle = (memberId: string, checked: boolean) =>
    edit({
      ...(checked && splitMethod === 'shares' && !splitValues[memberId]
        ? { splitValues: { ...splitValues, [memberId]: '1' } }
        : {}),
      participantIds: checked
        ? [...participantIds, memberId]
        : participantIds.filter((id) => id !== memberId),
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
      ...(index === 0 && field === 'user' ? { payerId: value } : {}),
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
    selectedMemberCount: participantIds.length,
    memberCount: members.length,
    multiPayerMode: multiPayer,
    primaryPayerId: (multiPayer ? payers[0]?.user : entry.payerId) || userId,
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
            ...scrollBox,
            // Room for a chip's focus ring, which the scroll row would clip (#830); the margins
            // keep the row where it was, its 4px below included. "&&" outranks the Stack's own
            // margin reset on its children.
            p: '6px',
            '&&': { m: '-6px', mb: '-2px' },
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
          <MoneyTextField
            currency={currency}
            label="Amount"
            value={amount}
            onValueChange={(value) => edit({ amount: value })}
            required
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
                ...(review ? {} : { 'aria-label': `Amount, ${amountReadAloud(amount, currency)}` }),
              },
              input: review
                ? undefined
                : {
                    startAdornment: (
                      <InputAdornment position="start" sx={{ gap: 1, mr: 1 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          color="inherit"
                          disabled={!changeable}
                          aria-haspopup="listbox"
                          aria-expanded={!!currencyMenu}
                          aria-controls={currencyMenu ? currencyListId : undefined}
                          aria-label={`Currency, ${chosen.code}, ${chosen.name}${changeable ? '. Change currency' : ''}`}
                          endIcon={changeable ? <ExpandMoreIcon /> : undefined}
                          onClick={(event) => setCurrencyMenu(event.currentTarget)}
                          sx={(theme) => ({
                            ...(theme.typography.money as React.CSSProperties),
                            minWidth: 0,
                            fontWeight: 600,
                            px: 1,
                          })}
                        >
                          {chosen.code}
                        </Button>
                        {prefix && (
                          <Box
                            component="span"
                            aria-hidden="true"
                            sx={(theme) => ({
                              ...(theme.typography.money as React.CSSProperties),
                              color: 'text.secondary',
                            })}
                          >
                            {prefix}
                          </Box>
                        )}
                      </InputAdornment>
                    ),
                  },
            }}
          />
          <Menu
            anchorEl={currencyMenu}
            open={!!currencyMenu}
            onClose={() => setCurrencyMenu(null)}
            slotProps={{ list: { id: currencyListId, role: 'listbox', 'aria-label': 'Currency' } }}
          >
            {choices.map((choice) => (
              <MenuItem
                key={choice.code}
                role="option"
                aria-selected={choice.code === currency}
                selected={choice.code === currency}
                onClick={() => {
                  if (choice.code !== currency) edit({ currency: choice.code });
                  setCurrencyMenu(null);
                }}
                sx={{ gap: 1.5, minHeight: 44, minWidth: 280 }}
              >
                <Box
                  component="span"
                  sx={(theme) => ({
                    ...(theme.typography.money as React.CSSProperties),
                    minWidth: 40,
                    fontWeight: 600,
                  })}
                >
                  {choice.code}
                </Box>
                <Box component="span" sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    {choice.name}
                  </Box>
                  {choice.note && (
                    <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {choice.note}
                    </Box>
                  )}
                </Box>
                {choice.code === currency && <CheckIcon fontSize="small" color="primary" />}
              </MenuItem>
            ))}
            {addCurrency && <Divider sx={{ my: 0.75 }} />}
            {addCurrency && (
              <MenuItem
                role="option"
                aria-selected={false}
                onClick={() => {
                  setCurrencyMenu(null);
                  addCurrency.onAdd();
                }}
                sx={{ gap: 1.5, minHeight: 44, minWidth: 280 }}
              >
                <AddIcon fontSize="small" color="primary" sx={{ minWidth: 40 }} />
                <Box component="span" sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <Box component="span" sx={{ fontWeight: 600, color: 'primary.main' }}>
                    Add a currency…
                  </Box>
                  <Box component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {addCurrency.note}
                  </Box>
                </Box>
              </MenuItem>
            )}
          </Menu>
          {!review && currencyHint && (
            <Typography variant="caption" color="text.secondary" sx={{ mx: 1.75, mt: 0.5 }}>
              {currencyHint}
            </Typography>
          )}
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
        {review && (
          <TextField
            select
            label="Currency"
            value={currency}
            size="small"
            disabled={currencyCodes.length < 2}
            onChange={(event) => edit({ currency: event.target.value })}
            helperText={currencyHelp}
            sx={{ width: '100%' }}
          >
            {CURRENCIES.filter((option) => currencyCodes.includes(option.code)).map((option) => (
              <MenuItem key={option.code} value={option.code}>
                {option.flag} {option.code}
              </MenuItem>
            ))}
          </TextField>
        )}
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
              onClick={() => edit({ tagId: tagOptionValue(t) })}
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
          {SEPARATOR}
          <span>{splitMethodLabel[splitMethod] || 'Split'}</span>
          {SEPARATOR}
          <span>{memberSummary}</span>
          {unit && (
            <>
              {SEPARATOR}
              <span>whole {unit}</span>
            </>
          )}
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

      {note && (
        <Box role="status" sx={{ fontSize: 12, color: 'text.secondary' }}>
          {note}
        </Box>
      )}

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
            {listedTwice.map((id) => (
              <Box key={id} sx={{ fontSize: 12, color: 'status.negative', mb: 1 }}>
                {memberName(id) === 'You' ? 'You are' : `${memberName(id)} is`} listed twice.
              </Box>
            ))}
            {!multiPayer ? (
              <Stack spacing={1}>
                <TextField
                  select
                  label={review ? 'Paid by' : undefined}
                  value={entry.payerId}
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
                  onClick={() => edit({ multiPayer: true })}
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
                    <MoneyTextField
                      currency={currency}
                      value={payer.amount}
                      error={!!reading.payers.errors[payer.user]}
                      helperText={reading.payers.errors[payer.user]}
                      onValueChange={(value) => updatePayer(i, 'amount', value)}
                      size="small"
                      placeholder="Amount"
                      sx={{ width: 120 }}
                      slotProps={{
                        htmlInput: {
                          'aria-label': `Paid by ${memberName(payer.user)}`,
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
                    Total: {totalText(payerMinor)} / {formatCurrency(parsedAmount, currency)}
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
                        multiPayer: false,
                        payerId: payers[0]?.user || userId,
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
            {splitProblem && (
              <Box role="alert" sx={{ fontSize: 12, color: 'status.negative', mb: 1 }}>
                {splitProblem}
              </Box>
            )}
            <Stack spacing={1}>
              {members.map((m) => {
                const id = m.user._id;
                const isSelected = participantIds.includes(id);

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
                      <MoneyTextField
                        currency={currency}
                        value={splitValues[id] || ''}
                        error={!!reading.split.errors[id]}
                        helperText={reading.split.errors[id]}
                        onValueChange={(value) =>
                          edit({
                            splitValues: {
                              ...splitValues,
                              [id]: value,
                            },
                          })
                        }
                        size="small"
                        placeholder="0.00"
                        sx={{ width: 110 }}
                        slotProps={{
                          htmlInput: {
                            'aria-label': `${id === viewerId ? 'Your' : `${memberName(id)}’s`} share`,
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
                          value={splitValues[id] || ''}
                          error={!!reading.split.errors[id]}
                          helperText={reading.split.errors[id]}
                          onChange={(e) =>
                            edit({
                              splitValues: {
                                ...splitValues,
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
                        {parsedAmount > 0 && (splitValues[id] || 0) && (
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
                          value={splitValues[id] || ''}
                          error={!!reading.split.errors[id]}
                          helperText={reading.split.errors[id]}
                          onChange={(e) =>
                            edit({
                              splitValues: {
                                ...splitValues,
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
                    Total: {totalText(unequalMinor)} / {formatCurrency(parsedAmount, currency)}
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
                    Total:{' '}
                    {Number.isFinite(percentageTotal) ? percentageTotal.toFixed(2) + '%' : '—'} /
                    100%
                    {percentagesBalanced && ' ✓'}
                  </Box>
                )}
                {splitMethod === 'shares' && sharesTotal > 0 && (
                  <Box sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {counted(sharesTotal, 'share')}
                    {SEPARATOR}
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
              value={entry.category}
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
