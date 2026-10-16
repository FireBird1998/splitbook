'use client';
import ReviewExpenseFields from './ReviewExpenseFields';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
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
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { type DraftContext } from '@splitbook/shared/persistent-draft-editor';
import type { PersistedExpenseDraft } from '@splitbook/shared/validators/expense-draft';
import { memberProblems, type ReviewItemModel } from '@splitbook/shared/to-review';
import type { ToReviewItem } from '@splitbook/shared/to-review-read';
import { RADIUS } from '@/lib/theme/tokens';
import { useReviewEditor } from './use-review-editor';
import { ReviewMatches, reviewSource } from './ReviewDetails';
import type { WebReviewClient } from './review-client';

export type ReviewPanelHandle = { flush: () => Promise<boolean>; focus: () => void };

export default function ToReviewPanel({
  ref,
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
  ref?: Ref<ReviewPanelHandle>;
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
  useImperativeHandle(ref, () => ({
    flush: () => (inFlight.current ? Promise.resolve(false) : editor.flush()),
    focus: () => surface.current?.focus(),
  }));
  const blocked = busy || savingBlocked;
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
            disabled={blocked || (!available && unsent)}
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
              <Button disabled={blocked || !available} onClick={() => void editor.flush()}>
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
        <Box
          component="fieldset"
          disabled={blocked || !available}
          inert={blocked || !available}
          sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}
        >
          <ReviewExpenseFields
            entries={editor.entries}
            context={context}
            onChange={(changes) => {
              setAcknowledgedVersion(null);
              editor.change(changes);
            }}
          />
        </Box>
        <Typography role="status" variant="caption" color="text.secondary">
          {editor.status === 'kept'
            ? 'Changes kept in To review'
            : editor.status === 'failed'
              ? 'Changes not kept yet'
              : 'Keeping your changes…'}
        </Typography>
        {/* A fact the Needs line names isn't said again; any other problem is said once (#441). */}
        {memberProblems(item, names, editor.draft.values).map((problem) => (
          <Typography key={problem} variant="body2" color="text.secondary">
            {problem}
          </Typography>
        ))}
        {duplicate && (
          <>
            <ReviewMatches item={item.accountItem!} items={items} names={names} />
            <FormControlLabel
              control={
                <Checkbox
                  checked={acknowledged}
                  disabled={blocked || !available || unsent}
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
          disabled={blocked || !!reason}
          aria-describedby={reason ? 'review-save-reason' : undefined}
          onClick={() => void action(async () => onSave(editor.latest(), acknowledged))}
        >
          Save expense
        </Button>
        {run && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button
              disabled={blocked || (!available && unsent)}
              onClick={() => void action(async () => onNext?.())}
            >
              Next
            </Button>
            <Button
              disabled={blocked || (!available && unsent)}
              onClick={() => void action(async () => onNext?.())}
            >
              Skip for now
            </Button>
          </Stack>
        )}
        <Button
          color="inherit"
          sx={{ color: 'status.negative' }}
          disabled={blocked || !available}
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
          <Button disabled={blocked} onClick={() => setDeleting(false)}>
            Keep item
          </Button>
          <Button
            color="inherit"
            sx={{ color: 'status.negative' }}
            disabled={blocked || !available}
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
