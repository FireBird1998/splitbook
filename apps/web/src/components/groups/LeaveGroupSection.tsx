'use client';

import { useState } from 'react';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import LogoutIcon from '@mui/icons-material/Logout';
import { apiFetch } from '@/lib/utils/api-fetch';
import { groupTabHref } from './group-tabs';

interface LeaveGroupSectionProps {
  groupId: string;
  groupName: string;
}

interface Refusal {
  message: string;
  code?: string;
}

/**
 * Lets any member leave the Group. The server decides whether they may:
 * they must be settled up, and the last admin must hand over first.
 */
export default function LeaveGroupSection({ groupId, groupName }: LeaveGroupSectionProps) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const close = () => {
    if (leaving) return;
    setOpen(false);
    setRefusal(null);
  };

  const leave = async () => {
    setLeaving(true);
    setRefusal(null);
    try {
      const res = await apiFetch(`/api/groups/${groupId}/leave`, { method: 'POST' });
      if (res.ok) {
        window.location.href = '/dashboard';
        return;
      }
      const body: unknown = await res.json().catch(() => null);
      const { error, code } = (body ?? {}) as { error?: unknown; code?: unknown };
      setRefusal({
        message:
          typeof error === 'string' && error ? error : 'Could not leave the Group. Try again.',
        code: typeof code === 'string' ? code : undefined,
      });
    } catch {
      setRefusal({ message: 'Could not leave the Group. Check your connection and try again.' });
    } finally {
      setLeaving(false);
    }
  };

  return (
    <>
      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
          Leave this Group
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          You can leave once you&apos;re settled up. Its Expenses and Activity stay for everyone
          else, and you can rejoin with an invite.
        </Typography>
        <Button
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={() => setOpen(true)}
        >
          Leave Group
        </Button>
      </Paper>

      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle>Leave &ldquo;{groupName}&rdquo;?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.primary">
            You won&apos;t see this Group or its balances any more. If you&apos;re the last member,
            the Group is archived.
          </Typography>
          {refusal && (
            <Alert
              severity="warning"
              sx={{ mt: 2 }}
              action={
                refusal.code === 'OPEN_BALANCE' ? (
                  <Button component={Link} href={groupTabHref(groupId, 'balances')} size="small">
                    Go to Balances
                  </Button>
                ) : undefined
              }
            >
              {refusal.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={close} color="inherit" disabled={leaving}>
            Cancel
          </Button>
          <Button onClick={leave} variant="contained" color="error" disabled={leaving}>
            {leaving ? <CircularProgress size={20} /> : 'Leave Group'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
