'use client';

import { useId } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';

/** The member changes that ask first. */
export type MemberConfirmation = 'remove' | 'step-down';

/** Names in a sentence: "Sam Chen", "Priya Shah and Sam Chen", "Meera Iyer, Priya Shah and Sam Chen". */
const andList = (names: string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * Removing a member, and an admin stepping down to member on their own row, ask first (#1251):
 * Remove names the member and the Group, and Step down names who stays an admin. A role change on
 * another member applies at once, without one.
 */
export default function MemberConfirmDialog({
  confirming,
  memberName,
  groupName,
  staying,
  busy,
  onCancel,
  onConfirm,
}: {
  confirming: MemberConfirmation;
  /** The member being removed. */
  memberName: string;
  groupName: string;
  /** The other admins, who stay admins after stepping down. */
  staying: string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const remove = confirming === 'remove';
  const paragraphs = remove
    ? [
        `${memberName.split(' ')[0]} won’t see this Group or its balances any more. The Expenses and payments they’re part of stay for everyone else.`,
        'They can rejoin with an invite.',
      ]
    : [
        `You’ll stay in ${groupName} and keep adding Expenses. You won’t be able to change Group settings, Tags or members.`,
        // Empty only if the other admin's role changed while this was open: the server decides.
        staying.length > 1
          ? `${andList(staying)} stay admins.`
          : staying.length === 1
            ? `${staying[0]} stays an admin.`
            : '',
      ].filter(Boolean);
  return (
    <Dialog
      open
      onClose={busy ? undefined : onCancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
    >
      <DialogTitle id={`${id}-title`}>
        {remove ? `Remove ${memberName} from ${groupName}?` : 'Step down to member?'}
      </DialogTitle>
      <DialogContent id={`${id}-text`}>
        {paragraphs.map((text, index) => (
          <Typography
            key={text}
            variant="body2"
            color="text.primary"
            sx={{ mt: index > 0 ? 1.5 : 0 }}
          >
            {text}
          </Typography>
        ))}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onCancel} color="inherit" disabled={busy}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color={remove ? 'error' : 'primary'}
          disabled={busy}
        >
          {remove ? 'Remove from Group' : 'Step down'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
