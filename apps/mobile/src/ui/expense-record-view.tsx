import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { getCategory } from '@splitbook/shared/categories';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { readExpenseMoney } from '@splitbook/shared/expense-money-edit';
import {
  draftFromExpense,
  expenseMoney,
  type ExpenseEditor as Editor,
} from '../data/expense-draft';
import { describeExpenseHistory } from '../data/expense-history';
import { canEditExpense, storedExpenseMoney, type ExpenseRecord } from '../data/expense-record';
import { expenseRecordPosition } from '@splitbook/shared/expense-position';
import { clockTime } from './activity-format';
import {
  Badge,
  Banner,
  BottomSheet,
  Card,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  IconButton,
  IconTile,
  ListRow,
  Money,
  SectionHeader,
  TopBar,
  type BadgeTone,
} from './compact';
import { WhoOwesWhat } from './expense-form';
import { Copy, Icon, Label, Panel, type IconName } from './primitives';
import { fonts, useTheme } from './theme';

const categoryIcons: Record<string, IconName> = {
  food: 'restaurant-outline',
  transport: 'car-outline',
  accommodation: 'bed-outline',
  travel: 'airplane-outline',
  entertainment: 'film-outline',
  shopping: 'bag-handle-outline',
  housing: 'home-outline',
  health: 'medkit-outline',
  education: 'school-outline',
};

/** "29 Sep, 20:02", with the year when it isn't this year. */
function recordTime(iso: string, now = Date.now()) {
  const date = new Date(iso);
  const day = date.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${day}, ${clockTime(iso)}`;
}

/**
 * A saved Expense, read-only: what it was for, the member's position, who owes what, its
 * details and when it was added and last changed. Edit is in the top bar and Delete in ⋮,
 * behind the existing confirmation. While the Group holds another draft, both wait for it.
 */
export function ExpenseRecordScreen({
  state,
  currentUserId,
  notice,
  onClose,
  onEdit,
  onReviewDelete,
  onDelete,
  onCancelDelete,
  onResume,
  onRefresh,
}: {
  state: Editor;
  currentUserId?: string;
  notice?: ReactNode;
  /** Back: returns to the Group destination the record opened from. */
  onClose?: () => void;
  onEdit: () => void;
  onReviewDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  /** Opens the Group's draft that holds Edit and Delete. */
  onResume: () => void;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  const [options, setOptions] = useState(false);
  const record = state.draft!.original!;
  const { context } = state;
  const members = context?.group.members.map(({ user }) => user) ?? [];
  const name = (id: string) =>
    members.find((member) => member.id === id)?.name ??
    [...record.paidBy, ...record.splitBetween].find((row) => row.user === id)?.name ??
    'Former member';
  const draft = draftFromExpense(record);
  // The stored allocation as saved: its rounding is never recalculated. Parsing already
  // checked it, so this only keeps the record readable if it still can't be read.
  let allocation: ReturnType<typeof expenseMoney> | null;
  try {
    allocation = expenseMoney(draft);
  } catch {
    allocation = null;
  }
  const money = (minor: number) =>
    formatCurrency(toMajorAmount(minor, record.currency), record.currency);
  const people = allocation
    ? [...new Set([...allocation.paidBy, ...allocation.splitBetween].map((row) => row.user))]
    : [];
  /** A current member's first name, unless someone else here shares it. */
  const shortName = (id: string) => {
    const full = name(id);
    const first = full.split(' ')[0];
    const shared = people.some((other) => other !== id && name(other).split(' ')[0] === first);
    return members.some((member) => member.id === id) && !shared ? first : full;
  };
  const position =
    allocation && currentUserId ? expenseRecordPosition(allocation, currentUserId) : null;
  const other = position?.counterpartyId ? `${shortName(position.counterpartyId)} ` : '';
  const badge: { label: string; tone: BadgeTone; icon?: IconName } | null = record.isDeleted
    ? { label: 'Deleted', tone: 'neutral', icon: 'trash-outline' }
    : !position
      ? null
      : position.kind === 'owe'
        ? { label: `You owe ${other}${money(position.amountMinor)}`, tone: 'negative' }
        : position.kind === 'lent'
          ? { label: `You lent ${other}${money(position.amountMinor)}`, tone: 'positive' }
          : {
              label: position.kind === 'even' ? 'You paid your share' : 'You’re not involved',
              tone: 'neutral',
            };
  const tag =
    context?.tags.find((item) => item.id === record.tagId)?.name ??
    (record.tag || 'Historical Tag');
  const date = new Date(record.date).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const category = record.category !== 'other' ? getCategory(record.category)?.label : undefined;
  const editable = canEditExpense(record);
  // The Group's draft holds Edit and Delete; the record itself stays readable.
  const held = state.groupDraft ? 'Finish or discard the draft in this Group first.' : undefined;
  const editReason =
    held ??
    (editable
      ? undefined
      : 'This Expense includes a member whose account is no longer available, so it can’t be edited.');
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TopBar
        title="Expense"
        subtitle={context?.group.name}
        leading={
          onClose
            ? {
                kind: 'back',
                label:
                  state.returnTo?.destination === 'activity' ? 'Back to Activity' : 'Back to Group',
                onPress: onClose,
              }
            : undefined
        }
        actions={
          <>
            {!record.isDeleted ? (
              <CompactButton
                label="Edit"
                accessibilityLabel="Edit expense"
                icon="pencil-outline"
                variant="text"
                disabled={!!editReason}
                hint={editReason}
                onPress={onEdit}
              />
            ) : null}
            <IconButton
              icon="ellipsis-vertical-outline"
              label="Expense options"
              onPress={() => setOptions(true)}
            />
          </>
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 }}
      >
        {notice}
        {state.groupDraft ? (
          <Banner
            tone="info"
            message="This Group has an unfinished draft. Finish or discard it to edit or delete this Expense."
          >
            <CompactButton label="Resume draft" variant="text" dense onPress={onResume} />
          </Banner>
        ) : null}
        {state.message && state.status !== 'delete-review' ? (
          <CompactText variant="small" accessibilityRole="alert">
            {state.message}
          </CompactText>
        ) : null}
        <Card padded>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconTile icon={categoryIcons[record.category] ?? 'receipt-outline'} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <CompactText variant="heading" accessibilityRole="header">
                {record.description}
              </CompactText>
              <CompactText
                variant="small"
                tone="secondary"
                accessibilityLabel={`${date}, Tag ${tag}`}
              >
                {date} · {tag}
              </CompactText>
            </View>
          </View>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginTop: 12,
            }}
          >
            {/* Shrinks to fit rather than cutting the amount short. */}
            <Money size="form" adjustsFontSizeToFit>
              {allocation
                ? money(allocation.amountMinor)
                : formatCurrency(record.amount, record.currency)}
            </Money>
            {badge ? <Badge label={badge.label} tone={badge.tone} icon={badge.icon} /> : null}
          </View>
          {record.isDeleted ? (
            <CompactText variant="small" tone="secondary" style={{ marginTop: 8 }}>
              This Expense was deleted. It no longer counts in balances.
            </CompactText>
          ) : !editable ? (
            <CompactText variant="small" tone="secondary" style={{ marginTop: 8 }}>
              This Expense includes a member whose account is no longer available. It can be
              deleted, but not edited.
            </CompactText>
          ) : null}
        </Card>
        <WhoOwesWhat
          draft={draft}
          allocation={allocation}
          problem="This allocation can’t be shown."
          name={name}
          currentUserId={currentUserId}
          money={money}
          saved
        />
        {category || record.notes ? (
          <Card>
            {category ? <DetailRow label="Category" value={category} /> : null}
            {category && record.notes ? <Divider /> : null}
            {record.notes ? <DetailRow label="Notes" value={record.notes} /> : null}
          </Card>
        ) : null}
        <RecordHistory record={record} currentUserId={currentUserId} name={name} />
      </ScrollView>
      <BottomSheet
        visible={options}
        title="Expense options"
        dismissLabel="Close Expense options"
        onDone={() => setOptions(false)}
      >
        <Card>
          <ListRow
            leading={<IconTile icon="refresh-outline" />}
            title="Refresh"
            meta="Read the latest saved version"
            onPress={() => {
              setOptions(false);
              onRefresh();
            }}
          />
          {!record.isDeleted ? (
            <>
              <Divider />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete expense"
                accessibilityHint={held ?? 'Removes it from balances; its history is kept'}
                accessibilityState={{ disabled: !!held }}
                disabled={!!held}
                onPress={() => {
                  setOptions(false);
                  onReviewDelete();
                }}
                style={({ pressed }) => ({
                  opacity: held ? 0.45 : 1,
                  backgroundColor: pressed ? theme.surfaceMuted : undefined,
                })}
              >
                <ListRow
                  leading={<IconTile icon="trash-outline" tone="warning" />}
                  title="Delete expense"
                  meta={held ?? 'Removes it from balances; its history is kept'}
                />
              </Pressable>
            </>
          ) : null}
        </Card>
      </BottomSheet>
      <BottomSheet
        visible={state.status === 'delete-review'}
        title="Delete this Expense?"
        doneLabel="Cancel"
        dismissLabel="Cancel, keeping this Expense"
        onDone={onCancelDelete}
      >
        <CompactText>
          {record.description} will no longer count in balances. Its history is kept.
        </CompactText>
        {state.message ? (
          <CompactText variant="small" tone="negative" accessibilityRole="alert">
            {state.message}
          </CompactText>
        ) : null}
        <CompactButton label="Delete expense" block onPress={onDelete} />
      </BottomSheet>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <CompactText variant="small" tone="secondary">
        {label}
      </CompactText>
      <CompactText style={{ flexShrink: 1, textAlign: 'right' }}>{value}</CompactText>
    </View>
  );
}

/**
 * When the Expense was added and last changed. This Expense's own changes will be listed
 * here once they can be read for one Expense.
 */
function RecordHistory({
  record,
  currentUserId,
  name,
}: {
  record: ExpenseRecord;
  currentUserId?: string;
  name: (id: string) => string;
}) {
  const creator = record.createdBy;
  const creatorId = typeof creator === 'object' && creator ? creator._id : creator;
  const creatorName =
    typeof creator === 'object' && creator
      ? (creator.name ?? 'Former member')
      : creatorId
        ? name(creatorId)
        : null;
  return (
    <View style={{ gap: 8 }}>
      <SectionHeader title="History" />
      <Card>
        {record.isDeleted ? (
          <>
            <HistoryRow
              icon="trash-outline"
              title="Deleted"
              time={record.deletedAt ?? record.updatedAt}
            />
            <Divider inset={58} />
          </>
        ) : record.updatedAt !== record.createdAt ? (
          <>
            <HistoryRow icon="time-outline" title="Last changed" time={record.updatedAt} />
            <Divider inset={58} />
          </>
        ) : null}
        <HistoryRow
          icon="add-outline"
          actor={
            creatorName
              ? { name: creatorName, label: creatorId === currentUserId ? 'You' : creatorName }
              : undefined
          }
          title={creatorName ? 'added this Expense' : 'Added'}
          time={record.createdAt}
        />
      </Card>
    </View>
  );
}

/** "{actor} {title}" with its time; a row without an actor leads with an icon. */
function HistoryRow({
  actor,
  icon,
  title,
  time,
}: {
  actor?: { name: string; label: string };
  icon: IconName;
  title: string;
  time: string;
}) {
  const theme = useTheme();
  const when = recordTime(time);
  return (
    <View
      accessible
      accessibilityLabel={`${actor ? `${actor.label} ${title}` : title}, ${when}`}
      style={{
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 8,
        paddingHorizontal: 14,
      }}
    >
      {actor ? (
        <CompactAvatar name={actor.name} />
      ) : (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.surfaceMuted,
          }}
        >
          <Icon name={icon} size={18} color={theme.textSecondary} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <CompactText>
          {actor ? (
            <>
              <Text style={{ fontFamily: fonts.semibold }}>{actor.label}</Text> {title}
            </>
          ) : (
            title
          )}
        </CompactText>
        <CompactText variant="caption" tone="secondary">
          {when}
        </CompactText>
      </View>
    </View>
  );
}

/** Authoritative saved values, also used beside an unchanged draft during conflict review. */
export function ExpenseRecordView({
  record,
  title = 'Saved Expense',
  people,
  tags,
}: {
  record: ExpenseRecord;
  title?: string;
  /** The Group's current members and Tags, so history can name them. */
  people?: { id: string; name: string }[];
  tags?: { id: string; name: string }[];
}) {
  const theme = useTheme();
  const history = describeExpenseHistory(record, people, tags);
  const money = readExpenseMoney(storedExpenseMoney(record));
  const amount = (value: number) => formatCurrency(value, record.currency);
  const name = (id: string) =>
    [...record.paidBy, ...record.splitBetween].find((row) => row.user === id)?.name ??
    'Former member';
  return (
    <Panel>
      <Label>{title}</Label>
      <Copy
        accessibilityRole="header"
        style={{ fontFamily: fonts.semibold, fontSize: 24, lineHeight: 32 }}
      >
        {record.description}
      </Copy>
      <Copy style={{ fontFamily: fonts.mono }}>
        {amount(money.amount)} · {record.currency}
      </Copy>
      <Copy>
        {new Date(record.date).toLocaleDateString()} · {record.category}
      </Copy>
      <Copy>Tag: {record.tag || 'Historical Tag'}</Copy>
      {record.notes ? <Copy>Notes: {record.notes}</Copy> : null}
      {record.isDeleted ? <Copy accessibilityRole="alert">This Expense is deleted.</Copy> : null}
      <Copy style={{ fontFamily: fonts.semibold }}>Paid by</Copy>
      {money.paidBy.map((row) => (
        <Copy key={row.user}>
          {name(row.user)} · {amount(row.amount)}
        </Copy>
      ))}
      <Copy style={{ fontFamily: fonts.semibold }}>Allocated · {record.splitMethod}</Copy>
      {money.splitBetween.map((row) => (
        <Copy key={row.user}>
          {name(row.user)} · {amount(row.amount)}
          {row.percentage !== undefined ? ` · ${row.percentage}%` : ''}
          {row.shares !== undefined ? ` · ${row.shares} shares` : ''}
        </Copy>
      ))}
      <Copy>
        Created {new Date(record.createdAt).toLocaleString()}
        {record.createdBy
          ? ` by ${typeof record.createdBy === 'object' ? (record.createdBy.name ?? 'Former member') : name(record.createdBy)}`
          : ''}
      </Copy>
      {record.predefinedItem ? <Copy>Item: {record.predefinedItem}</Copy> : null}
      {record.receiptUrl ? <Copy>Receipt: {record.receiptUrl}</Copy> : null}
      {record.recurringExpense ? (
        <Copy>Recurring Expense{record.period ? ` · ${record.period}` : ''}</Copy>
      ) : null}
      {record.deletedAt ? <Copy>Deleted {new Date(record.deletedAt).toLocaleString()}</Copy> : null}
      <Copy>Revision {record.revision}</Copy>
      <Copy>Last updated {new Date(record.updatedAt).toLocaleString()}</Copy>
      <View style={{ gap: 12 }}>
        <Copy accessibilityRole="header" style={{ fontFamily: fonts.semibold }}>
          Edit history
        </Copy>
        {!history.length ? (
          <Copy>No recorded edits.</Copy>
        ) : (
          history.map((entry) => (
            <View key={entry.key} style={{ gap: 4 }}>
              <Copy style={{ fontFamily: fonts.semibold }}>{entry.summary}</Copy>
              {entry.changes.map((change, index) => (
                <Copy
                  key={`${change.label}:${index}`}
                  accessibilityLabel={
                    change.before && change.after
                      ? `${change.label} changed from ${change.before} to ${change.after}`
                      : undefined
                  }
                >
                  {change.label}
                  {change.before && change.after ? (
                    <>
                      {': '}
                      <Copy style={change.money?.before ? { fontFamily: fonts.mono } : undefined}>
                        {change.before}
                      </Copy>
                      {' → '}
                      <Copy style={change.money?.after ? { fontFamily: fonts.mono } : undefined}>
                        {change.after}
                      </Copy>
                    </>
                  ) : change.after ? (
                    `: ${change.after}`
                  ) : (
                    ' changed'
                  )}
                </Copy>
              ))}
              <Copy style={{ color: theme.textSecondary, fontSize: 13 }}>{entry.editedAt}</Copy>
            </View>
          ))
        )}
      </View>
    </Panel>
  );
}
