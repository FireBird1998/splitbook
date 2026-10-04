'use client';

import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
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
import { formatCurrency, getCurrency, getCurrencyPrecision } from '@splitbook/shared/currency';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import { apiFetch } from '@/lib/utils/api-fetch';
import { useSettlementAttempts } from '@/lib/hooks/use-settlement-attempts';
import {
  browserAttemptStorage,
  recordSettlement,
  removeSettlementAttempt,
  type NamedSettlementPayment,
} from '@/lib/settlement-attempts';

const UNCONFIRMED =
  'This payment may already be recorded. Saving sends the same record again, so it can’t be counted twice.';
const GONE =
  'That payment was confirmed or discarded in another tab. Check Settlement history before recording another.';
const NOT_STORED =
  'Nothing was sent: this browser couldn’t keep a copy of the payment to retry it safely. Allow this site to store data, then save again.';

interface SettleUpDialogProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  group: Record<string, unknown>;
  /** The account the page was rendered for; it owns the payments stored in this browser. */
  accountId: string;
  /** Person who paid (debtor). */
  fromUser?: { _id: string; name: string };
  /** Person who received (creditor). */
  toUser?: { _id: string; name: string };
  defaultAmount?: number;
  /**
   * `record` opens a suggested payment; `check` opens a stored one that may
   * already be recorded. Either shows the stored payment for the pair, if any.
   */
  purpose?: 'record' | 'check';
  onSettled: () => void;
  /** A stored payment was discarded on purpose. */
  onDiscarded?: () => void;
}

/**
 * Records a Settlement. A payment is stored in this browser before its first
 * send (see `@/lib/settlement-attempts`), so a lost reply never leads to a
 * second record: while it is stored, this dialog shows it read-only for its
 * pair of members, Save resends it unchanged, and Discard waits until the
 * member has been told to check the Group's payments.
 */
export default function SettleUpDialog({
  open,
  onClose,
  groupId,
  group,
  accountId,
  fromUser,
  toUser,
  defaultAmount,
  purpose = 'record',
  onSettled,
  onDiscarded,
}: SettleUpDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [amount, setAmount] = useState(defaultAmount?.toString() || '');
  const [note, setNote] = useState('');
  /** A save found another payment for the pair stored first. */
  const [earlierFirst, setEarlierFirst] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** The key of the payment this opening of the dialog stored, which is no "earlier" payment. */
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  /** This dialog is saving or discarding, so a stored payment it removes is not news. */
  const acting = useRef(false);
  const shownKey = useRef<string | null>(null);

  const defaultCurrency = group.defaultCurrency as string;
  const defaultCurrencyDetails = getCurrency(defaultCurrency);
  const attempts = useSettlementAttempts(accountId, groupId);
  const stored =
    fromUser && toUser
      ? (attempts.find(
          (attempt) =>
            [attempt.paidBy, attempt.paidTo].sort().join() ===
            [fromUser._id, toUser._id].sort().join(),
        ) ?? null)
      : null;

  useEffect(() => {
    if (open) {
      setAmount(defaultAmount?.toString() || '');
      setNote('');
      setError('');
      setNotice('');
      setEarlierFirst(false);
      setConfirmDiscard(false);
      setCreatedKey(null);
    }
  }, [open, defaultAmount]);

  // A stored payment that disappears while it is shown was settled in another tab.
  useEffect(() => {
    if (!open) {
      shownKey.current = null;
      return;
    }
    if (stored) {
      shownKey.current = stored.key;
    } else if (shownKey.current) {
      shownKey.current = null;
      if (!acting.current) {
        setNotice(GONE);
        setError('');
        setConfirmDiscard(false);
      }
    }
  }, [open, stored]);

  const handleSubmit = async () => {
    if (!fromUser?._id || !toUser?._id) {
      setError('Missing settlement parties.');
      return;
    }
    setLoading(true);
    acting.current = true;
    setError('');
    setNotice('');

    try {
      let payment: NamedSettlementPayment | undefined;
      if (!stored) {
        const minor = parseAmountMinor(amount, defaultCurrency);
        if (minor <= 0) throw new Error('Please enter a positive amount.');
        payment = {
          paidBy: fromUser._id,
          paidTo: toUser._id,
          amount: toMajorAmount(minor, defaultCurrency),
          currency: defaultCurrency,
          note,
          paidByName: fromUser.name,
          paidToName: toUser.name,
        };
      }
      const result = await recordSettlement({
        storage: browserAttemptStorage(),
        accountId,
        groupId,
        resend: stored,
        payment,
        newKey: () => {
          const key = crypto.randomUUID();
          setCreatedKey(key);
          return key;
        },
        post: (key, body) =>
          apiFetch(`/api/groups/${groupId}/settlements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body,
          }),
      });
      // Removed by this save: not a payment settled elsewhere.
      if (result.status === 'recorded' || result.status === 'rejected') shownKey.current = null;

      switch (result.status) {
        case 'recorded':
          onSettled();
          onClose();
          setAmount('');
          setNote('');
          return;
        case 'earlier':
          setEarlierFirst(true);
          return;
        case 'gone':
          setNotice(GONE);
          return;
        case 'not-stored':
          setError(NOT_STORED);
          return;
        default:
          setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      acting.current = false;
      setLoading(false);
    }
  };

  const handleDiscard = () => {
    const storage = browserAttemptStorage();
    if (!stored || !storage) return;
    acting.current = true;
    shownKey.current = null;
    try {
      removeSettlementAttempt(storage, stored);
    } finally {
      acting.current = false;
    }
    onDiscarded?.();
    onClose();
  };

  // A first send in flight is not in doubt yet; once it fails, the warning shows.
  const inDoubt = stored !== null && !(loading && stored.key === createdKey);
  // Another payment for this pair was stored before: it has to be settled first.
  const earlier =
    stored !== null && stored.key !== createdKey && (purpose === 'record' || earlierFirst);
  const payer = stored?.paidByName ?? fromUser?.name ?? 'Someone';
  const payee = stored?.paidToName ?? toUser?.name ?? 'someone';
  const currency = stored?.currency ?? defaultCurrency;

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

          {inDoubt && (
            <Alert severity="warning" role="status">
              <AlertTitle>Payment not confirmed</AlertTitle>
              {UNCONFIRMED}
              {earlier && (
                <Box component="span" sx={{ display: 'block', mt: 1 }}>
                  This earlier payment between {payer} and {payee} isn’t confirmed yet, so it comes
                  first. Save it again, or discard it, before recording another payment between
                  them.
                </Box>
              )}
            </Alert>
          )}

          {!stored && notice && (
            <Alert severity="info" role="status">
              {notice}
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary">
            <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {payer}
            </Box>
            {' pays '}
            <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {payee}
            </Box>
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <TextField
              label="Amount"
              value={stored ? String(stored.amount) : amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              size="small"
              required
              autoFocus
              slotProps={{
                htmlInput: {
                  readOnly: stored !== null,
                  min: 10 ** -getCurrencyPrecision(currency),
                  step: 10 ** -getCurrencyPrecision(currency),
                },
              }}
            />
            <TextField
              select
              label="Currency"
              value={currency}
              size="small"
              disabled
              helperText="Group default"
            >
              <MenuItem value={currency}>
                {(getCurrency(currency) ?? defaultCurrencyDetails)?.flag} {currency}
              </MenuItem>
            </TextField>
          </Box>

          <TextField
            label="Note (optional)"
            value={stored ? stored.note : note}
            onChange={(e) => setNote(e.target.value)}
            fullWidth
            size="small"
            placeholder="e.g. Paid via UPI"
            slotProps={{ htmlInput: { readOnly: stored !== null } }}
          />

          {inDoubt && confirmDiscard && (
            <Alert severity="error" role="status">
              <AlertTitle>Check the Group’s payments first</AlertTitle>
              If Settlement history shows {payer} paying {payee}{' '}
              {formatCurrency(stored.amount, stored.currency)}, this payment was recorded: keep it.
              Discarding only forgets this browser’s copy. It never removes a recorded payment, and
              the next payment between them is sent as a new one.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions
        sx={{
          p: 2,
          pb: { xs: 'calc(16px + env(safe-area-inset-bottom, 0px))', sm: 2 },
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        {inDoubt && confirmDiscard ? (
          <>
            <Button onClick={() => setConfirmDiscard(false)} color="inherit">
              Keep payment
            </Button>
            <Button onClick={handleDiscard} variant="contained" color="error">
              Discard payment
            </Button>
          </>
        ) : (
          <>
            {inDoubt && (
              <Button
                onClick={() => setConfirmDiscard(true)}
                color="error"
                disabled={loading}
                sx={{ mr: 'auto' }}
              >
                Discard this payment
              </Button>
            )}
            <Button onClick={onClose} color="inherit">
              Cancel
            </Button>
            <Button onClick={handleSubmit} variant="contained" disabled={loading}>
              {loading ? <CircularProgress size={20} /> : 'Save settlement'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
