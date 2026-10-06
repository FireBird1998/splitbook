'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MuiMenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import MoneyText from '@/components/common/MoneyText';
import { EXPENSE_CATEGORIES } from '@splitbook/shared/categories';
import { formatDate, toDateParam } from '@splitbook/shared/date';
import { fetcher } from '@/lib/utils/fetcher';
import { displayTagReference, findReferencedTag } from '@splitbook/shared/tag-identity';
import {
  getStoredExpenseMoneyFields,
  getSelectableExpenseTags,
  tagOptionValue,
} from '@/components/expenses/expense-form-helpers';
import type { GroupReadMember, GroupReadTag } from '@splitbook/shared/group-read';
import type { IRecurringExpense, SplitMethod } from '@splitbook/shared/types';
import { decideExpenseMoneyEdit } from '@splitbook/shared/expense-money-edit';
import { formatCurrency, getCurrencyPrecision } from '@splitbook/shared/currency';
import {
  assertStoredExpenseMoney,
  normalizeExpenseMoney,
  parseAmountMinor,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import { apiFetch } from '@/lib/utils/api-fetch';
import { recurringRefusal } from '@/components/groups/recurring-refusal';

interface RecurringExpensesSectionProps {
  groupId: string;
  tags: GroupReadTag[];
  members: GroupReadMember[];
  defaultCurrency: string;
  onNotify: (message: string) => void;
}

interface SplitDraft {
  included: boolean;
  amount: string;
  percentage: string;
  shares: string;
}

interface FormState {
  description: string;
  amount: string;
  category: string;
  tag: string;
  paidByUser: string;
  splitMethod: SplitMethod;
  splits: Record<string, SplitDraft>;
  dayOfMonth: string;
  startsOn: string;
  endsOn: string;
}

const SPLIT_METHOD_OPTIONS: Array<{ value: SplitMethod; label: string }> = [
  { value: 'equal', label: 'Split equally' },
  { value: 'exact', label: 'Exact amounts' },
  { value: 'percentage', label: 'Percentages' },
  { value: 'shares', label: 'Shares' },
];

function toDateInputValue(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

function emptyForm(members: GroupReadMember[], activeTags: GroupReadTag[]): FormState {
  const splits: Record<string, SplitDraft> = {};
  for (const member of members) {
    splits[member.user._id] = { included: true, amount: '', percentage: '', shares: '1' };
  }
  return {
    description: '',
    amount: '',
    category: 'other',
    tag: activeTags[0]?._id ?? '',
    paidByUser: members[0]?.user._id ?? '',
    splitMethod: 'equal',
    splits,
    dayOfMonth: '1',
    startsOn: toDateParam(new Date()),
    endsOn: '',
  };
}

function formFromTemplate(template: IRecurringExpense, members: GroupReadMember[]): FormState {
  const base = emptyForm(members, []);
  let storedMoney: ReturnType<typeof getStoredExpenseMoneyFields> | undefined;
  try {
    storedMoney = getStoredExpenseMoneyFields(template);
  } catch {
    // Invalid saved values remain visible for review; the problem badge explains
    // why generation is stopped instead of silently repairing financial data.
  }
  const payer = template.paidBy[0];
  const payerId = typeof payer?.user === 'object' ? payer.user._id : (payer?.user as string);
  const splits: Record<string, SplitDraft> = { ...base.splits };
  for (const member of members) {
    const splitIndex = template.splitBetween.findIndex((s) => {
      const id = typeof s.user === 'object' ? s.user._id : (s.user as string);
      return String(id) === member.user._id;
    });
    const split = template.splitBetween[splitIndex];
    splits[member.user._id] = {
      included: !!split,
      amount:
        storedMoney?.splitBetween[splitIndex] ??
        (split?.amount != null ? String(split.amount) : ''),
      percentage: split?.percentage != null ? String(split.percentage) : '',
      shares: split?.shares != null ? String(split.shares) : '1',
    };
  }
  return {
    description: template.description,
    amount: storedMoney?.amount ?? String(template.amount),
    category: template.category || 'other',
    tag: template.tagId ?? template.tag,
    paidByUser: payerId ? String(payerId) : base.paidByUser,
    splitMethod: template.splitMethod,
    splits,
    dayOfMonth: String(template.dayOfMonth),
    startsOn: toDateInputValue(template.startsOn),
    endsOn: toDateInputValue(template.endsOn),
  };
}

export default function RecurringExpensesSection({
  groupId,
  tags,
  members,
  defaultCurrency,
  onNotify,
}: RecurringExpensesSectionProps) {
  const { data, mutate } = useSWR(`/api/groups/${groupId}/recurring`, fetcher);
  const templates = (data?.data ?? []) as IRecurringExpense[];

  const activeTags = useMemo(() => tags.filter((tag) => !tag.isArchived && !tag.isDeleted), [tags]);
  const memberIds = useMemo(() => new Set(members.map((m) => m.user._id)), [members]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IRecurringExpense | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(members, activeTags));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formConflict, setFormConflict] = useState(false);

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<IRecurringExpense | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionConflict, setActionConflict] = useState(false);
  const precision = getCurrencyPrecision(defaultCurrency);

  const memberName = (id: string) =>
    members.find((m) => m.user._id === id)?.user.name ?? 'Former member';

  /** A template whose tag or participants no longer match group state stops
   *  generating — surface that here instead of failing silently. */
  const problemFor = (template: IRecurringExpense): string | null => {
    const tag = findReferencedTag(tags, template);
    if (!tag || tag.isArchived || tag.isDeleted) {
      return `Tag "${template.tag}" is archived or deleted — not generating`;
    }
    const participantIds = [...template.paidBy, ...template.splitBetween].map((p) =>
      String(typeof p.user === 'object' ? p.user._id : p.user),
    );
    if (participantIds.some((id) => !memberIds.has(id))) {
      return 'A payer or split member is no longer in the group — not generating';
    }
    try {
      assertStoredExpenseMoney(template);
    } catch {
      return 'Amounts need review — not generating';
    }
    return null;
  };

  const openAddDialog = () => {
    setEditing(null);
    setForm(emptyForm(members, activeTags));
    setFormError('');
    setFormConflict(false);
    setDialogOpen(true);
  };

  const openEditDialog = (template: IRecurringExpense) => {
    setEditing(template);
    setForm(formFromTemplate(template, members));
    setFormError('');
    setFormConflict(false);
    setDialogOpen(true);
  };

  const setSplit = (userId: string, patch: Partial<SplitDraft>) => {
    setForm((prev) => ({
      ...prev,
      splits: { ...prev.splits, [userId]: { ...prev.splits[userId], ...patch } },
    }));
  };

  const validateForm = (): string | null => {
    if (!form.description.trim()) return 'Description is required';
    if (!form.tag) return 'Tag is required';
    if (!form.paidByUser) return 'Choose who pays';
    const included = members.filter((m) => form.splits[m.user._id]?.included);
    if (included.length === 0) return 'Include at least one person in the split';
    try {
      resolveMoney();
    } catch (err) {
      return err instanceof Error ? err.message : 'Check the amount and split';
    }
    const day = Number(form.dayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 31) return 'Day of month must be 1–31';
    if (!form.startsOn) return 'Start date is required';
    if (form.endsOn && form.endsOn < form.startsOn)
      return 'End date must be on or after the start date';
    return null;
  };

  const buildPayload = () => {
    const amount = toMajorAmount(parseAmountMinor(form.amount, defaultCurrency), defaultCurrency);
    const included = members.filter((m) => form.splits[m.user._id]?.included);
    const splitBetween = included.map((m) => {
      const draft = form.splits[m.user._id];
      const entry: { user: string; amount?: number; percentage?: number; shares?: number } = {
        user: m.user._id,
      };
      if (form.splitMethod === 'exact' || form.splitMethod === 'unequal') {
        entry.amount = toMajorAmount(
          parseAmountMinor(draft.amount, defaultCurrency),
          defaultCurrency,
        );
      } else if (form.splitMethod === 'percentage') {
        entry.percentage = Number(draft.percentage) || 0;
      } else if (form.splitMethod === 'shares') {
        entry.shares = Number(draft.shares) || 0;
      }
      return entry;
    });
    return {
      description: form.description.trim(),
      amount,
      currency: defaultCurrency,
      category: form.category,
      ...(tags.some((tag) => tag._id === form.tag) || editing?.tagId === form.tag
        ? { tagId: form.tag }
        : { tag: form.tag }),
      paidBy: [{ user: form.paidByUser, amount }],
      splitMethod: form.splitMethod,
      splitBetween,
      dayOfMonth: Number(form.dayOfMonth),
      startsOn: form.startsOn,
      endsOn: form.endsOn || null,
    };
  };

  const resolveMoney = () => {
    const payload = buildPayload();
    return editing
      ? decideExpenseMoneyEdit(editing, payload).money
      : normalizeExpenseMoney(payload);
  };
  const preview = (() => {
    try {
      return { money: resolveMoney(), error: '' };
    } catch (err) {
      return { money: null, error: err instanceof Error ? err.message : 'Invalid allocation' };
    }
  })();
  const splitPreview = preview.money?.splitBetween ?? [];

  const reloadLatest = async (target: 'form' | 'action') => {
    const id = target === 'form' ? editing?._id : selected?._id;
    if (!id) return;
    if (target === 'form') setSaving(true);
    else setActionLoading(true);
    try {
      const refreshed = await mutate();
      const latest = (refreshed?.data as IRecurringExpense[] | undefined)?.find(
        (item) => item._id === id,
      );
      if (!latest)
        throw new Error('This recurring expense was deleted. Close this dialog to continue.');
      if (target === 'form') {
        setEditing(latest);
        setForm(formFromTemplate(latest, members));
        setFormError('');
        setFormConflict(false);
      } else {
        setSelected(latest);
        setActionError('');
        setActionConflict(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load the latest version';
      if (target === 'form') setFormError(message);
      else setActionError(message);
    } finally {
      setSaving(false);
      setActionLoading(false);
    }
  };

  const handleSave = async () => {
    const validationMessage = validateForm();
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const url = editing
        ? `/api/groups/${groupId}/recurring/${editing._id}`
        : `/api/groups/${groupId}/recurring`;
      const res = await apiFetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(editing ? { 'X-Splitbook-Revision': String(editing.revision ?? 0) } : {}),
        },
        body: JSON.stringify(buildPayload()),
      });
      const json = await res.json();
      if (!res.ok) {
        const refusal = recurringRefusal(res.status, json, 'Failed to save');
        setFormError(refusal.message);
        setFormConflict(refusal.conflict);
        return;
      }
      mutate();
      setDialogOpen(false);
      setEditing(null);
      onNotify(editing ? 'Recurring expense updated' : 'Recurring expense added');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePause = async () => {
    if (!selected) return;
    setActionLoading(true);
    setActionError('');
    setActionConflict(false);
    try {
      const res = await apiFetch(`/api/groups/${groupId}/recurring/${selected._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Splitbook-Revision': String(selected.revision ?? 0),
        },
        body: JSON.stringify({ isPaused: !selected.isPaused }),
      });
      if (res.ok) {
        mutate();
        onNotify(selected.isPaused ? 'Recurring expense resumed' : 'Recurring expense paused');
      } else {
        const refusal = recurringRefusal(res.status, await res.json(), 'Failed to update');
        setActionError(refusal.message);
        setActionConflict(refusal.conflict);
      }
    } catch {
      onNotify('Failed to update');
    } finally {
      setActionLoading(false);
      setMenuAnchor(null);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setActionLoading(true);
    setActionError('');
    setActionConflict(false);
    try {
      const res = await apiFetch(`/api/groups/${groupId}/recurring/${selected._id}`, {
        method: 'DELETE',
        headers: { 'X-Splitbook-Revision': String(selected.revision ?? 0) },
      });
      if (res.ok) {
        mutate();
        onNotify('Recurring expense deleted');
        setDeleteDialogOpen(false);
        setSelected(null);
      } else {
        const refusal = recurringRefusal(res.status, await res.json(), 'Failed to delete');
        setActionError(refusal.message);
        setActionConflict(refusal.conflict);
      }
    } catch {
      onNotify('Failed to delete');
    } finally {
      setActionLoading(false);
    }
  };

  const splitSummary = (template: IRecurringExpense): string => {
    const count = template.splitBetween.length;
    switch (template.splitMethod) {
      case 'equal':
        return `split equally ${count} way${count === 1 ? '' : 's'}`;
      case 'percentage':
        return `split by percentage across ${count}`;
      case 'shares':
        return `split by shares across ${count}`;
      default:
        return `split exactly across ${count}`;
    }
  };

  const payerName = (template: IRecurringExpense): string => {
    const payer = template.paidBy[0];
    if (!payer) return '—';
    if (typeof payer.user === 'object' && payer.user?.name) return payer.user.name;
    return memberName(String(typeof payer.user === 'object' ? payer.user._id : payer.user));
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 0.5 }}>
            Recurring
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Expenses that log themselves every month — rent, WiFi, utilities. Generated expenses are
            ordinary expenses: edit or delete any month without touching the template.
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={openAddDialog}
          sx={{ ml: 2, flexShrink: 0 }}
        >
          Add
        </Button>
      </Stack>

      {actionError && !deleteDialogOpen && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            actionConflict ? (
              <Button
                color="inherit"
                disabled={actionLoading}
                onClick={() => reloadLatest('action')}
              >
                Reload latest
              </Button>
            ) : undefined
          }
        >
          {actionError}
        </Alert>
      )}

      {templates.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 3, color: 'text.disabled' }}>
          <AutorenewIcon sx={{ fontSize: 40, mb: 1, opacity: 0.4 }} />
          <Typography variant="body2">
            No recurring expenses yet. Add rent, WiFi, or utilities.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1}>
          {templates.map((template) => {
            const problem = problemFor(template);
            return (
              <Stack
                key={template._id}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{
                  py: 1,
                  px: 1.5,
                  borderRadius: 2,
                  bgcolor: 'background.paper',
                  opacity: template.isPaused ? 0.75 : 1,
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
                  <AutorenewIcon
                    fontSize="small"
                    sx={{ color: template.isPaused ? 'text.disabled' : 'primary.main' }}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                      <Typography variant="body2" fontWeight={500} color="text.primary" noWrap>
                        {template.description}
                      </Typography>
                      <MoneyText
                        amount={template.amount}
                        currency={template.currency}
                        tone="neutral"
                        variant="body2"
                        fontWeight={600}
                      />
                      <Chip
                        label={displayTagReference(tags, template).tag}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: 10, height: 20 }}
                      />
                      {template.isPaused && (
                        <Chip
                          label="Paused"
                          size="small"
                          color="warning"
                          variant="outlined"
                          sx={{ fontSize: 10, height: 20 }}
                        />
                      )}
                      {problem && (
                        <Chip
                          label={problem}
                          size="small"
                          color="error"
                          variant="outlined"
                          sx={{ fontSize: 10, height: 20 }}
                        />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.disabled">
                      Day {template.dayOfMonth} monthly · {payerName(template)} pays ·{' '}
                      {splitSummary(template)} · since {formatDate(template.startsOn)}
                      {template.endsOn ? ` · until ${formatDate(template.endsOn)}` : ''}
                    </Typography>
                  </Box>
                </Stack>
                <IconButton
                  size="small"
                  aria-label={`Actions for recurring expense ${template.description}`}
                  onClick={(e) => {
                    setSelected(template);
                    setMenuAnchor(e.currentTarget);
                  }}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </Stack>
            );
          })}
        </Stack>
      )}

      {/* Row action menu */}
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => {
          setMenuAnchor(null);
          setSelected(null);
        }}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        <MuiMenuItem
          onClick={() => {
            setMenuAnchor(null);
            if (selected) openEditDialog(selected);
          }}
          disabled={actionLoading}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MuiMenuItem>
        <MuiMenuItem onClick={handleTogglePause} disabled={actionLoading}>
          <ListItemIcon>
            {selected?.isPaused ? (
              <PlayArrowIcon fontSize="small" />
            ) : (
              <PauseIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>{selected?.isPaused ? 'Resume' : 'Pause'}</ListItemText>
        </MuiMenuItem>
        <MuiMenuItem
          onClick={() => {
            setMenuAnchor(null);
            setDeleteDialogOpen(true);
          }}
          disabled={actionLoading}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" sx={{ color: 'error.main' }} />
          </ListItemIcon>
          <ListItemText sx={{ color: 'error.main' }}>Delete</ListItemText>
        </MuiMenuItem>
      </Menu>

      {/* Add / edit dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{editing ? 'Edit recurring expense' : 'Add recurring expense'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              fullWidth
              size="small"
              placeholder="e.g. Rent"
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label="Amount"
                type="text"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                fullWidth
                size="small"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">{defaultCurrency}</InputAdornment>
                    ),
                  },
                  htmlInput: { inputMode: precision === 0 ? 'numeric' : 'decimal' },
                }}
                helperText={
                  precision === 0
                    ? `${defaultCurrency} uses whole amounts`
                    : `Up to ${precision} decimal places`
                }
              />
              <TextField
                select
                label="Category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                fullWidth
                size="small"
              >
                {EXPENSE_CATEGORIES.map((category) => (
                  <MenuItem key={category.id} value={category.id}>
                    {category.icon} {category.label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                select
                label="Tag"
                value={form.tag}
                onChange={(e) => setForm({ ...form, tag: e.target.value })}
                fullWidth
                size="small"
              >
                {getSelectableExpenseTags(tags, editing?.tag, editing?.tagId).map((tag) => (
                  <MenuItem key={tagOptionValue(tag)} value={tagOptionValue(tag)}>
                    {tag.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Paid by"
                value={form.paidByUser}
                onChange={(e) => setForm({ ...form, paidByUser: e.target.value })}
                fullWidth
                size="small"
              >
                {members.map((member) => (
                  <MenuItem key={member.user._id} value={member.user._id}>
                    {member.user.name}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <TextField
              select
              label="Split method"
              value={form.splitMethod}
              onChange={(e) => setForm({ ...form, splitMethod: e.target.value as SplitMethod })}
              fullWidth
              size="small"
            >
              {SPLIT_METHOD_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            <Box>
              <Typography
                variant="caption"
                fontWeight={600}
                color="text.secondary"
                sx={{
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  display: 'block',
                  mb: 0.5,
                }}
              >
                Split between
              </Typography>
              <Stack spacing={0.5}>
                {members.map((member) => {
                  const draft = form.splits[member.user._id];
                  if (!draft) return null;
                  return (
                    <Stack key={member.user._id} direction="row" alignItems="center" spacing={1}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={draft.included}
                            onChange={(e) =>
                              setSplit(member.user._id, { included: e.target.checked })
                            }
                            size="small"
                          />
                        }
                        label={member.user.name}
                        sx={{ flex: 1, minWidth: 0 }}
                      />
                      {draft.included &&
                        (form.splitMethod === 'exact' || form.splitMethod === 'unequal') && (
                          <TextField
                            type="text"
                            size="small"
                            label="Amount"
                            value={draft.amount}
                            onChange={(e) => setSplit(member.user._id, { amount: e.target.value })}
                            sx={{ width: 120 }}
                            slotProps={{
                              htmlInput: { inputMode: precision === 0 ? 'numeric' : 'decimal' },
                            }}
                          />
                        )}
                      {draft.included && form.splitMethod === 'percentage' && (
                        <TextField
                          type="number"
                          size="small"
                          label="%"
                          value={draft.percentage}
                          onChange={(e) =>
                            setSplit(member.user._id, { percentage: e.target.value })
                          }
                          sx={{ width: 96 }}
                          slotProps={{ htmlInput: { min: 0, max: 100 } }}
                        />
                      )}
                      {draft.included && form.splitMethod === 'shares' && (
                        <TextField
                          type="number"
                          size="small"
                          label="Shares"
                          value={draft.shares}
                          onChange={(e) => setSplit(member.user._id, { shares: e.target.value })}
                          sx={{ width: 96 }}
                          slotProps={{ htmlInput: { min: 0, step: '1' } }}
                        />
                      )}
                    </Stack>
                  );
                })}
              </Stack>
              {form.amount && preview.error && (
                <Box role="status" sx={{ color: 'status.negative' }}>
                  {preview.error}
                </Box>
              )}
              {splitPreview.length > 0 && (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                  {splitPreview
                    .map((split) => {
                      return `${memberName(split.user)}: ${formatCurrency(split.amount, defaultCurrency)}`;
                    })
                    .join(' · ')}
                </Typography>
              )}
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label="Day of month"
                type="number"
                value={form.dayOfMonth}
                onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
                fullWidth
                size="small"
                helperText="Short months use their last day — e.g. 31 → Feb 28"
                slotProps={{ htmlInput: { min: 1, max: 31, step: '1' } }}
              />
              <TextField
                label="Starts on"
                type="date"
                value={form.startsOn}
                onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
                fullWidth
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="Ends on (optional)"
                type="date"
                value={form.endsOn}
                onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
                fullWidth
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>

            {formError && (
              <Alert
                severity="error"
                action={
                  formConflict ? (
                    <Button color="inherit" disabled={saving} onClick={() => reloadLatest('form')}>
                      Reload latest
                    </Button>
                  ) : undefined
                }
              >
                {formError}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => {
              setDialogOpen(false);
              setEditing(null);
            }}
            color="inherit"
            disabled={saving}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || formConflict}>
            {saving ? (
              <CircularProgress size={20} />
            ) : editing ? (
              'Save changes'
            ) : (
              'Add recurring expense'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setSelected(null);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete recurring expense</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.primary">
            Stop generating <strong>&ldquo;{selected?.description}&rdquo;</strong>? Expenses it
            already generated stay in the ledger — only future months stop.
          </Typography>
          {actionError && (
            <Alert
              severity="error"
              sx={{ mt: 2 }}
              action={
                actionConflict ? (
                  <Button
                    color="inherit"
                    disabled={actionLoading}
                    onClick={() => reloadLatest('action')}
                  >
                    Reload latest
                  </Button>
                ) : undefined
              }
            >
              {actionError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => {
              setDeleteDialogOpen(false);
              setSelected(null);
            }}
            color="inherit"
            disabled={actionLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            variant="contained"
            color="error"
            disabled={actionLoading || actionConflict}
          >
            {actionLoading ? <CircularProgress size={20} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
