import { Pressable, TextInput, View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type { ExpenseDraft } from '../data/expense-draft';
import { acceptsNumericText } from '../data/field-feedback';
import {
  enteredPayers,
  giveRest,
  minorAmountText,
  payerRemainder,
  restRecipient,
  setPayerAmount,
} from '../data/payer-remainder';
import {
  Badge,
  BottomSheet,
  CompactAvatar,
  CompactButton,
  CompactText,
  Money,
  SegmentedControl,
  radius,
  touch,
} from './compact';
import { FieldError } from './group-workflows';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';

/** The Paid by tile's value: who paid, or how many people did. */
export function paidBySummary(draft: ExpenseDraft, person: (id: string) => string) {
  if (!draft.multiPayer) return person(draft.payerId);
  const payers = enteredPayers(draft.payers);
  if (payers.length === 1) return person(payers[0].user);
  return payers.length ? `${payers.length} people` : 'Choose who paid';
}

/**
 * Who paid, a sheet over the Expense form: one person from a list, or what each of several
 * people paid with the amount still to assign. Problems are explained here, beside their rows.
 * Done, Back and swiping down keep every entry in the draft.
 */
export function PayerSheet({
  visible,
  draft,
  members,
  currentUserId,
  locked,
  persistence,
  name,
  onChange,
  onDone,
}: {
  visible: boolean;
  draft: ExpenseDraft;
  /** The Group's current members, or null while they can't be checked. */
  members: { id: string; name: string }[] | null;
  currentUserId?: string;
  locked: boolean;
  persistence: 'saved' | 'saving' | 'error';
  name: (id: string) => string;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { currency } = draft;
  const money = (minor: number) => formatCurrency(toMajorAmount(minor, currency), currency);
  const memberIds = members?.map((member) => member.id) ?? [];
  const unavailable = (id: string) => members !== null && !memberIds.includes(id);
  const you = (id: string) => id === currentUserId;
  const edit = (patch: Partial<ExpenseDraft>) => {
    if (!locked) onChange(patch);
  };
  const remainder = payerRemainder(draft);
  const { totalMinor, assignedMinor } = remainder;
  const left = remainder.remainingMinor ?? 0;
  const invalid = Object.keys(remainder.errors).length > 0;

  const person = (id: string) => (
    <>
      <CompactAvatar name={name(id)} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <CompactText weight="semibold" numberOfLines={1}>
          {you(id) ? 'You' : name(id)}
        </CompactText>
        {you(id) ? (
          <CompactText variant="small" tone="secondary" numberOfLines={1}>
            {name(id)}
          </CompactText>
        ) : null}
      </View>
    </>
  );

  const one = (
    <>
      <View accessibilityRole="radiogroup" accessibilityLabel="Who paid" style={{ gap: 4 }}>
        {(members ? memberIds : [draft.payerId]).map((id) => {
          const selected = draft.payerId === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityLabel={you(id) ? `You, ${name(id)}` : name(id)}
              accessibilityState={{ checked: selected, disabled: locked }}
              disabled={locked}
              onPress={() => !selected && edit({ payerId: id })}
              style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            >
              {person(id)}
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: 2,
                  borderColor: selected ? theme.brand.main : theme.borderStrong,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected ? (
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: theme.brand.main,
                    }}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <FieldError
        message={
          unavailable(draft.payerId)
            ? `${name(draft.payerId)} is no longer in this Group. Choose who paid.`
            : null
        }
      />
    </>
  );

  const entered = enteredPayers(draft.payers).map((payer) => payer.user);
  const rows = [...new Set([...memberIds, ...entered])];
  const several = (
    <>
      <CompactText tone="secondary">
        Enter what each person paid. Together it must equal{' '}
        {totalMinor === null ? (
          'the Expense amount.'
        ) : (
          <CompactText tone="secondary" style={{ fontFamily: fonts.mono }}>
            {money(totalMinor)}.
          </CompactText>
        )}
      </CompactText>
      {rows.map((id) => {
        const entry = draft.payers.find((payer) => payer.user === id)?.amount ?? '';
        const error = remainder.errors[id];
        const gone = unavailable(id);
        return (
          <View key={id} style={{ gap: 6 }}>
            <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {person(id)}
              <TextInput
                value={entry}
                maxLength={40}
                keyboardType="decimal-pad"
                editable={!locked && !gone}
                placeholder={minorAmountText(0, currency)}
                placeholderTextColor={theme.textMuted}
                selectionColor={theme.brand.main}
                accessibilityLabel={`What ${you(id) ? 'you' : name(id)} paid`}
                accessibilityHint={error ?? (gone ? 'No longer in this Group.' : undefined)}
                onChangeText={(amount) => {
                  // A refused edit leaves the field showing the draft's entry.
                  if (amount !== entry && acceptsNumericText(amount, entry))
                    edit({ payers: setPayerAmount(draft.payers, id, amount) });
                }}
                style={{
                  width: 136,
                  minHeight: touch.dense,
                  paddingHorizontal: 12,
                  borderRadius: radius.tile,
                  borderWidth: error ? 2 : 1,
                  borderColor: error ? theme.negative.main : theme.borderStrong,
                  backgroundColor: gone ? theme.surfaceMuted : theme.surface,
                  color: theme.text,
                  fontFamily: fonts.mono,
                  fontSize: 15,
                  textAlign: 'right',
                  opacity: locked ? 0.65 : 1,
                }}
              />
            </View>
            <FieldError message={error} />
            {gone ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <FieldError message="No longer in this Group." />
                </View>
                <CompactButton
                  label="Remove"
                  accessibilityLabel={`Remove ${name(id)} from who paid`}
                  variant="text"
                  dense
                  disabled={locked}
                  onPress={() =>
                    edit({ payers: draft.payers.filter((payer) => payer.user !== id) })
                  }
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </>
  );

  const recipient = restRecipient(draft, memberIds);
  const rest = giveRest(draft, memberIds);
  const remainderText = left > 0 ? ' still to assign' : ' more than the total';
  const status =
    totalMinor === null
      ? 'Enter the Expense amount to see what’s left to assign.'
      : invalid
        ? 'Correct the marked amounts first.'
        : left === 0
          ? 'Adds up'
          : `${money(Math.abs(left))}${remainderText}`;
  const counted = totalMinor !== null && !invalid;
  const progress = counted ? `${money(assignedMinor)} of ${money(totalMinor)}` : '';
  const filled = counted ? Math.min(100, Math.round((assignedMinor / totalMinor) * 100)) : 0;
  const draftNote =
    persistence === 'error' ? (
      <CompactText variant="small" tone="negative" accessibilityRole="alert" style={{ flex: 1 }}>
        Couldn’t save these entries on this device. Close this sheet and retry saving the draft.
      </CompactText>
    ) : (
      <CompactText variant="small" tone="secondary" style={{ flex: 1, minWidth: 150 }}>
        Entries stay in your draft. Done or Back keeps them.
      </CompactText>
    );
  const footer = draft.multiPayer ? (
    <>
      <View
        accessible
        accessibilityLabel={counted ? `${status}. ${progress} entered.` : status}
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        {counted && left === 0 ? (
          <Badge label="Adds up" tone="positive" icon="checkmark" />
        ) : totalMinor === null ? (
          <CompactText variant="small" tone="secondary">
            {status}
          </CompactText>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <Icon name="alert-circle-outline" size={18} color={theme.status.negative} />
            <CompactText weight="semibold" tone="negative" style={{ flexShrink: 1 }}>
              {invalid ? (
                status
              ) : (
                <>
                  <Money tone="negative">{money(Math.abs(left))}</Money>
                  {remainderText}
                </>
              )}
            </CompactText>
          </View>
        )}
        {counted ? (
          <CompactText variant="caption" tone="secondary">
            <Money size="table" tone="secondary">
              {money(assignedMinor)}
            </Money>
            {' of '}
            <Money size="table" tone="secondary">
              {money(totalMinor)}
            </Money>
          </CompactText>
        ) : null}
      </View>
      {counted ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Entered so far"
          accessibilityValue={{ min: 0, max: 100, now: filled, text: progress }}
          style={{
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.surfaceMuted,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${filled}%`,
              height: '100%',
              backgroundColor: left === 0 ? theme.positive.main : theme.negative.main,
            }}
          />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {draftNote}
        {recipient && rest ? (
          <CompactButton
            label={`Give ${money(left)} to ${you(recipient) ? 'you' : name(recipient).split(' ')[0]}`}
            accessibilityLabel={`Give ${money(left)} to ${you(recipient) ? 'you' : name(recipient)}`}
            variant="tonal"
            dense
            disabled={locked}
            onPress={() => edit(rest)}
          />
        ) : null}
      </View>
    </>
  ) : persistence === 'error' ? (
    draftNote
  ) : undefined;

  return (
    <BottomSheet visible={visible} title="Who paid?" onDone={onDone} footer={footer}>
      <SegmentedControl
        label="How many people paid"
        options={[
          { value: 'one', label: 'One person' },
          { value: 'several', label: 'Several people' },
        ]}
        value={draft.multiPayer ? 'several' : 'one'}
        onChange={(value) => {
          if ((value === 'several') === draft.multiPayer) return;
          // Switching keeps the other mode's entries; the first switch starts from the one payer.
          edit(
            value === 'several'
              ? {
                  multiPayer: true,
                  ...(entered.length || totalMinor === null
                    ? {}
                    : { payers: [{ user: draft.payerId, amount: draft.amount }] }),
                }
              : { multiPayer: false },
          );
        }}
      />
      {draft.multiPayer ? several : one}
    </BottomSheet>
  );
}
