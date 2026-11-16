import { memo, useMemo } from 'react';
import { Pressable, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { amountToFit, fullAmount } from '@splitbook/shared/compact-amount';
import { localeFirstWeekday, monthGrid } from '@splitbook/shared/date';
import { SEPARATOR, counted } from '@splitbook/shared/separator';
import { dayTint } from '@splitbook/shared/spending-by-day';
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
  moneyCharacters,
  useLargeText,
  useLineBox,
  type MoneySize,
} from './compact';
import { readPhoneCalendar } from './day-format';
import { readTime, RetainedNotice } from './financial-views';
import { Icon } from './primitives';
import { refreshedLabel } from './refresh-feedback';
import { fonts, useTheme } from './theme';

type Currency = SpendingByDayRead['currencies'][number];

/** The page's side padding, the card's border and its side padding: what its content fits in. */
const pagePadding = 16,
  cardBorder = 1,
  cardPadding = 14;
const cardInset = 2 * (pagePadding + cardBorder + cardPadding);
/** The currency's badge, as Your balances draws it, and the gap after each part of a line. */
const badgeWidth = 52,
  gap = 12;
const grids = {
  regular: { cell: 13, gap: 3, round: 3.5 },
  small: { cell: 9, gap: 2, round: 2.5 },
} as const;
const gridWidth = (size: keyof typeof grids) => 7 * grids[size].cell + 6 * grids[size].gap;

/** A Month key's name in English, as a Group's Expenses spell their Month. */
const monthName = (month: string) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString('en', { month: 'long' });
const spendingDays = (count: number) => `${counted(count, 'day')} with spending`;
/** The figure and the Month's grid: side by side, or the grid under the figure at large text. */
const figuresRow = (large: boolean): ViewStyle => ({
  flexDirection: large ? 'column' : 'row',
  alignItems: large ? 'flex-start' : 'center',
  justifyContent: 'space-between',
  gap,
  paddingTop: 10,
  paddingBottom: 6,
});

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
  const { cell, gap: between, round } = grids[size];
  const firstWeekday = useMemo(() => localeFirstWeekday(readPhoneCalendar().locale), []);
  const grid = useMemo(
    () => monthGrid(month, { firstWeekday, today }),
    [month, today, firstWeekday],
  );
  const tintOf = new Map(
    currency?.days.map(({ day, shareMinor }) => [day, dayTint(shareMinor, currency.currency)]),
  );
  return (
    <View
      testID="spending-month"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ gap: between, flexShrink: 0 }}
    >
      {grid.weeks.map((week, row) => (
        <View key={row} style={{ flexDirection: 'row', gap: between }}>
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
                    : theme.dayTint.fill[placeholder ? 0 : (tintOf.get(day.date) ?? 0)],
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
function Heading({ state, offline }: { state: SpendingMonthState; offline: boolean }) {
  const height = useLineBox('caption').height;
  return (
    <View style={{ ...headingLine, minHeight: height, gap: 8 }}>
      <CompactText variant="overline" accessibilityRole="header" spare style={headingBeside}>
        {`Spending${SEPARATOR}${monthName(state.month)}`}
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
  zeroCurrency,
  offline = false,
  onOpen,
  onRetry,
}: {
  state: SpendingMonthState;
  /** The phone's date, `YYYY-MM-DD`. */
  today: string;
  /** The currency a Month with nothing says its zero in. */
  zeroCurrency: string;
  offline?: boolean;
  /** Opens Spending; without it the card is one block to read, with no button. */
  onOpen?: () => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const large = useLargeText();
  const { width, fontScale } = useWindowDimensions();
  const name = monthName(state.month),
    data = state.data;
  // With nothing to open, the card has no last line: it is as tall while it loads.
  const frame = { paddingTop: 12, paddingHorizontal: cardPadding, paddingBottom: onOpen ? 4 : 8 };
  const heading = <Heading state={state} offline={offline} />;

  if (data === null) {
    if (state.status === 'loading' || !state.message)
      // The card's whole height while it loads: Groups under it never jump.
      return (
        <Card loading="Loading your spending">
          <View style={frame}>
            {heading}
            <View testID="spending-figures" style={figuresRow(large)}>
              <View style={{ gap: 2 }}>
                <Skeleton width={150} line="total" />
                <Skeleton width={120} line="caption" />
              </View>
              <MonthTint month={state.month} today={today} size="regular" placeholder />
            </View>
            {onOpen ? (
              <View style={{ minHeight: 36, justifyContent: 'center' }}>
                <Skeleton width={96} line="small" />
              </View>
            ) : null}
          </View>
        </Card>
      );
    // Never a zero for a Month that simply wasn't read.
    return (
      <Card>
        <View style={{ ...frame, paddingBottom: 14, gap: 10 }}>
          {heading}
          <CompactText
            variant="small"
            tone="secondary"
            accessibilityLiveRegion="polite"
            style={{ fontSize: 14, lineHeight: 20 }}
          >
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
      : { currency: zeroCurrency, totalMinor: 0, dayCount: 0, days: [], expenses: [] };
  /** The figure in full where its column holds it, else its short form. */
  const fit = (minor: number, code: string, column: number, size: MoneySize) =>
    amountToFit(minor, code, moneyCharacters(column, size, fontScale));

  const figures =
    currencies.length > 1
      ? `Your share ${currencies
          .map(
            ({ totalMinor, currency, dayCount }) =>
              `${fullAmount(totalMinor, currency)} over ${counted(dayCount, 'day')}`,
          )
          .join(' and ')}`
      : `Your share ${fullAmount(single.totalMinor, single.currency)}. ${
          single.dayCount ? spendingDays(single.dayCount) : `Nothing yet in ${name}`
        }`;
  // A saved copy is never read out as current (ADR 0006).
  const saved = state.restored ? `. Saved ${refreshedLabel(state.refreshedAt)}` : '';
  const label = `Spending, ${name}. ${figures}${saved}`;

  const body =
    currencies.length > 1 ? (
      currencies.map((line, index) => {
        const column = large ? inner : inner - badgeWidth - gap - gap - gridWidth('small');
        return (
          <View key={line.currency}>
            {index > 0 ? <View style={{ height: 1, backgroundColor: theme.border }} /> : null}
            <View
              style={{
                flexDirection: large ? 'column' : 'row',
                alignItems: large ? 'flex-start' : 'center',
                gap: large ? 6 : gap,
                paddingVertical: 10,
              }}
            >
              <View
                style={{
                  minWidth: badgeWidth,
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
                <Money size="balance">
                  {fit(line.totalMinor, line.currency, column, 'balance')}
                </Money>
                <CompactText variant="caption" tone="secondary">
                  {spendingDays(line.dayCount)}
                </CompactText>
              </View>
              <MonthTint month={state.month} today={today} currency={line} size="small" />
            </View>
          </View>
        );
      })
    ) : (
      <View testID="spending-figures" style={figuresRow(large)}>
        <View style={{ flex: large ? undefined : 1, minWidth: 0, gap: 2 }}>
          <Money size="total">
            {fit(
              single.totalMinor,
              single.currency,
              large ? inner : inner - gridWidth('regular') - gap,
              'total',
            )}
          </Money>
          <CompactText variant="caption" tone="secondary">
            {`Your share${SEPARATOR}${
              single.dayCount ? spendingDays(single.dayCount) : `nothing yet in ${name}`
            }`}
          </CompactText>
        </View>
        <MonthTint month={state.month} today={today} currency={single} size="regular" />
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
          <View accessible accessibilityLabel={label} style={frame}>
            {heading}
            {body}
          </View>
        </Card>
      )}
    </View>
  );
});
