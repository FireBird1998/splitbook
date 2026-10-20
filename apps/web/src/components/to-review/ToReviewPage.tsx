'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useSWRConfig } from 'swr';
import { expenseDraftsKey } from '@splitbook/shared/query-keys';
import {
  summarizeReviewRun,
  type ReviewItemModel,
  type ReviewRunOutcome,
} from '@splitbook/shared/to-review';
import {
  applyQuickFix,
  bulkPayerItems,
  changedElsewhere,
  toReviewQuickFixes,
  type QuickFixFact,
} from '@splitbook/shared/to-review-quick-fixes';
import type {
  DraftReview,
  DraftSaveOutcome,
  ExpenseDraftValues,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import { writeOpenExpense } from '@/components/expenses/expense-list-query';
import { visuallyHidden } from '@/components/insights/a11y';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { useGroup } from '@/lib/hooks/use-groups';
import { RADIUS } from '@/lib/theme/tokens';
import { TO_REVIEW_KEY, useToReview } from './use-to-review';
import { webReviewClient, reviewProblem } from './review-client';
import { memberLabel } from '@splitbook/shared/activity-timeline';
import { ReviewFacts } from './ReviewDetails';
import ToReviewPanel, { type ReviewPanelHandle } from './ToReviewPanel';
import ReviewRow from './ReviewRow';

type Confirmation = {
  reviews: DraftReview[];
  totals: Array<{ currency: string; formatted: string }>;
};
type Run = { ids: string[]; index: number; outcomes: ReviewRunOutcome[] };
export default function ToReviewPage({
  accountId,
  groupId,
}: {
  accountId: string;
  groupId: string;
}) {
  const { read, unreadable, failure, retry, failed, reload } = useToReview(groupId);
  const { data: group, error: groupError } = useGroup(accountId, groupId);
  const { mutate } = useSWRConfig();
  const client = useMemo(() => webReviewClient(accountId, groupId), [accountId, groupId]);
  const [opened, setOpened] = useState<ReviewItemModel | null>(null);
  const [pending, setPending] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcomes, setOutcomes] = useState<DraftSaveOutcome[]>([]);
  const [outcomeNames, setOutcomeNames] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [summary, setSummary] = useState('');
  const [online, setOnline] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState<Record<string, QuickFixFact[]>>({});
  const [deleting, setDeleting] = useState<ReviewItemModel | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  const [announce, setAnnounce] = useState('');
  const openRows = useRef(new Map<string, HTMLButtonElement>());
  // A fixed row moves between sections and remounts; keyboard focus follows it there.
  const refocus = useRef<string | null>(null);
  /** A row S is saving, and the rows after and before it to move focus to once it's gone (#508). */
  const focusAfterSave = useRef<{ id: string; after: string[]; before: string[] } | null>(null);
  const caughtUp = useRef<HTMLHeadingElement>(null);
  const lock = useRef(false);
  const panel = useRef<ReviewPanelHandle>(null);
  const saveReadyButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const openedFrom = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!opened && openedFrom.current?.isConnected) openedFrom.current.focus();
  }, [opened]);
  const namesKey = `splitbook.review-names:${accountId}:${groupId}`;
  const refresh = useCallback(async () => {
    await Promise.all([
      mutate(TO_REVIEW_KEY),
      mutate(expenseDraftsKey({ ...WEB_QUERY_ACCOUNT, accountId }, groupId)),
    ]);
  }, [accountId, groupId, mutate]);
  useEffect(() => {
    let active = true;
    client
      .pending()
      .then((value) => {
        if (!active) return;
        setPending(!!value);
        setChecked(true);
        if (value) {
          const names: unknown = JSON.parse(sessionStorage.getItem(namesKey) || '{}');
          if (names && typeof names === 'object')
            setOutcomeNames(
              Object.fromEntries(
                Object.entries(names).filter((entry) => typeof entry[1] === 'string'),
              ),
            );
        }
      })
      .catch(() => {
        if (active) setError('Could not check the earlier save. Reload before saving.');
      });
    return () => {
      active = false;
    };
  }, [client, namesKey]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const model = read.status === 'ready' ? read.value : null;
  const items = model?.items ?? [];
  // The Group's currency as the read names it, which the model already applied (#512).
  const currency = model?.groups[0]?.currency;
  useEffect(() => {
    const from = focusAfterSave.current;
    if (!from || busy) return;
    focusAfterSave.current = null;
    const listed = (id: string) => items.some((item) => item.id === id);
    // A row that's still listed wasn't saved. Saving disabled it, so focus returns to it.
    if (listed(from.id)) refocus.current = from.id;
    else {
      const next = [...from.after, ...from.before].find(listed);
      if (next) refocus.current = next;
      else (caughtUp.current ?? heading.current)?.focus();
    }
  });
  useEffect(() => {
    const id = refocus.current;
    const row = id ? openRows.current.get(id) : undefined;
    if (row && !row.disabled) {
      refocus.current = null;
      row.focus();
    }
  });
  const selected = opened ? (items.find((item) => item.id === opened.id) ?? opened) : null;
  const available =
    checked && online && !!group && !groupError && !failed && read.status === 'ready';
  // Members' names for the panel and Save ready, with the viewer as "You" by id (#442). The
  // pickers take `context.members` with the names as members chose them, and mark the viewer
  // "You" themselves, by `context.viewerId` (#591).
  const names = Object.fromEntries(
    (group?.members ?? []).flatMap(({ user }) => {
      const label = memberLabel(user._id, user.name, accountId);
      return label ? [[user._id, label]] : [];
    }),
  );
  // A problem asks mid-sentence, "The amount paid by you?", as Android does (#434).
  const problemNames = accountId in names ? { ...names, [accountId]: 'you' } : names;
  const context = {
    currency,
    category: group?.category,
    viewerId: accountId,
    members: group?.members.map(({ user }) => ({ id: user._id, name: user.name })) ?? [],
    tags:
      group?.tags
        .filter((tag) => !tag.isArchived && !tag.isDeleted)
        .map((tag) => ({ id: tag._id, name: tag.name })) ?? [],
  };
  const quickContext = { viewerId: accountId, members: context.members, tags: context.tags };
  const quickFor = (item: ReviewItemModel) => toReviewQuickFixes(item, quickContext);
  const rowsDisabled = busy || pending || !available || !!run || !!selected;
  const nameOf = (draft: PersistedExpenseDraft) => draft.values?.description || 'Expense to review';
  /** A chip only fills in its fact; it never saves the Expense. */
  async function pick(item: ReviewItemModel, fact: QuickFixFact, option: string) {
    const draft = item.accountItem!.draft;
    const before = quickFor(item);
    refocus.current = item.id;
    await action(async () => {
      try {
        await client.replace(draft, applyQuickFix(draft.values ?? {}, fact, option));
      } finally {
        await refresh();
      }
      const left = before.fixes.some((fix) => fix.fact !== fact) || before.stillNeeds.length > 0;
      setAnnounce(left ? '' : `${nameOf(draft)} moved to Ready`);
    });
  }
  /** "You for all N": item by item, skipping any changed elsewhere; Undo restores only its own. */
  async function payAll(candidates: ReviewItemModel[]) {
    await action(async () => {
      const kept: Array<{ draft: PersistedExpenseDraft; before: ExpenseDraftValues }> = [];
      let skipped = 0;
      // An unexpected failure stops the run, but the items already set still get their Undo.
      let failure: unknown = null;
      try {
        for (const item of candidates) {
          const draft = item.accountItem!.draft;
          try {
            const next = await client.replace(
              draft,
              applyQuickFix(draft.values ?? {}, 'paidBy', accountId),
            );
            kept.push({ draft: next, before: draft.values ?? {} });
          } catch (cause) {
            if (!changedElsewhere(cause)) {
              failure = cause;
              break;
            }
            skipped += 1;
          }
        }
      } finally {
        await refresh();
      }
      const text = `You set as payer on ${kept.length} ${kept.length === 1 ? 'item' : 'items'}`;
      const left = skipped
        ? `. ${skipped} changed elsewhere and ${skipped === 1 ? 'was' : 'were'} left as ${skipped === 1 ? 'it was' : 'they were'}.`
        : '';
      // The snackbar is announced on its own; the live region would repeat it.
      setNotice({
        text: text + left,
        undo: kept.length
          ? () =>
              void action(async () => {
                setNotice(null);
                try {
                  for (const row of kept) {
                    try {
                      await client.replace(row.draft, row.before);
                    } catch (cause) {
                      if (!changedElsewhere(cause)) throw cause;
                    }
                  }
                } finally {
                  await refresh();
                }
              })
          : undefined,
      });
      if (failure) throw failure;
    });
  }
  function closeOpened() {
    setOpened(null);
    if (run) {
      const all = [
        ...run.outcomes,
        ...run.ids
          .slice(run.index)
          .filter((id) => items.some((item) => item.id === id))
          .map((id) => ({ id, status: 'skipped' as const })),
      ];
      setSummary(`Done for now · ${summarizeReviewRun(all).label}`);
      setRun(null);
    }
  }
  /** List shortcuts, off while typing, in a menu or dialog, or with a modifier held. */
  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]',
      )
    )
      return;
    const order = (['ready', 'duplicate', 'needs-details'] as const).flatMap((state) =>
      items.filter((item) => item.state === state && item.accountItem),
    );
    const index = order.findIndex((item) => item.id === cursor);
    const key = event.key.toLowerCase();
    if (key === 'arrowdown' || key === 'j' || key === 'arrowup' || key === 'k') {
      const step = key === 'arrowdown' || key === 'j' ? 1 : -1;
      const next = order[index < 0 ? 0 : Math.min(order.length - 1, Math.max(0, index + step))];
      if (!next) return;
      event.preventDefault();
      setCursor(next.id);
      openRows.current.get(next.id)?.focus();
      return;
    }
    const item = order[index];
    if (!item || rowsDisabled) return;
    if (/^[1-9]$/.test(key)) {
      const choices = quickFor(item).fixes.flatMap((fix) =>
        (more[item.id]?.includes(fix.fact) ? fix.options : fix.visible).map((option) => ({
          fact: fix.fact,
          id: option.id,
        })),
      );
      const chosen = choices[Number(key) - 1];
      if (!chosen) return;
      event.preventDefault();
      void pick(item, chosen.fact, chosen.id);
    } else if (key === 's' && item.state === 'ready') {
      event.preventDefault();
      const ids = order.map(({ id }) => id);
      focusAfterSave.current = {
        id: item.id,
        after: ids.slice(index + 1),
        before: ids.slice(0, index).reverse(),
      };
      void saveOne(item.accountItem!.draft, false, []);
    }
  }
  function finishItem(id: string, status: ReviewRunOutcome['status']) {
    if (!run) {
      if (status === 'saved' || status === 'deleted') setOpened(null);
      return;
    }
    const nextOutcomes = [...run.outcomes.filter((outcome) => outcome.id !== id), { id, status }];
    let next = run.index + 1;
    // The run keeps its original order, but another device may finish an upcoming item.
    // Omit unavailable items from our outcomes rather than strand the panel or claim a save.
    while (next < run.ids.length && !items.some((item) => item.id === run.ids[next])) next++;
    if (next >= run.ids.length) {
      setSummary(`Done for now · ${summarizeReviewRun(nextOutcomes).label}`);
      setRun(null);
      setOpened(null);
    } else {
      setRun({ ...run, index: next, outcomes: nextOutcomes });
      const following = items.find((item) => item.id === run.ids[next]);
      setOpened(following ?? null);
    }
  }
  async function action(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError(
        reviewProblem(
          cause instanceof Error
            ? cause.message
            : 'Could not confirm this action. Check your connection and try again.',
        ),
      );
    } finally {
      try {
        setPending(!!(await client.pending()));
      } catch {
        setPending(true);
        setError('Could not check the earlier save. Reload before saving.');
      }
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(reviews: DraftReview[], acknowledged: string[]) {
    const labels = Object.fromEntries(
      reviews.map((row) => [row.draft.id, row.draft.values?.description || 'Expense to review']),
    );
    sessionStorage.setItem(namesKey, JSON.stringify(labels));
    setOutcomeNames(labels);
    let results: DraftSaveOutcome[];
    try {
      results = await client.save(reviews, acknowledged);
    } catch (cause) {
      const uncertain = !!(await client.pending());
      results = reviews.map((row) =>
        uncertain
          ? { id: row.draft.id, status: 'unresolved', message: 'Unconfirmed' }
          : {
              id: row.draft.id,
              status: 'failed',
              message: cause instanceof Error ? cause.message : 'Could not save this expense.',
            },
      );
    }
    setOutcomes(results);
    setConfirmation(null);
    if (!(await client.pending())) sessionStorage.removeItem(namesKey);
    await refresh();
    await mutate(() => true);
    finishSaved(results);
  }
  function finishSaved(results: DraftSaveOutcome[]) {
    const saved = new Set(
      results.filter((outcome) => outcome.status === 'saved').map(({ id }) => id),
    );
    if (run) {
      const nextOutcomes = [
        ...run.outcomes.filter((outcome) => !saved.has(outcome.id)),
        ...run.ids.filter((id) => saved.has(id)).map((id) => ({ id, status: 'saved' as const })),
      ];
      let next = run.index;
      while (
        next < run.ids.length &&
        (saved.has(run.ids[next]) || !items.some((item) => item.id === run.ids[next]))
      )
        next++;
      if (next >= run.ids.length) {
        setSummary(`Done for now · ${summarizeReviewRun(nextOutcomes).label}`);
        setRun(null);
        setOpened(null);
      } else {
        setRun({ ...run, index: next, outcomes: nextOutcomes });
        setOpened(items.find((item) => item.id === run.ids[next]) ?? null);
      }
    } else if (selected && saved.has(selected.id)) setOpened(null);
  }
  async function saveOne(
    draft: PersistedExpenseDraft,
    acknowledged: boolean,
    seen = selected?.accountItem?.duplicates ?? [],
  ) {
    await action(async () => {
      const reviewed = await client.review([draft.id]);
      const review = reviewed[0];
      if (review.draft.revision !== draft.revision) {
        await refresh();
        throw new Error(
          'This item changed while you were looking. Review the latest version before saving.',
        );
      }
      const seenMatches = seen;
      const matchIds = (matches: typeof seenMatches) =>
        matches.map((match) => `${match.kind}:${match.id}`).sort();
      if (JSON.stringify(matchIds(review.duplicates)) !== JSON.stringify(matchIds(seenMatches))) {
        await refresh();
        throw new Error('The possible matches changed. Check them before saving this expense.');
      }
      if (review.problems.length || (review.duplicates.length && !acknowledged)) {
        await refresh();
        throw new Error(
          'This item needs another look before saving. Check the details and any possible duplicate.',
        );
      }
      await save(reviewed, acknowledged ? [draft.id] : []);
    });
  }
  async function saveReady() {
    if (!model) return;
    await action(async () => {
      if (selected && !(await panel.current?.flush())) {
        panel.current?.focus();
        return;
      }
      const chosen = (await reload()).ready;
      if (!chosen.count) {
        panel.current?.focus();
        return;
      }
      const reviews = await client.review(chosen.items.map((item) => item.draft.id));
      if (
        reviews.some(
          (review) =>
            review.draft.revision !==
              chosen.items.find((item) => item.draft.id === review.draft.id)?.draft.revision ||
            review.problems.length ||
            review.duplicates.length,
        )
      ) {
        await refresh();
        throw new Error('Some items changed or need another look. Review them before saving.');
      }
      setConfirmation({ reviews, totals: chosen.totals });
      setOutcomes([]);
    });
  }
  return (
    <Stack spacing={2.5} sx={{ py: 2, minWidth: 0 }}>
      <Typography component="h2" variant="h5" ref={heading} tabIndex={-1}>
        To review
      </Typography>
      <Typography color="text.secondary">
        Only you can see these. Nothing here changes Balances until you save it.
      </Typography>
      {error && <Alert severity="warning">{error}</Alert>}
      {(groupError || failure) && (
        <Alert severity="warning" action={<Button onClick={retry}>Try again</Button>}>
          {groupError || failure === 'connection'
            ? 'Could not verify To review. Connect to the internet and try again.'
            : 'Could not load To review. Try again.'}
        </Alert>
      )}
      {read.status === 'ready' && unreadable > 0 && (
        <Alert severity="info">
          {unreadable === 1
            ? '1 item couldn’t be shown.'
            : `${unreadable} items couldn’t be shown.`}
        </Alert>
      )}
      {!online && (
        <Alert severity="info">Connect to the internet to change items in your account.</Alert>
      )}
      {pending && (
        <Alert
          severity="warning"
          action={
            <Button
              disabled={busy || !available}
              onClick={() =>
                void action(async () => {
                  const result = await client.retry();
                  if (result?.kind === 'save') {
                    setOutcomes(result.outcomes);
                    finishSaved(result.outcomes);
                  }
                  if (!(await client.pending())) sessionStorage.removeItem(namesKey);
                  await refresh();
                  await mutate(() => true);
                })
              }
            >
              Check again
            </Button>
          }
        >
          We didn’t hear back, so it may already be saved. Check again before saving another item.
        </Alert>
      )}
      {summary && (
        <Alert severity="success" role="status">
          {summary}
        </Alert>
      )}
      {outcomes.map((outcome) => (
        <Alert key={outcome.id} severity={outcome.status === 'saved' ? 'success' : 'warning'}>
          <Typography fontWeight={600}>
            {outcomeNames[outcome.id] || 'Expense to review'}
          </Typography>
          {outcome.status === 'saved'
            ? 'Expense saved'
            : outcome.status === 'unresolved'
              ? 'We didn’t hear back, so it may already be saved'
              : `Couldn’t save: ${reviewProblem(outcome.message)}`}
          {outcome.status === 'saved' && (
            <Button
              component={Link}
              href={`/groups/${groupId}/expenses?${writeOpenExpense('', outcome.expenseId)}`}
            >
              View
            </Button>
          )}
          {outcome.status === 'failed' && items.find((item) => item.id === outcome.id) && (
            <Button
              disabled={busy}
              onClick={() => setOpened(items.find((item) => item.id === outcome.id)!)}
            >
              Fix this item
            </Button>
          )}
        </Alert>
      ))}
      {!model && !groupError && <Typography role="status">Loading To review…</Typography>}
      {model && (
        <>
          {!!model.counts.total && (
            <>
              <Typography>
                {model.counts.ready} ready · {model.counts.duplicate} to check
              </Typography>
              {model.sourceSummary && (
                <Typography variant="body2" color="text.secondary">
                  {model.sourceSummary}
                </Typography>
              )}
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                {model.ready.count > 0 && (
                  <Button
                    ref={saveReadyButton}
                    variant="contained"
                    disabled={busy || pending || !available}
                    onClick={() => void saveReady()}
                  >
                    {model.ready.label}
                  </Button>
                )}
                <Button
                  variant="outlined"
                  disabled={busy || pending || !available || !!selected || !!run}
                  onClick={(event) => {
                    openedFrom.current = event.currentTarget;
                    setRun({ ids: items.map((item) => item.id), index: 0, outcomes: [] });
                    setOpened(items[0]);
                    setSummary('');
                  }}
                >
                  Review one at a time
                </Button>
              </Stack>
            </>
          )}
          {!model.counts.total && (
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography component="h3" variant="h6" ref={caughtUp} tabIndex={-1}>
                All caught up
              </Typography>
              <Button component={Link} href={`/groups/${groupId}/expenses`}>
                Back to Expenses
              </Button>
            </Paper>
          )}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: selected
                ? { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(320px, 1fr)' }
                : 'minmax(0, 1fr)',
              gap: 2.5,
              alignItems: 'start',
            }}
            onKeyDown={(event) => {
              const target = event.target as HTMLElement;
              if (event.key !== 'Escape' || !selected || target.closest('input, textarea, select'))
                return;
              event.preventDefault();
              void (async () => {
                if (!panel.current || (await panel.current.flush())) closeOpened();
              })();
            }}
          >
            <Stack spacing={2} onKeyDown={onListKeyDown}>
              {(['ready', 'duplicate', 'needs-details'] as const).map((state) => {
                const section = items.filter((item) => item.state === state && item.accountItem);
                const label =
                  state === 'ready'
                    ? 'Ready'
                    : state === 'duplicate'
                      ? 'Check before saving'
                      : 'Needs details';
                const payers = state === 'needs-details' ? bulkPayerItems(section) : [];
                return (
                  !!section.length && (
                    <Box component="section" key={state} aria-label={label}>
                      <Typography
                        component="h3"
                        variant="subtitle1"
                        fontWeight={600}
                        sx={{ mb: 1 }}
                      >
                        {label}
                      </Typography>
                      <Stack spacing={1}>
                        {payers.length >= 2 && (
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            sx={{
                              alignItems: { xs: 'stretch', sm: 'center' },
                              justifyContent: 'space-between',
                              bgcolor: 'tint.brand',
                              borderRadius: `${RADIUS.md}px`,
                              px: 2,
                              py: 1.5,
                            }}
                          >
                            <Typography>
                              <Box component="span" sx={{ fontWeight: 600 }}>
                                Who paid?
                              </Box>{' '}
                              {payers.length} items still need a payer.
                            </Typography>
                            <Button
                              variant="outlined"
                              disabled={rowsDisabled}
                              onClick={() => void payAll(payers)}
                              sx={{ bgcolor: 'background.paper', minHeight: { xs: 44, md: 36 } }}
                            >
                              You for all {payers.length}
                            </Button>
                          </Stack>
                        )}
                        {section.map((item) => (
                          <ReviewRow
                            key={item.id}
                            item={item}
                            quick={quickFor(item)}
                            currency={currency}
                            open={selected?.id === item.id}
                            selected={cursor === item.id && !selected}
                            disabled={rowsDisabled}
                            openDisabled={busy || !!run || !!selected}
                            showAll={new Set(more[item.id] ?? [])}
                            registerOpen={(element) => {
                              if (element) openRows.current.set(item.id, element);
                              else openRows.current.delete(item.id);
                            }}
                            onOpen={(event) => {
                              openedFrom.current = event.currentTarget;
                              setOpened(item);
                            }}
                            onFocus={() => setCursor(item.id)}
                            onPick={(fact, option) => void pick(item, fact, option)}
                            onMore={(fact) =>
                              setMore((current) => ({
                                ...current,
                                [item.id]: [...(current[item.id] ?? []), fact],
                              }))
                            }
                            onSave={() => void saveOne(item.accountItem!.draft, false, [])}
                            onDelete={() => setDeleting(item)}
                          />
                        ))}
                      </Stack>
                    </Box>
                  )
                );
              })}
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: { xs: 'none', md: 'block' } }}
              >
                Keyboard shortcuts: ↑ ↓ or J K move · Enter opens · 1–9 choose · S saves · Esc
                closes
              </Typography>
            </Stack>
            {selected && (
              <ToReviewPanel
                key={selected.id}
                ref={panel}
                item={selected}
                items={items.flatMap((item) => (item.accountItem ? [item.accountItem] : []))}
                context={context}
                names={names}
                problemNames={problemNames}
                groupName={group?.name || 'this Group'}
                client={client}
                refresh={refresh}
                available={available && items.some((item) => item.id === selected.id) && !pending}
                savingBlocked={pending || busy}
                run={run ? `${run.index + 1} of ${run.ids.length}` : undefined}
                onClose={closeOpened}
                onNext={() => finishItem(selected.id, 'skipped')}
                onSave={saveOne}
                onDelete={(draft) =>
                  action(async () => {
                    await client.discard(draft);
                    await refresh();
                    finishItem(draft.id, 'deleted');
                  })
                }
              />
            )}
          </Box>
        </>
      )}
      <Dialog
        open={!!confirmation}
        disableRestoreFocus
        slotProps={{
          transition: {
            onExited: () => {
              if (saveReadyButton.current && !saveReadyButton.current.disabled)
                saveReadyButton.current.focus();
              else if (panel.current) panel.current.focus();
              else heading.current?.focus();
            },
          },
        }}
        onClose={() => !busy && setConfirmation(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {confirmation ? `Save ${confirmation.reviews.length} ready?` : 'Save ready expenses?'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {confirmation?.reviews.map((item) => (
              <ReviewFacts key={item.draft.id} item={item} names={names} currency={currency} />
            ))}
            {confirmation?.totals.map((total) => (
              <Typography key={total.currency} fontWeight={600}>
                Total · {total.formatted}
              </Typography>
            ))}
            <Typography>
              They’ll be added to {group?.name || 'this Group'}, and Balances there will change for
              everyone.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirmation(null)}>
            Keep reviewing
          </Button>
          <Button
            variant="contained"
            autoFocus
            disabled={busy || !available || pending}
            onClick={() => confirmation && void action(() => save(confirmation.reviews, []))}
          >
            Confirm save
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!deleting} onClose={() => !busy && setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this item?</DialogTitle>
        <DialogContent>
          It was never saved, so nothing in {group?.name || 'this Group'} changes. You can’t undo
          this.
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setDeleting(null)}>
            Keep item
          </Button>
          <Button
            color="inherit"
            sx={{ color: 'status.negative' }}
            disabled={busy || !available}
            onClick={() => {
              const draft = deleting?.accountItem?.draft;
              if (!draft) return;
              void action(async () => {
                await client.discard(draft);
                await refresh();
                setDeleting(null);
                setAnnounce(`${nameOf(draft)} deleted`);
              });
            }}
          >
            Delete item
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={!!notice}
        autoHideDuration={8000}
        onClose={(_, reason) => reason !== 'clickaway' && setNotice(null)}
        message={notice?.text}
        action={
          notice?.undo && (
            <Button color="inherit" disabled={busy} onClick={notice.undo}>
              Undo
            </Button>
          )
        }
      />
      <Box aria-live="polite" sx={visuallyHidden}>
        {announce}
      </Box>
    </Stack>
  );
}
