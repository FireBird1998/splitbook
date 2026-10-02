import type { ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { escapeRegex } from '@splitbook/shared/escape-regex';
import type { ExpenseDraft } from '../data/expense-draft';
import {
  previewSplit,
  roundingNote,
  splitChoiceOf,
  splitMethodFor,
  type SplitChoice,
  type SplitStatus,
} from '../data/expense-split';
import { acceptsNumericText } from '../data/field-feedback';
import { FieldError } from './group-workflows';
import { Icon } from './primitives';
import { Badge, BottomSheet, Chip, CompactText, Money, Stepper, radius } from './compact';
import { fonts, useTheme } from './theme';

const choices: { id: SplitChoice; label: string; hint: string }[] = [
  { id: 'equal', label: 'Equal', hint: 'Everyone included pays the same share.' },
  {
    id: 'amounts',
    label: 'Amounts',
    hint: 'Enter what each person owes. Switching method clears these values.',
  },
  {
    id: 'percentage',
    label: 'Percentage',
    hint: 'Enter each person’s percentage of the total. Switching method clears these values.',
  },
  {
    id: 'shares',
    label: 'Shares',
    hint: 'Weights: 2 and 1 split the cost 2:1. Switching method clears these values.',
  },
];

/** Hundredths of a percent as "33.34%". */
const percent = (units: number) => `${Number((units / 100).toFixed(2))}%`;

/** Text with each formatted amount in the money face; the words, and what's spoken, stay the same. */
function moneyRuns(text: string, amounts: string[]): ReactNode {
  if (!amounts.length) return text;
  return text.split(new RegExp(`(${amounts.map(escapeRegex).join('|')})`)).map((part, index) =>
    index % 2 ? (
      <Text key={index} style={{ fontFamily: fonts.mono, fontVariant: ['tabular-nums'] }}>
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

/**
 * The Split sheet over the Expense form: Equal, Amounts, Percentage or Shares, who's included,
 * and each person's resulting share. The footer says whether the split adds up, how far off it
 * is, and who got any leftover from rounding. Done, swiping down and Back keep the entries.
 */
export function SplitSheet({
  visible,
  draft,
  members,
  currentUserId,
  locked,
  persistence,
  name,
  money,
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
  /** Any participant's name, including people who have left the Group. */
  name: (id: string) => string;
  money: (minor: number) => string;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const choice = splitChoiceOf(draft.splitMethod);
  const preview = previewSplit(draft);
  const person = (id: string) => (id === currentUserId ? 'You' : name(id));
  const spoken = (id: string) => (id === currentUserId ? 'you' : name(id));
  const member = (id: string) => !members || members.some((item) => item.id === id);
  const people = [
    ...new Set([...(members ?? []).map((item) => item.id), ...draft.participantIds]),
  ].sort((a, b) => Number(b === currentUserId) - Number(a === currentUserId));

  const choose = (next: SplitChoice) => {
    const splitMethod = splitMethodFor(next, draft);
    if (locked || splitMethod === draft.splitMethod) return;
    onChange({ splitMethod });
    // A method change clears the previous values; Shares then start at one each.
    if (splitMethod === 'shares')
      onChange({ splitValues: Object.fromEntries(draft.participantIds.map((id) => [id, '1'])) });
  };
  const toggle = (id: string) => {
    if (locked) return;
    const included = draft.participantIds.includes(id);
    onChange({
      participantIds: included
        ? draft.participantIds.filter((item) => item !== id)
        : [...draft.participantIds, id],
      ...(!included && choice === 'shares' && !draft.splitValues[id]
        ? { splitValues: { ...draft.splitValues, [id]: '1' } }
        : {}),
    });
  };
  const setValue = (id: string, value: string) => {
    if (!locked) onChange({ splitValues: { ...draft.splitValues, [id]: value } });
  };

  return (
    <BottomSheet
      visible={visible}
      title="Split"
      subtitle={
        preview.total === null
          ? undefined
          : moneyRuns(`Total ${money(preview.total)} · ${draft.currency}`, [money(preview.total)])
      }
      onDone={onDone}
      footer={
        <>
          <SplitFooter
            status={preview.status}
            draft={draft}
            total={preview.total}
            spoken={spoken}
            money={money}
          />
          {persistence === 'error' ? (
            <CompactText variant="small" tone="negative">
              Couldn’t store these entries on this device. Close this sheet to retry.
            </CompactText>
          ) : null}
        </>
      }
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Split method"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
      >
        {choices.map((item) => (
          <Chip
            key={item.id}
            role="radio"
            label={item.label}
            selected={choice === item.id}
            onPress={() => choose(item.id)}
          />
        ))}
      </View>
      <CompactText tone="secondary">{choices.find((item) => item.id === choice)!.hint}</CompactText>
      <View style={{ gap: 4 }}>
        {people.map((id) => {
          const included = draft.participantIds.includes(id);
          const share = preview.shares[id];
          const error = included ? preview.errors[id] : undefined;
          const shown = !included ? 'Not included' : share === undefined ? null : money(share);
          return (
            <View key={id} style={{ gap: 4 }}>
              <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={[
                    person(id),
                    shown,
                    member(id) ? null : 'no longer in this Group',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  accessibilityState={{ checked: included, disabled: locked }}
                  disabled={locked}
                  onPress={() => toggle(id)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 48,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: included ? theme.brand.main : theme.borderStrong,
                      backgroundColor: included ? theme.brand.main : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: locked ? 0.45 : 1,
                    }}
                  >
                    {included ? (
                      <Icon name="checkmark" size={16} color={theme.brand.contrastText} />
                    ) : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <CompactText weight="semibold" numberOfLines={2}>
                      {person(id)}
                    </CompactText>
                    {!included ? (
                      <CompactText variant="small" tone="muted">
                        Not included
                      </CompactText>
                    ) : shown ? (
                      <Money tone="secondary">{shown}</Money>
                    ) : null}
                    {member(id) ? null : (
                      <CompactText variant="small" tone="warning">
                        No longer in this Group
                      </CompactText>
                    )}
                  </View>
                </Pressable>
                {included && choice === 'shares' ? (
                  <ShareStepper
                    label={`shares for ${spoken(id)}`}
                    value={draft.splitValues[id] ?? ''}
                    onChange={(value) => setValue(id, value)}
                  />
                ) : null}
                {included && (choice === 'amounts' || choice === 'percentage') ? (
                  <EntryInput
                    label={`${choice === 'amounts' ? 'Amount' : 'Percentage'} for ${spoken(id)}`}
                    placeholder={choice === 'amounts' ? '0.00' : '0'}
                    suffix={choice === 'percentage' ? '%' : undefined}
                    value={draft.splitValues[id] ?? ''}
                    error={error}
                    locked={locked}
                    onChange={(value) => setValue(id, value)}
                  />
                ) : null}
              </View>
              <FieldError message={error} />
            </View>
          );
        })}
      </View>
    </BottomSheet>
  );
}

/** Whole-number weights; an older draft's unreadable weight steps to the nearest whole number. */
function ShareStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const current = Number(value || 0);
  const shown = Number.isFinite(current) ? current : 0;
  return (
    <Stepper
      label={label}
      value={shown}
      min={1}
      onChange={(next) => onChange(String(next < shown ? Math.ceil(next) : Math.floor(next)))}
    />
  );
}

function EntryInput({
  label,
  placeholder,
  suffix,
  value,
  error,
  locked,
  onChange,
}: {
  label: string;
  placeholder: string;
  suffix?: string;
  value: string;
  error?: string;
  locked: boolean;
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 128,
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 12,
        borderRadius: radius.tile,
        borderWidth: error ? 2 : 1,
        borderColor: error ? theme.negative.main : theme.borderStrong,
        backgroundColor: locked ? theme.surfaceMuted : theme.surface,
      }}
    >
      <TextInput
        value={value}
        maxLength={40}
        keyboardType="decimal-pad"
        editable={!locked}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        selectionColor={theme.brand.main}
        accessibilityLabel={label}
        accessibilityHint={error}
        onChangeText={(next) => {
          // A refused edit leaves the field showing the draft's value.
          if (next !== value && acceptsNumericText(next, value)) onChange(next);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          paddingVertical: 8,
          paddingHorizontal: 0,
          textAlign: 'right',
          color: theme.text,
          fontFamily: fonts.mono,
          fontSize: 15,
          opacity: locked ? 0.65 : 1,
        }}
      />
      {suffix ? <CompactText tone="secondary">{suffix}</CompactText> : null}
    </View>
  );
}

/** "Adds up" with the total and any rounding note, or how far off the split is. */
function SplitFooter({
  status,
  draft,
  total,
  spoken,
  money,
}: {
  status: SplitStatus;
  draft: ExpenseDraft;
  total: number | null;
  spoken: (id: string) => string;
  money: (minor: number) => string;
}) {
  const theme = useTheme();
  if (status.kind === 'no-amount')
    return (
      <CompactText variant="small" tone="secondary">
        Enter a valid amount to see who owes what.
      </CompactText>
    );
  const row = (left: ReactNode, right?: string, amounts: string[] = []) => (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      {left}
      {right ? (
        <CompactText variant="caption" tone="secondary" style={{ marginLeft: 'auto' }}>
          {moneyRuns(right, amounts)}
        </CompactText>
      ) : null}
    </View>
  );
  const problem = (message: string, detail?: string, amounts: string[] = []) => (
    <View
      accessible
      accessibilityLabel={[message, detail].filter(Boolean).join('. ')}
      accessibilityLiveRegion="polite"
    >
      {row(
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
          <Icon name="alert-circle-outline" size={18} color={theme.status.negative} />
          <CompactText variant="small" weight="semibold" tone="negative" style={{ flexShrink: 1 }}>
            {moneyRuns(message, amounts)}
          </CompactText>
        </View>,
        detail,
        amounts,
      )}
    </View>
  );
  if (status.kind === 'problem') return problem(status.message);
  if (status.kind === 'remaining') {
    const show = status.unit === 'amount' ? money : percent;
    const left = status.target - status.entered;
    return problem(
      left > 0
        ? `${show(left)} still to assign`
        : status.unit === 'amount'
          ? `${show(-left)} over the total`
          : `${show(-left)} over 100%`,
      `${show(status.entered)} of ${show(status.target)}`,
      status.unit === 'amount' ? [Math.abs(left), status.entered, status.target].map(money) : [],
    );
  }
  const count = draft.participantIds.length;
  const shares = draft.participantIds.reduce(
    (sum, id) => sum + Number(draft.splitValues[id] || 0),
    0,
  );
  const amount = money(total!);
  const allocated = `${amount} allocated`;
  const summary =
    draft.splitMethod === 'equal'
      ? `${count} ${count === 1 ? 'person' : 'people'} · ${allocated}`
      : draft.splitMethod === 'percentage'
        ? `100% · ${allocated}`
        : draft.splitMethod === 'shares'
          ? `${shares} ${shares === 1 ? 'share' : 'shares'} · ${allocated}`
          : allocated;
  const note = status.leftover ? roundingNote(status.leftover, spoken, money) : null;
  return (
    <View
      accessible
      accessibilityLabel={['Adds up', summary, note].filter(Boolean).join('. ')}
      accessibilityLiveRegion="polite"
      style={{ gap: 6 }}
    >
      {row(<Badge label="Adds up" tone="positive" icon="checkmark" />, summary, [amount])}
      {note && status.leftover ? (
        <CompactText>{moneyRuns(note, [money(status.leftover.amountMinor)])}</CompactText>
      ) : null}
    </View>
  );
}
