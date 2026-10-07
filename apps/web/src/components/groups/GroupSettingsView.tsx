'use client';

import { useEffect, useState } from 'react';
import { useSWRConfig } from 'swr';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Avatar from '@mui/material/Avatar';
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
import Snackbar from '@mui/material/Snackbar';
import { alpha } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import PersonIcon from '@mui/icons-material/Person';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareIcon from '@mui/icons-material/Share';
import AddIcon from '@mui/icons-material/Add';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import LabelIcon from '@mui/icons-material/Label';
import { CURRENCIES, getSortedCurrencies } from '@splitbook/shared/currency';
import LeaveGroupSection from '@/components/groups/LeaveGroupSection';
import GroupUnavailable from '@/components/groups/GroupUnavailable';
import { formatDate } from '@splitbook/shared/date';
import { useGroup } from '@/lib/hooks/use-groups';
import { isGroupReadKey } from '@/lib/group-read';
import ErrorState from '@/components/common/ErrorState';
import { validateTripDates } from '@splitbook/shared/trip-setup';
import { GROUP_THEME_LIST, getGroupTheme } from '@splitbook/shared/group-themes';
import RecurringExpensesSection from '@/components/groups/RecurringExpensesSection';
import { apiFetch } from '@/lib/utils/api-fetch';

interface GroupSettingsViewProps {
  groupId: string;
  userId: string;
  /** The server's recurring Expenses switch (#289): off hides the recurring section. */
  recurringExpensesEnabled: boolean;
}

/** The API's `{ error }` message for a rejected request, or `fallback` when it has none. */
async function failureMessage(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  const message = (body as { error?: unknown } | null)?.error;
  return typeof message === 'string' && message ? message : fallback;
}

export default function GroupSettingsView(props: GroupSettingsViewProps) {
  return <GroupSettingsContent key={`${props.userId}:${props.groupId}`} {...props} />;
}

function GroupSettingsContent({
  groupId,
  userId,
  recurringExpensesEnabled,
}: GroupSettingsViewProps) {
  const { mutate: globalMutate } = useSWRConfig();
  const { data: group, isLoading, error, mutate } = useGroup(userId, groupId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('other');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [generalSaving, setGeneralSaving] = useState(false);
  const [generalInitialized, setGeneralInitialized] = useState(false);

  const [defaultCurrency, setDefaultCurrency] = useState('');
  const [alternateCurrencies, setAlternateCurrencies] = useState<string[]>([]);
  const [currencySaving, setCurrencySaving] = useState(false);
  const [currencyInitialized, setCurrencyInitialized] = useState(false);

  const [memberMenuAnchor, setMemberMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [memberLoading, setMemberLoading] = useState(false);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLinkLoading, setInviteLinkLoading] = useState(false);

  const [newTagName, setNewTagName] = useState('');
  const [tagLoading, setTagLoading] = useState(false);
  const [tagMenuAnchor, setTagMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [deleteTagDialogOpen, setDeleteTagDialogOpen] = useState(false);
  const [deleteTagError, setDeleteTagError] = useState('');
  const [renameTagOpen, setRenameTagOpen] = useState(false);
  const [renameTagName, setRenameTagName] = useState('');
  const [renameTagError, setRenameTagError] = useState('');

  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);

  const [snackbar, setSnackbar] = useState({ open: false, message: '' });

  useEffect(() => {
    if (!group || generalInitialized) return;
    setName(group.name);
    setDescription(group.description);
    setCategory(group.category);
    setStartDate(group.startDate ? new Date(group.startDate).toISOString().split('T')[0] : '');
    setEndDate(group.endDate ? new Date(group.endDate).toISOString().split('T')[0] : '');
    setGeneralInitialized(true);
  }, [group, generalInitialized]);

  useEffect(() => {
    if (!group || currencyInitialized) return;
    setDefaultCurrency(group.defaultCurrency);
    setAlternateCurrencies(group.alternateCurrencies);
    setCurrencyInitialized(true);
  }, [group, currencyInitialized]);

  if (isLoading && !group) {
    return (
      <Container maxWidth="md" disableGutters>
        <Skeleton variant="text" width={192} height={32} sx={{ mb: 2 }} />
        <Skeleton variant="text" width={128} height={20} sx={{ mb: 4 }} />
        <Skeleton variant="rounded" height={384} />
      </Container>
    );
  }

  if (error && !group) {
    return (
      <Container maxWidth="md" disableGutters>
        <ErrorState message="Group could not be loaded." onRetry={() => void mutate()} />
      </Container>
    );
  }

  if (!group) {
    return (
      <Container maxWidth="md" disableGutters>
        <GroupUnavailable />
      </Container>
    );
  }

  const members = group.members;

  const currentUserMember = members.find((m) => m.user._id === userId);
  const isAdmin = currentUserMember?.role === 'admin';

  if (!isAdmin) {
    return (
      <Container maxWidth="md" disableGutters>
        <Stack spacing={3} sx={{ py: 3 }}>
          <Box>
            <Typography variant="h6" fontWeight={500} color="text.primary" sx={{ mb: 1 }}>
              {group.name}
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Only admins can change this Group’s settings.
            </Typography>
            <Button component={Link} href={`/groups/${groupId}`} variant="outlined">
              Back to Group
            </Button>
          </Box>
          <LeaveGroupSection groupId={groupId} groupName={group.name} />
        </Stack>
      </Container>
    );
  }

  const currencies = getSortedCurrencies(group.defaultCurrency, group.alternateCurrencies);
  const tripDateError = validateTripDates(startDate || null, endDate || null);
  const theme = getGroupTheme(group.category);

  const handleSaveGeneral = async () => {
    if (tripDateError) return;
    setGeneralSaving(true);
    try {
      const res = await apiFetch(`/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          category,
          startDate: startDate || null,
          endDate: endDate || null,
        }),
      });
      if (!res.ok) {
        setSnackbar({ open: true, message: await failureMessage(res, 'Failed to update') });
        return;
      }
      mutate();
      globalMutate(
        (key: unknown) =>
          (typeof key === 'string' && key.includes('/api/groups')) || isGroupReadKey(key),
      );
      setSnackbar({ open: true, message: 'Group info updated' });
    } catch {
      setSnackbar({ open: true, message: 'Failed to update' });
    } finally {
      setGeneralSaving(false);
    }
  };

  const handleSaveCurrency = async () => {
    setCurrencySaving(true);
    try {
      const res = await apiFetch(`/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCurrency, alternateCurrencies }),
      });
      if (!res.ok) {
        setSnackbar({ open: true, message: await failureMessage(res, 'Failed to update') });
        return;
      }
      mutate();
      setSnackbar({ open: true, message: 'Currency settings updated' });
    } catch {
      setSnackbar({ open: true, message: 'Failed to update' });
    } finally {
      setCurrencySaving(false);
    }
  };

  const handleMemberAction = async (action: 'promote' | 'demote' | 'remove') => {
    if (!selectedMember) return;
    setMemberLoading(true);
    try {
      const res =
        action === 'remove'
          ? await apiFetch(`/api/groups/${groupId}/members/${selectedMember}`, {
              method: 'DELETE',
            })
          : await apiFetch(`/api/groups/${groupId}/members/${selectedMember}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                role: action === 'promote' ? 'admin' : 'member',
              }),
            });
      // Refresh either way: a rejection usually means the member list is stale.
      mutate();
      if (!res.ok) {
        setSnackbar({ open: true, message: await failureMessage(res, 'Action failed') });
        return;
      }
      setSnackbar({
        open: true,
        message:
          action === 'remove'
            ? 'Member removed'
            : action === 'promote'
              ? 'Promoted to admin'
              : 'Demoted to member',
      });
    } catch {
      setSnackbar({ open: true, message: 'Action failed' });
    } finally {
      setMemberLoading(false);
      setMemberMenuAnchor(null);
      setSelectedMember(null);
    }
  };

  const handleGenerateInviteLink = async () => {
    setInviteLinkLoading(true);
    try {
      const res = await apiFetch(`/api/groups/${groupId}/invite-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInDays: 7 }),
      });
      if (!res.ok) {
        setSnackbar({ open: true, message: await failureMessage(res, 'Failed to generate link') });
        return;
      }
      const data = await res.json();
      if (data.data?.inviteUrl) {
        setInviteLink(data.data.inviteUrl);
      }
    } catch {
      setSnackbar({ open: true, message: 'Failed to generate link' });
    } finally {
      setInviteLinkLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setSnackbar({ open: true, message: 'Link copied to clipboard' });
    }
  };

  const handleArchive = async () => {
    setArchiveLoading(true);
    try {
      const res = await apiFetch(`/api/groups/${groupId}`, { method: 'DELETE' });
      if (!res.ok) {
        setSnackbar({ open: true, message: await failureMessage(res, 'Failed to archive group') });
        return;
      }
      window.location.href = '/groups';
    } catch {
      setSnackbar({ open: true, message: 'Failed to archive group' });
    } finally {
      setArchiveLoading(false);
    }
  };

  const tags = group.tags.filter((tag) => !tag.isDeleted);

  const selectedTagData = tags.find((t) => t._id === selectedTag);

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    setTagLoading(true);
    try {
      const res = await apiFetch(`/api/groups/${groupId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTagName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSnackbar({
          open: true,
          message: data.error || 'Failed to create tag',
        });
      } else {
        setNewTagName('');
        mutate();
        setSnackbar({ open: true, message: 'Tag created' });
      }
    } catch {
      setSnackbar({ open: true, message: 'Failed to create tag' });
    } finally {
      setTagLoading(false);
    }
  };

  const handleRenameTag = async () => {
    if (!selectedTag || !renameTagName.trim()) return;
    setTagLoading(true);
    setRenameTagError('');
    try {
      const res = await apiFetch(`/api/groups/${groupId}/tags/${selectedTag}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameTagName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRenameTagError(data.error || 'Failed to rename tag');
        return;
      }
      await globalMutate(
        (key) =>
          (typeof key === 'string' && key.startsWith(`/api/groups/${groupId}`)) ||
          isGroupReadKey(key, `/api/groups/${groupId}`),
      );
      setRenameTagOpen(false);
      setSelectedTag(null);
      setSnackbar({ open: true, message: 'Tag renamed' });
    } catch {
      setRenameTagError('Failed to rename tag');
    } finally {
      setTagLoading(false);
    }
  };

  const handleToggleArchiveTag = async () => {
    if (!selectedTag || !selectedTagData) return;
    setTagLoading(true);
    try {
      const res = await apiFetch(`/api/groups/${groupId}/tags/${selectedTag}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: !selectedTagData.isArchived }),
      });
      if (!res.ok) {
        setSnackbar({ open: true, message: await failureMessage(res, 'Failed to update tag') });
        return;
      }
      mutate();
      setSnackbar({
        open: true,
        message: selectedTagData.isArchived ? 'Tag unarchived' : 'Tag archived',
      });
    } catch {
      setSnackbar({ open: true, message: 'Failed to update tag' });
    } finally {
      setTagLoading(false);
      setTagMenuAnchor(null);
      setSelectedTag(null);
    }
  };

  const handleDeleteTag = async () => {
    if (!selectedTag) return;
    setTagLoading(true);
    setDeleteTagError('');
    try {
      const res = await apiFetch(`/api/groups/${groupId}/tags/${selectedTag}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setDeleteTagError(data.error || 'Failed to delete tag');
      } else {
        mutate();
        setSnackbar({ open: true, message: 'Tag deleted' });
        setDeleteTagDialogOpen(false);
        setTagMenuAnchor(null);
        setSelectedTag(null);
      }
    } catch {
      setDeleteTagError('Failed to delete tag');
    } finally {
      setTagLoading(false);
    }
  };

  const selectedMemberData = members.find((m) => m.user._id === selectedMember);

  return (
    <Container maxWidth="md" disableGutters>
      {error && (
        <ErrorState
          message="Group could not be refreshed. Showing previously loaded group."
          onRetry={() => void mutate()}
        />
      )}
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 4 }}>
        <IconButton
          component={Link}
          href={`/groups/${groupId}`}
          size="small"
          aria-label="Back to group"
        >
          <ArrowBackIcon />
        </IconButton>
        <Box>
          <Typography variant="h5" fontWeight={700} color="text.primary">
            Group Settings
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {group.name}
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={4}>
        {/* ─── General Information ──────────────────── */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 2 }}>
            General Information
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Group Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              size="small"
              multiline
              rows={2}
            />
            <TextField
              select
              label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              fullWidth
              size="small"
            >
              {GROUP_THEME_LIST.map((theme) => (
                <MenuItem key={theme.id} value={theme.id}>
                  {theme.icon} {theme.label}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label="Start date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                fullWidth
                size="small"
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="End date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                fullWidth
                size="small"
                error={Boolean(tripDateError)}
                helperText={tripDateError || undefined}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                onClick={handleSaveGeneral}
                disabled={generalSaving || !name.trim() || Boolean(tripDateError)}
              >
                {generalSaving ? <CircularProgress size={20} /> : 'Save Changes'}
              </Button>
            </Box>
          </Stack>
        </Paper>

        {/* ─── Currency Settings ───────────────────── */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 2 }}>
            Currency Settings
          </Typography>
          <Stack spacing={2}>
            <TextField
              select
              label="Default Currency"
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
              fullWidth
              size="small"
            >
              {currencies.map((c) => (
                <MenuItem key={c.code} value={c.code}>
                  {c.flag} {c.code} — {c.name}
                </MenuItem>
              ))}
            </TextField>

            <Box>
              <Typography
                variant="caption"
                fontWeight={500}
                color="text.secondary"
                sx={{ mb: 1, display: 'block' }}
              >
                Alternate Currencies (max 2)
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1 }}>
                {alternateCurrencies.map((code) => {
                  const curr = CURRENCIES.find((c) => c.code === code);
                  return (
                    <Chip
                      key={code}
                      label={`${curr?.flag || ''} ${code}`}
                      onDelete={() =>
                        setAlternateCurrencies(alternateCurrencies.filter((c) => c !== code))
                      }
                      size="small"
                    />
                  );
                })}
              </Stack>
              {alternateCurrencies.length < 2 && (
                <TextField
                  select
                  label="Add currency"
                  value=""
                  onChange={(e) => {
                    if (
                      e.target.value &&
                      !alternateCurrencies.includes(e.target.value) &&
                      e.target.value !== defaultCurrency
                    ) {
                      setAlternateCurrencies([...alternateCurrencies, e.target.value]);
                    }
                  }}
                  fullWidth
                  size="small"
                >
                  <MenuItem value="" disabled>
                    Select currency...
                  </MenuItem>
                  {CURRENCIES.filter(
                    (c) => c.code !== defaultCurrency && !alternateCurrencies.includes(c.code),
                  ).map((c) => (
                    <MenuItem key={c.code} value={c.code}>
                      {c.flag} {c.code} — {c.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="contained" onClick={handleSaveCurrency} disabled={currencySaving}>
                {currencySaving ? <CircularProgress size={20} /> : 'Save Currency'}
              </Button>
            </Box>
          </Stack>
        </Paper>

        {/* ─── Tags ─────────────────────────────────── */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 0.5 }}>
            Tags
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Every expense must have exactly one tag. Archived tags won&apos;t appear in the expense
            form.
          </Typography>

          {/* Add tag */}
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField
              placeholder="New tag name..."
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              size="small"
              fullWidth
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddTag();
              }}
              slotProps={{ htmlInput: { maxLength: 50 } }}
            />
            <Button
              variant="contained"
              onClick={handleAddTag}
              disabled={tagLoading || !newTagName.trim()}
              startIcon={<AddIcon />}
              sx={{ minWidth: 100 }}
            >
              Add
            </Button>
          </Stack>

          {/* Tag list */}
          {tags.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 3, color: 'text.disabled' }}>
              <LabelIcon sx={{ fontSize: 40, mb: 1, opacity: 0.4 }} />
              <Typography variant="body2">No tags yet. Create your first tag above.</Typography>
            </Box>
          ) : (
            <Stack spacing={1}>
              {tags.map((tag) => (
                <Stack
                  key={tag._id}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{
                    py: 1,
                    px: 1.5,
                    borderRadius: 2,
                    bgcolor: tag.isArchived ? 'surface.muted' : 'background.paper',
                    opacity: tag.isArchived ? 0.7 : 1,
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <LabelIcon
                      fontSize="small"
                      sx={{
                        color: tag.isArchived ? 'text.disabled' : 'primary.main',
                      }}
                    />
                    <Typography
                      variant="body2"
                      fontWeight={500}
                      sx={{
                        color: tag.isArchived ? 'text.disabled' : 'text.primary',
                        textDecoration: tag.isArchived ? 'line-through' : 'none',
                      }}
                    >
                      {tag.name}
                    </Typography>
                    {tag.isArchived && (
                      <Chip
                        label="Archived"
                        size="small"
                        sx={{
                          fontSize: 10,
                          height: 20,
                          backgroundColor: (theme) => alpha(theme.palette.text.primary, 0.06),
                        }}
                      />
                    )}
                  </Stack>
                  <IconButton
                    size="small"
                    aria-label={`Actions for tag ${tag.name}`}
                    onClick={(e) => {
                      setSelectedTag(tag._id);
                      setTagMenuAnchor(e.currentTarget);
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          )}

          {/* Tag action menu */}
          <Menu
            anchorEl={tagMenuAnchor}
            open={!!tagMenuAnchor}
            onClose={() => {
              setTagMenuAnchor(null);
              setSelectedTag(null);
            }}
            slotProps={{ paper: { sx: { minWidth: 180 } } }}
          >
            <MuiMenuItem
              onClick={() => {
                setRenameTagName(selectedTagData?.name ?? '');
                setRenameTagError('');
                setRenameTagOpen(true);
                setTagMenuAnchor(null);
              }}
              disabled={tagLoading}
            >
              <ListItemIcon>
                <EditIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Rename</ListItemText>
            </MuiMenuItem>
            <MuiMenuItem onClick={handleToggleArchiveTag} disabled={tagLoading}>
              <ListItemIcon>
                {selectedTagData?.isArchived ? (
                  <UnarchiveIcon fontSize="small" />
                ) : (
                  <ArchiveIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText>{selectedTagData?.isArchived ? 'Unarchive' : 'Archive'}</ListItemText>
            </MuiMenuItem>
            <MuiMenuItem
              onClick={() => {
                setDeleteTagError('');
                setDeleteTagDialogOpen(true);
                setTagMenuAnchor(null);
              }}
              disabled={tagLoading}
            >
              <ListItemIcon>
                <DeleteIcon fontSize="small" sx={{ color: 'error.main' }} />
              </ListItemIcon>
              <ListItemText sx={{ color: 'error.main' }}>Delete</ListItemText>
            </MuiMenuItem>
          </Menu>
        </Paper>

        <Dialog
          open={renameTagOpen}
          onClose={() => {
            if (!tagLoading) setRenameTagOpen(false);
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Rename Tag</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              label="Tag name"
              fullWidth
              value={renameTagName}
              onChange={(event) => setRenameTagName(event.target.value)}
              error={!!renameTagError}
              helperText={renameTagError || 'Expenses and recurring templates keep this Tag.'}
              slotProps={{ htmlInput: { maxLength: 50 } }}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRenameTagOpen(false)} disabled={tagLoading}>
              Cancel
            </Button>
            <Button
              onClick={handleRenameTag}
              disabled={tagLoading || !renameTagName.trim()}
              variant="contained"
            >
              Save name
            </Button>
          </DialogActions>
        </Dialog>

        {/* Delete Tag Confirmation Dialog */}
        <Dialog
          open={deleteTagDialogOpen}
          onClose={() => {
            setDeleteTagDialogOpen(false);
            setSelectedTag(null);
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Delete Tag</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.primary">
              Are you sure you want to delete the tag{' '}
              <strong>&ldquo;{selectedTagData?.name}&rdquo;</strong>? This is only possible if no
              expenses or recurring templates use this tag.
            </Typography>
            {deleteTagError && (
              <Typography variant="body2" color="error.main" sx={{ mt: 1 }}>
                {deleteTagError}
              </Typography>
            )}
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
            <Button
              onClick={() => {
                setDeleteTagDialogOpen(false);
                setSelectedTag(null);
              }}
              color="inherit"
              disabled={tagLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteTag}
              variant="contained"
              color="error"
              disabled={tagLoading}
            >
              {tagLoading ? <CircularProgress size={20} /> : 'Delete'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* ─── Recurring (Household only, while the product offers it) ── */}
        {recurringExpensesEnabled && theme.recurringExpenses && (
          <RecurringExpensesSection
            groupId={groupId}
            tags={tags}
            members={members}
            defaultCurrency={group.defaultCurrency}
            onNotify={(message) => setSnackbar({ open: true, message })}
          />
        )}

        {/* ─── Members ─────────────────────────────── */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 2 }}>
            Members ({members.length})
          </Typography>
          <Stack spacing={1.5}>
            {members.map((m) => (
              <Stack
                key={m.user._id}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ py: 1 }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Avatar src={m.user.image} sx={{ width: 36, height: 36, fontSize: 14 }}>
                    {m.user.name?.[0]}
                  </Avatar>
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="body2" fontWeight={500} color="text.primary">
                        {m.user._id === userId ? 'You' : m.user.name}
                      </Typography>
                      <Chip
                        label={m.role}
                        size="small"
                        sx={{
                          fontSize: 10,
                          height: 20,
                          ...(m.role === 'admin'
                            ? {
                                backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.1),
                                color: 'primary.main',
                              }
                            : {}),
                        }}
                      />
                    </Stack>
                    <Typography variant="caption" color="text.disabled">
                      {m.user.email} · Joined {formatDate(m.joinedAt)}
                    </Typography>
                  </Box>
                </Stack>

                {m.user._id !== userId && (
                  <IconButton
                    size="small"
                    aria-label={`Actions for member ${m.user.name}`}
                    onClick={(e) => {
                      setSelectedMember(m.user._id);
                      setMemberMenuAnchor(e.currentTarget);
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            ))}
          </Stack>

          {/* Member action menu */}
          <Menu
            anchorEl={memberMenuAnchor}
            open={!!memberMenuAnchor}
            onClose={() => {
              setMemberMenuAnchor(null);
              setSelectedMember(null);
            }}
            slotProps={{ paper: { sx: { minWidth: 180 } } }}
          >
            {selectedMemberData?.role === 'member' && (
              <MuiMenuItem onClick={() => handleMemberAction('promote')} disabled={memberLoading}>
                <ListItemIcon>
                  <AdminPanelSettingsIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Promote to Admin</ListItemText>
              </MuiMenuItem>
            )}
            {selectedMemberData?.role === 'admin' && (
              <MuiMenuItem onClick={() => handleMemberAction('demote')} disabled={memberLoading}>
                <ListItemIcon>
                  <PersonIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Demote to Member</ListItemText>
              </MuiMenuItem>
            )}
            <MuiMenuItem onClick={() => handleMemberAction('remove')} disabled={memberLoading}>
              <ListItemIcon>
                <PersonRemoveIcon fontSize="small" sx={{ color: 'error.main' }} />
              </ListItemIcon>
              <ListItemText sx={{ color: 'error.main' }}>Remove</ListItemText>
            </MuiMenuItem>
          </Menu>
        </Paper>

        {/* ─── Invite Link ─────────────────────────── */}
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 2 }}>
            Invite Link
          </Typography>
          {inviteLink ? (
            <Stack spacing={1.5}>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ bgcolor: 'surface.muted', borderRadius: 2, px: 1.5, py: 1 }}
              >
                <Typography
                  component="code"
                  variant="body2"
                  color="text.primary"
                  sx={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {inviteLink}
                </Typography>
                <IconButton size="small" onClick={handleCopyLink} aria-label="Copy invite link">
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Link expires in 7 days
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                Generate a shareable link that anyone can use to join this group.
              </Typography>
              <Button
                variant="outlined"
                onClick={handleGenerateInviteLink}
                disabled={inviteLinkLoading}
                startIcon={inviteLinkLoading ? <CircularProgress size={16} /> : <ShareIcon />}
              >
                Generate Invite Link
              </Button>
            </Stack>
          )}
        </Paper>

        <LeaveGroupSection groupId={groupId} groupName={group.name} />

        {/* ─── Danger Zone ─────────────────────────── */}
        <Paper sx={{ p: 3, border: 2, borderColor: 'error.light' }}>
          <Typography variant="subtitle1" fontWeight={600} color="error.main" sx={{ mb: 1 }}>
            Danger Zone
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Archiving a group will hide it from all members. Existing expenses and settlements will
            be preserved.
          </Typography>
          <Button variant="outlined" color="error" onClick={() => setArchiveDialogOpen(true)}>
            Archive Group
          </Button>
        </Paper>
      </Stack>

      {/* Archive Confirmation Dialog */}
      <Dialog
        open={archiveDialogOpen}
        onClose={() => setArchiveDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Archive Group</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.primary">
            Are you sure you want to archive <strong>&ldquo;{group.name}&rdquo;</strong>? This will
            hide the group from all members.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setArchiveDialogOpen(false)}
            color="inherit"
            disabled={archiveLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleArchive}
            variant="contained"
            color="error"
            disabled={archiveLoading}
          >
            {archiveLoading ? <CircularProgress size={20} /> : 'Archive'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ open: false, message: '' })}
        message={snackbar.message}
      />
    </Container>
  );
}
