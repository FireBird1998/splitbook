import { memo, type ReactNode } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
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
import { notOnPhone } from '../data/home-queries';
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
  Skeleton,
  SkeletonText,
  moneySizes,
  scaledSp,
  useLargeText,
  useLineBox,
} from './compact';
import { readTime, RetainedNotice } from './financial-views';
import { NotAvailableOffline } from './offline-notice';
import type { IconName } from './primitives';
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
  refreshDisabled = false,
  onRefresh,
  onAccount,
}: {
  userName: string;
  status?: ReactNode;
  accountDisabled?: boolean;
  refreshDisabled?: boolean;
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
      {/* Takes the room the actions leave; the status in it is one short line (#332). */}
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
      <IconButton
        icon="refresh-outline"
        label="Refresh Home"
        disabled={refreshDisabled}
        onPress={onRefresh}
      />
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

/**
 * When the figures shown were read. "Updated hh:mm" for the server's answer in this session,
 * offline too; this device's saved copy says "Saved hh:mm", never presented as fresh (ADR
 * 0006), and offline it is the badge every saved view shows. "Saved" giving way to "Updated"
 * cross-fades in place (#332). Read again after a change, or after a Group's Expenses were read,
 * they say "Updating…" where their time was, in its place, so nothing moves (#219).
 */
function BalancesTime({
  state,
  offline,
  updating,
}: {
  state: HomeFinancialState;
  offline: boolean;
  updating: boolean;
}) {
  return readTime({
    refreshedAt: state.refreshedAt,
    restored: state.restored === true,
    updating,
    offline,
    tone: 'muted',
  });
}

/**
 * One row per currency, each kept separate, with when the figures were read (`BalancesTime`).
 * `silent` keeps an automatic refresh unannounced.
 */
export const HomeBalances = memo(function HomeBalances({
  state,
  offline = false,
  silent = false,
  onRefresh,
}: {
  state: HomeFinancialState;
  offline?: boolean;
  silent?: boolean;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  const large = useLargeText();
  const chip = useLineBox('body').height + 6;
  // Tall enough for "Updated hh:mm" from the start, so the figures don't move when it appears.
  const status = useLineBox('caption').height;
  const loading = state.status === 'idle' || state.status === 'loading';
  const placeholder = state.data === null && loading;
  if (state.data === null && state.status === 'error' && offline)
    return (
      <NotAvailableOffline
        compact
        // True whether they were never saved, removed by a change or sign-out, or withheld.
        message={notOnPhone.balances}
        onRetry={onRefresh}
      />
    );
  return (
    <View style={{ gap: 8 }}>
      {state.data !== null && (
        <RetainedNotice
          status={state.status}
          refreshedAt={state.refreshedAt}
          message={state.message}
          subject="your balances"
          retryLabel="Retry Home balances"
          offline={offline}
          onRetry={onRefresh}
        />
      )}
      <Card
        padded
        header={
          <View
            style={{
              minHeight: status,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <CompactText variant="overline" accessibilityRole="header" style={{ flex: 1 }}>
              Your balances
            </CompactText>
            {state.data !== null ? (
              <BalancesTime
                state={state}
                offline={offline}
                // From the frame Home shows them, before their read starts, until it lands or
                // fails; an automatic refresh says nothing (#219).
                updating={state.stale && state.status !== 'error' && !silent}
              />
            ) : null}
          </View>
        }
        loading={placeholder ? 'Loading your balances' : undefined}
      >
        {state.data === null ? (
          placeholder ? (
            // One currency's row, as `CurrencyRow` lays it out at this text size.
            <View
              style={{
                flexDirection: large ? 'column' : 'row',
                alignItems: large ? 'flex-start' : 'center',
                gap: large ? 6 : 12,
                paddingVertical: 10,
              }}
            >
              <Skeleton width={52} height={chip} rounded={8} />
              <SkeletonText
                style={large ? { alignSelf: 'stretch' } : { flex: 1 }}
                gap={large ? 4 : 0}
                lines={
                  large
                    ? [
                        { width: '80%', line: 'balance' },
                        { width: '80%', line: 'balance' },
                      ]
                    : [
                        { width: '40%', line: 'small' },
                        { width: '55%', line: 'balance' },
                      ]
                }
              />
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
});

/** A formatted amount, or null while the draft's amount isn't valid yet. */
function draftAmount({ amount, currency }: ExpenseDraftSummary) {
  try {
    return formatCurrency(toMajorAmount(parseAmountMinor(amount, currency), currency), currency);
  } catch {
    return null;
  }
}

/**
 * Every Expense draft on this device; saves that weren't confirmed come first, in warning.
 * `disabled` rows can't be opened yet, as while the session is checked.
 */
export const ContinueDrafts = memo(function ContinueDrafts({
  drafts,
  disabled = false,
  onOpen,
}: {
  drafts: ExpenseDraftSummary[];
  disabled?: boolean;
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
                onPress={disabled ? undefined : () => onOpen(draft)}
              />
            </View>
          );
        })}
      </Card>
    </View>
  );
});

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

/**
 * The width of a Group row's balance, before and after it lands, so a long name is cut once
 * (#332): a nine-character amount at this text size, such as "₹1,480.00", in IBM Plex Mono,
 * whose every character is 0.6 of its size. "Settled up" and the captions fit in it; a wider
 * amount widens its own row, and is never cut.
 */
export function balanceWidth(fontScale: number) {
  const { fontSize, letterSpacing } = moneySizes.list;
  return 9 * (0.6 * scaledSp(fontSize as number, fontScale) + (letterSpacing as number));
}

const GroupRow = memo(function GroupRow({
  group,
  balances,
  pending,
  width,
  onOpen,
  disabled,
}: {
  group: MobileGroup;
  /** Undefined while the member's balance in this Group is unknown. */
  balances: HomeGroupBalance[] | undefined;
  /** Home's figures are being read: an unknown balance keeps its place until they land. */
  pending: boolean;
  /** The balance's width (`balanceWidth`). */
  width: number;
  onOpen: (groupId: string) => void;
  disabled: boolean;
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
      trailingLoading={pending && !balances}
      trailingWidth={width}
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
      onPress={disabled ? undefined : () => onOpen(group.id)}
    />
  );
});

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

/**
 * The member's Groups, each with their balance in it, and New Group. `disabled` keeps them
 * from opening yet, as while the session is checked. While Home's figures are read
 * (`balancesPending`), a Group whose balance isn't known yet holds its place, so its row
 * doesn't lay out again when the balance lands after the list (#332).
 */
export const HomeGroups = memo(function HomeGroups({
  groups,
  byGroup,
  balancesPending = false,
  newGroupLabel,
  offline = false,
  disabled = false,
  onNewGroup,
  onOpen,
  onRetry,
}: {
  groups: MobileSnapshot['groups'];
  byGroup: HomeFinancialState['byGroup'];
  balancesPending?: boolean;
  newGroupLabel: string;
  offline?: boolean;
  disabled?: boolean;
  onNewGroup: () => void;
  onOpen: (groupId: string) => void;
  onRetry: () => void;
}) {
  const known = groups.loaded || groups.data.length > 0;
  const unsaved = groups.status === 'error' && offline && !groups.data.length;
  const width = balanceWidth(useWindowDimensions().fontScale);
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
            disabled={disabled}
            onPress={onNewGroup}
          />
        }
      />
      {unsaved ? (
        <NotAvailableOffline compact message={notOnPhone.groups} onRetry={onRetry} />
      ) : null}
      {(groups.status === 'error' || groups.status === 'denied') && !unsaved && (
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
      {/* A list read empty stays empty while it's read again. */}
      {groups.status === 'loading' && !groups.loaded ? (
        // The list's own Card, so the Groups fade in where their skeleton was.
        <Card loading="Loading your Groups" skeleton={{ dividers: true }} />
      ) : ['ready', 'loading'].includes(groups.status) && !groups.data.length ? (
        <NoGroups onRefresh={onRetry} />
      ) : groups.data.length ? (
        <Card>
          {groups.data.map((group, index) => (
            <View key={group.id}>
              {index > 0 ? <Divider inset={rowInset} /> : null}
              <GroupRow
                group={group}
                balances={byGroup[group.id]}
                pending={balancesPending}
                width={width}
                onOpen={onOpen}
                disabled={disabled}
              />
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
});

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
