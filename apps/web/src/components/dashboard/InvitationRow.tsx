'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { apiFetch } from '@/lib/utils/api-fetch';
import { RADIUS } from '@/lib/theme/tokens';
import type { HomeInvitation } from './home-reads';
import { homeRowSx } from './HomeCard';

interface InvitationRowProps {
  invitation: HomeInvitation;
  /** After Join or Decline went through: the invitations are read again. */
  onAnswered: () => void;
}

/** "Invitation from Priya Shah · General", without parts the read didn't send. */
export function invitationDetail({ invitedByName, category }: HomeInvitation): string {
  return [
    invitedByName ? `Invitation from ${invitedByName}` : 'Invitation',
    category ? getGroupTheme(category).label : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * An invitation in Needs you, answered right there with Join or Decline, as Home's invitation
 * card answered it before (#306). Joining refetches the member's Groups and balances (the
 * shell refetches them after any invitation write), so the new Group appears everywhere.
 */
export default function InvitationRow({ invitation, onAnswered }: InvitationRowProps) {
  const [pending, setPending] = useState<'accept' | 'decline' | null>(null);
  const [failed, setFailed] = useState(false);

  const answer = async (action: 'accept' | 'decline') => {
    setPending(action);
    setFailed(false);
    try {
      const response = await apiFetch(`/api/invitations/${invitation.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error('Invitation not answered');
      onAnswered();
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  };

  return (
    // Join and Decline move below the name when the card is too narrow for both on one line.
    <Box component="li" sx={{ ...homeRowSx, flexWrap: 'wrap' }}>
      <Box
        aria-hidden
        sx={{
          width: 36,
          height: 36,
          flex: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: `${RADIUS.md - 1}px`,
          bgcolor: 'tint.brand',
          color: 'primary.main',
        }}
      >
        <PersonAddAltOutlinedIcon sx={{ fontSize: 18 }} />
      </Box>
      <Box sx={{ flex: '1 1 180px', minWidth: 0 }}>
        <Typography noWrap sx={{ fontWeight: 600, color: 'text.primary' }}>
          {invitation.groupName}
        </Typography>
        <Typography noWrap component="p" variant="caption" sx={{ color: 'text.secondary' }}>
          {invitationDetail(invitation)}
        </Typography>
        {failed ? (
          <Typography role="alert" variant="caption" sx={{ color: 'status.negative' }}>
            The invitation wasn’t answered. Try again.
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flex: 'none', ml: 'auto' }}>
        <Button
          variant="text"
          disabled={pending !== null}
          onClick={() => void answer('accept')}
          aria-label={`Join ${invitation.groupName}`}
        >
          {pending === 'accept' ? <CircularProgress size={16} aria-label="Joining" /> : 'Join'}
        </Button>
        <Button
          variant="text"
          color="inherit"
          disabled={pending !== null}
          onClick={() => void answer('decline')}
          aria-label={`Decline ${invitation.groupName}`}
          sx={{ color: 'text.secondary' }}
        >
          {pending === 'decline' ? (
            <CircularProgress size={16} aria-label="Declining" />
          ) : (
            'Decline'
          )}
        </Button>
      </Box>
    </Box>
  );
}
