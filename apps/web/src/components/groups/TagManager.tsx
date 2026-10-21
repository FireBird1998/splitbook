'use client';

import Paper from '@mui/material/Paper';
import { ShortcutOverlay } from '@/lib/shortcuts/ShortcutOverlay';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { tagArchiveExplanation, type TagIntent } from '@splitbook/shared/tag-management';
import { type TagActionScope } from '@/lib/tag-actions';
import { useTagManager } from './use-tag-manager';

const actionName: Record<TagIntent['action'], string> = {
  create: 'Create',
  rename: 'Rename',
  archive: 'Archive',
  restore: 'Restore',
  delete: 'Delete',
};

export default function TagManager(scope: TagActionScope) {
  return <TagManagerContent key={`${scope.accountId}:${scope.groupId}`} {...scope} />;
}

function TagManagerContent(scope: TagActionScope) {
  const manager = useTagManager(scope);
  const {
    open,
    snapshot,
    editor,
    pending,
    receipt,
    busy,
    message,
    show,
    submit,
    setEditor,
    beginEdit,
  } = manager;
  const saved = snapshot?.tags.find((tag) => tag.id === receipt?.receipt.tagId);
  const reviewed =
    editor && 'tagId' in editor ? snapshot?.tags.find((tag) => tag.id === editor.tagId) : null;
  const tags = snapshot?.tags.filter((tag) => !tag.isDeleted) ?? [];
  const activeCount = tags.filter((tag) => !tag.isArchived).length;
  const retiringLast =
    editor &&
    (editor.action === 'archive' || editor.action === 'delete') &&
    reviewed &&
    !reviewed.isArchived &&
    activeCount <= 1;
  const duplicate =
    manager.duplicate && editor && 'name' in editor
      ? tags.find(
          (tag) =>
            tag.isArchived && tag.name.trim().toLowerCase() === editor.name.trim().toLowerCase(),
        )
      : null;
  const disabled =
    busy ||
    pending.length > 0 ||
    !snapshot?.canManage ||
    !manager.verified ||
    !manager.storageReady ||
    !manager.online ||
    !!manager.discard ||
    manager.unavailable;
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography component="h2" variant="subtitle1" fontWeight={600}>
        Tags
      </Typography>
      <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
        Every Expense has one Tag. Archived Tags keep their history.
      </Typography>
      {!open ? (
        <Button disabled={manager.unavailable} onClick={show}>
          Manage Tags
        </Button>
      ) : (
        <Stack spacing={2} role="region" aria-label="Manage Tags">
          <Button
            autoFocus
            disabled={!!manager.discard}
            onClick={() => manager.requestClose('manager')}
            sx={{ alignSelf: 'flex-end' }}
          >
            Close Tags
          </Button>
          {manager.discard && (
            <ShortcutOverlay>
              <Stack role="alertdialog" aria-label="Discard this name?" spacing={1}>
                <Typography>Discard this name? Your unsubmitted text will be lost.</Typography>
                <Stack direction="row">
                  <Button autoFocus onClick={manager.keepEditing}>
                    Keep editing
                  </Button>
                  <Button onClick={manager.discardText}>Discard text</Button>
                </Stack>
              </Stack>
            </ShortcutOverlay>
          )}
          {message && <Typography role="status">{message}</Typography>}
          {!manager.online && (
            <Typography role="status">
              Connect to change Tags or check an earlier action.
            </Typography>
          )}
          {!manager.verified && !busy && !manager.unavailable && (
            <Button disabled={!!manager.discard} onClick={show}>
              Refresh Tags
            </Button>
          )}
          {busy && <Typography role="status">Checking Tags…</Typography>}
          {snapshot && !snapshot.canManage && (
            <Typography>
              Only admins can change Tags. You can still read this Group and check an earlier
              action.
            </Typography>
          )}
          {receipt && (
            <Stack role="status" spacing={0.5}>
              <Typography
                fontWeight={600}
              >{`${actionName[receipt.receipt.intent.action]} confirmed`}</Typography>
              {'name' in receipt.receipt.intent && (
                <Typography>{`Submitted name: ${receipt.receipt.intent.name}`}</Typography>
              )}
              <Typography>{`Current Tag: ${!saved || saved.isDeleted ? 'Deleted' : saved.name}${saved?.isArchived && !saved.isDeleted ? ' (archived)' : ''}`}</Typography>
              <Typography variant="caption">
                This confirms your earlier action. The current Tag may include later changes.
              </Typography>
            </Stack>
          )}
          {pending.map((attempt) => (
            <Stack
              key={attempt.command.requestId}
              spacing={1}
              sx={{ p: 2, border: 1, borderColor: 'warning.main', borderRadius: 2 }}
            >
              <Typography fontWeight={600}>Unconfirmed Tag action</Typography>
              <Typography>{`${actionName[attempt.command.intent.action]}${'name' in attempt.command.intent ? `: ${attempt.command.intent.name}` : ''}`}</Typography>
              <Typography variant="body2">
                Closing this manager keeps the original action for recovery. Check only reads its
                result; Retry sends that exact action.
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button
                  disabled={busy || !manager.online || manager.unavailable}
                  onClick={() => manager.check(attempt)}
                >
                  Check action
                </Button>
                <Button
                  disabled={
                    busy ||
                    !snapshot?.canManage ||
                    !manager.online ||
                    !manager.verified ||
                    manager.unavailable
                  }
                  onClick={() => manager.retry(attempt)}
                >
                  Retry original action
                </Button>
              </Stack>
            </Stack>
          ))}
          {snapshot && activeCount === 0 && (
            <Typography>No active Tags. Create or restore one before adding an Expense.</Typography>
          )}
          {(['active', 'archived'] as const).map((state) => (
            <Stack key={state} spacing={1}>
              <Typography component="h3" variant="subtitle2">
                {state === 'active' ? 'Active Tags' : 'Archived Tags'}
              </Typography>
              {tags
                .filter((tag) => tag.isArchived === (state === 'archived'))
                .map((tag) => (
                  <Stack
                    key={tag.id}
                    spacing={0.5}
                    sx={{ p: 1.5, bgcolor: 'surface.muted', borderRadius: 2 }}
                  >
                    <Typography fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>
                      {tag.name}
                    </Typography>
                    <Stack direction="row" flexWrap="wrap">
                      <Button
                        disabled={disabled || !!editor}
                        aria-label={`Rename ${tag.name}`}
                        onClick={() =>
                          beginEdit({
                            action: 'rename',
                            tagId: tag.id,
                            expectedRevision: tag.revision,
                            name: tag.name,
                          })
                        }
                      >
                        Rename
                      </Button>
                      <Button
                        disabled={disabled || !!editor || (!tag.isArchived && activeCount <= 1)}
                        aria-label={`${tag.isArchived ? 'Restore' : 'Archive'} ${tag.name}`}
                        onClick={() =>
                          beginEdit({
                            action: tag.isArchived ? 'restore' : 'archive',
                            tagId: tag.id,
                            expectedRevision: tag.revision,
                          })
                        }
                      >
                        {tag.isArchived ? 'Restore' : 'Archive'}
                      </Button>
                      <Button
                        disabled={disabled || !!editor || (!tag.isArchived && activeCount <= 1)}
                        aria-label={`Delete ${tag.name}`}
                        color="error"
                        sx={{ color: 'status.negative' }}
                        onClick={() =>
                          beginEdit({
                            action: 'delete',
                            tagId: tag.id,
                            expectedRevision: tag.revision,
                          })
                        }
                      >
                        Delete
                      </Button>
                    </Stack>
                    {!tag.isArchived && activeCount <= 1 && (
                      <Typography variant="caption">
                        Keep at least one active Tag. Create or restore another before archiving or
                        deleting this one.
                      </Typography>
                    )}
                  </Stack>
                ))}
            </Stack>
          ))}
          {editor ? (
            <Stack spacing={1.5} role="group" aria-label={`${actionName[editor.action]} Tag`}>
              <Typography
                component="h3"
                variant="subtitle2"
              >{`${actionName[editor.action]} Tag`}</Typography>
              {reviewed && <Typography>{`Tag: ${reviewed.name}`}</Typography>}
              {'name' in editor && (
                <TextField
                  label="Tag name"
                  value={editor.name}
                  disabled={disabled}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  slotProps={{ htmlInput: { maxLength: 50 } }}
                />
              )}
              {editor.action === 'archive' && <Typography>{tagArchiveExplanation}</Typography>}
              {editor.action === 'delete' && (
                <Typography>
                  Delete only an unused Tag. Tags referenced by Expenses or recurring templates must
                  be archived instead.
                </Typography>
              )}
              {editor.action === 'restore' && (
                <Typography>{`Restore ${reviewed?.name ?? 'this Tag'} with its existing identity and history.`}</Typography>
              )}
              {manager.conflict && (
                <>
                  <Typography>{`Current Tag: ${!reviewed || reviewed.isDeleted ? 'Deleted' : reviewed.name}${reviewed?.isArchived ? ' (archived)' : ''}`}</Typography>
                  <Button
                    disabled={disabled || !reviewed || reviewed.isDeleted}
                    onClick={manager.review}
                  >
                    Review current Tag
                  </Button>
                </>
              )}
              {duplicate && (
                <Button
                  disabled={disabled}
                  onClick={() =>
                    beginEdit({
                      action: 'restore',
                      tagId: duplicate.id,
                      expectedRevision: duplicate.revision,
                    })
                  }
                >{`Restore existing ${duplicate.name}`}</Button>
              )}
              <Stack direction="row" spacing={1}>
                <Button
                  disabled={busy || pending.length > 0 || !!manager.discard}
                  onClick={() => manager.requestClose('editor')}
                >
                  Cancel edit
                </Button>
                <Button
                  variant="contained"
                  disabled={
                    disabled ||
                    !!retiringLast ||
                    manager.conflict ||
                    ('name' in editor && !editor.name.trim())
                  }
                  onClick={submit}
                >
                  {editor.action === 'archive'
                    ? 'Confirm archive'
                    : editor.action === 'delete'
                      ? 'Confirm delete'
                      : 'Apply change'}
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Button disabled={disabled} onClick={() => beginEdit({ action: 'create', name: '' })}>
              Create Tag
            </Button>
          )}
        </Stack>
      )}
    </Paper>
  );
}
