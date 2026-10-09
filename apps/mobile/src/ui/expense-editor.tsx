import type { MobileController } from '../data/mobile-controller';
import { DraftStatus } from './draft-status';
import { SelectedDraftStatus } from './draft-status-selection';
import { SelectedExpenseTiles } from './expense-tile-selection';
import { SelectedWhoOwesWhat } from './expense-allocation-selection';
import { SelectedSplitSheet, SelectedPayerSheet } from './expense-sheet-selection';
import { SelectedOptionalDetails } from './expense-optional-details';
import { canEditExpense } from '../data/expense-record';
import {
  ExpenseRecordScreen,
  ExpenseRecordSkeleton,
  ExpenseRecordView,
  type RecordOutline,
} from './expense-record-view';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { AccessibilityInfo, ScrollView, View, type TextInput } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { expenseDifferences } from '@splitbook/shared/expense-review';
import { enteredPayers } from '@splitbook/shared/payer-remainder';
import {
  draftFromExpense,
  expenseDraftChanged,
  expenseContextPending,
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
import { Button, Loading, Notice } from './primitives';
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
  Skeleton,
  TileGrid,
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

const contextNotices = {
  checking: {
    tone: 'info',
    title: 'Checking Group',
    message:
      'You can enter the amount, description, date and notes while current members, Tags and currency are checked. Financial choices and Save wait for this check.',
  },
  failed: {
    tone: 'warning',
    title: 'Group not checked',
    message:
      'Could not verify this Group. Your entries are kept. Retry to unlock financial choices and Save.',
  },
  saved: {
    tone: 'offline',
    title: 'Saved Group',
    message: 'Using the saved Group. Connect to verify current financial choices before saving.',
  },
} satisfies Record<
  NonNullable<Editor['contextCheck']>['status'],
  {
    tone: 'info' | 'warning' | 'offline';
    title: string;
    message: string;
  }
>;

/**
 * Android clamps the scroll offset when notices disappear or the footer gets shorter. Keep
 * their largest natural height for this task so an already-focused input stays in place.
 * The inner view measures only its children, never the outer minimum: no layout feedback.
 */
function RetainHeight({
  children,
  enabled = true,
  footer = false,
}: {
  children: ReactNode;
  enabled?: boolean;
  footer?: boolean;
}) {
  const [height, setHeight] = useState(0);
  const theme = useTheme();
  if (!enabled) return <>{children}</>;
  return (
    <View
      style={{
        minHeight: height,
        justifyContent: footer ? 'flex-end' : undefined,
        backgroundColor: footer ? theme.bgElevated : undefined,
      }}
    >
      <View
        style={footer ? undefined : { gap: 12 }}
        onLayout={(event) => {
          const natural = event.nativeEvent.layout.height;
          setHeight((before) => Math.max(before, natural));
        }}
      >
        {children}
      </View>
    </View>
  );
}

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
      resetKey={
        props.controller ? (state.blank ?? state.draft?.original ?? state.groupId) : state.draft
      }
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
  controller,
  state,
  currentUserId,
  kept = false,
  onClose,
  notice,
  emptyNotice,
  offline = false,
  onChange,
  onSave,
  onResume,
  onDiscard,
  onDiscardUnconfirmed,
  onRetry,
  onRefresh,
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
  onLoadNewerHistory,
  onRetryHistory,
  outline,
}: {
  controller?: MobileController;
  state: Editor;
  /** Shown as "You" in the form. */
  currentUserId?: string;
  /**
   * A draft is kept on this phone for this Group, as its Group last read: opening a new Expense
   * says "draft" only then, even before the draft itself is read (#334).
   */
  kept?: boolean;
  /** Close or Back: returns to the Group and keeps the draft on this device. */
  onClose?: () => void;
  /** Shown above the content, such as the offline notice. */
  notice?: ReactNode;
  /**
   * Shown instead while the Expense opens, or when nothing of it could be: the offline notice
   * without the saved copy's time or a second Try again (#332's rule, #220).
   */
  emptyNotice?: ReactNode;
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
  /**
   * The record's Refresh: reads it and its changes again where they are, keeping the pages
   * loaded (#220, M1-3). Without it, the record opens again.
   */
  onRefresh?: () => void;
  onEdit: () => void;
  onReviewDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onReconcile: () => void;
  onReviewLatest: () => void;
  onAcceptCurrent: () => void;
  /** The saved record's older changes, and another read of its changes after a failure. */
  onLoadOlderHistory?: () => void;
  /** Its newer changes, once the window of changes has slid past the newest (#220). */
  onLoadNewerHistory?: () => void;
  onRetryHistory?: () => void;
  /** What the list row an Expense opens from already says, so its skeleton takes its shape. */
  outline?: RecordOutline | null;
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
  // Whether the skeleton showed the list row's summary: it stays as it was when the record lands.
  const outlined = useRef(false);
  if (opening) outlined.current = !!outline;
  const errors = state.validation.errors;
  const refs = useMemo(
    () =>
      Object.fromEntries(
        expenseFields.map((field) => [
          field,
          {
            section: (node: View | null) => {
              sections.current[field] = node;
            },
            input: (node: TextInput | null) => {
              inputs.current[field] = node;
            },
            correction: (node: View | null) => {
              corrections.current[field] = node;
            },
          },
        ]),
      ),
    [],
  );
  const section = useCallback((field: ExpenseField) => refs[field].section, [refs]);
  const input = useCallback((field: ExpenseField) => refs[field].input, [refs]);
  const correction = useCallback((field: ExpenseField) => refs[field].correction, [refs]);
  const openTile = useCallback(
    (tile: 'date' | 'payers' | 'split' | 'tag') =>
      tile === 'payers' ? setEditor(tile) : setSheet(tile),
    [],
  );
  const amountDone = useCallback(() => inputs.current.description?.focus(), []);
  const SplitEditor = controller ? SelectedSplitSheet : SplitSheet;
  const PayerEditor = controller ? SelectedPayerSheet : PayerSheet;
  const { draft, context } = state;
  const members = useMemo(() => context?.group.members.map(({ user }) => user) ?? [], [context]);
  const name = useCallback(
    (id: string) =>
      members.find((member) => member.id === id)?.name ??
      [draft?.original, state.latest]
        .flatMap((saved) => [...(saved?.paidBy ?? []), ...(saved?.splitBetween ?? [])])
        .find((row) => row.user === id)?.name ??
      'Unavailable member',
    [members, draft?.original, state.latest],
  );
  const record = !!draft?.original && ['detail', 'delete-review'].includes(state.status);
  const form = showsForm(state);
  // A save that may already be recorded stays locked until it is checked.
  const unconfirmed =
    form &&
    (['resume', 'uncertain'].includes(state.status) ||
      (state.status === 'blocked' && state.accessLost)) &&
    !!(state.attempt || state.mutation);
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
  // The offline banner speaks of what's shown: while the Expense opens, or when nothing of it
  // could be, it only says the phone is offline, and the screen's own Try again stands alone
  // (the loading-state audit, #220).
  const shownNotice = draft && state.status !== 'loading' ? notice : emptyNotice;
  const newTask = !state.requestedExpenseId && !draft?.original;
  const frame = (body: ReactNode, footer?: ReactNode) => (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TopBar
        title={
          newTask
            ? 'Add expense'
            : !draft || state.status === 'loading' || record
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
        prominent={!form && !newTask}
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
            controller ? (
              <SelectedDraftStatus controller={controller} />
            ) : (
              <DraftStatus
                persistence={state.persistence}
                kept={
                  !!(state.attempt || state.mutation) || expenseDraftChanged(draft!, state.blank)
                }
              />
            )
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
        {newTask && form ? null : shownNotice}
        {state.waitingInvitation ? (
          <Notice
            title="Invitation waiting"
            message="Your invitation will open after you keep or discard this draft, or finish saving it."
          />
        ) : null}
        {body}
      </ScrollView>
      {newTask && form && footer ? <RetainHeight footer>{footer}</RetainHeight> : footer}
    </View>
  );

  const requested = !!state.requestedExpenseId;
  if (state.status === 'loading')
    return frame(
      opening ? (
        <ExpenseRecordSkeleton label="Opening this Expense…" outline={outline} />
      ) : !newTask ? (
        <Loading label={requested ? 'Opening this Expense…' : 'Opening your draft…'} />
      ) : (
        <View
          accessibilityLabel={draft || kept ? 'Opening your draft…' : 'Opening a new Expense…'}
          accessibilityState={{ busy: true }}
          accessibilityLiveRegion="polite"
          style={{ gap: 12 }}
        >
          <CompactText variant="small" tone="secondary">
            {draft || kept ? 'Opening your draft…' : 'Opening a new Expense…'}
          </CompactText>
          <Card padded>
            <CompactText variant="small" tone="secondary">
              Amount
            </CompactText>
            <Skeleton width="60%" height={48} />
            <CompactText variant="small" tone="secondary">
              Description
            </CompactText>
            <Skeleton width="80%" height={48} />
          </Card>
          <TileGrid>
            {['Date', 'Paid by', 'Split', 'Tag'].map((label) => (
              <Card key={label} padded>
                <CompactText variant="small" tone="secondary">
                  {label}
                </CompactText>
                <Skeleton width="75%" line="body" />
              </Card>
            ))}
          </TileGrid>
        </View>
      ),
    );
  if (!draft)
    return frame(
      <Notice
        title={
          requested
            ? 'Couldn’t open this Expense'
            : kept
              ? 'Couldn’t open this draft'
              : 'Couldn’t open a new Expense'
        }
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
        onRefresh={onRefresh ?? onRetry}
        onLoadOlderHistory={onLoadOlderHistory}
        onLoadNewerHistory={onLoadNewerHistory}
        onRetryHistory={onRetryHistory}
        reveal={recordReveal}
        outlined={outlined.current}
      />
    );
  const locked = state.status !== 'editing';
  const checking = state.contextCheck;
  const pendingContext = expenseContextPending(state, offline);
  const financialLocked = locked || pendingContext;
  const checkNotice = checking ? contextNotices[checking.status] : null;
  const checkingMessage = checkNotice?.message ?? '';
  const invalidMembers =
    !checking &&
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
    if (!pendingContext) allocation = expenseMoney(draft);
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
        : checking
          ? 'Save waits for current Group verification.'
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
                state.accessLost
                  ? `${state.message ? `${state.message} ` : ''}This save or change may already be recorded. Its retry will be removed from this device when you leave. If access returns, check the Group’s Expenses before saving again.`
                  : (state.message ??
                    (state.attempt
                      ? state.attemptRejected
                        ? `SplitBook refused a retry of this save. ${refusedRetryNotice}`
                        : `This Expense may already be in ${context?.group.name ?? 'the Group'}. Checking reuses the same submission, so it can’t be recorded twice.`
                      : `${state.mutation?.kind === 'delete' ? 'This Expense may already be deleted.' : 'This change may already be saved.'} Checking reads the saved Expense first, so nothing is sent twice.`))
              }
            >
              {(state.attemptRejected || (state.accessLost && state.status === 'blocked')) &&
                onDiscardUnconfirmed && (
                  <CompactButton
                    label="Discard unconfirmed save"
                    variant="text"
                    dense
                    onPress={onDiscardUnconfirmed}
                  />
                )}
            </Banner>
          ) : state.status === 'blocked' && state.accessLost ? (
            <Banner
              tone="warning"
              title="Group access lost"
              message="This draft will be removed from this device when you leave. Nothing has been sent. If access returns, check the Group’s Expenses before saving again."
            >
              <CompactButton label="Discard draft" variant="text" dense onPress={onDiscard} />
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
          <AmountDescriptionCard
            controller={controller}
            draft={draft}
            locked={locked}
            showLock={unconfirmed}
            errors={errors}
            amountRef={input('amount')}
            descriptionRef={input('description')}
            section={section}
            onChange={onChange}
            onLeave={onLeaveField}
            onAmountDone={amountDone}
          ></AmountDescriptionCard>
          {controller ? (
            <SelectedExpenseTiles
              controller={controller}
              currentUserId={currentUserId}
              locked={locked}
              financialLocked={financialLocked}
              correction={correction}
              section={section}
              onOpen={openTile}
            />
          ) : (
            <ExpenseTiles
              locked={locked}
              financialLocked={financialLocked}
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
              onOpen={openTile}
            />
          )}
          {controller ? (
            <SelectedOptionalDetails
              controller={controller}
              locked={locked}
              categoryLocked={financialLocked}
              onChange={onChange}
            />
          ) : (
            <OptionalDetails
              draft={draft}
              locked={locked}
              categoryLocked={financialLocked}
              onChange={onChange}
            />
          )}
          <RetainHeight enabled={newTask}>
            {newTask ? shownNotice : null}
            {/* The Group's details are unknown: offline, refused, or not read. Each says which. */}
            {checking && checkNotice ? (
              <Banner tone={checkNotice.tone} title={checkNotice.title} message={checkingMessage}>
                {checking.saved && checking.refreshedAt && (
                  <CompactText variant="small" tone="secondary">
                    Saved Group checked {new Date(checking.refreshedAt).toLocaleString()}
                  </CompactText>
                )}
                {checking.status !== 'checking' && (
                  <CompactButton label="Retry Group check" variant="text" dense onPress={onRetry} />
                )}
              </Banner>
            ) : null}
            {!context &&
              !checking &&
              (offline ? (
                <Banner
                  tone="offline"
                  message="Connect to check the current members and Tags. You can still edit your saved text."
                />
              ) : (
                <Banner
                  tone="warning"
                  standing
                  message={
                    state.status === 'blocked'
                      ? 'You no longer have access to this Group’s members and Tags. Your draft is kept.'
                      : 'Couldn’t check the current members and Tags. You can still edit your saved text.'
                  }
                />
              ))}
            {!checking &&
            !draft.original &&
            context &&
            draft.currency !== context.group.defaultCurrency ? (
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
                  disabled={financialLocked}
                  onPress={() => onChange({ currency: context.group.defaultCurrency })}
                />
              </View>
            ) : null}
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
            {!pendingContext &&
              (controller ? (
                <SelectedWhoOwesWhat
                  controller={controller}
                  name={name}
                  currentUserId={currentUserId}
                />
              ) : (
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
              ))}
            {/* The banners above already say why a save is unconfirmed or in conflict. */}
            {state.message &&
              !summary &&
              !unconfirmed &&
              !conflict &&
              state.status !== 'resume' && (
                <CompactText
                  variant="small"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
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
          </RetainHeight>
        </>,
        unconfirmed ? (
          <SaveBar
            label={state.attempt ? 'Check and finish saving' : 'Check the saved Expense'}
            blocked={checking ? checkingMessage : offline ? 'Checking needs a connection.' : null}
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
      {sheet === 'date' ? (
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
      ) : null}
      {sheet === 'split' ? (
        <SplitEditor
          controller={controller!}
          visible={sheet === 'split'}
          draft={draft}
          members={context ? members : null}
          currentUserId={currentUserId}
          locked={financialLocked}
          persistence={state.persistence}
          name={name}
          money={money}
          onChange={onChange}
          onDone={() => {
            setSheet(null);
            onLeaveField('split');
          }}
        />
      ) : null}
      {sheet === 'tag' ? (
        <TagSheet
          visible={sheet === 'tag'}
          tags={context ? activeTags : null}
          tagId={draft.tagId}
          error={tagReport.error}
          notice={tagNotice}
          locked={financialLocked}
          onChoose={(tagId) => {
            onChange({ tagId });
            setSheet(null);
          }}
          onDone={() => {
            setSheet(null);
            onLeaveField('tag');
          }}
        />
      ) : null}
      {sheet === 'options' ? (
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
      ) : null}
      {editor === 'payers' ? (
        <PayerEditor
          controller={controller!}
          visible={editor === 'payers'}
          draft={draft}
          members={context ? members : null}
          currentUserId={currentUserId}
          locked={financialLocked}
          persistence={state.persistence}
          name={name}
          onChange={onChange}
          onDone={() => {
            setEditor(null);
            onLeaveField('payers');
          }}
        />
      ) : null}
    </>
  );
}
