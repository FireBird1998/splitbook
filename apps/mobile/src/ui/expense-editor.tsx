import { canEditExpense } from '../data/expense-record';
import { ExpenseRecordView } from './expense-record-view';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, ScrollView, View, type TextInput } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { toDateParam } from '@splitbook/shared/date';
import {
  expenseFieldLabels,
  expenseFields,
  expenseMoney,
  type ExpenseDraft,
  type ExpenseEditor as Editor,
  type ExpenseField,
} from '../data/expense-draft';
import { Field } from './group-workflows';
import { Button, Copy, Icon, Loading, Notice, Panel } from './primitives';
import {
  Banner,
  BottomSheet,
  Card,
  Chip,
  CompactButton,
  CompactText,
  FieldMarker,
  IconButton,
  IconTile,
  ListRow,
  TopBar,
} from './compact';
import { AllocationEditor } from './allocation-editors';
import {
  AmountDescriptionCard,
  ExpenseTiles,
  OptionalDetails,
  SaveBar,
  WhoOwesWhat,
  expenseDateLabel,
  splitSummary,
} from './expense-form';
import { fonts, useTheme } from './theme';

/**
 * The Expense task, full screen without the Group's bottom navigation: the compact form for
 * adding and editing, and the saved record. Close and Android Back keep the draft.
 */
export function ExpenseEditor({
  state,
  currentUserId,
  onClose,
  notice,
  onChange,
  onSave,
  onResume,
  onDiscard,
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
}: {
  state: Editor;
  /** Shown as "You" in the form. */
  currentUserId?: string;
  /** Close or Back: returns to the Group and keeps the draft on this device. */
  onClose?: () => void;
  /** Shown above the content, such as the offline notice. */
  notice?: ReactNode;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  /** Called when a field loses focus, so its correction can appear. */
  onLeaveField: (field: ExpenseField) => void;
  /** Told whenever a section is scrolled into view. */
  onReveal?: (section: View) => void;
  onSave: () => void;
  onResume: () => void;
  onDiscard: () => void;
  onRetry: () => void;
  onEdit: () => void;
  onReviewDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onReconcile: () => void;
  onReviewLatest: () => void;
  onAcceptCurrent: () => void;
}) {
  const theme = useTheme();
  const [editor, setEditor] = useState<'payers' | 'split' | null>(null);
  const [sheet, setSheet] = useState<'date' | 'tag' | 'options' | null>(null);
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
  const form = !!draft && !record && state.status !== 'loading';
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
        status={form ? <DraftStatus persistence={state.persistence} draft={draft!} /> : null}
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

  if (state.status === 'loading') return frame(<Loading label="Opening your draft…" />);
  if (!draft)
    return frame(
      <Notice
        title="Couldn’t open this draft"
        message={state.message ?? 'Please try again.'}
        retry={onRetry}
      />,
    );
  const locked = state.status !== 'editing';
  const members = context?.group.members.map(({ user }) => user) ?? [];
  const name = (id: string) =>
    members.find((member) => member.id === id)?.name ??
    [...(draft.original?.paidBy ?? []), ...(draft.original?.splitBetween ?? [])].find(
      (row) => row.user === id,
    )?.name ??
    'Unavailable member';
  const invalidMembers =
    context &&
    [
      ...(draft.multiPayer ? draft.payers.map((payer) => payer.user) : [draft.payerId]),
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
  // Save stays available for incomplete input so it can explain what is missing.
  const saveBlocked =
    state.status === 'saving'
      ? 'Sending this Expense. Keep this screen open until SplitBook confirms it.'
      : state.persistence === 'error'
        ? 'Save is unavailable until this draft is stored on this device. Retry saving the draft first.'
        : state.persistence === 'saving'
          ? 'Available once your latest entries are stored on this device.'
          : null;

  if (record)
    return frame(
      <>
        <ExpenseRecordView record={draft.original!} people={members} tags={context?.tags} />
        {state.message ? <Copy accessibilityRole="alert">{state.message}</Copy> : null}
        {state.status === 'delete-review' ? (
          <Panel>
            <Copy accessibilityRole="header" style={{ fontFamily: fonts.semibold }}>
              Delete this Expense?
            </Copy>
            <Copy>
              This removes the Expense from balances. Its saved history is retained. Review the
              record above before confirming.
            </Copy>
            <Button label="Confirm delete Expense" onPress={onDelete} />
            <Button label="Keep Expense" secondary onPress={onCancelDelete} />
          </Panel>
        ) : !draft.original!.isDeleted ? (
          <>
            <Button
              label="Edit Expense"
              onPress={onEdit}
              disabled={!canEditExpense(draft.original!)}
            />
            {!canEditExpense(draft.original!) ? (
              <Copy>
                This historical Expense includes a member whose account is no longer available. It
                can be reviewed or deleted, but not edited.
              </Copy>
            ) : null}
            <Button label="Delete Expense" secondary onPress={onReviewDelete} />
            <Button label="Refresh Expense" secondary onPress={onRetry} />
          </>
        ) : null}
      </>,
    );

  const invalid = expenseFields.filter((field) => errors[field]);
  const summary = state.validation.submitted && invalid.length > 0;
  const canSave =
    state.status === 'editing' ||
    state.status === 'saving' ||
    (!draft.original && state.status === 'uncertain');
  const tagNotice =
    !errors.tag && draft.tagId && context && (!tag || tag.isArchived || tag.isDeleted)
      ? draft.original && draft.tagId === (draft.original.tagId ?? '')
        ? `Historical Tag: ${tag?.name ?? draft.original.tag}. This association is retained.`
        : state.attempt
          ? `Submitted Tag: ${tag?.name ?? 'unavailable'}. Recovery keeps the original Tag identity.`
          : `Saved Tag: ${tag?.name ?? 'unavailable'}. It is unavailable or archived; choose an active Tag before saving.`
      : null;
  const today = toDateParam(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = toDateParam(yesterdayDate);

  return (
    <>
      {frame(
        <>
          {state.latest && (
            <ExpenseRecordView
              record={state.latest}
              title="Current saved record"
              people={members}
              tags={context?.tags}
            />
          )}
          {state.status === 'conflict' && (
            <Panel>
              <Copy>
                Your draft is shown below. Compare every field with the current record before
                choosing.
              </Copy>
              <Button
                label="Keep my draft for review"
                onPress={onReviewLatest}
                disabled={!state.latest || !canEditExpense(state.latest)}
              />
              <Button label="Keep current saved record" secondary onPress={onAcceptCurrent} />
            </Panel>
          )}
          {state.status === 'blocked' && state.latest && (
            <Button label="Keep current saved record" secondary onPress={onAcceptCurrent} />
          )}
          {/* An ordinary draft was never sent; an unconfirmed save may already be recorded. */}
          {state.status === 'resume' &&
            (state.attempt || state.mutation ? (
              <View style={{ gap: 12 }}>
                <Banner
                  tone="warning"
                  title="Save not confirmed"
                  message={
                    state.mutation
                      ? 'This change may already be saved. Resume to check the current Expense before anything else is sent.'
                      : 'This Expense may already be saved. Resume to confirm it with the same details; it can’t be added twice.'
                  }
                />
                <Button label="Resume save recovery" onPress={onResume} />
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                <Banner
                  tone="info"
                  title="Unfinished draft"
                  message="Nothing has been sent. Resume your entries or discard them to start again."
                />
                <Button label="Resume draft" onPress={onResume} />
                <Button label="Discard draft" secondary onPress={onDiscard} />
              </View>
            ))}
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
            errors={errors}
            values={{
              date: expenseDateLabel(draft.date),
              payers: draft.multiPayer
                ? `${draft.payers.length} ${draft.payers.length === 1 ? 'person' : 'people'}`
                : draft.payerId === currentUserId
                  ? 'You'
                  : name(draft.payerId),
              split: splitSummary(draft),
              tag:
                tag?.name ??
                (draft.tagId ? (draft.original?.tag ?? 'Unavailable Tag') : 'Choose a Tag'),
            }}
            correction={correction}
            section={section}
            onOpen={(tile) =>
              tile === 'payers' || tile === 'split' ? setEditor(tile) : setSheet(tile)
            }
          />
          {tagNotice ? (
            <CompactText variant="small" tone="warning" accessibilityRole="alert">
              {tagNotice}
            </CompactText>
          ) : null}
          {context && !activeTags.length ? (
            <CompactText variant="small" tone="secondary">
              This Group needs an active Tag. Add one on the web, then reopen this draft.
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
          {state.message && !summary && (
            <CompactText variant="small" accessibilityRole="alert" accessibilityLiveRegion="polite">
              {state.message}
            </CompactText>
          )}
          {state.persistence === 'error' && !state.attempt && (
            <Button label="Retry saving draft" secondary onPress={() => onChange({})} />
          )}
          {draft.original && ['uncertain', 'blocked'].includes(state.status) && (
            <Button label="Check current Expense" onPress={onReconcile} />
          )}
          {(state.attempt || state.mutation) && (
            <CompactText variant="small" tone="secondary">
              Details are locked until the save is confirmed. Signing out removes recovery
              information; check Group history before recreating this expense.
            </CompactText>
          )}
        </>,
        canSave ? (
          <SaveBar
            label={
              state.status === 'saving'
                ? 'Saving expense…'
                : state.attempt
                  ? 'Retry same submission'
                  : draft.original
                    ? 'Save changes'
                    : 'Save expense'
            }
            amount={
              allocation && state.status !== 'saving' ? money(allocation.amountMinor) : undefined
            }
            blocked={saveBlocked}
            onSave={onSave}
          />
        ) : null,
      )}
      <BottomSheet
        visible={sheet === 'date'}
        title="Date"
        titleAccessory={<FieldMarker kind="required" />}
        onDone={() => {
          setSheet(null);
          onLeaveField('date');
        }}
      >
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip
              label="Today"
              selected={draft.date === today}
              onPress={() => !locked && onChange({ date: today })}
            />
            <Chip
              label="Yesterday"
              selected={draft.date === yesterday}
              onPress={() => !locked && onChange({ date: yesterday })}
            />
          </View>
          <Field
            label="Date"
            required
            hint="Use YYYY-MM-DD."
            value={draft.date}
            maxLength={10}
            editable={!locked}
            error={errors.date}
            onBlur={() => onLeaveField('date')}
            onChangeText={(date) => onChange({ date })}
          />
        </View>
      </BottomSheet>
      <BottomSheet
        visible={sheet === 'tag'}
        title="Tag"
        titleAccessory={<FieldMarker kind="required" />}
        onDone={() => {
          setSheet(null);
          onLeaveField('tag');
        }}
        footer={
          <CompactText variant="small" tone="secondary">
            Only this Group’s active Tags are listed.
          </CompactText>
        }
      >
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Tag"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
        >
          {activeTags.map((item) => (
            <Chip
              key={item.id}
              role="radio"
              label={`Tag: ${item.name}`}
              selected={draft.tagId === item.id}
              onPress={() => {
                if (locked) return;
                onChange({ tagId: item.id });
                setSheet(null);
              }}
            />
          ))}
        </View>
      </BottomSheet>
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
      <AllocationEditor
        editor={editor}
        draft={draft}
        members={members}
        locked={locked}
        persistence={state.persistence}
        allocationError={allocationError}
        onChange={onChange}
        onClose={() => setEditor(null)}
      />
    </>
  );
}

/** "Draft saved" once the entries are stored on this device. */
function DraftStatus({
  persistence,
  draft,
}: {
  persistence: Editor['persistence'];
  draft: ExpenseDraft;
}) {
  const theme = useTheme();
  if (persistence === 'saved' && !draft.amount && !draft.description) return null;
  const [icon, text, color] =
    persistence === 'saved'
      ? (['checkmark', 'Draft saved', theme.textSecondary] as const)
      : persistence === 'saving'
        ? (['sync-outline', 'Saving draft…', theme.textSecondary] as const)
        : (['alert-circle-outline', 'Draft not saved', theme.status.negative] as const);
  return (
    <View
      accessible
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 }}
    >
      <Icon name={icon} size={16} color={color} />
      <CompactText variant="caption" style={{ color }}>
        {text}
      </CompactText>
    </View>
  );
}
