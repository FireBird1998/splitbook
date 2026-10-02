import { Fragment } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { ActivityEvent, ActivityState } from '../data/activity';
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
  Skeleton,
} from './compact';
import { fonts, useTheme } from './theme';

interface GroupActivityProps {
  state: ActivityState;
  currentUserId: string;
  /** The Group's currency, for amounts an event doesn't label itself. */
  currency: string;
  /** The Group's members, to name people in edits; anyone else is a former member. */
  members?: { id: string; name: string }[];
  /** Figures come from this device's saved copy. */
  offline: boolean;
  /** A pull-to-refresh is running; its native indicator is the only cue. */
  pulling: boolean;
  now: number;
  onRetry: () => void;
  onMore: () => void;
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

function ActivityRow({
  event,
  line,
  disabled,
  onSelect,
}: {
  event: ActivityEvent;
  line: ActivityLine;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const theme = useTheme();
  const time = clockTime(event.createdAt);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenActivity(line, time)}
      accessibilityHint="Opens what was recorded"
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
      <CompactAvatar name={event.actor?.name || 'Former member'} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Headline line={line} numberOfLines={2} />
        <Details line={line} time={time} />
      </View>
    </Pressable>
  );
}

function ActivityList({
  state,
  currentUserId,
  currency,
  members,
  offline,
  pulling,
  now,
  onRetry,
  onMore,
  onSelect,
}: GroupActivityProps) {
  const theme = useTheme();
  const loading = state.status === 'loading';
  const more =
    state.status === 'ready' &&
    state.pagination !== null &&
    state.pagination.page < state.pagination.totalPages;
  return (
    <View style={{ gap: 12 }}>
      {/* One cue per operation: a pull has its native indicator and a refresh of shown events
          the header's quiet status, so only a first load draws a bar. */}
      {loading && !state.events.length && !pulling ? (
        <LinearProgress label="Loading Activity" />
      ) : null}
      <SectionHeader
        title="Changes in this Group"
        trailing={
          <CompactText variant="caption" tone="secondary">
            Newest first
          </CompactText>
        }
      />
      {state.status === 'denied' ? (
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
      {loading && !state.events.length ? (
        <Card>
          {[0, 1, 2].map((row) => (
            <View
              key={row}
              style={{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'center' }}
            >
              <Skeleton width={32} height={32} rounded={11} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width="70%" />
                <Skeleton width="40%" height={12} />
              </View>
            </View>
          ))}
        </Card>
      ) : state.status === 'ready' && !state.events.length ? (
        <Card padded>
          <CompactText weight="semibold">No changes yet</CompactText>
          <CompactText variant="small" tone="secondary">
            Expenses, payments and member changes in this Group will appear here.
          </CompactText>
        </Card>
      ) : state.events.length ? (
        <Card>
          {activityDays(state.events, now).map((day, index) => (
            <View key={day.key}>
              {index > 0 ? <Divider /> : null}
              <CompactText
                variant="small"
                tone="secondary"
                accessibilityRole="header"
                style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 }}
              >
                {day.label}
              </CompactText>
              {day.events.map((event) => (
                <ActivityRow
                  key={event._id}
                  event={event}
                  line={describeActivity(event, { currentUserId, currency, members })}
                  disabled={state.status !== 'ready'}
                  onSelect={onSelect}
                />
              ))}
            </View>
          ))}
        </Card>
      ) : null}
      {more && state.moreStatus === 'loading' ? (
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
          <CompactText tone="secondary">Loading older activity…</CompactText>
        </View>
      ) : more ? (
        <>
          {state.moreStatus === 'error' ? (
            <CompactText variant="small" tone="negative" accessibilityRole="alert">
              Couldn’t load older activity. The events shown are still here.
            </CompactText>
          ) : null}
          <CompactButton
            label={
              state.moreStatus === 'error' ? 'Try loading older activity' : 'Load older activity'
            }
            variant="tonal"
            block
            onPress={onMore}
          />
        </>
      ) : null}
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
