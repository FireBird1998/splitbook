'use client';
import { useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { draftFields, type DraftContext } from '@splitbook/shared/persistent-draft-editor';
import type { PersistedExpenseDraft } from '@splitbook/shared/validators/expense-draft';
import type { ReviewItemModel } from '@splitbook/shared/to-review';
import type { ToReviewItem } from '@splitbook/shared/to-review-read';
import { RADIUS } from '@/lib/theme/tokens';
import { useReviewEditor } from './use-review-editor';
import { ReviewMatches, reviewSource } from './ReviewDetails';
import { reviewProblem, type WebReviewClient } from './review-client';

export default function ToReviewPanel({
  item,
  items,
  context,
  names,
  groupName,
  client,
  refresh,
  available,
  savingBlocked,
  run,
  onClose,
  onNext,
  onSave,
  onDelete,
}: {
  item: ReviewItemModel;
  items: ToReviewItem[];
  context: DraftContext;
  names: Readonly<Record<string, string>>;
  groupName: string;
  client: WebReviewClient;
  refresh: () => Promise<void>;
  available: boolean;
  savingBlocked: boolean;
  run?: string;
  onClose: () => void;
  onNext?: () => void;
  onSave: (draft: PersistedExpenseDraft, acknowledged: boolean) => Promise<void>;
  onDelete: (draft: PersistedExpenseDraft) => Promise<void>;
}) {
  const surface = useRef<HTMLElement>(null);
  useEffect(() => {
    surface.current?.focus({ preventScroll: true });
    surface.current?.scrollIntoView({ block: 'start' });
  }, []);
  const editor = useReviewEditor(item.accountItem!.draft, client, refresh, names);
  const [acknowledgedVersion, setAcknowledgedVersion] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const duplicateVersion = JSON.stringify([
    editor.draft.revision,
    item.accountItem!.duplicates.map((match) => `${match.kind}:${match.id}`).sort(),
  ]);
  const acknowledged = acknowledgedVersion === duplicateVersion;
  const incomplete = item.missingFacts.length > 0 || item.accountItem!.problems.length > 0;
  const duplicate = item.accountItem!.duplicates.length > 0;
  const unsent = editor.status !== 'kept';
  const reason = !available
    ? 'Connect to the internet to change or save this item.'
    : savingBlocked
      ? 'Check the earlier save before saving another item.'
      : unsent
        ? 'Keep your changes before saving.'
        : incomplete
          ? `Still needs ${item.missingFacts.join(', ') || 'the expense details'}.`
          : duplicate && !acknowledged
            ? 'Check the possible duplicate before saving.'
            : '';
  async function action(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (await editor.flush()) await work();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Box
      component="section"
      id="to-review-expense-panel"
      aria-label="Review expense"
      tabIndex={-1}
      ref={surface}
      sx={{
        minWidth: 0,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: `${RADIUS.lg}px`,
        p: 2.5,
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography component="h2" variant="h6">
            {run || 'Review expense'}
          </Typography>
          <IconButton
            aria-label="Close review"
            disabled={busy || (!available && unsent)}
            onClick={() => void action(async () => onClose())}
          >
            <CloseIcon />
          </IconButton>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {groupName} · {reviewSource(item.accountItem!)}
        </Typography>
        {editor.note && (
          <Alert severity="info" role="status">
            {editor.note}
          </Alert>
        )}
        {editor.error && (
          <Alert
            severity="warning"
            action={
              <Button disabled={busy || !available} onClick={() => void editor.flush()}>
                Try again
              </Button>
            }
          >
            {editor.error}
          </Alert>
        )}
        {!available && (
          <Alert severity="info">
            Items in your account are read-only until we can verify this Group online.
          </Alert>
        )}
        {item.accountItem!.draft.preparedBy.kind === 'assistant' &&
          item.missingFacts.map((fact) => (
            <Typography key={fact} variant="body2">
              {item.accountItem!.draft.preparedBy.kind === 'assistant'
                ? item.accountItem!.draft.preparedBy.name
                : ''}{' '}
              didn&apos;t know {fact}, so it left that to you.
            </Typography>
          ))}
        {draftFields(editor.entries, context).map((field) => (
          <TextField
            key={field.key}
            label={field.label}
            value={field.value ?? editor.entries[field.key] ?? ''}
            select={!!field.options}
            disabled={busy || !available}
            onChange={(event) => {
              setAcknowledgedVersion(null);
              editor.change(field.key, event.target.value);
            }}
            slotProps={{ htmlInput: { inputMode: field.numeric ? 'decimal' : 'text' } }}
          >
            {field.options && [
              <MenuItem key="empty" value="">
                Not specified
              </MenuItem>,
              ...field.options.map((option) => (
                <MenuItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </MenuItem>
              )),
            ]}
          </TextField>
        ))}
        <Typography role="status" variant="caption" color="text.secondary">
          {editor.status === 'kept'
            ? 'Changes kept in To review'
            : editor.status === 'failed'
              ? 'Changes not kept yet'
              : 'Keeping your changes…'}
        </Typography>
        {item.accountItem!.problems.map((problem, index) => (
          <Typography key={index} variant="body2" color="text.secondary">
            {reviewProblem(problem)}
          </Typography>
        ))}
        {duplicate && (
          <>
            <ReviewMatches item={item.accountItem!} items={items} names={names} />
            <FormControlLabel
              control={
                <Checkbox
                  checked={acknowledged}
                  disabled={busy || !available || unsent}
                  onChange={(_, checked) =>
                    setAcknowledgedVersion(checked ? duplicateVersion : null)
                  }
                />
              }
              label="It's a different expense, save it anyway"
            />
          </>
        )}
        {reason && (
          <Typography id="review-save-reason" variant="body2" color="text.secondary">
            {reason}
          </Typography>
        )}
        <Button
          variant="contained"
          disabled={busy || !!reason}
          aria-describedby={reason ? 'review-save-reason' : undefined}
          onClick={() => void action(async () => onSave(editor.latest(), acknowledged))}
        >
          Save expense
        </Button>
        {run && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button
              disabled={busy || (!available && unsent)}
              onClick={() => void action(async () => onNext?.())}
            >
              Next
            </Button>
            <Button
              disabled={busy || (!available && unsent)}
              onClick={() => void action(async () => onNext?.())}
            >
              Skip for now
            </Button>
          </Stack>
        )}
        <Button
          color="inherit"
          sx={{ color: 'status.negative' }}
          disabled={busy || !available || savingBlocked}
          onClick={() => void action(async () => setDeleting(true))}
        >
          Delete
        </Button>
      </Stack>
      <Dialog open={deleting} onClose={() => !busy && setDeleting(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this item?</DialogTitle>
        <DialogContent>
          It was never saved, so nothing in {groupName} changes. You can&apos;t undo this.
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setDeleting(false)}>
            Keep item
          </Button>
          <Button
            color="inherit"
            sx={{ color: 'status.negative' }}
            disabled={busy || !available}
            onClick={() =>
              void action(async () => {
                await onDelete(editor.latest());
                setDeleting(false);
              })
            }
          >
            Delete item
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
