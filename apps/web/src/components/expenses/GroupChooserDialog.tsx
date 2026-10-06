'use client';

import { useId } from 'react';
import Link from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import type { GroupRead } from '@splitbook/shared/group-read';
import ErrorState from '@/components/common/ErrorState';
import { groupThemeIcon } from '@/components/layout/group-theme-icons';
import { NEW_GROUP_HREF } from '@/components/layout/shell-nav';
import { useGroups } from '@/lib/hooks/use-groups';
import { activeGroups, groupChoiceDetail } from './add-expense';

/** Sizes from the design canvas's Group rows (web.css: .g-a, .gi). */
const ROW_RADIUS = '10px';
const TILE_RADIUS = '9px';

interface GroupChooserProps {
  userId: string;
  onChoose: (group: GroupRead) => void;
  /** Called as the member follows the link to create a Group. */
  onCreateGroup: () => void;
}

/**
 * Which Group a new Expense goes to, asked before the form opens anywhere outside a Group
 * (#304). It lists the member's active Groups from the Groups read the sidebar and Home use;
 * archived Groups are never offered. A member with none is sent to create one first.
 */
export function GroupChooser({ userId, onChoose, onCreateGroup }: GroupChooserProps) {
  const groups = useGroups(userId);

  if (groups.data) {
    const choices = activeGroups(groups.data);
    if (choices.length === 0)
      return (
        <Box sx={{ py: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography component="h3" variant="subtitle1">
            No Groups yet
          </Typography>
          <Typography color="text.secondary">
            Create a Group first, then add expenses to it.
          </Typography>
          <Button
            component={Link}
            href={NEW_GROUP_HREF}
            onClick={onCreateGroup}
            variant="contained"
            startIcon={<AddIcon />}
            sx={{ alignSelf: 'flex-start', borderRadius: '12px', px: 2 }}
          >
            Create a Group
          </Button>
        </Box>
      );
    return (
      <Box
        component="ul"
        aria-label="Your Groups"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}
      >
        {choices.map((group) => {
          const Icon = groupThemeIcon(group.category);
          return (
            <li key={group._id}>
              <ButtonBase
                onClick={() => onChoose(group)}
                sx={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  minHeight: 56,
                  px: 1.25,
                  py: 1,
                  borderRadius: ROW_RADIUS,
                  textAlign: 'left',
                  // A <button> doesn't inherit the page's font by itself.
                  fontFamily: 'inherit',
                  color: 'text.primary',
                  '&:hover': { bgcolor: 'surface.hover' },
                }}
              >
                <Box
                  data-group-theme={group.category}
                  aria-hidden
                  sx={{
                    width: 36,
                    height: 36,
                    flex: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: TILE_RADIUS,
                    bgcolor: 'tint.brand',
                    color: 'primary.main',
                  }}
                >
                  <Icon sx={{ fontSize: 20 }} />
                </Box>
                <Box
                  component="span"
                  sx={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}
                >
                  <Box
                    component="span"
                    sx={{ fontSize: '0.9375rem', fontWeight: 600, overflowWrap: 'anywhere' }}
                  >
                    {group.name}
                  </Box>
                  <Box component="span" sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>
                    {groupChoiceDetail(group)}
                  </Box>
                </Box>
                <ChevronRightIcon aria-hidden sx={{ flex: 'none', color: 'text.secondary' }} />
              </ButtonBase>
            </li>
          );
        })}
      </Box>
    );
  }

  if (groups.error)
    return (
      <Box sx={{ py: 1 }}>
        <ErrorState
          message="Your Groups could not be loaded."
          onRetry={() => void groups.mutate()}
        />
      </Box>
    );

  return (
    <Box role="status" aria-label="Loading your Groups">
      {[0, 1, 2].map((row) => (
        <Box
          key={row}
          aria-hidden
          sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 56, px: 1.25 }}
        >
          <Skeleton variant="rounded" width={36} height={36} sx={{ borderRadius: TILE_RADIUS }} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="60%" />
            <Skeleton variant="text" width="40%" sx={{ fontSize: '0.8125rem' }} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

interface GroupChooserDialogProps extends GroupChooserProps {
  open: boolean;
  onClose: () => void;
}

/** The chooser in a dialog, named "Choose a Group". */
export default function GroupChooserDialog({
  open,
  onClose,
  userId,
  onChoose,
  onCreateGroup,
}: GroupChooserDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      slotProps={{ paper: { sx: { m: { xs: 2, sm: 4 }, width: { xs: 'calc(100% - 32px)' } } } }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          px: 3,
          pt: 2.5,
          pb: 1,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography id={titleId} component="h2" variant="h6">
            Choose a Group
          </Typography>
          <Typography id={descriptionId} variant="body2" color="text.secondary">
            Pick the Group this expense belongs to.
          </Typography>
        </Box>
        <IconButton
          onClick={onClose}
          aria-label="Close"
          sx={{ width: 44, height: 44, mt: -0.75, mr: -1.5, color: 'text.secondary' }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <DialogContent sx={{ px: 1.75, pt: 1, pb: 2 }}>
        <GroupChooser userId={userId} onChoose={onChoose} onCreateGroup={onCreateGroup} />
      </DialogContent>
    </Dialog>
  );
}
