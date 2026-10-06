import { canEditExpense } from '../data/expense-record';
import {
  ExpenseRecordScreen,
  ExpenseRecordSkeleton,
  ExpenseRecordView,
} from './expense-record-view';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, ScrollView, View, type TextInput } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { expenseDifferences } from '@splitbook/shared/expense-review';
import { enteredPayers } from '@splitbook/shared/payer-remainder';
import {
  draftFromExpense,
  expenseDraftChanged,
  expenseFieldLabels,
  expenseFields,
  expenseMoney,
  refusedRetryNotice,
  resolveDraftReview,
  type ExpenseDraft,
  type ExpenseEditor as Editor,
  type ExpenseField,
} from '../data/expense-draft';
import { DateSheet } from './date-sheet';
import { Button, Icon, Loading, Notice } from './primitives';
import {
  Badge,
  Banner,
  BottomSheet,
  Card,
  CompactButton,
  CompactText,
  IconButton,
  IconTile,
  ListRow,
  TopBar,
  useReveal,
} from './compact';
import { TagSheet, inactiveTagReport } from './tag-sheet';
import { PayerSheet, paidBySummary } from './payer-sheet';
import {
  AmountDescriptionCard,
  ExpenseTiles,
  OptionalDetails,
  SaveBar,
  WhatsDifferent,
  WhoOwesWhat,
  expenseDateLabel,
  splitSummary,
} from './expense-form';
import { SplitSheet } from './split-sheet';
import { ErrorBoundary } from './error-boundary';
import { savingNeedsConnection } from './offline-notice';
import { useTheme } from './theme';

/** The form for a draft, rather than loading, a notice or a saved record. */
const showsForm = ({ draft, status }: Editor) =>
  !!draft &&
  status !== 'loading' &&
  !(draft.original && ['detail', 'delete-review'].includes(status));

/**
 * The Expense task, full screen without the Group's bottom navigation: the compact form for
 * adding and editing, and the saved record. Close and Android Back keep the draft.
 *
 * An unexpected rendering error shows a recoverable view instead of closing the app (#187). It
 * never renders the draft, and the task is tried again only for another draft.
 */
export function ExpenseEditor(props: Parameters<typeof ExpenseTask>[0]) {
  const { state } = props;
  const form = showsForm(state);
  // A save, change or deletion that may already be recorded is never discarded here.
  const unconfirmed = state.attempt ? 'save' : (state.mutation?.kind ?? null);
  return (
    <ErrorBoundary
      resetKey={state.draft}
      fallback={
        <ExpenseProblem
          draft={form}
          unconfirmed={form ? unconfirmed : null}
          onKeep={props.onClose}
          onDiscard={
            form && !unconfirmed && ['editing', 'resume'].includes(state.status)
              ? props.onDiscard
              : undefined
          }
        />
      }
    >
      <ExpenseTask {...props} />
    </ErrorBoundary>
  );
}

/** What the Expense task shows after an unexpected rendering error: never the draft itself. */
function ExpenseProblem({
  draft,
  unconfirmed,
  onKeep,
  onDiscard,
}: {
  draft: boolean;
  unconfirmed: 'save' | 'edit' | 'delete' | null;
  onKeep?: () => void;
  onDiscard?: () => void;
}) {
  const theme = useTheme();
  const message = !draft
    ? 'This Expense couldn’t be shown.'
    : `This form couldn’t be shown. Your draft is kept on this device.${
        unconfirmed
          ? ` It may already be ${unconfirmed === 'delete' ? 'deleted' : 'saved'}, so check it from the Group before trying again.`
          : ''
      }`;
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TopBar
        title="Expense"
        prominent={false}
        leading={
          onKeep
            ? {
                kind: 'close',
                label: draft ? 'Back to Group, keeping your draft' : 'Back to Group',
                onPress: onKeep,
              }
            : undefined
        }
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <Banner tone="error" title="Something went wrong" message={message}>
          {onKeep ? (
            <CompactButton
              label={draft ? 'Keep draft' : 'Back to Group'}
              accessibilityLabel={draft ? 'Keep draft and return to the Group' : 'Back to Group'}
              variant="tonal"
              dense
              onPress={onKeep}
            />
          ) : null}
          {onDiscard ? (
            <CompactButton label="Discard draft" variant="text" dense onPress={onDiscard} />
          ) : null}
        </Banner>
      </View>
    </View>
  );
}

function ExpenseTask({
  state,
  currentUserId,
  onClose,
  notice,
  offline = false,
  onChange,
  onSave,
  onResume,
  onDiscard,
  onDiscardUnconfirmed,
  onRetry,
  onEdit,
  onReviewDelete,
  onDelete,
  onCancelDelete,
  onReconcile,
  onReviewLatest,
  onAcceptCurrent,
  onLeaveField,
  onReveal,
  onLoadOlderHistory,
  onRetryHistory,
}: {
  state: Editor;
  /** Shown as "You" in the form. */
  currentUserId?: string;
  /** Close or Back: returns to the Group and keeps the draft on this device. */
  onClose?: () => void;
  /** Shown above the content, such as the offline notice. */
  notice?: ReactNode;
  /** Saving and checking a save need a connection; the draft stays editable. */
  offline?: boolean;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  /** Called when a field loses focus, so its correction can appear. */
  onLeaveField: (field: ExpenseField) => void;
  /** Told whenever a section is scrolled into view. */
  onReveal?: (section: View) => void;
  onSave: () => void;
  onResume: () => void;
  onDiscard: () => void;
  /** Offered once the server refused a retry of an unconfirmed save; the app confirms it. */
  onDiscardUnconfirmed?: () => void;
  onRetry: () => void;
  onEdit: () => void;
  onReviewDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onReconcile: () => void;
  onReviewLatest: () => void;
  onAcceptCurrent: () => void;
  /** The saved record's older changes, and another read of its changes after a failure. */
  onLoadOlderHistory?: () => void;
  onRetryHistory?: () => void;
}) {
  const theme = useTheme();
  const [editor, setEditor] = useState<'payers' | null>(null);
  const [sheet, setSheet] = useState<'date' | 'split' | 'tag' | 'options' | null>(null);
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const sections = useRef<Partial<Record<ExpenseField, View | null>>>({});
  const inputs = useRef<Partial<Record<ExpenseField, TextInput | null>>>({});
  const corrections = useRef<Partial<Record<ExpenseField, View | null>>>({});
  /** Scroll a section near the top so it stays visible when the keyboard opens. */
  const reveal = (section: View) => {
    const container = content.current;
    if (container && typeof section.measureLayout === 'function')
      section.measureLayout(
        container,
        (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - 16), animated: false }),
        () => undefined,
      );
    onReveal?.(section);
  };
  /** Moves to a field: its input when it has one, otherwise its correction for screen readers. */
  const goTo = (field: ExpenseField) => {
    const section = sections.current[field];
    if (section) reveal(section);
    const input = inputs.current[field];
    const correction = corrections.current[field];
    if (input) input.focus();
    else if (correction) AccessibilityInfo.sendAccessibilityEvent(correction, 'focus');
  };
  const focus = state.validation.focus;
  useEffect(() => {
    // Each rejected save asks once for the first invalid field; later edits never move focus.
    if (focus) goTo(focus.field);
  }, [focus?.request]);
  const review = useRef<View>(null);
  /** Brings the choices left in What’s different into view and to the screen reader. */
  const showReview = () => {
    const node = review.current;
    if (!node) return;
    reveal(node);
    AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  };
  // Keeping a version leaves money choices that Save waits for; they open in view, once.
  const reviewing = state.status === 'editing' && !!state.draft?.review?.length;
  useEffect(() => {
    if (reviewing) showReview();
  }, [reviewing]);
  // An Expense opening from nothing shows its record's skeleton, and the record then fades in
  // where it was. A form that is briefly loading, as while a save is discarded, isn't opening a
  // record: it keeps the spinner it always had.
  const opening = state.status === 'loading' && !!state.requestedExpenseId && !state.draft;
  const recordReveal = useReveal(opening);
  const errors = state.validation.errors;
  const section = (field: ExpenseField) => (node: View | null) => {
    sections.current[field] = node;
  };
  const input = (field: ExpenseField) => (node: TextInput | null) => {
    inputs.current[field] = node;
  };
  const correction = (field: ExpenseField) => (node: View | null) => {
    corrections.current[field] = node;
  };
  const { draft, context } = state;
  const record = !!draft?.original && ['detail', 'delete-review'].includes(state.status);
  const form = showsForm(state);
  // A save that may already be recorded stays locked until it is checked.
  const unconfirmed =
    form && ['resume', 'uncertain'].includes(state.status) && !!(state.attempt || state.mutation);
  const conflict = form && state.status === 'conflict' ? state.latest : null;
  // A newer revision means the Expense changed; who changed it isn't known, since the member's
  // own unconfirmed change may be the one that landed.
  const changed = !!conflict && conflict.revision !== draft?.original?.revision;
  const badge = unconfirmed
    ? 'Not confirmed'
    : conflict
      ? changed
        ? 'Changed'
        : 'Not saved'
      : null;
  const frame = (body: ReactNode, footer?: ReactNode) => (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TopBar
        title={
          !draft || state.status === 'loading' || record
            ? 'Expense'
            : draft.original
              ? 'Edit expense'
              : 'Add expense'
        }
        subtitle={
          context
            ? `${context.group.name} · ${draft?.currency ?? context.group.defaultCurrency}`
            : undefined
        }
        prominent={!form}
        leading={
          onClose
            ? form
              ? { kind: 'close', label: 'Back to Group, keeping your draft', onPress: onClose }
              : { kind: 'back', label: 'Back to Group', onPress: onClose }
            : undefined
        }
        status={
          badge ? (
            <Badge label={badge} tone="warning" />
          ) : form ? (
            <DraftStatus
              persistence={state.persistence}
              kept={!!(state.attempt || state.mutation) || expenseDraftChanged(draft!, state.blank)}
            />
          ) : null
        }
        actions={
          form && state.status === 'editing' ? (
            <IconButton
              icon="ellipsis-vertical-outline"
              label="Expense options"
              onPress={() => setSheet('options')}
            />
          ) : null
        }
      />
      <ScrollView
        ref={scroll}
        innerViewRef={content as RefObject<View>}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 }}
      >
        {notice}
        {body}
      </ScrollView>
      {footer}
    </View>
  );

  const requested = !!state.requestedExpenseId;
  if (state.status === 'loading')
    return frame(
      opening ? (
        <ExpenseRecordSkeleton label="Opening this Expense…" />
      ) : (
        <Loading label={requested ? 'Opening this Expense…' : 'Opening your draft…'} />
      ),
    );
  if (!draft)
    return frame(
      <Notice
        title={requested ? 'Couldn’t open this Expense' : 'Couldn’t open this draft'}
        message={state.message ?? 'Please try again.'}
        retry={onRetry}
      />,
    );
  if (record)
    return (
      <ExpenseRecordScreen
        state={state}
        currentUserId={currentUserId}
        notice={notice}
        offline={offline}
        onClose={onClose}
        onEdit={onEdit}
        onReviewDelete={onReviewDelete}
        onDelete={onDelete}
        onCancelDelete={onCancelDelete}
        onResume={onResume}
        onRefresh={onRetry}
        onLoadOlderHistory={onLoadOlderHistory}
        onRetryHistory={onRetryHistory}
        reveal={recordReveal}
      />
    );
  const locked = state.status !== 'editing';
  const members = context?.group.members.map(({ user }) => user) ?? [];
  const name = (id: string) =>
    members.find((member) => member.id === id)?.name ??
    [draft.original, state.latest]
      .flatMap((saved) => [...(saved?.paidBy ?? []), ...(saved?.splitBetween ?? [])])
      .find((row) => row.user === id)?.name ??
    'Unavailable member';
  const invalidMembers =
    context &&
    [
      ...(draft.multiPayer
        ? enteredPayers(draft.payers).map((payer) => payer.user)
        : [draft.payerId]),
      ...draft.participantIds,
    ].some((id) => !members.some((member) => member.id === id));
  let allocation: ReturnType<typeof expenseMoney> | null = null;
  let allocationError = '';
  try {
    allocation = expenseMoney(draft);
  } catch (error) {
    allocationError = error instanceof Error ? error.message : 'Review the allocation.';
  }
  const money = (minor: number) =>
    formatCurrency(toMajorAmount(minor, draft.currency), draft.currency);
  const tag = context?.tags.find((item) => item.id === draft.tagId);
  const activeTags = context?.tags.filter((item) => !item.isArchived && !item.isDeleted) ?? [];
  // Save stays available for incomplete input so it can explain what is missing, and while
  // the latest entries are being stored: the save waits for that write.
  const saveBlocked =
    state.status === 'saving'
      ? 'Sending this Expense. Keep this screen open until SplitBook confirms it.'
      : offline
        ? savingNeedsConnection
        : state.persistence === 'error'
          ? 'Save is unavailable until this draft is stored on this device. Retry saving the draft first.'
          : draft.review?.length
            ? 'Choose which version to keep for each change in What’s different first.'
            : null;

  const invalid = expenseFields.filter((field) => errors[field]);
  const summary = state.validation.submitted && invalid.length > 0;
  const canSave = state.status === 'editing' || state.status === 'saving';
  const tagName = (id: string) =>
    !id
      ? 'No Tag'
      : (context?.tags.find((item) => item.id === id)?.name ??
        [draft.original, state.latest].find((saved) => saved?.tagId === id)?.tag ??
        'Unavailable Tag');
  const versions = { name, tagName, currentUserId };
  const tagReport = inactiveTagReport(state);
  const tagNotice = errors.tag ? undefined : tagReport.notice;

  return (
    <>
      {frame(
        <>
          {state.status === 'blocked' && state.latest && (
            <>
              <ExpenseRecordView
                record={state.latest}
                title="Current saved record"
                people={members}
                tags={context?.tags}
              />
              <Button label="Use the saved version" secondary onPress={onAcceptCurrent} />
            </>
          )}
          {/* An ordinary draft was never sent; an unconfirmed save may already be recorded. */}
          {unconfirmed ? (
            <Banner
              tone="warning"
              // Reopening says it again calmly; a new reason interrupts.
              standing={!state.message}
              title={
                state.attempt
                  ? 'We couldn’t confirm this save'
                  : state.mutation?.kind === 'delete'
                    ? 'We couldn’t confirm this deletion'
                    : 'We couldn’t confirm this change'
              }
              message={
                state.message ??
                (state.attempt
                  ? state.attemptRejected
                    ? `SplitBook refused a retry of this save. ${refusedRetryNotice}`
                    : `This Expense may already be in ${context?.group.name ?? 'the Group'}. Checking reuses the same submission, so it can’t be recorded twice.`
                  : `${state.mutation?.kind === 'delete' ? 'This Expense may already be deleted.' : 'This change may already be saved.'} Checking reads the saved Expense first, so nothing is sent twice.`)
              }
            >
              {state.attemptRejected && onDiscardUnconfirmed && (
                <CompactButton
                  label="Discard unconfirmed save"
                  variant="text"
                  dense
                  onPress={onDiscardUnconfirmed}
                />
              )}
            </Banner>
          ) : state.status === 'resume' ? (
            <Banner
              tone="info"
              title="Unfinished draft"
              message={
                state.message ??
                'Nothing has been sent. Resume your entries or discard them to start again.'
              }
            >
              <CompactButton label="Resume draft" variant="tonal" dense onPress={onResume} />
              <CompactButton label="Discard draft" variant="text" dense onPress={onDiscard} />
            </Banner>
          ) : null}
          {conflict ? (
            <>
              <Banner
                tone="warning"
                title={
                  changed
                    ? 'This Expense changed since you started editing'
                    : 'Your change isn’t in the saved Expense'
                }
                message={
                  state.message ??
                  'Compare your version with the saved one, then choose which to keep. Nothing is sent until you save again.'
                }
              />
              <WhatsDifferent
                fields={expenseDifferences(draft, draftFromExpense(conflict))}
                yours={draft}
                saved={draftFromExpense(conflict)}
                note="Keeping your version takes the saved values for anything you didn’t change. A saved change to the amount, payers or split waits for your choice."
                {...versions}
              />
            </>
          ) : reviewing && draft.review && draft.original ? (
            <WhatsDifferent
              ref={review}
              fields={draft.review}
              yours={draft}
              saved={draftFromExpense(draft.original)}
              note="The saved Expense changed these while you were editing. Choose which to keep."
              onChoose={(field, keep) => onChange(resolveDraftReview(draft, field, keep))}
              {...versions}
            />
          ) : null}
          {summary ? (
            <Banner
              tone="error"
              title={`${invalid.length === 1 ? 'One thing' : `${invalid.length} things`} to fix before saving`}
              message="Your draft is kept. Go to each one:"
            >
              {invalid.map((field) => (
                <CompactButton
                  key={field}
                  label={expenseFieldLabels[field]}
                  accessibilityLabel={`Go to ${expenseFieldLabels[field]}`}
                  variant="text"
                  dense
                  onPress={() => goTo(field)}
                />
              ))}
            </Banner>
          ) : null}
          {!context && (
            <Banner
              tone="offline"
              message="Connect to check the current members and Tags. You can still edit your saved text."
            />
          )}
          <AmountDescriptionCard
            draft={draft}
            locked={locked}
            showLock={unconfirmed}
            errors={errors}
            amountRef={input('amount')}
            descriptionRef={input('description')}
            section={section}
            onChange={onChange}
            onLeave={onLeaveField}
            onAmountDone={() => inputs.current.description?.focus()}
          >
            {!draft.original && context && draft.currency !== context.group.defaultCurrency ? (
              <View style={{ gap: 6 }}>
                {!errors.amount && (
                  <CompactText variant="small" tone="warning" accessibilityRole="alert">
                    This draft uses {draft.currency}; the Group now uses{' '}
                    {context.group.defaultCurrency}. Review the amount before choosing the new
                    currency.
                  </CompactText>
                )}
                <CompactButton
                  label={`Use ${context.group.defaultCurrency}`}
                  variant="tonal"
                  dense
                  disabled={locked}
                  onPress={() => onChange({ currency: context.group.defaultCurrency })}
                />
              </View>
            ) : null}
          </AmountDescriptionCard>
          <ExpenseTiles
            locked={locked}
            errors={{ ...errors, tag: errors.tag ?? tagReport.error }}
            values={{
              date: expenseDateLabel(draft.date),
              payers: paidBySummary(draft, (id) => (id === currentUserId ? 'You' : name(id))),
              split: splitSummary(draft),
              tag:
                tag?.name ??
                (draft.tagId ? (draft.original?.tag ?? 'Unavailable Tag') : 'Choose a Tag'),
            }}
            correction={correction}
            section={section}
            onOpen={(tile) => (tile === 'payers' ? setEditor(tile) : setSheet(tile))}
          />
          {tagNotice ? (
            <CompactText variant="small" tone="warning" accessibilityRole="alert">
              {tagNotice}
            </CompactText>
          ) : null}
          {invalidMembers && !errors.payers && !errors.split && (
            <CompactText variant="small" tone="warning" accessibilityRole="alert">
              A saved payer or participant is no longer in this Group. Open Paid by or Split to
              remove unavailable members.
            </CompactText>
          )}
          <WhoOwesWhat
            draft={draft}
            allocation={allocation}
            problem={
              errors.amount
                ? 'Correct the amount to see who owes what.'
                : draft.amount
                  ? allocationError
                  : 'Enter a valid amount to see who owes what.'
            }
            name={name}
            currentUserId={currentUserId}
            money={money}
          />
          <OptionalDetails draft={draft} locked={locked} onChange={onChange} />
          {/* The banners above already say why a save is unconfirmed or in conflict. */}
          {state.message && !summary && !unconfirmed && !conflict && state.status !== 'resume' && (
            <CompactText variant="small" accessibilityRole="alert" accessibilityLiveRegion="polite">
              {state.message}
            </CompactText>
          )}
          {state.persistence === 'error' && !state.attempt && (
            <Button label="Retry saving draft" secondary onPress={() => onChange({})} />
          )}
          {draft.original && !unconfirmed && ['uncertain', 'blocked'].includes(state.status) && (
            <Button label="Check current Expense" onPress={onReconcile} />
          )}
          {unconfirmed && (
            <CompactText variant="small" tone="secondary">
              Details are locked until the save is confirmed. Signing out removes recovery
              information; check Group history before recreating this expense.
            </CompactText>
          )}
        </>,
        unconfirmed ? (
          <SaveBar
            label={state.attempt ? 'Check and finish saving' : 'Check the saved Expense'}
            blocked={offline ? 'Checking needs a connection.' : null}
            onSave={state.attempt ? onSave : onReconcile}
            secondary={onClose && { label: 'Keep for later', onPress: onClose }}
          />
        ) : conflict ? (
          <SaveBar
            label="Keep my version for review"
            blocked={
              canEditExpense(conflict)
                ? null
                : 'This Expense includes a member whose account is no longer available, so it can’t be edited.'
            }
            onSave={onReviewLatest}
            secondary={{ label: 'Use the saved version', onPress: onAcceptCurrent }}
          />
        ) : canSave ? (
          <SaveBar
            label={draft.original ? 'Save changes' : 'Save expense'}
            busy={state.status === 'saving' ? 'Saving expense…' : undefined}
            amount={
              allocation && state.status !== 'saving' ? money(allocation.amountMinor) : undefined
            }
            blocked={saveBlocked}
            onSave={onSave}
            // Save's reason leads back to the choices it waits for, wherever the form is scrolled.
            secondary={
              reviewing ? { label: 'Go to What’s different', onPress: showReview } : undefined
            }
          />
        ) : null,
      )}
      <DateSheet
        visible={sheet === 'date'}
        value={draft.date}
        locked={locked}
        onChange={(date) => onChange({ date })}
        onDone={() => {
          setSheet(null);
          onLeaveField('date');
        }}
      />
      <SplitSheet
        visible={sheet === 'split'}
        draft={draft}
        members={context ? members : null}
        currentUserId={currentUserId}
        locked={locked}
        persistence={state.persistence}
        name={name}
        money={money}
        onChange={onChange}
        onDone={() => {
          setSheet(null);
          onLeaveField('split');
        }}
      />
      <TagSheet
        visible={sheet === 'tag'}
        tags={context ? activeTags : null}
        tagId={draft.tagId}
        error={tagReport.error}
        notice={tagNotice}
        locked={locked}
        onChoose={(tagId) => {
          onChange({ tagId });
          setSheet(null);
        }}
        onDone={() => {
          setSheet(null);
          onLeaveField('tag');
        }}
      />
      <BottomSheet
        visible={sheet === 'options'}
        title="Expense options"
        onDone={() => setSheet(null)}
      >
        <Card>
          <ListRow
            leading={<IconTile icon="trash-outline" tone="warning" />}
            title="Discard draft"
            meta="Removes these entries from this device"
            onPress={() => {
              setSheet(null);
              onDiscard();
            }}
          />
        </Card>
      </BottomSheet>
      <PayerSheet
        visible={editor === 'payers'}
        draft={draft}
        members={context ? members : null}
        currentUserId={currentUserId}
        locked={locked}
        persistence={state.persistence}
        name={name}
        onChange={onChange}
        onDone={() => {
          setEditor(null);
          onLeaveField('payers');
        }}
      />
    </>
  );
}

/** "Draft saved" while this device keeps entries that differ from where the form started. */
function DraftStatus({ persistence, kept }: { persistence: Editor['persistence']; kept: boolean }) {
  const theme = useTheme();
  // Writes run on every keystroke; only one that takes a while says so.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (persistence !== 'saving') return;
    const timer = setTimeout(() => setSlow(true), 400);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [persistence]);
  const saving = persistence === 'saving' && slow;
  if (persistence !== 'error' && !saving && !kept) return null;
  const [icon, text, color] =
    persistence === 'error'
      ? (['alert-circle-outline', 'Draft not saved', theme.status.negative] as const)
      : saving
        ? (['sync-outline', 'Saving draft…', theme.textSecondary] as const)
        : (['checkmark', 'Draft saved', theme.textSecondary] as const);
  return (
    <View
      accessible
      accessibilityLabel={text}
      // Only a failure is announced.
      accessibilityLiveRegion={persistence === 'error' ? 'polite' : 'none'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }}
    >
      <Icon name={icon} size={16} color={color} />
      <CompactText variant="caption" style={{ color }}>
        {text}
      </CompactText>
    </View>
  );
}
