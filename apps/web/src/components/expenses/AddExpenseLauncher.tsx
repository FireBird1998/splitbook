'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Portal from '@mui/material/Portal';
import Snackbar from '@mui/material/Snackbar';
import AddIcon from '@mui/icons-material/Add';
import type { GroupRead } from '@splitbook/shared/group-read';
import ErrorState from '@/components/common/ErrorState';
import { ShortcutHint, useShortcutAria } from '@/components/shortcuts/ShortcutHint';
import { isGroupReadDenied, useGroup } from '@/lib/hooks/use-groups';
import { useShortcut } from '@/lib/shortcuts/ShortcutsProvider';
import ExpenseFormDialog from './ExpenseFormDialog';
import GroupChooserDialog from './GroupChooserDialog';
import { addExpenseDefaultDate, addExpenseTarget, expenseAddedMessage } from './add-expense';

type Step =
  | { kind: 'closed' }
  | { kind: 'choose' }
  /** `chosen` is the chooser's copy of the Group, shown until the Group's own read answers. */
  | { kind: 'form'; groupId: string; chosen: GroupRead | null };

/**
 * Out of sight but still read, so the phone's icon button keeps its name. Sizes are strings:
 * in `sx` the number 1 would mean 100% and a margin of -1 one spacing unit.
 */
const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: '0',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: '0',
} as const;

/**
 * Add expense from anywhere (#304): the top bar's primary button. Inside a Group it opens the
 * Expense form for that Group; anywhere else it asks which Group first. The form is the
 * Group page's own, so a save is the same request with the same idempotency key, unconfirmed-
 * save handling and errors. After a save the member stays on the page, a confirmation names
 * the Group, and the form's refetch (plus the shell's, after any write) refreshes its figures.
 * N does the same from anywhere (#322), and the button shows the key while shortcuts are on.
 */
export default function AddExpenseLauncher({ userId }: { userId: string }) {
  const pathname = usePathname();
  const [step, setStep] = useState<Step>({ kind: 'closed' });
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const close = () => setStep({ kind: 'closed' });

  const open = () => {
    const target = addExpenseTarget(pathname);
    setStep(
      target.kind === 'group'
        ? { kind: 'form', groupId: target.groupId, chosen: null }
        : { kind: 'choose' },
    );
  };
  useShortcut('add-expense', open);
  const keyShortcuts = useShortcutAria('add-expense');

  return (
    <>
      <Button
        variant="contained"
        onClick={open}
        aria-haspopup="dialog"
        aria-keyshortcuts={keyShortcuts}
        sx={(theme) => ({
          flex: 'none',
          gap: 1,
          minWidth: 44,
          height: 44,
          px: 2,
          borderRadius: '12px',
          fontSize: '0.875rem',
          whiteSpace: 'nowrap',
          // Phones: a 44 px icon button, still named "Add expense".
          [theme.breakpoints.down('sm')]: { px: 0, gap: 0 },
        })}
      >
        <AddIcon />
        <Box component="span" sx={(theme) => ({ [theme.breakpoints.down('sm')]: visuallyHidden })}>
          Add expense
        </Box>
        <ShortcutHint id="add-expense" onButton />
      </Button>

      <GroupChooserDialog
        open={step.kind === 'choose'}
        onClose={close}
        userId={userId}
        onChoose={(group) => setStep({ kind: 'form', groupId: group._id, chosen: group })}
        onCreateGroup={close}
      />

      {step.kind === 'form' ? (
        <GroupExpenseForm
          key={step.groupId}
          userId={userId}
          groupId={step.groupId}
          chosen={step.chosen}
          onClose={close}
          onSaved={(group) => setConfirmation(expenseAddedMessage(group.name))}
        />
      ) : null}

      {/* In the page's own layer, so no fixed bar of the page can sit over it. */}
      <Portal>
        <Snackbar
          open={confirmation !== null}
          autoHideDuration={6000}
          onClose={(_, reason) => {
            if (reason !== 'clickaway') setConfirmation(null);
          }}
          message={confirmation}
        />
      </Portal>
    </>
  );
}

interface GroupExpenseFormProps {
  userId: string;
  groupId: string;
  chosen: GroupRead | null;
  onClose: () => void;
  onSaved: (group: GroupRead) => void;
}

/**
 * The Expense form for one Group, from the Group read the Group page uses (the same SWR key,
 * so on the Group's page it is already loaded). A Group the member can no longer read closes
 * the form, as the Group page closes its own.
 */
function GroupExpenseForm({ userId, groupId, chosen, onClose, onSaved }: GroupExpenseFormProps) {
  const read = useGroup(userId, groupId);
  // A refused read leaves no data, and the chooser's copy no longer counts either. An outage
  // keeps the form on the chooser's copy, so a draft already begun isn't lost; the save
  // itself is checked by the server.
  const group = read.data ?? (isGroupReadDenied(read.error) ? null : chosen);
  // Taken once, as the form opens: the Group page's own Add expense picks the same date.
  const [monthParam] = useState(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('month'),
  );

  if (group)
    return (
      <ExpenseFormDialog
        open
        onClose={onClose}
        groupId={groupId}
        group={group}
        userId={userId}
        defaultDate={addExpenseDefaultDate(group, monthParam)}
        showGroupName
        onSaved={() => onSaved(group)}
      />
    );

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add expense</DialogTitle>
      <DialogContent>
        {read.error ? (
          <ErrorState
            message="This Group could not be loaded."
            onRetry={() => void read.mutate()}
          />
        ) : (
          <Box
            role="status"
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, color: 'text.secondary' }}
          >
            <CircularProgress size={20} aria-hidden />
            Loading the Group…
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
