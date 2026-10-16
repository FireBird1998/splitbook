import { ListDayHeader } from './list-day-header';
import type { RowPlaces } from './return-scroll';
import { GroupLedgerList, type LedgerScrollProps } from './group-ledger-list';
import { ledgerItems } from './ledger-items';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { activityExpenseId, type ActivityEvent, type ActivityState } from '../data/activity';
import {
  activityDays,
  clockTime,
  describeActivity,
  spokenActivity,
  type ActivityLine,
  type TextRun,
} from './activity-format';
import {
  Banner,
  Card,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  LinearProgress,
  SectionHeader,
} from './compact';
import { readTime } from './financial-views';
import { NotAvailableOffline } from './offline-notice';
import { fonts, useTheme } from './theme';

type Member = { id: string; name: string };

interface GroupActivityProps {
  header?: ReactNode;
  listScroll?: LedgerScrollProps;
  state: ActivityState;
  currentUserId: string;
  /** The Group's currency, for amounts an event doesn't label itself. */
  currency: string;
  /** The Group's members, to name people in edits; anyone else is a former member. */
  members?: Member[];
  /** The app can't reach SplitBook: this device's saved copy shows its badge. */
  offline: boolean;
  now?: number;
  dayKey?: string;
  onRetry: () => void;
  onMore: () => void;
  /** Reads the page before the window, once Activity has slid past its newest page (#222). */
  onLoadNewer?: () => void;
  /** Scroll the view by `dy`: the events above the one on screen moved by as much. */
  onShift?: (dy: number) => void;
  /** Current row layouts in scroll-content coordinates, for memory-only return anchors. */
  onRowsLayout?: (rows: RowPlaces) => void;
  /** Opens an event: its Expense's record when it names one, otherwise what was recorded. */
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** The Activity destination: this Group's changes, newest first, grouped by day. */
export function GroupActivity(props: GroupActivityProps) {
  return props.state.selected ? (
    <ActivityDetail {...props} event={props.state.selected} />
  ) : (
    <ActivityList {...props} />
  );
}

function Headline({ line, numberOfLines }: { line: ActivityLine; numberOfLines?: number }) {
  const strong = { fontFamily: fonts.semibold };
  return (
    <CompactText numberOfLines={numberOfLines}>
      <Text style={strong}>{line.actor}</Text> {line.verb}
      {line.subject ? (
        <>
          {' '}
          <Text style={strong}>{line.subject}</Text>
        </>
      ) : null}
      {line.complement ? ` ${line.complement}` : null}
    </CompactText>
  );
}

/** Text within a sentence, with its amounts in the money font. */
function Runs({ runs }: { runs: TextRun[] }) {
  return (
    <>
      {runs.map((run, index) =>
        run.mono ? (
          <Text key={index} style={{ fontFamily: fonts.mono, fontVariant: ['tabular-nums'] }}>
            {run.text}
          </Text>
        ) : (
          run.text
        ),
      )}
    </>
  );
}

function Details({ line, time }: { line: ActivityLine; time: string }) {
  const parts = [...line.details, { text: time }];
  return (
    <CompactText variant="caption" tone="secondary" numberOfLines={2}>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? ' · ' : ''}
          <Runs runs={part.runs ?? [part]} />
        </Fragment>
      ))}
    </CompactText>
  );
}

/** The same people, by id and name: a row that names them needn't be drawn again. */
const sameMembers = (a?: Member[], b?: Member[]) =>
  a === b ||
  (!!a &&
    !!b &&
    a.length === b.length &&
    a.every((member, index) => member.id === b[index].id && member.name === b[index].name));

/** What an event says: drawn again only when that changes, never for whether it can be opened. */
const EventContent = memo(function EventContent({
  line,
  name,
  time,
}: {
  line: ActivityLine;
  name: string;
  time: string;
}) {
  return (
    <>
      <CompactAvatar name={name} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Headline line={line} numberOfLines={2} />
        <Details line={line} time={time} />
      </View>
    </>
  );
});

/**
 * One event, drawn again only when the event or how it is described changes: a refresh, a page
 * loaded or a slide that keeps it redraws nothing of it, and while it is read again only whether
 * it can be opened changes (#222, as #219).
 */
const ActivityRow = memo(
  function ActivityRow({
    event,
    currentUserId,
    currency,
    members,
    disabled,
    onSelect,
  }: {
    event: ActivityEvent;
    currentUserId: string;
    currency: string;
    members?: Member[];
    disabled: boolean;
    onSelect: (id: string) => void;
  }) {
    const theme = useTheme();
    const named = members?.map(({ id, name }) => `${id}:${name}`).join('|');
    const line = useMemo(
      () => describeActivity(event, { currentUserId, currency, members }),
      // The members by what they say, not by the list that holds them.
      [event, currentUserId, currency, named],
    );
    const time = clockTime(event.createdAt);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spokenActivity(line, time)}
        accessibilityHint={
          activityExpenseId(event) ? 'Opens this Expense' : 'Opens what was recorded'
        }
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onSelect(event._id)}
        style={({ pressed }) => ({
          minHeight: 60,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 8,
          paddingHorizontal: 14,
          backgroundColor: pressed ? theme.surfaceMuted : undefined,
        })}
      >
        <EventContent line={line} name={event.actor?.name || 'Former member'} time={time} />
      </Pressable>
    );
  },
  (a, b) =>
    a.event === b.event &&
    a.currentUserId === b.currentUserId &&
    a.currency === b.currency &&
    a.disabled === b.disabled &&
    a.onSelect === b.onSelect &&
    sameMembers(a.members, b.members),
);

function ActivityList({
  state,
  currentUserId,
  currency,
  members,
  offline,
  now: legacyNow,
  dayKey,
  onRetry,
  onMore,
  onLoadNewer,
  onShift,
  onRowsLayout,
  onSelect,
  header,
  listScroll,
}: GroupActivityProps) {
  const now = dayKey ? new Date(`${dayKey}T12:00:00`).getTime() : (legacyNow ?? Date.now());
  const theme = useTheme();
  const loading = state.status === 'loading';
  // Events listed with their pages: they stay shown while they're read again (M1-3), and after
  // that failed.
  const listed = state.pagination !== null && state.events.length > 0;
  // Load older stays in place, disabled, while the events shown are read again and after that
  // failed, so the list never gets shorter under the member: at its end, Android would clamp the
  // view (#219).
  const more = listed && state.pagination!.page < state.pagination!.totalPages;
  // Past 5 pages the list has slid: the pages before it are read with Load newer, above it, which
  // stays in place, disabled, as Load older does (M7-2, as #219's Expenses keep it).
  const newer = listed && (state.firstPage ?? 1) > 1;
  // The latest handler, behind one that never changes, so no row renders again for it.
  const selecting = useRef(onSelect);
  useEffect(() => {
    selecting.current = onSelect;
  });
  const select = useCallback((id: string) => selecting.current(id), []);
  const progress = (label: string) => (
    <View
      accessibilityLiveRegion="polite"
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
      }}
    >
      <ActivityIndicator color={theme.brand.main} />
      <CompactText tone="secondary">{label}</CompactText>
    </View>
  );
  /**
   * Load older, below the events, or Load newer, above them: loading, failed with the events
   * kept, or offered, and named for TalkBack. Load newer loads busy in its own place, so the
   * events below it don't move before its page lands (#220's lesson). Each is offered once the
   * events are read, and not while the other one reads.
   */
  const pageControl = (
    which: 'older' | 'newer',
    status: 'idle' | 'loading' | 'error',
    onPress: () => void,
  ) =>
    status === 'loading' && which === 'older' ? (
      progress('Loading older activity…')
    ) : (
      <>
        {status === 'error' ? (
          <CompactText variant="small" tone="negative" accessibilityRole="alert">
            {`Couldn’t load ${which} activity. The events shown are still here.`}
          </CompactText>
        ) : null}
        <CompactButton
          label={status === 'error' ? `Try loading ${which} activity` : `Load ${which} activity`}
          busy={status === 'loading' ? `Loading ${which} activity…` : undefined}
          variant="tonal"
          block
          disabled={
            state.status !== 'ready' ||
            (which === 'older' ? state.newerStatus : state.moreStatus) === 'loading'
          }
          onPress={onPress}
        />
      </>
    );
  const items = useMemo(
    () =>
      ledgerItems(
        activityDays(state.events, now).map((day) => ({ ...day, rows: day.events })),
        (event) => event._id,
      ),
    [state.events, now],
  );
  const renderRow = useCallback(
    (item: (typeof items)[number]) =>
      item.kind === 'day' ? (
        <>
          {!item.first ? <Divider /> : null}
          <ListDayHeader label={item.label} />
        </>
      ) : (
        <ActivityRow
          event={item.row}
          currentUserId={currentUserId}
          currency={currency}
          members={members}
          disabled={state.status !== 'ready'}
          onSelect={select}
        />
      ),
    [currentUserId, currency, members, state.status, select],
  );
  return (
    <GroupLedgerList
      {...listScroll}
      items={items}
      renderRow={renderRow}
      firstPage={state.firstPage ?? 1}
      onShift={onShift}
      onRowsLayout={onRowsLayout}
      header={
        <>
          {header}
          <SectionHeader
            title="Changes in this Group"
            // Under the title: beside it, the time was cut at the screen's edge at 130% text on a
            // 360dp phone (#222's UI review), and it never moves the events as it changes.
            below
            trailing={
              // When the events shown were read: "Updated" for this session's reads, offline too,
              // "Saved" only for this phone's copy (#222, as #219). The progress bar says a read runs.
              // Drawn as part of this list, as Home's balances draw it, so it renders nothing more.
              state.events.length > 0 && state.refreshedAt !== null ? (
                readTime({
                  refreshedAt: state.refreshedAt,
                  restored: state.restored === true,
                  offline,
                })
              ) : (
                <CompactText variant="caption" tone="secondary">
                  Newest first
                </CompactText>
              )
            }
          />
          {state.status === 'error' && state.unsaved && !state.events.length ? (
            <NotAvailableOffline
              compact
              // True whether it was never saved here, removed by a change or a sign-out, or withheld
              // (#323): never "hasn't been opened" (#280 item 2). A server's own failure says what
              // failed instead, offline too: it isn't about what this phone keeps (#222).
              message="This Group’s activity isn’t saved on this phone. Connect to load it."
              onRetry={onRetry}
            />
          ) : state.status === 'denied' ? (
            <Banner
              tone="error"
              title="This Group isn’t available"
              message={state.message ?? 'You may no longer be a member of this Group.'}
            />
          ) : state.status === 'error' ? (
            <Banner
              tone={offline ? 'offline' : 'warning'}
              title="Couldn’t update Activity"
              message={
                state.message ??
                'Events shown may be out of date. A missing event doesn’t mean a change failed.'
              }
            >
              <CompactButton label="Try again" variant="text" dense onPress={onRetry} />
            </Banner>
          ) : null}
          {newer && onLoadNewer
            ? pageControl('newer', state.newerStatus ?? 'idle', onLoadNewer)
            : null}
        </>
      }
      empty={
        loading && state.pagination === null ? (
          <Card loading="Loading Activity" skeleton={{ avatar: true, heading: true }} />
        ) : (state.status === 'ready' || loading) && !state.events.length ? (
          <Card padded>
            <CompactText weight="semibold">No changes yet</CompactText>
            <CompactText variant="small" tone="secondary">
              Expenses, payments and member changes in this Group will appear here.
            </CompactText>
          </Card>
        ) : null
      }
      footer={more ? pageControl('older', state.moreStatus, onMore) : null}
    />
  );
}

const recordCheck: Record<string, [current: string, saved: string]> = {
  available: [
    'This Expense still exists. Its current values may differ from this event.',
    'At the last saved check this Expense still existed. It may have changed since.',
  ],
  deleted: [
    'This Expense has since been deleted. What happened here stays in the history.',
    'At the last saved check this Expense had been deleted.',
  ],
  unavailable: [
    'The Expense isn’t available. That doesn’t change what happened here.',
    'The Expense isn’t available. That doesn’t change what happened here.',
  ],
  error: ['Couldn’t check the Expense as it is now.', 'Couldn’t check the Expense as it is now.'],
};

function ActivityDetail({
  state,
  event,
  currentUserId,
  currency,
  members,
  offline,
  onSelect,
  onClose,
}: GroupActivityProps & { event: ActivityEvent }) {
  const line = describeActivity(event, { currentUserId, currency, members });
  const when = new Date(event.createdAt).toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const check = recordCheck[state.target.status];
  return (
    <View style={{ gap: 12 }}>
      <Card padded>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <CompactAvatar name={event.actor?.name || 'Former member'} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Headline line={line} />
            <Details
              line={{ ...line, details: line.changes.length ? [] : line.details }}
              time={when}
            />
          </View>
        </View>
      </Card>
      {line.changes.length ? (
        <>
          <SectionHeader title="What changed" />
          <Card>
            {line.changes.map((change, index) => (
              <View key={index}>
                {index > 0 ? <Divider /> : null}
                <CompactText style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
                  <Runs runs={change.runs ?? [change]} />
                </CompactText>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      {event.type === 'settlement_recorded' ? (
        <CompactText variant="small" tone="secondary">
          This records a payment made outside Splitbook. No money moved in the app.
        </CompactText>
      ) : null}
      {state.target.status === 'loading' ? (
        <LinearProgress label="Checking the Expense as it is now" />
      ) : check ? (
        <Banner tone={offline ? 'offline' : 'info'} message={check[offline ? 1 : 0]}>
          {state.target.status === 'error' ? (
            <CompactButton
              label="Try again"
              variant="text"
              dense
              onPress={() => onSelect(event._id)}
            />
          ) : null}
        </Banner>
      ) : null}
      <CompactText variant="small" tone="secondary">
        This is what was recorded at the time.
      </CompactText>
      <CompactButton label="Back to Activity" variant="text" onPress={onClose} />
    </View>
  );
}
