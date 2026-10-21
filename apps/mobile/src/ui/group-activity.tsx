import { ListDayHeader } from './list-day-header';
import type { RowPlaces } from './return-scroll';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import {
  paymentRecord,
  readCrossCurrencyRecord,
  type CrossCurrencyRecord,
} from '@splitbook/shared/cross-currency-payment';
import {
  groupSettlementBatches,
  type SettlementBatchActivityItem,
} from '@splitbook/shared/settlement-batch-activity';
import { activityExpenseId, type ActivityEvent, type ActivityState } from '../data/activity';
import {
  activityDays,
  clockTime,
  describeActivity,
  describeSettlementBatch,
  spokenActivity,
  type ActivityLine,
  type TextRun,
} from './activity-format';
import {
  Badge,
  Banner,
  Card,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  LinearProgress,
  SectionHeader,
  useLargestText,
  useTap,
} from './compact';
import { readTime } from './financial-views';
import { spellMoment } from './day-format';
import { NotAvailableOffline } from './offline-notice';
import { fonts, useTheme } from './theme';
import { PRODUCT_NAME } from '../product';

type Member = { id: string; name: string };
/** A settle-up's events, as the shared groupSettlementBatches collects them (#734). */
type Batch = Extract<SettlementBatchActivityItem<ActivityEvent>, { kind: 'batch' }>;

interface GroupActivityProps {
  state: ActivityState;
  currentUserId: string;
  /** The Group's currency, for amounts an event doesn't label itself. */
  currency: string;
  /** The Group's members, to name people in edits; anyone else is a former member. */
  members?: Member[];
  /** The app can't reach Splitbook: this device's saved copy shows its badge. */
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
  /** Opens a link: a payment's second source's attribution (#728). */
  onOpenLink?: (url: string) => void;
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

function Details({
  line,
  time,
  whole = false,
}: {
  line: ActivityLine;
  time: string;
  /** All the lines it needs, as in an event's detail, where it is read in full (#783). */
  whole?: boolean;
}) {
  const parts = [...line.details, { text: time }];
  return (
    <CompactText variant="caption" tone="secondary" numberOfLines={whole ? 0 : 2}>
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
  // An assistant's credit has a line of its own, cut in the middle so the start and the domain
  // at the end both show, and whole at the largest text (#751).
  const whole = useLargestText();
  return (
    <>
      <CompactAvatar name={name} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Headline line={line} numberOfLines={2} />
        {line.credit ? (
          <CompactText
            variant="caption"
            tone="secondary"
            numberOfLines={whole ? 0 : 1}
            ellipsizeMode="middle"
          >
            {line.credit}
          </CompactText>
        ) : null}
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
    batch,
    currentUserId,
    currency,
    members,
    disabled,
    onSelect,
  }: {
    event: ActivityEvent;
    /** A settle-up's Settlements, of which `event` is the newest in the feed: one row (#734). */
    batch?: Batch;
    currentUserId: string;
    currency: string;
    members?: Member[];
    disabled: boolean;
    onSelect: (id: string) => void;
  }) {
    const theme = useTheme();
    const named = members?.map(({ id, name }) => `${id}:${name}`).join('|');
    const line = useMemo(
      () =>
        batch
          ? describeSettlementBatch(batch.events, batch.batchSize, { currentUserId, currency })
          : describeActivity(event, { currentUserId, currency, members }),
      // The members by what they say, not by the list that holds them.
      [event, batch, currentUserId, currency, named],
    );
    const time = clockTime(event.createdAt);
    // A drag that starts on the row never opens it (#665).
    const tap = useTap();
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spokenActivity(line, time)}
        accessibilityHint={
          activityExpenseId(event) ? 'Opens this Expense' : 'Opens what was recorded'
        }
        accessibilityState={{ disabled }}
        disabled={disabled}
        {...tap.on(() => onSelect(event._id))}
        style={({ pressed }) => ({
          minHeight: 60,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 8,
          paddingHorizontal: 14,
          backgroundColor: pressed && !tap.dragged ? theme.surfaceMuted : undefined,
        })}
      >
        <EventContent line={line} name={event.actor?.name || 'Former member'} time={time} />
      </Pressable>
    );
  },
  (a, b) =>
    a.event === b.event &&
    a.batch === b.batch &&
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
  // A settle-up's Settlements are one row, where its newest event is in the feed, so the row
  // stays put as a batch a page boundary split joins once the older page loads; its words read
  // in the order they were recorded (#734).
  const { rows, batches } = useMemo(() => {
    const placed = groupSettlementBatches(state.events).map((item) =>
      item.kind === 'event'
        ? { row: item.event }
        : { row: state.events.find((event) => item.events.includes(event))!, batch: item },
    );
    return {
      rows: placed.map(({ row }) => row),
      batches: new Map(placed.flatMap(({ row, batch }) => (batch ? [[row._id, batch]] : []))),
    };
  }, [state.events]);
  // When the window moves, events above the one on screen go or come: Load older past 5 pages
  // drops the newest page, and Load newer brings it back above. The view moves by as much as an
  // event shown on both sides of the move moved, so the event on screen keeps its place (#215).
  // Where the list, each day and each event lie, as their layouts last said.
  const places = useRef({
    origin: 0,
    list: 0,
    body: null as number | null,
    days: new Map<string, number>(),
    rows: new Map<string, { day: string; y: number; height: number }>(),
  });
  const anchor = useRef<{
    id: string;
    at: number;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const firstPage = state.firstPage ?? 1;
  const shownFirst = useRef(firstPage);
  /** The events as last shown: the window's move keeps the first of them still listed. */
  const shownEvents = useRef(state.events);
  const top = (id: string) => {
    const row = places.current.rows.get(id),
      day = row && places.current.days.get(row.day);
    return row && day !== undefined && places.current.body !== null
      ? places.current.list + places.current.body + day + row.y
      : null;
  };
  useLayoutEffect(() => {
    const moved = firstPage !== shownFirst.current;
    shownFirst.current = firstPage;
    if (anchor.current?.timer) clearTimeout(anchor.current.timer);
    if (!moved) return;
    // The first event shown before the move that is still listed: the newest one left after a
    // slide, or the one that was first before Load newer.
    const listedNow = new Set(state.events.map(({ _id }) => _id));
    const id = shownEvents.current.find((event) => listedNow.has(event._id))?._id;
    // Laid out before the move: where it was.
    const at = id ? top(id) : null;
    anchor.current = id && at !== null ? { id, at } : null;
    // Only this commit's move: the layout it leads to moves the view, once.
  }, [firstPage]);
  useLayoutEffect(() => {
    shownEvents.current = state.events;
  });
  /** A layout changed: once the move's layouts have all arrived, the view follows its event. */
  const place = (
    change:
      | { origin: number }
      | { list: number }
      | { body: number }
      | { day: string; y: number }
      | { row: string; day: string; y: number; height: number },
  ) => {
    if ('origin' in change) places.current.origin = change.origin;
    else if ('list' in change) places.current.list = change.list;
    else if ('body' in change) places.current.body = change.body;
    else if ('row' in change) places.current.rows.set(change.row, change);
    else places.current.days.set(change.day, change.y);
    const rows = new Map<string, { top: number; height: number }>();
    for (const { _id: key } of state.events) {
      const at = top(key),
        row = places.current.rows.get(key);
      if (at !== null && row)
        rows.set(key, { top: places.current.origin + at, height: row.height });
    }
    onRowsLayout?.(rows);
    const held = anchor.current;
    if (!held || held.timer) return;
    // A layout's events arrive together: the shift waits for all of them.
    held.timer = setTimeout(() => {
      if (anchor.current === held) anchor.current = null;
      const at = top(held.id);
      if (at !== null && at !== held.at) onShift?.(at - held.at);
    }, 0);
  };
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
  return (
    // A first load's progress bar is the screen's, under the top bar.
    <View
      style={{ gap: 12 }}
      onLayout={({ nativeEvent }) => place({ origin: nativeEvent.layout.y })}
    >
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
            readTime({ refreshedAt: state.refreshedAt, restored: state.restored === true, offline })
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
      {newer && onLoadNewer ? pageControl('newer', state.newerStatus ?? 'idle', onLoadNewer) : null}
      {/* Where the list lies, for the event kept on screen when the window moves (#222). */}
      <View onLayout={({ nativeEvent }) => place({ list: nativeEvent.layout.y })}>
        {/* Activity read empty stays empty while it's read again. */}
        {loading && state.pagination === null ? (
          <Card
            loading="Loading Activity"
            skeleton={{ avatar: true, heading: true }}
            onBodyOffset={(body) => place({ body })}
          />
        ) : (state.status === 'ready' || loading) && !state.events.length ? (
          <Card padded>
            <CompactText weight="semibold">No changes yet</CompactText>
            <CompactText variant="small" tone="secondary">
              Expenses, payments and member changes in this Group will appear here.
            </CompactText>
          </Card>
        ) : state.events.length ? (
          <Card onBodyOffset={(body) => place({ body })}>
            {activityDays(rows, now).map((day, index) => (
              <View
                key={day.key}
                onLayout={({ nativeEvent }) => place({ day: day.key, y: nativeEvent.layout.y })}
              >
                {index > 0 ? <Divider /> : null}
                <ListDayHeader label={day.label} />
                {day.events.map((event) => (
                  <View
                    key={event._id}
                    onLayout={({ nativeEvent }) =>
                      place({
                        row: event._id,
                        day: day.key,
                        y: nativeEvent.layout.y,
                        height: nativeEvent.layout.height,
                      })
                    }
                  >
                    <ActivityRow
                      event={event}
                      batch={batches.get(event._id)}
                      currentUserId={currentUserId}
                      currency={currency}
                      members={members}
                      // Opened once read: not while they're read again, or after that failed.
                      disabled={state.status !== 'ready'}
                      onSelect={select}
                    />
                  </View>
                ))}
              </View>
            ))}
          </Card>
        ) : null}
      </View>
      {more ? pageControl('older', state.moreStatus, onMore) : null}
    </View>
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

/** One line of a payment's record: what it is, and its value at the end of the line. */
function RecordRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 12,
        rowGap: 2,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <CompactText tone="secondary">{label}</CompactText>
      <View
        style={{
          marginLeft: 'auto',
          flexShrink: 1,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * A Debt paid in another currency, as recorded (#728, the board "The Settlement's record", the
 * web's `PaymentRecordCard`): who paid whom, both amounts, the rate used beside the suggestion
 * with its source, when and by whom, and what it changed. Every figure is the shared
 * `paymentRecord`'s, from what was stored; nothing is looked up again.
 */
function PaymentRecord({
  event,
  record,
  line,
  currentUserId,
  when,
  onOpenLink,
  titled = true,
}: {
  event: ActivityEvent;
  record: CrossCurrencyRecord;
  line: ActivityLine;
  currentUserId: string;
  when: string;
  onOpenLink: (url: string) => void;
  /** Under a settle-up's own "Payment", each record goes without one (#734). */
  titled?: boolean;
}) {
  const card = paymentRecord(record, currentUserId);
  const mono = { fontFamily: fonts.mono, fontVariant: ['tabular-nums' as const] };
  const recorder =
    event.actor?._id === currentUserId ? 'you' : event.actor?.name || 'a former member';
  return (
    <>
      {titled ? (
        <CompactText variant="title" accessibilityRole="header">
          Payment
        </CompactText>
      ) : null}
      <Card padded>
        <View
          accessible
          accessibilityLabel={[line.actor, line.verb, line.subject, line.complement]
            .filter(Boolean)
            .join(' ')}
          style={{ gap: 8 }}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <CompactAvatar name={record.paidByName || card.payer} />
            <CompactText weight="semibold">{card.payer}</CompactText>
            <CompactText tone="secondary">→</CompactText>
            <CompactAvatar name={record.paidToName || card.payee} />
            <CompactText weight="semibold" style={{ flexShrink: 1 }}>
              {card.payee}
            </CompactText>
          </View>
          <View>
            <CompactText variant="caption" tone="secondary">
              Paid
            </CompactText>
            <CompactText style={{ ...mono, fontSize: 28, lineHeight: 34 }}>{card.paid}</CompactText>
            <CompactText tone="secondary">{card.clears}</CompactText>
          </View>
        </View>
      </Card>
      <Card>
        <RecordRow label="Rate used">
          <CompactText style={mono}>{card.rateUsed}</CompactText>
          <Badge label={card.badge} tone={card.badge === 'Suggested' ? 'positive' : 'warning'} />
        </RecordRow>
        {card.suggested ? (
          <>
            <Divider />
            <RecordRow label="Suggested">
              <CompactText style={mono}>{card.suggested.rate}</CompactText>
            </RecordRow>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 14,
                paddingBottom: 12,
                marginTop: -6,
              }}
            >
              <CompactText variant="caption" tone="secondary">
                {card.suggested.source}
              </CompactText>
              {card.suggested.attribution ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={card.suggested.attribution.text}
                  onPress={() => onOpenLink(card.suggested!.attribution!.url)}
                  hitSlop={8}
                >
                  <CompactText
                    variant="caption"
                    tone="brand"
                    weight="semibold"
                    style={{ textDecorationLine: 'underline' }}
                  >
                    {card.suggested.attribution.text}
                  </CompactText>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
        <Divider />
        <RecordRow label="Amount cleared">
          <CompactText style={mono}>{card.cleared}</CompactText>
          <CompactText variant="caption" tone="secondary">
            {record.currency}
          </CompactText>
        </RecordRow>
        <Divider />
        <RecordRow label="Amount paid">
          <CompactText style={mono}>{card.paidAmount}</CompactText>
          <CompactText variant="caption" tone="secondary">
            {record.paidCurrency}
          </CompactText>
        </RecordRow>
        <Divider />
        <RecordRow label="Recorded">
          <CompactText>{`${when} by ${recorder}`}</CompactText>
        </RecordRow>
      </Card>
      <SectionHeader title="What it changed" />
      <Card padded>
        <View style={{ gap: 6 }}>
          {card.pair ? (
            <CompactText>
              {card.pair.label}{' '}
              <Text style={mono}>{`${card.pair.before} → ${card.pair.after}`}</Text>
            </CompactText>
          ) : null}
          <CompactText variant="small" tone="secondary">
            {card.unchanged}
          </CompactText>
        </View>
      </Card>
      <CompactText variant="small" tone="secondary">
        {card.kept}
      </CompactText>
    </>
  );
}

/**
 * A payment that settled several Debts at once (#734): what it paid in all and each Debt it
 * cleared, in the shared words its row says, then each Settlement's own record, as a single
 * payment in another currency opens it (#728).
 */
function BatchRecord({
  events,
  batchSize,
  currentUserId,
  currency,
  members,
  when,
  onOpenLink,
}: {
  events: ActivityEvent[];
  batchSize: number;
  currentUserId: string;
  currency: string;
  members?: Member[];
  when: string;
  onOpenLink: (url: string) => void;
}) {
  const line = describeSettlementBatch(events, batchSize, { currentUserId, currency });
  return (
    <>
      <CompactText variant="title" accessibilityRole="header">
        Payment
      </CompactText>
      <Card padded>
        <View
          accessible
          accessibilityLabel={[line.actor, line.verb, line.subject, line.complement]
            .filter(Boolean)
            .join(' ')}
          style={{ gap: 6 }}
        >
          <Headline line={line} />
          {line.details.map((detail, index) => (
            <CompactText key={index} variant="small" tone="secondary">
              {detail.text}
            </CompactText>
          ))}
          <CompactText variant="caption" tone="secondary">
            {when}
          </CompactText>
        </View>
      </Card>
      {events.map((event) => {
        const record = readCrossCurrencyRecord(event.metadata);
        return record ? (
          <PaymentRecord
            key={event._id}
            titled={false}
            event={event}
            record={record}
            line={describeActivity(event, { currentUserId, currency, members })}
            currentUserId={currentUserId}
            when={when}
            onOpenLink={onOpenLink}
          />
        ) : null;
      })}
    </>
  );
}

function ActivityDetail({
  state,
  event,
  currentUserId,
  currency,
  members,
  offline,
  onSelect,
  onClose,
  onOpenLink = () => undefined,
}: GroupActivityProps & { event: ActivityEvent }) {
  const line = describeActivity(event, { currentUserId, currency, members });
  // "Mon 19 Oct 2026, 1:44 PM", day first on every phone (#640).
  const when = spellMoment(new Date(event.createdAt), { weekday: 'short', year: true });
  const check = recordCheck[state.target.status];
  // A Debt paid in another currency opens its record (#728); a settle-up, all of its own (#734).
  const payment =
    event.type === 'settlement_recorded' ? readCrossCurrencyRecord(event.metadata) : null;
  const { batchId, batchSize = 1 } = event.type === 'settlement_recorded' ? event.metadata : {};
  const batch =
    batchId && batchSize > 1
      ? groupSettlementBatches(state.events).find(
          (item): item is Batch => item.kind === 'batch' && item.batchId === batchId,
        )?.events
      : null;
  return (
    <View style={{ gap: 12 }}>
      {batch?.length ? (
        <BatchRecord
          events={batch}
          batchSize={batchSize}
          currentUserId={currentUserId}
          currency={currency}
          members={members}
          when={when}
          onOpenLink={onOpenLink}
        />
      ) : payment ? (
        <PaymentRecord
          event={event}
          record={payment}
          line={line}
          currentUserId={currentUserId}
          when={when}
          onOpenLink={onOpenLink}
        />
      ) : (
        <Card padded>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <CompactAvatar name={event.actor?.name || 'Former member'} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Headline line={line} />
              {/* Whole here, where the event is read in full (#751). */}
              {line.credit ? (
                <CompactText variant="caption" tone="secondary">
                  {line.credit}
                </CompactText>
              ) : null}
              <Details
                line={{ ...line, details: line.changes.length ? [] : line.details }}
                time={when}
                whole
              />
            </View>
          </View>
        </Card>
      )}
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
          This records a payment made outside {PRODUCT_NAME}. No money moved in the app.
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
