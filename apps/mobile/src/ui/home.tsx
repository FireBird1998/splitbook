import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { formatCurrency } from '@splitbook/shared/currency';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { getMoneyTone } from '@splitbook/shared/money';
import type { GroupCategory } from '@splitbook/shared/types';
import type {
  ExpenseDraftSummary,
  HomeCurrencyBalance,
  HomeFinancialState,
  HomeGroupBalance,
  MobileGroup,
  MobileSnapshot,
} from '../data/types';
import {
  Banner,
  Card,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  IconButton,
  IconTile,
  ListRow,
  Money,
  RowAmount,
  SectionHeader,
  useLargeText,
} from './compact';
import { RetainedNotice } from './financial-views';
import { Loading, type IconName } from './primitives';
import { refreshedLabel } from './refresh-feedback';
import { fonts, useTheme } from './theme';

const themeIcons: Record<GroupCategory, IconName> = {
  home: 'home-outline',
  trip: 'airplane-outline',
  work: 'briefcase-outline',
  couple: 'heart-outline',
  other: 'people-outline',
};
/** Leading icon tile (40) plus the row's padding and gap, so dividers start under the text. */
const rowInset = 66;

/** The wordmark, a quiet refresh status, Refresh, and the avatar that opens Account. */
export function HomeTopBar({
  userName,
  status,
  accountDisabled = false,
  onRefresh,
  onAccount,
}: {
  userName: string;
  status?: ReactNode;
  accountDisabled?: boolean;
  onRefresh: () => void;
  onAccount: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingVertical: 4,
        paddingLeft: 20,
        paddingRight: 4,
        backgroundColor: theme.bg,
      }}
    >
      {/* Shrinks so a long refresh status wraps instead of pushing the actions off screen. */}
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text
          accessibilityRole="header"
          style={{
            fontFamily: fonts.bold,
            fontSize: 24,
            lineHeight: 30,
            letterSpacing: -0.6,
            color: theme.text,
          }}
        >
          splitbook<Text style={{ color: theme.brand.main }}>.</Text>
        </Text>
        {status}
      </View>
      <IconButton icon="refresh-outline" label="Refresh Home" onPress={onRefresh} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account and settings"
        accessibilityState={{ disabled: accountDisabled }}
        disabled={accountDisabled}
        onPress={onAccount}
        style={({ pressed }) => ({
          width: 48,
          height: 48,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: accountDisabled ? 0.4 : pressed ? 0.7 : 1,
        })}
      >
        <CompactAvatar name={userName} />
      </Pressable>
    </View>
  );
}

function CurrencyRow({ bucket }: { bucket: HomeCurrencyBalance }) {
  const theme = useTheme();
  const large = useLargeText();
  const figures = [
    { label: 'You owe', value: bucket.youOwe, tone: 'negative' as const },
    { label: 'Owed to you', value: bucket.youAreOwed, tone: 'positive' as const },
  ].map((figure) => ({ ...figure, shown: formatCurrency(figure.value, bucket.currency) }));
  return (
    <View
      accessible
      accessibilityLabel={`${bucket.currency}: ${figures.map((figure) => `${figure.label} ${figure.shown}`).join(', ')}`}
      // At large text the code sits above the figures, which become label-and-value rows.
      style={{
        flexDirection: large ? 'column' : 'row',
        alignItems: large ? 'flex-start' : 'center',
        gap: large ? 6 : 12,
        paddingVertical: 10,
      }}
    >
      <View
        style={{
          minWidth: 52,
          alignItems: 'center',
          borderRadius: 8,
          paddingHorizontal: 8,
          paddingVertical: 3,
          backgroundColor: theme.surfaceMuted,
        }}
      >
        <CompactText tone="secondary" style={{ fontFamily: fonts.mono }}>
          {bucket.currency}
        </CompactText>
      </View>
      <View
        style={{
          flex: large ? undefined : 1,
          alignSelf: large ? 'stretch' : undefined,
          flexDirection: large ? 'column' : 'row',
          gap: large ? 4 : 12,
        }}
      >
        {figures.map((figure) => (
          <View
            key={figure.label}
            style={
              large
                ? {
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 8,
                  }
                : { flex: 1, minWidth: 0 }
            }
          >
            <CompactText variant="small" tone="secondary">
              {figure.label}
            </CompactText>
            {/* Nothing owed either way is neutral, never coral or mint. */}
            <Money
              size="balance"
              tone={getMoneyTone(figure.value) === 'neutral' ? 'secondary' : figure.tone}
              adjustsFontSizeToFit
            >
              {figure.shown}
            </Money>
          </View>
        ))}
      </View>
    </View>
  );
}

/** One row per currency, each kept separate, with when the figures were read. */
export function HomeBalances({
  state,
  onRefresh,
}: {
  state: HomeFinancialState;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  const loading = state.status === 'idle' || state.status === 'loading';
  return (
    <View style={{ gap: 8 }}>
      {state.data !== null && (
        <RetainedNotice
          status={state.status}
          stale={state.stale}
          refreshedAt={state.refreshedAt}
          message={state.message}
          subject="your balances"
          retryLabel="Retry Home balances"
          onRetry={onRefresh}
        />
      )}
      <Card padded>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <CompactText variant="overline" accessibilityRole="header" style={{ flex: 1 }}>
            Your balances
          </CompactText>
          {state.data !== null && state.refreshedAt !== null ? (
            <CompactText variant="caption" tone="muted">
              Updated {refreshedLabel(state.refreshedAt)}
            </CompactText>
          ) : null}
        </View>
        {state.data === null ? (
          loading ? (
            <View
              accessibilityLiveRegion="polite"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 }}
            >
              <ActivityIndicator color={theme.brand.main} />
              <CompactText tone="secondary">Loading your balances…</CompactText>
            </View>
          ) : (
            <View style={{ gap: 8, paddingTop: 10, alignItems: 'flex-start' }}>
              <CompactText accessibilityRole="alert" variant="small" tone="negative">
                {state.message ?? 'Couldn’t load your balances. Try again.'}
              </CompactText>
              <CompactButton
                label="Retry Home balances"
                variant="tonal"
                dense
                onPress={onRefresh}
              />
            </View>
          )
        ) : state.data.length ? (
          state.data.map((bucket, index) => (
            <View key={bucket.currency}>
              {index > 0 ? <View style={{ height: 1, backgroundColor: theme.border }} /> : null}
              <CurrencyRow bucket={bucket} />
            </View>
          ))
        ) : (
          <CompactText weight="semibold" tone="secondary" style={{ paddingTop: 10 }}>
            Nothing outstanding in your Groups
          </CompactText>
        )}
      </Card>
    </View>
  );
}

/** A formatted amount, or null while the draft's amount isn't valid yet. */
function draftAmount({ amount, currency }: ExpenseDraftSummary) {
  try {
    return formatCurrency(toMajorAmount(parseAmountMinor(amount, currency), currency), currency);
  } catch {
    return null;
  }
}

/** Every Expense draft on this device; saves that weren't confirmed come first, in warning. */
export function ContinueDrafts({
  drafts,
  onOpen,
}: {
  drafts: ExpenseDraftSummary[];
  onOpen: (draft: ExpenseDraftSummary) => void;
}) {
  if (!drafts.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <SectionHeader title="Continue where you left off" />
      <Card>
        {drafts.map((draft, index) => {
          const amount = draftAmount(draft);
          const description = draft.description.trim() || 'No description';
          const status = draft.unconfirmed ? 'Save not confirmed' : 'Draft';
          return (
            <View key={draft.groupId}>
              {index > 0 ? <Divider inset={rowInset} /> : null}
              <ListRow
                leading={
                  draft.unconfirmed ? (
                    <IconTile icon="alert-circle-outline" tone="warning" />
                  ) : (
                    <IconTile icon="pencil-outline" tone="info" />
                  )
                }
                title={description}
                meta={`${status} · ${draft.groupName}`}
                metaTone={draft.unconfirmed ? 'warning' : 'secondary'}
                trailing={amount ? <Money>{amount}</Money> : undefined}
                accessibilityLabel={[status, description, amount, draft.groupName]
                  .filter(Boolean)
                  .join(', ')}
                onPress={() => onOpen(draft)}
              />
            </View>
          );
        })}
      </Card>
    </View>
  );
}

/** "17–20 Sep", "28 Sep – 2 Oct" or "17 Sep"; Group dates are calendar days at UTC midnight. */
function tripDates({ startDate, endDate }: MobileGroup) {
  if (!startDate) return null;
  const day = (date: Date) => date.getUTCDate();
  const month = (date: Date) => date.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' });
  if (!endDate) return `${day(startDate)} ${month(startDate)}`;
  return month(startDate) === month(endDate) &&
    startDate.getUTCFullYear() === endDate.getUTCFullYear()
    ? `${day(startDate)}–${day(endDate)} ${month(endDate)}`
    : `${day(startDate)} ${month(startDate)} – ${day(endDate)} ${month(endDate)}`;
}

/** The first currency the member isn't settled in, "+N" for the rest, or Settled up. */
function groupPosition(balances: HomeGroupBalance[]) {
  const open = balances.filter(({ balance }) => getMoneyTone(balance) !== 'neutral');
  if (!open.length) return null;
  const [first] = open;
  const owe = first.balance < 0;
  const amount = formatCurrency(Math.abs(first.balance), first.currency);
  const more = open.length - 1;
  return {
    amount,
    tone: owe ? ('negative' as const) : ('positive' as const),
    caption: `${owe ? 'you owe' : 'owed to you'}${more ? ` · +${more}` : ''}`,
    spoken: `${owe ? 'You owe' : 'Owed to you'} ${amount}${more ? `, plus ${more} more ${more === 1 ? 'currency' : 'currencies'}` : ''}`,
  };
}

function GroupRow({
  group,
  balances,
  onPress,
}: {
  group: MobileGroup;
  /** Undefined while the member's balance in this Group is unknown. */
  balances: HomeGroupBalance[] | undefined;
  onPress: () => void;
}) {
  const descriptor = getGroupTheme(group.category);
  const count = group.members.length;
  const meta = [
    descriptor.label,
    descriptor.dates === 'bounded' ? tripDates(group) : null,
    `${count} ${count === 1 ? 'member' : 'members'}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const position = balances && groupPosition(balances);
  return (
    <ListRow
      leading={<IconTile icon={themeIcons[descriptor.id]} />}
      title={group.name}
      meta={meta}
      trailing={
        position ? (
          <RowAmount amount={position.amount} tone={position.tone} caption={position.caption} />
        ) : balances ? (
          <CompactText variant="small" tone="secondary">
            Settled up
          </CompactText>
        ) : undefined
      }
      accessibilityLabel={[
        `Open ${group.name}`,
        meta,
        position ? position.spoken : balances ? 'Settled up' : null,
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={onPress}
    />
  );
}

function NoGroups({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Card padded>
      <View style={{ gap: 8, alignItems: 'flex-start' }}>
        <IconTile icon="people-outline" />
        <CompactText variant="heading">A shared space starts here.</CompactText>
        <CompactText variant="small" tone="secondary">
          You haven’t joined any Groups yet. Create a Group or open an invitation to get started.
        </CompactText>
        <CompactButton
          label="Refresh Groups"
          icon="refresh-outline"
          variant="tonal"
          dense
          onPress={onRefresh}
        />
      </View>
    </Card>
  );
}

/** The member's Groups, each with their balance in it, and New Group. */
export function HomeGroups({
  groups,
  byGroup,
  newGroupLabel,
  onNewGroup,
  onOpen,
  onRetry,
}: {
  groups: MobileSnapshot['groups'];
  byGroup: HomeFinancialState['byGroup'];
  newGroupLabel: string;
  onNewGroup: () => void;
  onOpen: (groupId: string) => void;
  onRetry: () => void;
}) {
  const known = groups.status === 'ready' || groups.data.length > 0;
  return (
    <View style={{ gap: 6 }}>
      <SectionHeader
        title={known ? `Groups · ${groups.data.length}` : 'Groups'}
        trailing={
          <CompactButton
            label={newGroupLabel}
            icon="add"
            variant="text"
            dense
            onPress={onNewGroup}
          />
        }
      />
      {(groups.status === 'error' || groups.status === 'denied') && (
        <Banner
          tone="error"
          title="Couldn’t load your Groups"
          message={
            groups.data.length
              ? `${groups.message ?? 'Please try again.'} Showing previously verified Groups.`
              : (groups.message ?? 'Please try again.')
          }
        >
          <CompactButton label="Try again" variant="text" dense onPress={onRetry} />
        </Banner>
      )}
      {groups.status === 'loading' && !groups.data.length ? (
        <Loading label="Finding your Groups…" />
      ) : groups.status === 'ready' && !groups.data.length ? (
        <NoGroups onRefresh={onRetry} />
      ) : groups.data.length ? (
        <Card>
          {groups.data.map((group, index) => (
            <View key={group.id}>
              {index > 0 ? <Divider inset={rowInset} /> : null}
              <GroupRow
                group={group}
                balances={byGroup[group.id]}
                onPress={() => onOpen(group.id)}
              />
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

/** A Group save that wasn't confirmed: check the Groups list before sending it again. */
export function GroupCreationCheck({
  message,
  groupsReady,
  onCheck,
  onResume,
  onDiscard,
}: {
  message: string | null;
  groupsReady: boolean;
  onCheck: () => void;
  onResume: () => void;
  onDiscard: () => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Banner
        tone="warning"
        message={message ?? 'Your Group may already be created. Check your Groups first.'}
      />
      <CompactButton label="Refresh my Groups" variant="tonal" block onPress={onCheck} />
      <CompactButton
        label="I checked — return to my form"
        variant="tonal"
        block
        disabled={!groupsReady}
        hint={groupsReady ? undefined : 'Available once your Groups have loaded.'}
        onPress={onResume}
      />
      <CompactButton label="Discard this form" variant="text" block onPress={onDiscard} />
    </View>
  );
}
