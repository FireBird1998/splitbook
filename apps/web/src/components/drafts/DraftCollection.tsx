'use client';
import { expenseDraftsKey } from '@splitbook/shared/query-keys';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { formatCurrency } from '@splitbook/shared/currency';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useGroup } from '@/lib/hooks/use-groups';
import { apiFetch } from '@/lib/utils/api-fetch';
import { draftCollectionClient } from '@splitbook/shared/draft-collection-client';
import {
  draftEntries,
  draftEntryChanges,
  draftFields,
  draftValues,
  type DraftEntries,
} from '@splitbook/shared/persistent-draft-editor';
import type {
  DraftReview,
  DraftSaveOutcome,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import useSWR, { useSWRConfig } from 'swr';

export default function DraftCollection({
  groupId,
  accountId,
}: {
  groupId: string;
  accountId: string;
}) {
  const { data: group, error: groupError } = useGroup(accountId, groupId);
  const { mutate } = useSWRConfig();
  const [selected, setSelected] = useState<string[]>([]);
  const [reviews, setReviews] = useState<DraftReview[]>([]);
  const [ack, setAck] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<DraftSaveOutcome[]>([]);
  const [outcomeNames, setOutcomeNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<PersistedExpenseDraft | 'new' | null>(null);
  const [entries, setEntries] = useState<DraftEntries>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const client = useMemo(() => {
    const key = `splitbook.draft-request:${accountId}:${groupId}`;
    return draftCollectionClient(
      groupId,
      async (path, init) => {
        const response = await apiFetch(path, {
          ...init,
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-Expected-Account': accountId,
            ...init?.headers,
          },
        });
        const value = await response.json();
        if (!response.ok)
          throw Object.assign(new Error(value.error || 'Could not complete Draft request'), {
            status: response.status,
          });
        return value;
      },
      {
        load: async () => sessionStorage.getItem(key),
        save: async (value) => {
          sessionStorage.setItem(key, value);
        },
        clear: async () => {
          sessionStorage.removeItem(key);
        },
      },
      () => crypto.randomUUID(),
    );
  }, [accountId, groupId]);
  const {
    data: rows = [],
    error: collectionError,
    mutate: reloadDrafts,
  } = useSWR(expenseDraftsKey({ ...WEB_QUERY_ACCOUNT, accountId }, groupId), () => client.list());
  async function reload() {
    await reloadDrafts();
    setPending(!!(await client.pending()));
  }
  useEffect(() => {
    let active = true;
    client
      .pending()
      .then((value) => {
        if (active) setPending(!!value);
      })
      .catch(() => {
        if (active) setError('Could not read your pending request. Reload before making changes.');
      });
    return () => {
      active = false;
    };
  }, [client]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Request not confirmed. Reload before retrying.',
      );
    } finally {
      setPending(!!(await client.pending().catch(() => null)));
      setBusy(false);
    }
  }
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
  if (groupError)
    return (
      <Alert severity="error">
        This Group is unavailable. Your unsent corrections have not been submitted.
      </Alert>
    );
  if (!group) return <Typography>Loading Group…</Typography>;
  const context = {
    members: group.members.map((member) => ({ id: member.user._id, name: member.user.name })),
    tags: group.tags
      .filter((tag) => !tag.isArchived && !tag.isDeleted)
      .map((tag) => ({ id: tag._id, name: tag.name })),
  };
  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography component="h2" variant="h5">
        Your private Drafts
      </Typography>
      <Typography>
        Available online across SplitBook and your authorized assistants. Drafts do not change
        Balances. Unknown fields stay empty until you review them.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {collectionError && (
        <Alert severity="error">
          Could not load your Drafts. Connect to the internet and reload.
        </Alert>
      )}
      {pending && (
        <Alert
          severity="warning"
          action={
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await client.retry();
                  if (result?.kind === 'save') {
                    setOutcomes(result.outcomes);
                    setOutcomeNames((current) => ({
                      ...Object.fromEntries(
                        rows.map((row) => [row.id, row.values?.description || 'Incomplete Draft']),
                      ),
                      ...current,
                    }));
                    setReviews([]);
                    setSelected([]);
                  }
                  await reload();
                  await mutate(() => true);
                })
              }
            >
              Retry original request
            </Button>
          }
        >
          A previous request is not confirmed. Retry it before creating or saving more Drafts.
        </Alert>
      )}
      <Stack direction="row" spacing={1}>
        <Button disabled={busy} onClick={() => void action(reload)}>
          Reload
        </Button>
        <Button
          disabled={busy || pending}
          onClick={() => {
            setEntries({});
            setEditing('new');
          }}
        >
          New Draft
        </Button>
      </Stack>
      {editing && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={2}>
            <Typography component="h2">
              {editing === 'new' ? 'Keep an incomplete Expense' : 'Edit Draft'}
            </Typography>
            {draftFields(entries, context).map((field) => (
              <TextField
                key={field.key}
                label={field.label}
                value={field.value ?? entries[field.key] ?? ''}
                select={!!field.options}
                disabled={busy}
                onChange={(event) =>
                  setEntries((current) => ({
                    ...current,
                    ...draftEntryChanges(field.key, event.target.value),
                  }))
                }
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
            <Button
              disabled={busy || pending}
              variant="contained"
              onClick={() =>
                void action(async () => {
                  const values = draftValues(entries);
                  if (editing === 'new') await client.create(values);
                  else await client.replace(editing, values);
                  setEditing(null);
                  setReviews([]);
                  await reload();
                })
              }
            >
              Keep as Draft
            </Button>
            <Button disabled={busy} onClick={() => setEditing(null)}>
              Close editor
            </Button>
            {editing !== 'new' && (
              <Button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const fresh = (await client.list()).find((row) => row.id === editing.id);
                    if (!fresh) throw new Error('Draft no longer available');
                    setEditing(fresh);
                    setEntries(draftEntries(fresh.values));
                  })
                }
              >
                Load latest (replace these unsent entries)
              </Button>
            )}
          </Stack>
        </Paper>
      )}
      {!rows.length && <Typography>No active Drafts.</Typography>}
      {rows.map((row) => (
        <Paper key={row.id} variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <FormControlLabel
              control={
                <Checkbox
                  disabled={busy}
                  checked={selected.includes(row.id)}
                  onChange={() => {
                    setSelected(toggle(selected, row.id));
                    setReviews([]);
                  }}
                />
              }
              label={row.values?.description || 'Description missing'}
            />
            <Typography>
              {row.values?.amount ?? 'Amount missing'} {row.values?.currency ?? 'Currency missing'}{' '}
              · {row.values?.date ?? 'Date missing'}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                disabled={busy}
                onClick={() => {
                  setEditing(row);
                  setEntries(draftEntries(row.values));
                }}
              >
                Edit
              </Button>
              <Button
                disabled={busy}
                color="error"
                onClick={() => {
                  if (
                    window.confirm(
                      'Permanently discard this Draft? Its content cannot be recovered.',
                    )
                  )
                    void action(async () => {
                      await client.discard(row);
                      setReviews([]);
                      await reload();
                    });
                }}
              >
                Discard permanently
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ))}
      <Button
        disabled={busy || !selected.length || pending}
        onClick={() =>
          void action(async () => {
            setReviews(await client.review(selected));
            setAck([]);
            setOutcomes([]);
          })
        }
      >
        Review selected Drafts
      </Button>
      {reviews.map((review) => (
        <Paper key={review.draft.id} variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Typography component="h2">
              Review: {review.draft.values?.description || 'Incomplete Draft'}
            </Typography>
            {draftFields(draftEntries(review.draft.values), context).map((field) => {
              const value = field.value ?? draftEntries(review.draft.values)[field.key];
              return value ? (
                <Typography key={field.key}>
                  {field.label}:{' '}
                  {field.options?.find((option) => option.value === value)?.label ?? value}
                </Typography>
              ) : null;
            })}
            {review.allocation && (
              <Stack>
                <Typography>Exact allocation</Typography>
                {review.allocation.paidBy.map((row) => (
                  <Typography key={`paid:${row.user}`}>
                    {context.members.find((member) => member.id === row.user)?.name ?? row.user}{' '}
                    paid {formatCurrency(row.amount, review.allocation!.currency)}
                  </Typography>
                ))}
                {review.allocation.splitBetween.map((row) => (
                  <Typography key={`share:${row.user}`}>
                    {context.members.find((member) => member.id === row.user)?.name ?? row.user}{' '}
                    shares {formatCurrency(row.amount, review.allocation!.currency)}
                  </Typography>
                ))}
              </Stack>
            )}
            {review.problems.map((problem, i) => (
              <Alert severity="warning" key={i}>
                {problem}
              </Alert>
            ))}
            {review.duplicates.length > 0 && (
              <>
                <Alert severity="warning">
                  Possible duplicates (same description, amount, currency and UTC date):{' '}
                  {review.duplicates.map((item) => `${item.kind}: ${item.description}`).join(', ')}
                </Alert>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={ack.includes(review.draft.id)}
                      disabled={busy}
                      onChange={() => setAck(toggle(ack, review.draft.id))}
                    />
                  }
                  label="I reviewed these matches and want to save this separate Expense."
                />
              </>
            )}
          </Stack>
        </Paper>
      ))}
      {!!reviews.length && (
        <Button
          disabled={busy || pending}
          variant="contained"
          onClick={() =>
            void action(async () => {
              setOutcomeNames(
                Object.fromEntries(
                  reviews.map((row) => [
                    row.draft.id,
                    row.draft.values?.description || 'Incomplete Draft',
                  ]),
                ),
              );
              setOutcomes(await client.save(reviews, ack));
              setReviews([]);
              setSelected([]);
              await reload();
              await mutate(() => true);
            })
          }
        >
          Save reviewed Drafts
        </Button>
      )}
      {outcomes.map((outcome) => (
        <Alert key={outcome.id} severity={outcome.status === 'saved' ? 'success' : 'warning'}>
          {outcomeNames[outcome.id] || `Draft ${outcome.id}`}:{' '}
          {outcome.status === 'saved' ? 'Expense saved' : outcome.message}
        </Alert>
      ))}
    </Stack>
  );
}
