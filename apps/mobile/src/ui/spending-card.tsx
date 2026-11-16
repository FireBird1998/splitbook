import { memo, useMemo } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { amountToFit, fullAmount } from '@splitbook/shared/compact-amount';
import { localeFirstWeekday, monthGrid } from '@splitbook/shared/date';
import { SEPARATOR } from '@splitbook/shared/separator';
import { dayTint, type DayTint } from '@splitbook/shared/spending-by-day';
import type { SpendingByDayRead } from '@splitbook/shared/spending-by-day-read';
import type { SpendingMonthState } from '../data/types';
import {
  Card,
  CompactButton,
  CompactText,
  Money,
  Skeleton,
  headingBeside,
  headingLine,
  scaledSp,
  useLargeText,
  useLineBox,
} from './compact';
import { readPhoneCalendar } from './day-format';
import { readTime, RetainedNotice } from './financial-views';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';

type Theme = ReturnType<typeof useTheme>;
type Currency = SpendingByDayRead['currencies'][number];

/** Board SpendAndHome's tint steps between the surface and the brand blue, in each mode. */
const steps = {
  light: ['#dfe3ff', '#b9c1f6', '#7f8ce6'],
  dark: ['#262c55', '#353f86', '#5462c8'],
} as const;
/** A day's colour for each tint step: nothing, then four steps up to the bright brand blue. */
export function tintColours(theme: Theme): Readonly<Record<DayTint, string>> {
  const [one, two, three] = steps[theme.mode];
  return [
    theme.surfaceMuted,
    one,
    two,
    three,
    theme.mode === 'light' ? theme.brand.main : theme.focus,
  ];
}

/** The page's and the card's side padding and border: what the card's content has to fit in. */
const cardInset = 16 * 2 + 1 * 2 + 14 * 2;
const grids = {
  regular: { cell: 13, gap: 3, round: 3.5 },
  small: { cell: 9, gap: 2, round: 2.5 },
} as const;
const gridWidth = (size: keyof typeof grids) => 7 * grids[size].cell + 6 * grids[size].gap;

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** A Month key's name, as the day's read-aloud spells it: English, whatever the locale. */
const monthName = (month: string) => months[Number(month.slice(5, 7)) - 1]!;
const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'} with spending`;

/**
 * A Month as a small grid, a week a row, starting on the phone's first weekday: each day so far
 * tinted by the member's share of it, today ringed, the days to come outlined. Hidden from screen
 * readers: the card's label says the figures. `placeholder` draws its frame while it loads.
 */
function MonthTint({
  month,
  today,
  currency,
  size,
  placeholder = false,
}: {
  month: string;
  today: string;
  currency?: Currency;
  size: keyof typeof grids;
  placeholder?: boolean;
}) {
  const theme = useTheme();
  const tints = tintColours(theme);
  const { cell, gap, round } = grids[size];
  const firstWeekday = useMemo(() => localeFirstWeekday(readPhoneCalendar().locale), []);
  const grid = useMemo(
    () => monthGrid(month, { firstWeekday, today }),
    [month, today, firstWeekday],
  );
  const steps = new Map(
    currency?.days.map(({ day, shareMinor }) => [day, dayTint(shareMinor, currency.currency)]),
  );
  return (
    <View
      testID="spending-month"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ gap, flexShrink: 0 }}
    >
      {grid.weeks.map((week, row) => (
        <View key={row} style={{ flexDirection: 'row', gap }}>
          {week.map((day, column) => {
            if (!day) return <View key={column} style={{ width: cell, height: cell }} />;
            const future = !placeholder && day.date > today;
            return (
              <View
                key={column}
                testID={`spending-day-${day.date}`}
                style={{
                  width: cell,
                  height: cell,
                  borderRadius: round,
                  backgroundColor: future
                    ? 'transparent'
                    : placeholder
                      ? theme.surfaceMuted
                      : tints[steps.get(day.date) ?? 0],
                  ...(future ? { borderWidth: 1, borderColor: theme.border } : {}),
                }}
              >
                {day.today && !placeholder ? (
                  <View
                    testID="spending-today"
                    style={{
                      position: 'absolute',
                      top: -2.5,
                      left: -2.5,
                      right: -2.5,
                      bottom: -2.5,
                      borderRadius: round + 2.5,
                      borderWidth: 1.5,
                      borderColor: theme.text,
                    }}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** "Spending · November", and when its figures were read, as Your balances says it. */
function Heading({
  month,
  state,
  offline,
}: {
  month: string;
  state: SpendingMonthState;
  offline: boolean;
}) {
  const height = useLineBox('caption').height;
  return (
    <View style={{ ...headingLine, minHeight: height, gap: 8 }}>
      <CompactText variant="overline" accessibilityRole="header" spare style={headingBeside}>
        {`Spending${SEPARATOR}${monthName(month)}`}
      </CompactText>
      {state.data !== null
        ? readTime({
            refreshedAt: state.refreshedAt,
            restored: state.restored,
            updating: state.status === 'loading',
            offline,
            tone: 'muted',
          })
        : null}
    </View>
  );
}

/** "See each day", the card's last line: the whole card opens Spending. */
function SeeEachDay() {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        borderTopWidth: 1,
        borderTopColor: theme.border,
      }}
    >
      <CompactText weight="semibold" tone="brand" style={{ fontSize: 14 }}>
        See each day
      </CompactText>
      <Icon name="chevron-forward" size={16} color={theme.brand.main} />
    </View>
  );
}

/**
 * Board SpendAndHome: this Month's share of spending across the member's Groups, directly under
 * Your balances while Spending by day is on. One currency shows its figure beside the Month's grid;
 * each of several has its own line and grid, never added together. A figure is written in full
 * where it fits and shortened where it doesn't; TalkBack always hears it in full. The whole card is
 * one button that opens Spending. Offline it shows this phone's copy with "Saved" and its time,
 * or says the Month isn't on this phone yet.
 */
export const SpendingCard = memo(function SpendingCard({
  state,
  today,
  currency: fallback,
  offline = false,
  onOpen,
  onRetry,
}: {
  state: SpendingMonthState;
  /** The phone's date, `YYYY-MM-DD`. */
  today: string;
  /** The currency a Month with nothing says its zero in. */
  currency: string;
  offline?: boolean;
  /** Opens Spending; without it the card is one block to read, with no button. */
  onOpen?: () => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const large = useLargeText();
  const { width, fontScale } = useWindowDimensions();
  const month = state.month,
    name = monthName(month),
    data = state.data;
  const frame = { paddingTop: 12, paddingHorizontal: 14, paddingBottom: 4 };
  const heading = <Heading month={month} state={state} offline={offline} />;

  if (data === null) {
    if (state.status === 'loading' || !state.message)
      // The card's whole height while it loads: Groups under it never jump.
      return (
        <Card loading="Loading your spending">
          <View style={frame}>
            {heading}
            <View
              testID="spending-figures"
              style={{
                flexDirection: large ? 'column' : 'row',
                alignItems: large ? 'flex-start' : 'center',
                justifyContent: 'space-between',
                gap: 12,
                paddingTop: 10,
                paddingBottom: 6,
              }}
            >
              <View style={{ gap: 4 }}>
                <Skeleton width={150} line="total" />
                <Skeleton width={120} line="small" />
              </View>
              <MonthTint month={month} today={today} size="regular" placeholder />
            </View>
            <View style={{ minHeight: 36, justifyContent: 'center' }}>
              <Skeleton width={96} line="small" />
            </View>
          </View>
        </Card>
      );
    // Never a zero for a Month that simply wasn't read.
    return (
      <Card>
        <View style={{ ...frame, paddingBottom: 14, gap: 10 }}>
          {heading}
          <CompactText variant="small" tone="secondary" accessibilityLiveRegion="polite">
            {state.message}
          </CompactText>
          <View style={{ alignItems: 'flex-start' }}>
            <CompactButton label="Try again" variant="tonal" dense onPress={onRetry} />
          </View>
        </View>
      </Card>
    );
  }

  const inner = width - cardInset;
  const currencies = data.currencies;
  const single: Currency =
    currencies.length === 1
      ? currencies[0]!
      : { currency: fallback, totalMinor: 0, dayCount: 0, days: [], expenses: [] };
  /** The figure in full where its column holds it, else its short form. */
  const fit = (minor: number, code: string, column: number, size: number) =>
    amountToFit(minor, code, Math.floor(column / (0.6 * scaledSp(size, fontScale))));

  const label =
    currencies.length > 1
      ? `Spending, ${name}. Your share ${currencies
          .map(
            ({ totalMinor, currency, dayCount }) =>
              `${fullAmount(totalMinor, currency)} over ${dayCount} ${dayCount === 1 ? 'day' : 'days'}`,
          )
          .join(' and ')}`
      : `Spending, ${name}. Your share ${fullAmount(single.totalMinor, single.currency)}. ${
          single.dayCount ? days(single.dayCount) : `Nothing yet in ${name}`
        }`;

  const body =
    currencies.length > 1 ? (
      currencies.map((line, index) => {
        // The code's badge, the figure's column and the small grid, each 12 apart.
        const column = large ? inner : inner - 52 - 12 - 12 - gridWidth('small');
        return (
          <View key={line.currency}>
            {index > 0 ? <View style={{ height: 1, backgroundColor: theme.border }} /> : null}
            <View
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
                  {line.currency}
                </CompactText>
              </View>
              <View style={{ flex: large ? undefined : 1, minWidth: 0, gap: 2 }}>
                <Money size="balance">{fit(line.totalMinor, line.currency, column, 19)}</Money>
                <CompactText variant="small" tone="secondary">
                  {days(line.dayCount)}
                </CompactText>
              </View>
              <MonthTint month={month} today={today} currency={line} size="small" />
            </View>
          </View>
        );
      })
    ) : (
      <View
        testID="spending-figures"
        style={{
          flexDirection: large ? 'column' : 'row',
          alignItems: large ? 'flex-start' : 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingTop: 10,
          paddingBottom: 6,
        }}
      >
        <View style={{ flex: large ? undefined : 1, minWidth: 0, gap: 2 }}>
          <Money size="total">
            {fit(
              single.totalMinor,
              single.currency,
              large ? inner : inner - gridWidth('regular') - 12,
              24,
            )}
          </Money>
          <CompactText variant="small" tone="secondary">
            {`Your share${SEPARATOR}${single.dayCount ? days(single.dayCount) : `nothing yet in ${name}`}`}
          </CompactText>
        </View>
        <MonthTint month={month} today={today} currency={single} size="regular" />
      </View>
    );

  return (
    <View style={{ gap: 8 }}>
      <RetainedNotice
        status={state.status}
        refreshedAt={state.refreshedAt}
        message={state.message}
        subject="your spending"
        retryLabel="Retry spending"
        offline={offline}
        onRetry={onRetry}
      />
      {onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}. See each day`}
          onPress={onOpen}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Card>
            <View style={frame}>
              {heading}
              {body}
              <SeeEachDay />
            </View>
          </Card>
        </Pressable>
      ) : (
        <Card>
          <View accessible accessibilityLabel={label} style={{ ...frame, paddingBottom: 8 }}>
            {heading}
            {body}
          </View>
        </Card>
      )}
    </View>
  );
});
