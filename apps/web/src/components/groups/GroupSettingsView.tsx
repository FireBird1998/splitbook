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
import LeaveGroupSection from '@/components/groups/LeaveGroupSection';
import TagManager from '@/components/groups/TagManager';
import GroupCurrenciesSection from '@/components/groups/GroupCurrenciesSection';
import GroupUnavailable from '@/components/groups/GroupUnavailable';
import { formatDate } from '@splitbook/shared/date';
import { useGroup } from '@/lib/hooks/use-groups';
import { isWebGroupsRead } from '@/lib/web-query-keys';
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

  const [memberMenuAnchor, setMemberMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [memberLoading, setMemberLoading] = useState(false);

  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLinkLoading, setInviteLinkLoading] = useState(false);

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
  const currenciesSection = (
    <GroupCurrenciesSection
      groupId={groupId}
      groupName={group.name}
      viewerId={userId}
      isAdmin={isAdmin}
      adminNames={members
        .filter((m) => m.role === 'admin' && m.user._id !== userId)
        .map((m) => m.user.name)}
      onNotify={(message) => setSnackbar({ open: true, message })}
    />
  );
  const snackbarView = (
    <Snackbar
      open={snackbar.open}
      autoHideDuration={3000}
      onClose={() => setSnackbar({ open: false, message: '' })}
      message={snackbar.message}
    />
  );

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
          {currenciesSection}
          <TagManager groupId={groupId} accountId={userId} />
          <LeaveGroupSection
            groupId={groupId}
            groupName={group.name}
            memberCount={members.length}
          />
        </Stack>
        {snackbarView}
      </Container>
    );
  }

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
      globalMutate(isWebGroupsRead);
      setSnackbar({ open: true, message: 'Group info updated' });
    } catch {
      setSnackbar({ open: true, message: 'Failed to update' });
    } finally {
      setGeneralSaving(false);
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

        {currenciesSection}

        <TagManager groupId={groupId} accountId={userId} />

        {/* ─── Recurring (Household only, while the product offers it) ── */}
        {recurringExpensesEnabled && theme.recurringExpenses && (
          <RecurringExpensesSection
            groupId={groupId}
            tags={tags}
            members={members}
            defaultCurrency={group.defaultCurrency}
            viewerId={userId}
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
                                backgroundColor: (theme) =>
                                  theme.vars
                                    ? `rgba(${theme.vars.palette.primary.mainChannel} / 0.1)`
                                    : alpha(theme.palette.primary.main, 0.1),
                                color: 'primary.main',
                              }
                            : {}),
                        }}
                      />
                    </Stack>
                    <Typography variant="caption" color="text.disabled">
                      {[m.user.email, `Joined ${formatDate(m.joinedAt)}`]
                        .filter(Boolean)
                        .join(' · ')}
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

        <LeaveGroupSection groupId={groupId} groupName={group.name} memberCount={members.length} />

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

      {snackbarView}
    </Container>
  );
}
