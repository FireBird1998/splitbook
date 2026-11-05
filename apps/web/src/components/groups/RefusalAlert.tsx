'use client';

import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import type { SxProps, Theme } from '@mui/material/styles';
import { groupTabHref } from './group-tabs';

/** Why the server refused a membership change, in its words, with its code when it sent one. */
export interface Refusal {
  message: string;
  code?: string;
}

/** The API's `{ error, code }`, or `fallback` when it says nothing readable. */
export function refusalFrom(body: unknown, fallback: string): Refusal {
  const { error, code } = (typeof body === 'object' && body !== null ? body : {}) as {
    error?: unknown;
    code?: unknown;
  };
  return {
    message: typeof error === 'string' && error ? error : fallback,
    ...(typeof code === 'string' ? { code } : {}),
  };
}

/**
 * Why a member can't leave the Group, or be removed from it, yet, on the page until it's
 * dismissed (with `onClose`): a sentence can be long, so it never times out. An open balance
 * offers Balances, where it shows (#875).
 */
export default function RefusalAlert({
  groupId,
  refusal,
  onClose,
  sx,
}: {
  groupId: string;
  refusal: Refusal;
  onClose?: () => void;
  sx?: SxProps<Theme>;
}) {
  const balances = refusal.code === 'OPEN_BALANCE' && (
    <Button component={Link} href={groupTabHref(groupId, 'balances')} size="small">
      Go to Balances
    </Button>
  );
  // MUI drops its own close button once there is an action, so it keeps one beside it.
  const close = onClose && (
    <IconButton aria-label="Close" color="inherit" size="small" onClick={onClose}>
      <CloseIcon fontSize="small" />
    </IconButton>
  );
  return (
    <Alert
      severity="warning"
      sx={sx}
      action={
        balances || close ? (
          <>
            {balances}
            {close}
          </>
        ) : undefined
      }
    >
      {refusal.message}
    </Alert>
  );
}
