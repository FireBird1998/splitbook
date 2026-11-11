'use client';

import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { recurringExpensesKey } from '@splitbook/shared/query-keys';
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { MoneyTextField } from '@/components/ui/MoneyInput';
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
import { expenseLocalDate } from '@splitbook/shared/expense-day';
import { fetchWebRead } from '@/lib/web-read';
import { displayTagReference, findReferencedTag } from '@splitbook/shared/tag-identity';
import {
  getStoredExpenseMoneyFields,
  getSelectableExpenseTags,
  tagOptionValue,
} from '@/components/expenses/expense-form-helpers';
import type { GroupReadMember, GroupReadTag } from '@splitbook/shared/group-read';
import type { IRecurringExpense, SplitMethod } from '@splitbook/shared/types';
import {
  readExpenseEntry,
  recurringEntryPolicy,
  type ExpenseEntry,
} from '@splitbook/shared/expense-entry';
import { formatCurrency, getCurrencyPrecision } from '@splitbook/shared/currency';
import { assertStoredExpenseMoney } from '@splitbook/shared/exact-money';
import { apiFetch } from '@/lib/utils/api-fetch';
import { recurringRefusal } from '@/components/groups/recurring-refusal';
import { RECURRING_SECTION_ID } from '@/components/groups/group-tabs';
import { memberLabel } from '@splitbook/shared/activity-timeline';
import { SEPARATOR, counted } from '@splitbook/shared/separator';

interface RecurringExpensesSectionProps {
  groupId: string;
  tags: GroupReadTag[];
  members: GroupReadMember[];
  defaultCurrency: string;
  /** The signed-in member, called "You" (#442). */
  viewerId: string;
  onNotify: (message: string) => void;
}

const SPLIT_METHOD_OPTIONS: Array<{ value: SplitMethod; label: string }> = [
  { value: 'equal', label: 'Split equally' },
  { value: 'exact', label: 'Exact amounts' },
  { value: 'percentage', label: 'Percentages' },
  { value: 'shares', label: 'Shares' },
];

/**
 * "1 Feb 2026": a recurring Expense's start or end, a calendar day stored at midnight UTC, so the
 * same in every zone (#522).
 */
const dayLabel = (date: Date | string) => formatDate(expenseLocalDate(date));

function toDateInputValue(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

function emptyEntry(
  members: GroupReadMember[],
  activeTags: GroupReadTag[],
  currency: string,
): ExpenseEntry {
  return {
    description: '',
    amount: '',
    currency,
    date: '',
    category: 'other',
    tagId: activeTags[0]?._id ?? '',
    payerId: members[0]?.user._id ?? '',
    multiPayer: false,
    payers: [],
    splitMethod: 'equal',
    splitValues: {},
    participantIds: members.map((member) => member.user._id),
    notes: '',
  };
}

// The recurring dialog retains a method's boxes when switching away and back. These are
// interaction bookmarks, not another reading: only the active entry is shown and submitted.
function methodValues(members: GroupReadMember[], template?: IRecurringExpense) {
  let storedMoney: ReturnType<typeof getStoredExpenseMoneyFields> | undefined;
  if (template)
    try {
      storedMoney = getStoredExpenseMoneyFields(template);
    } catch {
      // Invalid saved values stay visible for review; don't silently repair the saved money.
    }
  const values: Record<'exact' | 'percentage' | 'shares', Record<string, string>> = {
    exact: {},
    percentage: {},
    shares: {},
  };
  for (const { user } of members) {
    const index =
      template?.splitBetween.findIndex(
        (s) => String(typeof s.user === 'object' ? s.user._id : s.user) === user._id,
      ) ?? -1;
    const split = template?.splitBetween[index];
    values.exact[user._id] =
      storedMoney?.splitBetween[index] ?? (split?.amount != null ? String(split.amount) : '');
    values.percentage[user._id] = split?.percentage != null ? String(split.percentage) : '';
    values.shares[user._id] = split?.shares != null ? String(split.shares) : '1';
  }
  return { values, amount: storedMoney?.amount };
}

function entryFromTemplate(
  template: IRecurringExpense,
  members: GroupReadMember[],
  currency: string,
): ExpenseEntry {
  const base = emptyEntry(members, [], currency);
  const { values, amount } = methodValues(members, template);
  const payer = template.paidBy[0];
  const payerId = typeof payer?.user === 'object' ? payer.user._id : (payer?.user as string);
  return {
    ...base,
    description: template.description,
    amount: amount ?? String(template.amount),
    category: template.category || 'other',
    tagId: template.tagId ?? template.tag,
    payerId: payerId ? String(payerId) : base.payerId,
    splitMethod: template.splitMethod,
    splitValues:
      template.splitMethod === 'equal'
        ? {}
        : values[template.splitMethod === 'unequal' ? 'exact' : template.splitMethod],
    participantIds: members
      .filter(({ user }) =>
        template.splitBetween.some(
          (s) => String(typeof s.user === 'object' ? s.user._id : s.user) === user._id,
        ),
      )
      .map(({ user }) => user._id),
  };
}
const scheduleFor = (template?: IRecurringExpense) => ({
  dayOfMonth: template ? String(template.dayOfMonth) : '1',
  startsOn: template ? toDateInputValue(template.startsOn) : toDateParam(new Date()),
  endsOn: template ? toDateInputValue(template.endsOn) : '',
});

export default function RecurringExpensesSection({
  groupId,
  tags,
  members,
  defaultCurrency,
  viewerId,
  onNotify,
}: RecurringExpensesSectionProps) {
  const { data, mutate } = useSWR(recurringExpensesKey(WEB_QUERY_ACCOUNT, groupId), fetchWebRead);
  const templates = (data?.data ?? []) as IRecurringExpense[];

  // Linked to as `#recurring-expenses` (the Insights tab's Manage, #315). The section mounts
  // only once the Group's read is in, after the browser and the router have looked for the
  // hash, so it brings itself into view and takes focus when it mounts under that hash.
  const sectionRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (window.location.hash !== `#${RECURRING_SECTION_ID}`) return;
    sectionRef.current?.scrollIntoView({ block: 'start' });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const activeTags = useMemo(() => tags.filter((tag) => !tag.isArchived && !tag.isDeleted), [tags]);
  const memberIds = useMemo(() => new Set(members.map((m) => m.user._id)), [members]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IRecurringExpense | null>(null);
  const [entry, setEntry] = useState(() => emptyEntry(members, activeTags, defaultCurrency));
  const [schedule, setSchedule] = useState(() => scheduleFor());
  const splitBookmarks = useRef(methodValues(members).values);
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
    memberLabel(id, members.find((m) => m.user._id === id)?.user.name, viewerId) ?? 'Former member';

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
    setEntry(emptyEntry(members, activeTags, defaultCurrency));
    setSchedule(scheduleFor());
    splitBookmarks.current = methodValues(members).values;
    setFormError('');
    setFormConflict(false);
    setDialogOpen(true);
  };

  const openEditDialog = (template: IRecurringExpense) => {
    setEditing(template);
    setEntry(entryFromTemplate(template, members, defaultCurrency));
    setSchedule(scheduleFor(template));
    splitBookmarks.current = methodValues(members, template).values;
    setFormError('');
    setFormConflict(false);
    setDialogOpen(true);
  };

  const setSplit = (userId: string, value: string) => {
    setEntry((prev) => ({ ...prev, splitValues: { ...prev.splitValues, [userId]: value } }));
  };
  const changeMethod = (method: SplitMethod) => {
    const key = (value: Exclude<SplitMethod, 'equal'>) => (value === 'unequal' ? 'exact' : value);
    if (entry.splitMethod !== 'equal')
      splitBookmarks.current[key(entry.splitMethod)] = entry.splitValues;
    setEntry({
      ...entry,
      splitMethod: method,
      splitValues: method === 'equal' ? {} : splitBookmarks.current[key(method)],
    });
  };
  const currentEntry = {
    ...entry,
    currency: defaultCurrency,
    participantIds: members
      .filter(({ user }) => entry.participantIds.includes(user._id))
      .map(({ user }) => user._id),
  };
  const reading = readExpenseEntry(
    currentEntry,
    editing ? { kind: 'edit', saved: editing } : { kind: 'new' },
    recurringEntryPolicy,
  );
  const validateForm = (): string | null => {
    if (!entry.description.trim()) return 'Description is required';
    if (!entry.tagId) return 'Tag is required';
    if (!entry.payerId) return 'Choose who pays';
    if (!currentEntry.participantIds.length) return 'Include at least one person in the split';
    if (reading.result.kind === 'refused') return reading.result.problems[0].message;
    const day = Number(schedule.dayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 31) return 'Day of month must be 1–31';
    if (!schedule.startsOn) return 'Start date is required';
    if (schedule.endsOn && schedule.endsOn < schedule.startsOn)
      return 'End date must be on or after the start date';
    return null;
  };
  const splitPreview = reading.result.kind === 'ready' ? reading.result.money.splitBetween : [];
  const previewError = reading.result.kind === 'refused' ? reading.result.problems[0].message : '';

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
        setEntry(entryFromTemplate(latest, members, defaultCurrency));
        setSchedule(scheduleFor(latest));
        splitBookmarks.current = methodValues(members, latest).values;
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
    if (reading.result.kind !== 'ready') return;
    const { amount, currency, paidBy, splitMethod, splitBetween } = reading.result.figures;
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
        body: JSON.stringify({
          description: entry.description.trim(),
          amount,
          currency,
          category: entry.category,
          ...(tags.some((tag) => tag._id === entry.tagId) || editing?.tagId === entry.tagId
            ? { tagId: entry.tagId }
            : { tag: entry.tagId }),
          paidBy,
          splitMethod,
          splitBetween,
          dayOfMonth: Number(schedule.dayOfMonth),
          startsOn: schedule.startsOn,
          endsOn: schedule.endsOn || null,
        }),
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
        return `split equally ${counted(count, 'way')}`;
      case 'percentage':
        return `split by percentage across ${count}`;
      case 'shares':
        return `split by shares across ${count}`;
      default:
        return `split exactly across ${count}`;
    }
  };

  /** "Alex Rao pays", or "You pay" for the viewer, matched by id since two members can share a name. */
  const payerPays = (template: IRecurringExpense): string => {
    const payer = template.paidBy[0];
    if (!payer) return '— pays';
    const id = String(typeof payer.user === 'object' ? payer.user._id : payer.user);
    if (id === viewerId) return 'You pay';
    if (typeof payer.user === 'object' && payer.user?.name) return `${payer.user.name} pays`;
    return `${memberName(id)} pays`;
  };

  return (
    <Paper
      ref={sectionRef}
      id={RECURRING_SECTION_ID}
      variant="outlined"
      // Clear of the sticky top bar when brought into view.
      sx={{ p: 3, scrollMarginTop: 80 }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography
            ref={headingRef}
            tabIndex={-1}
            variant="subtitle1"
            fontWeight={600}
            color="text.primary"
            sx={{ mb: 0.5 }}
          >
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
                      Day {template.dayOfMonth} monthly{SEPARATOR}
                      {payerPays(template)}
                      {SEPARATOR}
                      {splitSummary(template)}
                      {SEPARATOR}since {dayLabel(template.startsOn)}
                      {template.endsOn ? `${SEPARATOR}until ${dayLabel(template.endsOn)}` : ''}
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
              value={entry.description}
              onChange={(e) => setEntry({ ...entry, description: e.target.value })}
              fullWidth
              size="small"
              placeholder="e.g. Rent"
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <MoneyTextField
                currency={defaultCurrency}
                label="Amount"
                value={entry.amount}
                onValueChange={(value) => setEntry({ ...entry, amount: value })}
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
                value={entry.category}
                onChange={(e) => setEntry({ ...entry, category: e.target.value })}
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
                value={entry.tagId}
                onChange={(e) => setEntry({ ...entry, tagId: e.target.value })}
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
                value={entry.payerId}
                onChange={(e) => setEntry({ ...entry, payerId: e.target.value })}
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
              value={entry.splitMethod}
              onChange={(e) => changeMethod(e.target.value as SplitMethod)}
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
                  if (!Object.hasOwn(splitBookmarks.current.shares, member.user._id)) return null;
                  const included = entry.participantIds.includes(member.user._id);
                  const value = entry.splitValues[member.user._id] ?? '';
                  return (
                    <Stack key={member.user._id} direction="row" alignItems="center" spacing={1}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={included}
                            onChange={(e) =>
                              setEntry({
                                ...entry,
                                participantIds: members
                                  .filter(({ user }) =>
                                    user._id === member.user._id
                                      ? e.target.checked
                                      : entry.participantIds.includes(user._id),
                                  )
                                  .map(({ user }) => user._id),
                              })
                            }
                            size="small"
                          />
                        }
                        label={member.user.name}
                        sx={{ flex: 1, minWidth: 0 }}
                      />
                      {included &&
                        (entry.splitMethod === 'exact' || entry.splitMethod === 'unequal') && (
                          <MoneyTextField
                            currency={defaultCurrency}
                            size="small"
                            label="Amount"
                            value={value}
                            onValueChange={(value) => setSplit(member.user._id, value)}
                            sx={{ width: 120 }}
                            slotProps={{
                              htmlInput: { inputMode: precision === 0 ? 'numeric' : 'decimal' },
                            }}
                          />
                        )}
                      {included && entry.splitMethod === 'percentage' && (
                        <TextField
                          type="number"
                          size="small"
                          label="%"
                          value={value}
                          onChange={(e) => setSplit(member.user._id, e.target.value)}
                          sx={{ width: 96 }}
                          slotProps={{ htmlInput: { min: 0, max: 100 } }}
                        />
                      )}
                      {included && entry.splitMethod === 'shares' && (
                        <TextField
                          type="number"
                          size="small"
                          label="Shares"
                          value={value}
                          onChange={(e) => setSplit(member.user._id, e.target.value)}
                          sx={{ width: 96 }}
                          slotProps={{ htmlInput: { min: 0, step: '1' } }}
                        />
                      )}
                    </Stack>
                  );
                })}
              </Stack>
              {entry.amount && previewError && (
                <Box role="status" sx={{ color: 'status.negative' }}>
                  {previewError}
                </Box>
              )}
              {splitPreview.length > 0 && (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                  {splitPreview
                    .map((split) => {
                      return `${memberName(split.user)}: ${formatCurrency(split.amount, defaultCurrency)}`;
                    })
                    .join(SEPARATOR)}
                </Typography>
              )}
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label="Day of month"
                type="number"
                value={schedule.dayOfMonth}
                onChange={(e) => setSchedule({ ...schedule, dayOfMonth: e.target.value })}
                fullWidth
                size="small"
                helperText="Short months use their last day — e.g. 31 → Feb 28"
                slotProps={{ htmlInput: { min: 1, max: 31, step: '1' } }}
              />
              <TextField
                label="Starts on"
                type="date"
                value={schedule.startsOn}
                onChange={(e) => setSchedule({ ...schedule, startsOn: e.target.value })}
                fullWidth
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="Ends on (optional)"
                type="date"
                value={schedule.endsOn}
                onChange={(e) => setSchedule({ ...schedule, endsOn: e.target.value })}
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
