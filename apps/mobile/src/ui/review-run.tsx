import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  buildToReview,
  summarizeReviewRun,
  describeDraftChange,
} from '@splitbook/shared/to-review';
import { formatCurrency } from '@splitbook/shared/currency';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import { formatDate, toDateParam } from '@splitbook/shared/date';
import type { MobileController } from '../data/mobile-controller';
import { reviewForm, reviewFormChange } from '../data/review-form';
import type { ExpenseDraft } from '../data/expense-draft';
import { useMobileSnapshot, sameSelection } from './use-mobile-snapshot';
import { BottomSheet, Card, CompactText, Money } from './compact';
import { Button, Copy } from './primitives';
import { ExpenseTiles, expenseDateLabel, splitSummary, OptionalDetails } from './expense-form';
import { DateSheet } from './date-sheet';
import { clockTime } from './activity-format';
import { PayerSheet, paidBySummary } from './payer-sheet';
import { SplitSheet } from './split-sheet';
import { TagSheet } from './tag-sheet';
import { useTheme } from './theme';
import { reviewedItemsLine } from './review-run-copy';

function money(amount: number | undefined, currency: string | undefined) {
  if (amount === undefined || !currency) return 'Amount needed';
  try {
    return formatCurrency(toMajorAmount(parseAmountMinor(amount, currency), currency), currency);
  } catch {
    return 'Amount needed';
  }
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
  if (
    !snapshot.run ||
    !snapshot.user ||
    process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED !== 'true'
  )
    return null;
  const close = () => {
    if (!controller.getSnapshot().toReview.run?.unkept) return void controller.closeReviewRun();
    Alert.alert(
      'Leave without your latest changes?',
      'These changes have not been kept. The last kept details stay in To review.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Leave without changes', onPress: () => void controller.closeReviewRun() },
      ],
    );
  };
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
        >
          <ReviewRunContent
            key={`${snapshot.run.index}:${snapshot.run.changed?.after.revision ?? 0}`}
            controller={controller}
            state={snapshot.run}
            offline={snapshot.offline}
            userId={snapshot.user.id}
            close={close}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
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
  const machine = controller.reviewRun()!;
  const selected = state.items[state.index];
  const [invalid, setInvalid] = useState<string | null>(null);
  const [typedAmount, setTypedAmount] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'date' | 'payers' | 'split' | 'tag' | null>(null);
  if (!selected) {
    const summary = summarizeReviewRun(state.outcomes);
    return (
      <>
        <CompactText variant="title" accessibilityRole="header">
          Done for now
        </CompactText>
        <Copy>
          {reviewedItemsLine(state.items.length, [
            ...new Set(state.items.map((row) => row.groupName)),
          ])}
        </Copy>
        <Copy>Saved {summary.saved}</Copy>
        <Copy>Deleted {summary.deleted}</Copy>
        <Copy>Left for later {summary.left}</Copy>
        <Button label="Done" onPress={close} />
      </>
    );
  }
  const { item, groupId, groupName } = selected;
  const values = item.draft.values ?? {};
  const model = buildToReview(
    { total: 1, groups: [{ groupId, groupName, count: 1, items: [item] }] },
    [],
    new Date(controller.reviewNow()),
  ).items[0];
  const groups = new Set(state.items.map((row) => row.groupId)).size;
  const locked = offline || (state.busy && !state.editing) || state.pending || !state.context;
  const missing = model.missingFacts;
  const reason = offline
    ? 'Connect to change or save this'
    : state.pending
      ? "We didn't hear back, so it may already be saved"
      : missing.length
        ? `${missing.length === 1 ? 'One thing' : `${missing.length} things`} left before you can save: ${missing.join(', ')}`
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
      void machine.change(reviewFormChange(values, patch, form.currency));
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
        : formatDate(created);
  const source =
    item.draft.preparedBy.kind === 'assistant'
      ? `Prepared by ${item.draft.preparedBy.name} · from your chat`
      : 'You set this aside · Finish later';
  return (
    <>
      <CompactText variant="title" accessibilityRole="header">
        {groupName}
      </CompactText>
      <Copy>
        Review · {state.index + 1} of {state.items.length}
        {groups > 1 ? ` · across ${groups} Groups` : ''}
      </Copy>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Review progress"
        accessibilityValue={{
          min: 0,
          max: state.items.length,
          now: state.index,
          text: `${state.index} done, item ${state.index + 1} of ${state.items.length}, ${state.items.length - state.index - 1} remaining`,
        }}
        style={{ height: 8, backgroundColor: theme.border, borderRadius: 4, flexDirection: 'row' }}
      >
        <View style={{ flex: state.index, backgroundColor: theme.positive.main }} />
        <View style={{ flex: 1, backgroundColor: theme.brand.main }} />
        <View style={{ flex: state.items.length - state.index - 1 }} />
      </View>
      <Button label="Close review" secondary onPress={close} />
      {offline && <Copy accessibilityRole="alert">Connect to change or save this</Copy>}
      <Card padded>
        <View style={{ gap: 12 }}>
          {state.changed && (
            <Copy accessibilityRole="alert" accessibilityLiveRegion="polite">
              {describeDraftChange(
                state.changed.before,
                state.changed.after,
                Object.fromEntries([
                  ...(members ?? []).map((member) => [member.id, person(member.id)]),
                  ...(state.context?.tags ?? []).map((tag) => [tag.id, tag.name]),
                ]),
              )}
            </Copy>
          )}
          <Copy>
            {source} · {day} {clockTime(item.draft.createdAt)}
          </Copy>
          <Money numberOfLines={0}>{money(values.amount, values.currency)}</Money>
          <TextInput
            key={`amount:${state.changed?.after.revision ?? 0}`}
            accessibilityLabel="Amount"
            value={typedAmount ?? form.amount}
            editable={!locked}
            keyboardType="decimal-pad"
            onChangeText={(amount) => {
              setTypedAmount(amount);
              change({ amount });
            }}
            style={{ color: theme.text, padding: 12, borderColor: theme.border, borderWidth: 1 }}
          />
          <TextInput
            key={`description:${state.changed?.after.revision ?? 0}`}
            accessibilityLabel="Description"
            value={form.description}
            editable={!locked}
            onChangeText={(description) => change({ description })}
            style={{ color: theme.text, padding: 12, borderColor: theme.border, borderWidth: 1 }}
          />
          {!values.currency && (
            <Button
              label={`Use ${form.currency} as currency`}
              disabled={locked}
              onPress={() => change({ currency: form.currency })}
            />
          )}
          <OptionalDetails draft={form} locked={locked} onChange={change} />
          <ExpenseTiles
            locked={locked}
            errors={{
              date: missing.includes('the date') ? 'Choose a date' : undefined,
              payers: missing.includes('who paid') ? 'Who paid? · Choose' : undefined,
              split: missing.some((f) => /split|shared/.test(f))
                ? 'Choose who shared it and how'
                : undefined,
              tag: missing.includes('the tag') ? 'Choose a Tag' : undefined,
            }}
            values={{
              date: expenseDateLabel(form.date, controller.reviewNow()),
              payers: values.paidBy?.length ? paidBySummary(form, person) : 'Choose',
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
          {state.allocation?.splitBetween.map((row) => (
            <Copy key={row.user}>
              {person(row.user)} {row.user === userId ? 'share' : 'shares'}{' '}
              {money(row.amount, state.allocation!.currency)}
            </Copy>
          ))}
          {!!missing.length && <Copy accessibilityRole="alert">{reason}</Copy>}
          {missing.includes('who paid') && item.draft.preparedBy.kind === 'assistant' && (
            <Copy>{item.draft.preparedBy.name} didn't know who paid, so it left that to you</Copy>
          )}
          {invalid && <Copy accessibilityRole="alert">{invalid}</Copy>}
          {!!state.message && <Copy accessibilityRole="alert">{state.message}</Copy>}
          {!!item.duplicates.length && (
            <>
              <Copy accessibilityRole="header">Possible duplicate</Copy>
              {item.duplicates.map((duplicate) => (
                <View key={duplicate.id} style={{ gap: 4 }}>
                  <Copy>{duplicate.description}</Copy>
                  {state.matches
                    .filter((expense) => expense._id === duplicate.id)
                    .map((expense) => (
                      <View key={expense._id}>
                        <Copy>
                          {formatDate(expense.date)} · {money(expense.amount, expense.currency)}
                        </Copy>
                        <Copy>
                          Added by{' '}
                          {expense.createdBy && typeof expense.createdBy === 'object'
                            ? (expense.createdBy.name ?? 'Group member')
                            : name(expense.createdBy ?? '')}
                        </Copy>
                      </View>
                    ))}
                </View>
              ))}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="It's a different expense, save it anyway"
                accessibilityState={{ checked: state.acknowledged, disabled: locked }}
                disabled={locked}
                onPress={machine.acknowledge}
                style={{
                  minHeight: 48,
                  padding: 12,
                  borderColor: state.acknowledged ? theme.brand.main : theme.border,
                  borderWidth: 2,
                }}
              >
                <Copy>
                  {state.acknowledged ? '✓ ' : ''}It's a different expense, save it anyway
                </Copy>
              </Pressable>
            </>
          )}
          {state.unkept && (
            <Button
              label="Keep my changes"
              disabled={offline || state.busy || state.pending}
              onPress={() => void machine.retryChange()}
            />
          )}
          {state.pending ? (
            <Button
              label="Check again"
              disabled={offline || state.busy}
              onPress={() => void machine.retry()}
            />
          ) : (
            <Button
              label="Save expense"
              hint={reason ?? undefined}
              disabled={locked || state.busy || !!reason || !!invalid || !!state.unkept}
              onPress={() => void machine.save()}
            />
          )}
          {reason && !missing.length && <Copy>{reason}</Copy>}
          <Button
            label="Delete"
            secondary
            disabled={locked || state.busy || !!state.unkept}
            onPress={() => machine.deletePrompt(true)}
          />
          <Button
            label="Skip for now"
            secondary
            disabled={offline || state.busy || state.pending || !!state.unkept}
            onPress={() => void machine.skip()}
          />
          {!offline && (
            <Button
              label="Check latest details"
              secondary
              disabled={state.busy || state.pending}
              onPress={() => void machine.refresh()}
            />
          )}
        </View>
      </Card>
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
        >
          <Copy>It was never saved, so nothing in {groupName} changes. You can't undo this.</Copy>
          <Button label="Delete item" disabled={locked} onPress={() => void machine.delete()} />
        </BottomSheet>
      )}
    </>
  );
}
