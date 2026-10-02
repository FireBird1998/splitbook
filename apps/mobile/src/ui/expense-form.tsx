import { useState, type ReactNode, type Ref } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { EXPENSE_CATEGORIES, getCategory } from '@splitbook/shared/categories';
import { formatCurrency } from '@splitbook/shared/currency';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import {
  expenseFieldLabels,
  isMoneyField,
  type ExpenseDraft,
  type ExpenseField,
  type ExpenseMoneyField,
  type ExpenseVersionField,
  type expenseMoney,
} from '../data/expense-draft';
import { acceptsNumericText } from '../data/field-feedback';
import { gregorianDateFormat } from './date-sheet';
import { Field, FieldError } from './group-workflows';
import { Icon } from './primitives';
import {
  Badge,
  Card,
  Chip,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  FieldMarker,
  Money,
  SelectorTile,
  TileGrid,
  radius,
  useLargeText,
} from './compact';
import { fonts, useTheme } from './theme';

type Allocation = ReturnType<typeof expenseMoney>;
type SectionRef = (field: ExpenseField) => (node: View | null) => void;

const splitSummaries: Record<ExpenseDraft['splitMethod'], string> = {
  equal: 'Equally',
  unequal: 'By amounts',
  exact: 'By amounts',
  percentage: 'By percentage',
  shares: 'By shares',
};

const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * The Date tile's value for a YYYY-MM-DD draft date, on the Gregorian calendar in the device's
 * language. `shown` fits a half-width tile on a 360dp phone: "Today, 30 Sep", "Thu 1 Oct" or
 * "24 Sep 2025". `spoken` is the full date, such as "Yesterday, Thursday, 1 October 2026".
 */
export function expenseDateLabel(value: string, now = Date.now()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match && new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!date || localDay(date) !== value) {
    const shown = value || 'Choose a date';
    return { shown, spoken: shown };
  }
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const thisYear = date.getFullYear() === today.getFullYear();
  const short = gregorianDateFormat({
    day: 'numeric',
    month: 'short',
    ...(thisYear ? {} : { year: 'numeric' }),
  }).format(date);
  const full = gregorianDateFormat({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  if (value === localDay(today)) return { shown: `Today, ${short}`, spoken: `Today, ${full}` };
  return {
    shown: thisYear ? `${gregorianDateFormat({ weekday: 'short' }).format(date)} ${short}` : short,
    spoken: value === localDay(yesterday) ? `Yesterday, ${full}` : full,
  };
}

export const splitSummary = (draft: ExpenseDraft) =>
  `${splitSummaries[draft.splitMethod]} · ${draft.participantIds.length}`;

/** Amount with its read-only currency, then Description: the two typed values. */
export function AmountDescriptionCard({
  draft,
  locked,
  showLock = false,
  errors,
  amountRef,
  descriptionRef,
  section,
  onChange,
  onLeave,
  onAmountDone,
  children,
}: {
  draft: ExpenseDraft;
  locked: boolean;
  /** Shows the values as locked, as for a save that may already be recorded. */
  showLock?: boolean;
  errors: { amount?: string; description?: string };
  amountRef: Ref<TextInput>;
  descriptionRef: Ref<TextInput>;
  section: SectionRef;
  onChange: (patch: Partial<ExpenseDraft>) => void;
  onLeave: (field: ExpenseField) => void;
  /** The keyboard's next key on Amount: moves on to Description. */
  onAmountDone: () => void;
  /** Notes about the amount, such as a changed Group currency. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const [amountFocused, setAmountFocused] = useState(false);
  const input = {
    color: theme.text,
    paddingVertical: 4,
    paddingHorizontal: 0,
    opacity: locked ? 0.65 : 1,
  };
  const label = (text: string, error?: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <CompactText variant="small" tone={error ? 'negative' : 'secondary'}>
        {text}
      </CompactText>
      <FieldMarker kind="required" />
    </View>
  );
  return (
    <Card
      state={errors.amount || errors.description ? 'error' : showLock ? 'locked' : 'default'}
      padded
    >
      <View ref={section('amount')} style={{ gap: 6 }}>
        {label('Amount', errors.amount)}
        <View style={{ gap: 4 }}>
          {/* The focus ring sits outside the content and stays as a transparent border on blur. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              marginHorizontal: -10,
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderWidth: 2,
              borderRadius: radius.tile,
              borderColor: amountFocused && !locked ? theme.focus : 'transparent',
            }}
          >
            <View
              accessible
              accessibilityLabel={`Currency ${draft.currency}, ${draft.original ? 'the Expense’s currency' : 'the Group’s currency'}`}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 10,
                backgroundColor: theme.surfaceMuted,
              }}
            >
              <CompactText tone="secondary" style={{ fontFamily: fonts.mono, fontSize: 15 }}>
                {draft.currency}
              </CompactText>
            </View>
            <TextInput
              ref={amountRef}
              value={draft.amount}
              maxLength={40}
              keyboardType="decimal-pad"
              returnKeyType="next"
              submitBehavior="submit"
              editable={!locked}
              placeholder="0.00"
              placeholderTextColor={theme.textMuted}
              selectionColor={theme.brand.main}
              accessibilityLabel="Amount, required"
              accessibilityHint={errors.amount}
              onChangeText={(amount) => {
                // A refused edit leaves the field showing the draft's amount.
                if (amount !== draft.amount && acceptsNumericText(amount, draft.amount))
                  onChange({ amount });
              }}
              onFocus={() => setAmountFocused(true)}
              onBlur={() => {
                setAmountFocused(false);
                onLeave('amount');
              }}
              onSubmitEditing={onAmountDone}
              style={[
                input,
                {
                  flex: 1,
                  minHeight: 48,
                  fontFamily: fonts.mono,
                  fontSize: 32,
                  lineHeight: 38,
                },
              ]}
            />
            {showLock ? (
              <Icon name="lock-closed-outline" size={20} color={theme.textSecondary} />
            ) : null}
          </View>
        </View>
        <FieldError message={errors.amount} />
        {children}
      </View>
      <View style={{ marginVertical: 12, marginHorizontal: -14 }}>
        <Divider inset={14} />
      </View>
      <View ref={section('description')} style={{ gap: 6 }}>
        {label('Description', errors.description)}
        <View>
          <TextInput
            ref={descriptionRef}
            value={draft.description}
            maxLength={200}
            returnKeyType="done"
            editable={!locked}
            placeholder="What was it for? e.g. Groceries"
            placeholderTextColor={theme.textMuted}
            selectionColor={theme.brand.main}
            accessibilityLabel="Description, required"
            accessibilityHint={
              errors.description ? `${errors.description} What was this for?` : 'What was this for?'
            }
            onChangeText={(description) => onChange({ description })}
            onBlur={() => onLeave('description')}
            style={[input, { minHeight: 48, fontFamily: fonts.regular, fontSize: 17 }]}
          />
        </View>
        <FieldError message={errors.description} />
      </View>
    </Card>
  );
}

/** Date, Paid by, Split and Tag; each opens its editor. Their corrections follow the grid. */
export function ExpenseTiles({
  locked,
  errors,
  values,
  correction,
  section,
  onOpen,
}: {
  locked: boolean;
  errors: Partial<Record<'date' | 'payers' | 'split' | 'tag', string>>;
  values: {
    date: ReturnType<typeof expenseDateLabel>;
    payers: string;
    split: string;
    tag: string;
  };
  correction: (field: ExpenseField) => Ref<View>;
  section: SectionRef;
  onOpen: (tile: 'date' | 'payers' | 'split' | 'tag') => void;
}) {
  const fields = ['date', 'payers', 'split', 'tag'] as const;
  return (
    // Every tile's correction reveals the grid.
    <View ref={(node) => fields.forEach((field) => section(field)(node))} style={{ gap: 8 }}>
      <TileGrid>
        <SelectorTile
          icon="calendar-outline"
          label="Date"
          value={values.date.shown}
          spokenValue={values.date.spoken}
          error={errors.date}
          locked={locked}
          onPress={() => onOpen('date')}
        />
        <SelectorTile
          icon="wallet-outline"
          label="Paid by"
          value={values.payers}
          error={errors.payers}
          locked={locked}
          onPress={() => onOpen('payers')}
        />
        <SelectorTile
          icon="pie-chart-outline"
          label="Split"
          value={values.split}
          error={errors.split}
          locked={locked}
          onPress={() => onOpen('split')}
        />
        <SelectorTile
          icon="pricetag-outline"
          label="Tag"
          value={values.tag}
          required
          error={errors.tag}
          locked={locked}
          onPress={() => onOpen('tag')}
        />
      </TileGrid>
      {fields.map((field) => (
        <FieldError key={field} ref={correction(field)} message={errors[field]} />
      ))}
    </View>
  );
}

/**
 * "Who owes what": each person's paid amount and share, an "Adds up" badge and the totals.
 * With more than four people it shows three and "Show all".
 */
export function WhoOwesWhat({
  draft,
  allocation,
  problem,
  name,
  currentUserId,
  money,
}: {
  draft: ExpenseDraft;
  allocation: Allocation | null;
  /** Why there is no allocation to show yet. */
  problem: string;
  name: (id: string) => string;
  currentUserId?: string;
  money: (minor: number) => string;
}) {
  const theme = useTheme();
  const [all, setAll] = useState(false);
  const person = (id: string) => (id === currentUserId ? 'You' : name(id));
  if (!allocation)
    return (
      <Card padded>
        <CompactText variant="overline">Who owes what</CompactText>
        <CompactText tone="secondary" style={{ marginTop: 6 }}>
          {problem}
        </CompactText>
      </Card>
    );
  const paid = new Map(allocation.paidBy.map((row) => [String(row.user), row.amountMinor]));
  const shares = new Map(allocation.splitBetween.map((row) => [String(row.user), row.amountMinor]));
  // The signed-in member first, then everyone else in the Group's order.
  const people = [...new Set([...shares.keys(), ...paid.keys()])].sort(
    (a, b) => Number(b === currentUserId) - Number(a === currentUserId),
  );
  const shown = people.length > 4 && !all ? people.slice(0, 3) : people;
  const shareValues = [...shares.values()];
  const rounded =
    draft.splitMethod === 'equal' &&
    shareValues.length > 1 &&
    Math.max(...shareValues) !== Math.min(...shareValues);
  // Wide enough for "₹1,24,999.50" in the table face; names wrap rather than clip.
  const column = { width: 84, textAlign: 'right' as const };
  return (
    <Card>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingHorizontal: 14,
          paddingTop: 12,
        }}
      >
        <CompactText variant="overline" accessibilityRole="header">
          Who owes what
        </CompactText>
        <Badge label="Adds up" tone="positive" icon="checkmark" />
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          paddingHorizontal: 14,
          paddingTop: 6,
        }}
      >
        <CompactText variant="caption" tone="secondary" style={column}>
          Paid
        </CompactText>
        <CompactText variant="caption" tone="secondary" style={column}>
          Share
        </CompactText>
      </View>
      {shown.map((id) => {
        const paidMinor = paid.get(id);
        const shareMinor = shares.get(id) ?? 0;
        return (
          <View
            key={id}
            accessible
            accessibilityLabel={`${person(id)}: paid ${paidMinor === undefined ? 'nothing' : money(paidMinor)}, share ${money(shareMinor)}`}
            style={{
              minHeight: 48,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 14,
              paddingVertical: 4,
            }}
          >
            <CompactAvatar name={name(id)} small />
            <CompactText numberOfLines={2} style={{ flex: 1, minWidth: 0 }}>
              {person(id)}
            </CompactText>
            <View style={column}>
              {paidMinor === undefined ? (
                <CompactText tone="muted" style={{ textAlign: 'right' }}>
                  –
                </CompactText>
              ) : (
                <Money size="table" style={{ textAlign: 'right' }}>
                  {money(paidMinor)}
                </Money>
              )}
            </View>
            <View style={column}>
              <Money size="table" style={{ textAlign: 'right' }}>
                {money(shareMinor)}
              </Money>
            </View>
          </View>
        );
      })}
      {people.length > 4 ? (
        <View style={{ paddingHorizontal: 6 }}>
          <CompactButton
            label={all ? 'Show fewer' : `Show all ${people.length}`}
            variant="text"
            dense
            onPress={() => setAll(!all)}
          />
        </View>
      ) : null}
      <View
        style={{
          marginTop: 4,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          padding: 14,
          gap: 4,
        }}
      >
        <CompactText variant="small">
          {money(allocation.amountMinor)} paid = {money(allocation.amountMinor)} shared.
        </CompactText>
        {rounded ? (
          <CompactText variant="caption" tone="secondary">
            Shares differ by the smallest unit so the whole amount is shared.
          </CompactText>
        ) : null}
      </View>
    </Card>
  );
}

const versionLabels: Record<ExpenseVersionField, string> = {
  ...expenseFieldLabels,
  category: 'Category',
  notes: 'Notes',
};
const reviewNames: Record<ExpenseMoneyField, string> = {
  amount: 'amount',
  payers: 'payers',
  split: 'split',
};
interface VersionNames {
  name: (id: string) => string;
  tagName: (id: string) => string;
  currentUserId?: string;
}

/** One field of one version as the member reads it; empty when there is nothing. */
function versionText(
  draft: ExpenseDraft,
  field: ExpenseVersionField,
  { name, tagName, currentUserId }: VersionNames,
) {
  const person = (id: string) => (id === currentUserId ? 'You' : name(id));
  const money = (value: string) => {
    try {
      const minor = parseAmountMinor(value, draft.currency);
      return formatCurrency(toMajorAmount(minor, draft.currency), draft.currency);
    } catch {
      return value && `${draft.currency} ${value}`;
    }
  };
  switch (field) {
    case 'amount':
      return money(draft.amount);
    case 'description':
      return draft.description.trim();
    case 'date':
      return expenseDateLabel(draft.date);
    case 'payers': {
      const payers = draft.multiPayer
        ? draft.payers
        : [{ user: draft.payerId, amount: draft.amount }];
      return payers.length === 1
        ? person(payers[0].user)
        : payers.map((row) => `${person(row.user)} ${money(row.amount)}`).join(', ');
    }
    case 'split': {
      const value = (user: string) => draft.splitValues[user] || '0';
      const shares = draft.participantIds.map((user) =>
        draft.splitMethod === 'equal'
          ? person(user)
          : draft.splitMethod === 'percentage'
            ? `${person(user)} ${value(user)}%`
            : draft.splitMethod === 'shares'
              ? `${person(user)} ${value(user)}`
              : `${person(user)} ${money(value(user))}`,
      );
      return `${splitSummaries[draft.splitMethod]}: ${shares.join(', ')}`;
    }
    case 'tag':
      return tagName(draft.tagId);
    case 'category':
      return getCategory(draft.category)?.label ?? draft.category;
    case 'notes':
      return draft.notes.trim();
  }
}

/**
 * "What's different": each field that differs between the member's version and the saved
 * Expense. With `onChoose`, each money field offers keeping theirs or using the saved value.
 */
export function WhatsDifferent({
  fields,
  yours,
  saved,
  note,
  onChoose,
  ref,
  ...names
}: {
  fields: readonly ExpenseVersionField[];
  yours: ExpenseDraft;
  saved: ExpenseDraft;
  /** What choosing does, under the table. */
  note: string;
  onChoose?: (field: ExpenseMoneyField, keep: 'mine' | 'saved') => void;
  /** The heading, where the table is scrolled to and focused. */
  ref?: Ref<View>;
} & VersionNames) {
  const theme = useTheme();
  // At large text sizes each version gets its own line instead of a column.
  const large = useLargeText();
  // The saved version is in the warning tone, as in the banner above.
  const value = (field: ExpenseVersionField, text: string, side: 'yours' | 'saved') => {
    const shown = large
      ? `${side === 'saved' ? 'Saved now' : 'Yours'}: ${text || '–'}`
      : text || '–';
    const tone = side === 'saved' ? 'warning' : 'primary';
    const style = large ? undefined : { flex: 1, minWidth: 0, textAlign: 'right' as const };
    return field === 'amount' && !large ? (
      <Money size="table" tone={tone} style={style}>
        {shown}
      </Money>
    ) : (
      <CompactText variant="small" tone={tone} style={style}>
        {shown}
      </CompactText>
    );
  };
  return (
    <Card>
      <View
        ref={ref}
        accessible
        accessibilityRole="header"
        accessibilityLabel="What’s different"
        style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}
      >
        <CompactText variant="overline">What’s different</CompactText>
      </View>
      {fields.length && !large ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 2 }}
        >
          <View style={{ width: 84 }} />
          {['Yours', 'Saved now'].map((heading) => (
            <CompactText
              key={heading}
              variant="caption"
              tone="secondary"
              style={{ flex: 1, textAlign: 'right' }}
            >
              {heading}
            </CompactText>
          ))}
        </View>
      ) : null}
      {fields.length ? (
        fields.map((field) => {
          const label = versionLabels[field];
          const mine = versionText(yours, field, names);
          const theirs = versionText(saved, field, names);
          return (
            <View key={field} style={{ gap: 2, paddingHorizontal: 14, paddingVertical: 6 }}>
              <View
                accessible
                accessibilityLabel={`${label}: yours ${mine || 'none'}, saved now ${theirs || 'none'}`}
                style={
                  large ? { gap: 2 } : { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }
                }
              >
                <CompactText
                  variant="small"
                  weight={large ? 'semibold' : undefined}
                  style={large ? undefined : { width: 84 }}
                >
                  {label}
                </CompactText>
                {value(field, mine, 'yours')}
                {value(field, theirs, 'saved')}
              </View>
              {onChoose && isMoneyField(field) ? (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 4 }}>
                  <CompactButton
                    label="Keep yours"
                    accessibilityLabel={`Keep your ${reviewNames[field]}`}
                    variant="text"
                    dense
                    onPress={() => onChoose(field, 'mine')}
                  />
                  <CompactButton
                    label="Use saved"
                    accessibilityLabel={`Use the saved ${reviewNames[field]}`}
                    variant="tonal"
                    dense
                    onPress={() => onChoose(field, 'saved')}
                  />
                </View>
              ) : null}
            </View>
          );
        })
      ) : (
        <CompactText tone="secondary" style={{ paddingHorizontal: 14, paddingVertical: 6 }}>
          Your version matches the saved one.
        </CompactText>
      )}
      <View
        style={{
          marginTop: 6,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          padding: 14,
        }}
      >
        <CompactText variant="small" tone="secondary">
          {note}
        </CompactText>
      </View>
    </Card>
  );
}

/** Category and Notes behind one optional row. */
export function OptionalDetails({
  draft,
  locked,
  onChange,
}: {
  draft: ExpenseDraft;
  locked: boolean;
  onChange: (patch: Partial<ExpenseDraft>) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Category and notes, optional"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => ({
          minHeight: 56,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 14,
          backgroundColor: pressed ? theme.surfaceMuted : undefined,
        })}
      >
        <Icon name="document-text-outline" size={20} color={theme.brand.main} />
        <CompactText weight="semibold" style={{ flex: 1 }}>
          Category and notes
        </CompactText>
        <FieldMarker kind="optional" />
        <Icon name={open ? 'chevron-up-outline' : 'chevron-down-outline'} size={20} />
      </Pressable>
      {open ? (
        <View style={{ padding: 14, paddingTop: 4, gap: 12 }}>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Category"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
          >
            {EXPENSE_CATEGORIES.map((category) => (
              <Chip
                key={category.id}
                role="radio"
                label={category.label}
                selected={draft.category === category.id}
                onPress={() => !locked && onChange({ category: category.id })}
              />
            ))}
          </View>
          <Field
            label="Notes"
            value={draft.notes}
            maxLength={500}
            multiline
            editable={!locked}
            onChangeText={(notes) => onChange({ notes })}
          />
        </View>
      ) : null}
    </Card>
  );
}

/** Pinned under the form, above the keyboard; it names the amount once that is valid. */
export function SaveBar({
  label,
  amount,
  blocked,
  onSave,
  secondary,
}: {
  label: string;
  amount?: string;
  /** Why Save is unavailable, also spoken as its hint. */
  blocked: string | null;
  onSave: () => void;
  /** A quieter alternative under the main action, such as "Keep for later". */
  secondary?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: 6,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 12,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        backgroundColor: theme.bgElevated,
      }}
    >
      <CompactButton
        label={label}
        amount={amount}
        block
        disabled={blocked !== null}
        hint={blocked ?? undefined}
        onPress={onSave}
      />
      {blocked ? (
        <CompactText variant="small" tone="secondary">
          {blocked}
        </CompactText>
      ) : null}
      {secondary ? (
        <CompactButton label={secondary.label} variant="text" block onPress={secondary.onPress} />
      ) : null}
    </View>
  );
}
