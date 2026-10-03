'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import { apiFetch } from '@/lib/utils/api-fetch';

interface InvitationCardProps {
  invitation: Record<string, unknown>;
  onAction: () => void;
}

export default function InvitationCard({ invitation, onAction }: InvitationCardProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const group = invitation.group as Record<string, unknown>;
  const invitedBy = invitation.invitedBy as Record<string, unknown>;

  const handleAction = async (action: 'accept' | 'decline') => {
    setLoading(action);
    try {
      await apiFetch(`/api/invitations/${invitation._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      onAction();
    } catch {
      console.error('Failed to process invitation');
    } finally {
      setLoading(null);
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
      }}
    >
      <Box>
        <Typography variant="body2" fontWeight={500} color="text.primary">
          You&apos;ve been invited to <strong>{group?.name as string}</strong>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Invited by {invitedBy?.name as string}
        </Typography>
      </Box>
      <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
        <Button
          size="small"
          variant="contained"
          disabled={!!loading}
          onClick={() => handleAction('accept')}
        >
          {loading === 'accept' ? <CircularProgress size={16} /> : 'Accept'}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={!!loading}
          onClick={() => handleAction('decline')}
          color="inherit"
        >
          {loading === 'decline' ? <CircularProgress size={16} /> : 'Decline'}
        </Button>
      </Stack>
    </Paper>
  );
}
