'use client';

import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import { getCurrency, getCurrencyPrecision } from '@splitbook/shared/currency';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';

interface SettleUpDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  group: Record<string, unknown>;
  /** Person who paid (debtor). */
  fromUser?: { _id: string; name: string };
  /** Person who received (creditor). */
  toUser?: { _id: string; name: string };
  defaultAmount?: number;
  onSettled: () => void;
}

export default function SettleUpDialog({
  open,
  onClose,
  groupId,
  group,
  fromUser,
  toUser,
  defaultAmount,
  onSettled,
}: SettleUpDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState(defaultAmount?.toString() || '');
  const [note, setNote] = useState('');
  const submission = useRef<{ payload: string; key: string } | null>(null);

  const defaultCurrency = group.defaultCurrency as string;
  const defaultCurrencyDetails = getCurrency(defaultCurrency);

  useEffect(() => {
    if (open) {
      setAmount(defaultAmount?.toString() || '');
      setNote('');
      setError('');
      submission.current = null;
    }
  }, [open, defaultAmount]);

  const handleSubmit = async () => {
    if (!fromUser?._id || !toUser?._id) {
      setError('Missing settlement parties.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const minor = parseAmountMinor(amount, defaultCurrency);
      if (minor <= 0) throw new Error('Please enter a positive amount.');
      const payload = JSON.stringify({
        paidBy: fromUser._id,
        paidTo: toUser._id,
        amount: toMajorAmount(minor, defaultCurrency),
        currency: defaultCurrency,
        note,
      });
      if (submission.current?.payload !== payload)
        submission.current = { payload, key: crypto.randomUUID() };
      const res = await fetch(`/api/groups/${groupId}/settlements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submission.current.key },
        body: payload,
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to record settlement');
        return;
      }

      onSettled();
      onClose();
      setAmount('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Record settlement</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && (
            <Box
              role="alert"
              sx={{
                bgcolor: (theme) => `${theme.palette.error.main}12`,
                color: 'error.main',
                px: 1.5,
                py: 1,
                borderRadius: 2,
                fontSize: '0.875rem',
              }}
            >
              {error}
            </Box>
          )}

          <Typography variant="body2" color="text.secondary">
            <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {fromUser?.name || 'Someone'}
            </Box>
            {' pays '}
            <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {toUser?.name || 'someone'}
            </Box>
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField
              label="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              size="small"
              required
              autoFocus
              slotProps={{
                htmlInput: {
                  min: 10 ** -getCurrencyPrecision(defaultCurrency),
                  step: 10 ** -getCurrencyPrecision(defaultCurrency),
                },
              }}
            />
            <TextField
              select
              label="Currency"
              value={defaultCurrency}
              size="small"
              disabled
              helperText="Group default"
            >
              <MenuItem value={defaultCurrency}>
                {defaultCurrencyDetails?.flag} {defaultCurrency}
              </MenuItem>
            </TextField>
          </Box>

          <TextField
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            fullWidth
            size="small"
            placeholder="e.g. Paid via UPI"
          />
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{
          p: 2,
          pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 2 },
        }}
      >
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading ? <CircularProgress size={20} /> : 'Save settlement'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
