import { HeldUpdateFooter } from './held-update-snackbar';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  buildToReview,
  summarizeReviewRun,
  describeDraftChange,
  needsAmount,
  payerListedTwice,
  PAYER_LISTED_TWICE,
  SPLIT_LISTED_TWICE,
  splitListedTwice,
  type ReviewNeed,
} from '@splitbook/shared/to-review';
import {
  formatCurrency,
  formatCurrencyAsEntered,
  getCurrency,
  getCurrencyPrecision,
} from '@splitbook/shared/currency';
import { expenseCurrencyChoices } from '@splitbook/shared/group-currencies';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { toDateParam } from '@splitbook/shared/date';
import type { MobileController } from '../data/mobile-controller';
import { reviewForm, reviewFormChange } from '../data/review-form';
import type { ExpenseDraft } from '../data/expense-draft';
import { useMobileSnapshot, sameSelection } from './use-mobile-snapshot';
import {
  Banner,
  BottomSheet,
  Card,
  CompactButton,
  CompactText,
  Divider,
  IconButton,
  IconTile,
  Money,
  TopBar,
  denseHitSlop,
  touch,
  useConfirm,
  useTap,
} from './compact';
import { Icon } from './primitives';
import {
  ActionBar,
  ExpenseTiles,
  expenseDateLabel,
  splitSummary,
  OptionalDetails,
} from './expense-form';
import { DateSheet } from './date-sheet';
import {
  CurrencyBadge,
  CurrencyChip,
  CurrencySymbol,
  RequiredFieldLabel,
  useDescriptionPlaceholder,
} from './expense-inputs';
import { CurrencySheet } from './currency-sheet';
import { clockTime } from './activity-format';
import { recentDay, spellDay } from './day-format';
import { PayerSheet, paidBySummary } from './payer-sheet';
import { SplitSheet } from './split-sheet';
import { TagSheet } from './tag-sheet';
import { useStartWhileUnfocused } from './start-while-unfocused';
import { fonts, useTheme } from './theme';
import { reviewedItemsLine } from './review-run-copy';
import { expenseLocalDate } from '@splitbook/shared/expense-day';
import { NO_BREAK_SPACE, SEPARATOR } from '@splitbook/shared/separator';

/**
 * An amount as its field shows it, with its currency's places, as Add expense does: 18.4 in euros
 * is "18.40" (#874). One with more places than the currency has stays as entered (#537).
 */
function amountText(amount: string, currency: string) {
  if (!/^\d+(?:\.\d+)?$/.test(amount)) return amount;
  const places = getCurrency(currency) ? getCurrencyPrecision(currency) : 2;
  const [whole, fraction = ''] = amount.split('.');
  return fraction.length >= places ? amount : `${whole}.${fraction.padEnd(places, '0')}`;
}

/** As entered, never rounded: the Needs line says when it has too many decimals (#537). */
function money(amount: number | undefined, currency: string | undefined) {
  if (amount === undefined || !currency) return 'Amount needed';
  return formatCurrencyAsEntered(amount, currency);
}
export function ReviewRunOverlay({ controller }: { controller: MobileController }) {
  const snapshot = useMobileSnapshot(
    controller,
    (s) => ({
      run: s.toReview.run,
      offline: s.toReview.offline || s.offline.active,
      user: s.auth.user,
    }),
    sameSelection,
  );
  const theme = useTheme();
  const [confirm, confirmation] = useConfirm();
  if (
    !snapshot.run ||
    !snapshot.user ||
    process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED !== 'true'
  )
    return null;
  const close = () => {
    if (!controller.getSnapshot().toReview.run?.unkept) return void controller.closeReviewRun();
    confirm({
      title: 'Leave without your latest changes?',
      message: 'These changes have not been kept. The last kept details stay in To review.',
      action: 'Leave without changes',
      cancel: 'Keep editing',
      onConfirm: () => void controller.closeReviewRun(),
    });
  };
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        {/* The keyboard leaves room for what's typed: the run shrinks above it. */}
        <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
          <ReviewRunContent
            key={`${snapshot.run.index}:${snapshot.run.changed?.after.revision ?? 0}`}
            controller={controller}
            state={snapshot.run}
            offline={snapshot.offline}
            userId={snapshot.user.id}
            close={close}
          />
        </KeyboardAvoidingView>
        {confirmation}
      </SafeAreaView>
    </Modal>
  );
}

/** The run's screen: its top bar, then what scrolls, then the bar pinned at the foot. */
function RunScreen({
  controller,
  bar,
  progress,
  children,
  ...top
}: {
  controller: MobileController;
  title: string;
  subtitle: string;
  close(): void;
  /** Check latest details, while there is an item to check. */
  refresh?: { onPress(): void; disabled: boolean };
  progress?: ReactNode;
  bar: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <TopBar
        title={top.title}
        subtitle={top.subtitle}
        subtitleLines={2}
        prominent={false}
        leading={{ kind: 'close', label: 'Close review', onPress: top.close }}
        actions={
          top.refresh ? (
            <IconButton
              icon="refresh-outline"
              label="Check latest details"
              disabled={top.refresh.disabled}
              onPress={top.refresh.onPress}
            />
          ) : null
        }
      />
      {progress}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 }}
      >
        {children}
      </ScrollView>
      <HeldUpdateFooter controller={controller}>
        <ActionBar>{bar}</ActionBar>
      </HeldUpdateFooter>
    </>
  );
}

/** One segment per item: done in green, this one in the brand colour, the rest muted. */
function RunProgress({ index, total }: { index: number; total: number }) {
  const theme = useTheme();
  const segments = Math.max(1, total);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Review progress"
      accessibilityValue={{
        min: 0,
        max: total,
        now: index,
        text: `${index} done, item ${index + 1} of ${total}, ${total - index - 1} remaining`,
      }}
      style={{
        flexDirection: 'row',
        gap: segments > 24 ? 0 : 4,
        paddingHorizontal: 16,
        paddingBottom: 10,
      }}
    >
      {Array.from({ length: segments }, (_, at) => (
        <View
          key={at}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor:
              at < index
                ? theme.positive.main
                : at === index
                  ? theme.brand.main
                  : theme.surfaceMuted,
          }}
        />
      ))}
    </View>
  );
}

/** Where the item came from: the assistant's initials, or a bookmark for one you set aside. */
function RunSource({
  assistant,
  title,
  detail,
}: {
  assistant?: string;
  title: string;
  detail: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 2 }}>
      {assistant ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: theme.text,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CompactText weight="semibold" maxFontSizeMultiplier={1.3} style={{ color: theme.bg }}>
            {assistant.slice(0, 2)}
          </CompactText>
        </View>
      ) : (
        <IconTile icon="bookmark-outline" />
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <CompactText weight="semibold">{title}</CompactText>
        <CompactText variant="caption" tone="secondary">
          {detail}
        </CompactText>
      </View>
    </View>
  );
}

/** A count at the end of the run, label then figure. */
function Tally({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone?: 'positive' | 'warning';
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label} ${count}`}
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
      }}
    >
      <CompactText>{label}</CompactText>
      <Money tone={count ? tone : undefined}>{String(count)}</Money>
    </View>
  );
}

function ReviewRunContent({
  controller,
  state,
  offline,
  userId,
  close,
}: {
  controller: MobileController;
  state: NonNullable<ReturnType<MobileController['getSnapshot']>['toReview']['run']>;
  offline: boolean;
  userId: string;
  close(): void;
}) {
  const theme = useTheme();
  // A drag that starts on the duplicate checkbox never checks it (#684).
  const duplicateTap = useTap();
  const machine = controller.reviewRun()!;
  const selected = state.items[state.index];
  const [invalid, setInvalid] = useState<string | null>(null);
  const [typedAmount, setTypedAmount] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'date' | 'payers' | 'split' | 'tag' | 'currency' | null>(null);
  const descriptionStart = useStartWhileUnfocused();
  const descriptionPlaceholder = useDescriptionPlaceholder();
  if (!selected) {
    const summary = summarizeReviewRun(state.outcomes);
    const reviewedIds = new Set(state.outcomes.map(({ id }) => id));
    const reviewed = state.items.filter(({ item }) => reviewedIds.has(item.draft.id));
    return (
      <RunScreen
        controller={controller}
        title="To review"
        subtitle="Finished"
        close={close}
        bar={<CompactButton label="Done" block onPress={close} />}
      >
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 40, paddingHorizontal: 8 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.positive.bg,
            }}
          >
            <Icon name="checkmark" size={30} color={theme.status.positive} />
          </View>
          <CompactText variant="title" accessibilityRole="header">
            Done for now
          </CompactText>
          <CompactText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
            {reviewedItemsLine(reviewed.length, [...new Set(reviewed.map((row) => row.groupName))])}
          </CompactText>
        </View>
        <Card>
          <Tally label="Saved" count={summary.saved} tone="positive" />
          <Divider />
          <Tally label="Deleted" count={summary.deleted} />
          <Divider />
          <Tally label="Left for later" count={summary.left} tone="warning" />
        </Card>
        <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          What you skipped stays in To review.
        </CompactText>
      </RunScreen>
    );
  }
  const { item, groupId, groupName } = selected;
  const values = item.draft.values ?? {};
  // An item without a currency is in its Group's, as on Add expense (#512).
  const groupCurrency = selected.currency;
  const model = buildToReview(
    {
      total: 1,
      groups: [
        {
          groupId,
          groupName,
          currency: groupCurrency,
          category: selected.category,
          count: 1,
          items: [item],
        },
      ],
    },
    [],
    new Date(controller.reviewNow()),
  ).items[0];
  const groups = new Set(state.items.map((row) => row.groupId)).size;
  const locked = offline || (state.busy && !state.editing) || state.pending || !state.context;
  const missing = model.missingFacts;
  const hasNeed = (field: string, reason?: ReviewNeed['reason']) =>
    model.needs.some(
      (need) =>
        need.field === field &&
        (reason ? need.reason === reason : need.reason === 'missing' || need.reason === 'invalid'),
    );
  const reason = offline
    ? 'Connect to change or save this'
    : state.pending
      ? 'We didn’t hear back, so it may already be saved'
      : model.needs.length
        ? `${missing.length === 1 ? 'One thing' : `${missing.length}${NO_BREAK_SPACE}things`} left before you can save: ${missing.join(', ')}`
        : item.duplicates.some(
              (d) => d.kind === 'expense' && !state.matches.some((expense) => expense._id === d.id),
            )
          ? 'Check the matching expense before saving'
          : model.state === 'duplicate' && !state.acknowledged
            ? 'Confirm it is a different expense before saving'
            : null;
  const form = reviewForm(values, state.context?.group.defaultCurrency ?? 'INR');
  const members =
    state.context?.group.members.map((row) => ({ id: row.user.id, name: row.user.name })) ?? null;
  const name = (id: string) => members?.find((row) => row.id === id)?.name ?? 'Group member';
  // The signed-in member is "You", as on Add expense (#434).
  const person = (id: string) => (id === userId ? 'You' : name(id));
  const change = (patch: Partial<ExpenseDraft>) => {
    if (locked) return;
    try {
      void machine.change(reviewFormChange(values, patch));
      setInvalid(null);
    } catch {
      setInvalid('Correct the entered amount or details before saving.');
    }
  };
  const created = new Date(item.draft.createdAt),
    now = new Date(controller.reviewNow());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const day =
    toDateParam(created) === toDateParam(now)
      ? 'today'
      : toDateParam(created) === toDateParam(yesterday)
        ? 'yesterday'
        : spellDay(created, { year: true });
  const assistant =
    item.draft.preparedBy.kind === 'assistant' ? item.draft.preparedBy.name : undefined;
  const sourceTitle = assistant ? `Prepared by ${assistant}` : 'You set this aside';
  const sourceDetail = `${assistant ? 'From your chat' : 'Finish later'}${SEPARATOR}${day} ${clockTime(item.draft.createdAt)}`;
  const canSave = !(locked || state.busy || !!reason || !!invalid || !!state.unkept);
  const shares = state.allocation?.splitBetween
    .map(
      (row) =>
        `${person(row.user)} ${row.user === userId ? 'share' : 'shares'} ${money(row.amount, state.allocation!.currency)}`,
    )
    .join(SEPARATOR);
  const field = { color: theme.text, paddingVertical: 4, paddingHorizontal: 0 };
  // The item's own currency beside the Amount, main or extra, and Add expense's picker to change
  // it, with every currency the Group lists; nothing is converted (#874).
  const places = getCurrencyPrecision(form.currency);
  const currencyChoices = state.context
    ? expenseCurrencyChoices(
        state.context.group,
        state.context.group.latestExpenseCurrency,
        form.currency,
      )
    : null;
  return (
    <>
      <RunScreen
        controller={controller}
        title={groupName}
        subtitle={`Review${SEPARATOR}${state.index + 1} of ${state.items.length}${groups > 1 ? `${SEPARATOR}across ${groups}${NO_BREAK_SPACE}Groups` : ''}`}
        close={close}
        refresh={
          offline
            ? undefined
            : { onPress: () => void machine.refresh(), disabled: state.busy || state.pending }
        }
        progress={<RunProgress index={state.index} total={state.items.length} />}
        bar={
          <>
            {state.pending ? (
              <CompactButton
                label="Check again"
                block
                disabled={offline || state.busy}
                onPress={() => void machine.retry()}
              />
            ) : (
              <CompactButton
                label="Save expense"
                block
                hint={reason ?? undefined}
                disabled={!canSave}
                onPress={() => void machine.save()}
              />
            )}
            {/* Why Save waits, under it, for anything not already said in a banner above. */}
            {reason && !missing.length && !state.pending ? (
              <CompactText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
                {reason}
              </CompactText>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <CompactButton
                label="Delete"
                variant="text"
                destructive
                dense
                disabled={locked || state.busy || !!state.unkept}
                onPress={() => machine.deletePrompt(true)}
              />
              <CompactButton
                label="Skip for now"
                variant="text"
                dense
                disabled={offline || state.busy || state.pending || !!state.unkept}
                onPress={() => void machine.skip()}
              />
            </View>
          </>
        }
      >
        <RunSource assistant={assistant} title={sourceTitle} detail={sourceDetail} />
        {/* The item is locked until its save is checked: this says why, as Check again waits. */}
        {state.pending && !offline && <Banner tone="warning" standing message={reason ?? ''} />}
        {offline && <Banner tone="offline" message="Connect to change or save this" />}
        {state.changed && (
          <Banner
            tone="info"
            standing
            message={describeDraftChange(
              state.changed.before,
              state.changed.after,
              Object.fromEntries([
                ...(members ?? []).map((member) => [member.id, person(member.id)]),
                ...(state.context?.tags ?? []).map((tag) => [tag.id, tag.name]),
              ]),
              groupCurrency,
            )}
          />
        )}
        {/* Amount and Description, as Add expense lays them out, labelled as it labels them (#524). */}
        <Card padded>
          <View style={{ gap: 6 }}>
            <RequiredFieldLabel text="Amount" invalid={needsAmount(model.needs)} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {currencyChoices && currencyChoices.length > 1 ? (
                <>
                  <CurrencyChip
                    currency={form.currency}
                    locked={locked}
                    onPress={() => setSheet('currency')}
                  />
                  <CurrencySymbol currency={form.currency} />
                </>
              ) : (
                <CurrencyBadge currency={form.currency} recorded={false} />
              )}
              <TextInput
                // A new keypad is a new field: Android keeps the decimal key otherwise (#866).
                key={`amount:${state.changed?.after.revision ?? 0}:${places === 0 ? 'whole' : 'decimal'}`}
                accessibilityLabel={`Amount, ${getCurrency(form.currency)?.name ?? form.currency}`}
                value={typedAmount ?? amountText(form.amount, form.currency)}
                editable={!locked}
                keyboardType={places === 0 ? 'number-pad' : 'decimal-pad'}
                placeholder={places === 0 ? '0' : `0.${'0'.repeat(places)}`}
                placeholderTextColor={theme.textMuted}
                selectionColor={theme.brand.main}
                onChangeText={(amount) => {
                  setTypedAmount(amount);
                  change({ amount });
                }}
                style={[
                  field,
                  { flex: 1, minHeight: 48, fontFamily: fonts.mono, fontSize: 32, lineHeight: 38 },
                ]}
              />
            </View>
          </View>
          <View
            style={{ height: 1, backgroundColor: theme.border, marginTop: 4, marginBottom: 8 }}
          />
          <View style={{ gap: 6 }}>
            <RequiredFieldLabel text="Description" invalid={hasNeed('description')} />
            <View>
              <TextInput
                key={`description:${state.changed?.after.revision ?? 0}`}
                accessibilityLabel="Description"
                value={form.description}
                editable={!locked}
                placeholder={descriptionPlaceholder}
                placeholderTextColor={theme.textMuted}
                selectionColor={theme.brand.main}
                onChangeText={(description) => change({ description })}
                selection={descriptionStart.selection}
                onFocus={descriptionStart.onFocus}
                onBlur={descriptionStart.onBlur}
                style={[field, { minHeight: 48, fontFamily: fonts.regular, fontSize: 17 }]}
              />
            </View>
          </View>
        </Card>
        <ExpenseTiles
          locked={locked}
          errors={{
            date: hasNeed('date') ? 'Choose a date' : undefined,
            payers:
              hasNeed('paidBy') || hasNeed('paidBy', 'listed-twice')
                ? `Who paid?${SEPARATOR}Choose`
                : hasNeed('paidBy', 'payer-total')
                  ? 'Must add up to the total'
                  : undefined,
            // A split that is there but doesn't add up says so, not "Choose" (#506).
            split: splitListedTwice(model.needs)
              ? SPLIT_LISTED_TWICE
              : hasNeed('splitBetween') || hasNeed('splitMethod')
                ? 'Choose who shared it and how'
                : hasNeed('splitBetween', 'split-total')
                  ? 'Must add up to the total'
                  : hasNeed('splitBetween', 'percentage-total')
                    ? 'Must add up to 100%'
                    : undefined,
            tag: hasNeed('tagId') || hasNeed('tag') ? 'Choose a Tag' : undefined,
          }}
          values={{
            date: expenseDateLabel(form.date, controller.reviewNow()),
            // One person listed twice isn't "2 people": the tile asks, as for no payer (#716).
            payers:
              values.paidBy?.length && !payerListedTwice(model.needs)
                ? paidBySummary(form, person)
                : 'Choose',
            split: values.splitMethod ? splitSummary(form) : 'Choose',
            tag:
              state.context?.tags.find((tag) => tag.id === form.tagId)?.name ??
              values.tag ??
              'Choose',
          }}
          correction={() => null}
          section={() => () => {}}
          onOpen={setSheet}
        />
        {shares ? (
          <CompactText variant="caption" tone="secondary" style={{ paddingHorizontal: 2 }}>
            {shares}
          </CompactText>
        ) : null}
        <OptionalDetails draft={form} locked={locked} onChange={change} />
        {!!model.needs.length && (
          <Banner tone="warning" message={reason ?? ''}>
            {/* Only a payer that is really missing is one the assistant didn't know (#716). */}
            {hasNeed('paidBy', 'missing') && assistant ? (
              <CompactText variant="small" tone="secondary" style={{ paddingLeft: 4 }}>
                {assistant} didn’t know who paid, so it left that to you
              </CompactText>
            ) : payerListedTwice(model.needs) ? (
              <CompactText variant="small" tone="secondary" style={{ paddingLeft: 4 }}>
                {PAYER_LISTED_TWICE}
              </CompactText>
            ) : null}
          </Banner>
        )}
        {invalid && <Banner tone="error" message={invalid} />}
        {!!state.message && <Banner tone="error" message={state.message} />}
        {!!item.duplicates.length && (
          <Banner
            tone="warning"
            standing
            heading
            title="Possible duplicate"
            message="Save it only if it’s a different expense."
          >
            <View style={{ flex: 1, gap: 6, marginLeft: 4 }}>
              {item.duplicates.map((duplicate) => (
                <View
                  key={duplicate.id}
                  style={{
                    gap: 2,
                    padding: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                  }}
                >
                  <CompactText weight="semibold">{duplicate.description}</CompactText>
                  {state.matches
                    .filter((expense) => expense._id === duplicate.id)
                    .map((expense) => (
                      <View key={expense._id} style={{ gap: 1 }}>
                        <CompactText variant="caption" tone="secondary">
                          {recentDay(expenseLocalDate(expense.date))}
                          {SEPARATOR}
                          {money(expense.amount, expense.currency)}
                        </CompactText>
                        <CompactText variant="caption" tone="secondary">
                          Added by{' '}
                          {expense.createdBy && typeof expense.createdBy === 'object'
                            ? (expense.createdBy.name ?? 'Group member')
                            : name(expense.createdBy ?? '')}
                        </CompactText>
                      </View>
                    ))}
                </View>
              ))}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="It’s a different expense, save it anyway"
                accessibilityState={{ checked: state.acknowledged, disabled: locked }}
                disabled={locked}
                {...duplicateTap.on(machine.acknowledge)}
                hitSlop={denseHitSlop}
                style={{
                  minHeight: touch.dense,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: state.acknowledged ? theme.brand.main : theme.borderStrong,
                    backgroundColor: state.acknowledged ? theme.brand.main : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {state.acknowledged ? (
                    <Icon name="checkmark" size={16} color={theme.brand.contrastText} />
                  ) : null}
                </View>
                <CompactText variant="small" weight="medium" style={{ flex: 1 }}>
                  It’s a different expense, save it anyway
                </CompactText>
              </Pressable>
            </View>
          </Banner>
        )}
        {state.unkept && (
          <Banner tone="warning" standing message="Your latest changes have not been kept.">
            <CompactButton
              label="Keep my changes"
              variant="text"
              dense
              disabled={offline || state.busy || state.pending}
              onPress={() => void machine.retryChange()}
            />
          </Banner>
        )}
      </RunScreen>
      {sheet === 'currency' && state.context && currencyChoices && (
        <CurrencySheet
          visible
          groupName={state.context.group.name}
          choices={currencyChoices}
          currency={form.currency}
          locked={locked}
          offline={offline}
          onChoose={(currency) => {
            change({ currency });
            setSheet(null);
          }}
          onDone={() => setSheet(null)}
        />
      )}
      {sheet === 'date' && (
        <DateSheet
          visible
          value={form.date}
          locked={locked}
          onChange={(date) => change({ date })}
          onDone={() => setSheet(null)}
        />
      )}
      {sheet === 'payers' && (
        <PayerSheet
          visible
          draft={form}
          members={members}
          currentUserId={userId}
          locked={locked}
          persistence={state.busy ? 'saving' : 'saved'}
          name={name}
          onChange={change}
          onDone={() => setSheet(null)}
        />
      )}
      {sheet === 'split' && (
        <SplitSheet
          visible
          problem={splitListedTwice(model.needs) ? SPLIT_LISTED_TWICE : undefined}
          draft={form}
          members={members}
          currentUserId={userId}
          locked={locked}
          persistence={state.busy ? 'saving' : 'saved'}
          name={name}
          money={(minor) => formatCurrency(toMajorAmount(minor, form.currency), form.currency)}
          onChange={change}
          onDone={() => setSheet(null)}
        />
      )}
      {sheet === 'tag' && (
        <TagSheet
          visible
          tags={state.context?.tags.filter((tag) => !tag.isArchived && !tag.isDeleted) ?? null}
          tagId={form.tagId}
          locked={locked}
          onChoose={(tagId) => {
            change({ tagId });
            setSheet(null);
          }}
          onDone={() => setSheet(null)}
        />
      )}
      {state.deletePrompt && (
        <BottomSheet
          visible
          title="Delete this item?"
          onDone={() => machine.deletePrompt(false)}
          doneLabel="Keep item"
          dismissible={!state.busy}
          footer={
            <CompactButton
              label="Delete item"
              destructive
              block
              disabled={locked}
              onPress={() => void machine.delete()}
            />
          }
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <CompactText weight="semibold" style={{ flex: 1 }} numberOfLines={2}>
              {values.description || 'Expense to review'}
            </CompactText>
            <Money numberOfLines={0}>
              {money(values.amount, values.currency || groupCurrency)}
            </Money>
          </View>
          <CompactText>
            It was never saved, so nothing in {groupName} changes. You can’t undo this.
          </CompactText>
        </BottomSheet>
      )}
    </>
  );
}
