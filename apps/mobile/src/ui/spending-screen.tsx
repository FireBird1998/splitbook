import { memo, useMemo } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { amountToFit, dayCellAmount, fullAmount } from '@splitbook/shared/compact-amount';
import { localeFirstWeekday, monthGrid } from '@splitbook/shared/date';
import { SEPARATOR, counted } from '@splitbook/shared/separator';
import { dayShareReadAloud, dayTint, type DayTint } from '@splitbook/shared/spending-by-day';
import type {
  SpendingByDayExpenseRead,
  SpendingByDayRead,
} from '@splitbook/shared/spending-by-day-read';
import type { GroupCategory } from '@splitbook/shared/types';
import type { SpendingScreenState } from '../data/types';
import { groupIcon } from './group-icon';
import {
  Card,
  CompactButton,
  CompactText,
  Divider,
  IconButton,
  IconTile,
  ListRow,
  Money,
  RowAmount,
  Skeleton,
  moneyCharacters,
  useLargeText,
} from './compact';
import { readPhoneCalendar } from './day-format';
import { monthName, spendingDays } from './spending-words';
import { readTime, RetainedNotice } from './financial-views';
import { fonts, useTheme } from './theme';

type Currency = SpendingByDayRead['currencies'][number];
/** A Group as its rows need it: its Theme gives its icon. */
type SpendingGroup = { id: string; category: GroupCategory };

/** Where Spending's figures sit: the page's side padding on each side. */
const pageInset = 2 * 16;
const weekdayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** The whole units a day's cell counts in, as its note names them. */
const units: Record<string, string> = {
  INR: 'rupees',
  EUR: 'euros',
  USD: 'dollars',
  GBP: 'pounds',
  JPY: 'yen',
};

const dateOf = (day: string) => new Date(`${day}T12:00:00`);
/** "November 2026": a Month key in English, as a Group's Expenses spell their Month. */
const monthTitle = (month: string) =>
  dateOf(`${month}-01`).toLocaleDateString('en', { month: 'long', year: 'numeric' });
/** "Mon 16 Nov": the chosen day's heading. */
const dayHeading = (day: string) => {
  const date = dateOf(day);
  return `${shortDays[date.getDay()]} ${date.getDate()} ${date.toLocaleDateString('en', { month: 'short' })}`;
};
/** "3 November": a day as TalkBack hears it, as dayShareReadAloud says its date. */
const readAloudDay = (day: string) => `${dateOf(day).getDate()} ${monthName(day.slice(0, 7))}`;

/** Who paid an Expense, as its row says it: "You paid", "Priya paid", "Priya and Sam paid". */
export function payers(paidBy: SpendingByDayExpenseRead['paidBy'], me: string) {
  const names = paidBy.map(({ _id, name }) => (_id === me ? 'You' : (name ?? 'A former member')));
  // "You" first, then the others in their order.
  names.sort((a, b) => Number(b === 'You') - Number(a === 'You'));
  if (names.length <= 2) return `${names.join(' and ')} paid`;
  return `${names[0]} and ${names.length - 1} others paid`;
}

/** A currency's tab with its Month's total, as board SpendAndDays draws them. */
function CurrencyTab({
  currency,
  selected,
  onPress,
}: {
  currency: Currency;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const total = fullAmount(currency.totalMinor, currency.currency);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${currency.currency}, ${total}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        // The touch target's 44 dp (QA round).
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.brand.main : theme.borderStrong,
        backgroundColor: selected ? theme.brand.bg : theme.surface,
      }}
    >
      <CompactText
        weight="semibold"
        tone={selected ? 'brand' : 'secondary'}
        style={{ fontFamily: fonts.mono, fontSize: 12 }}
      >
        {currency.currency}
      </CompactText>
      <Money size="table" tone={selected ? 'brand' : 'secondary'}>
        {total}
      </Money>
    </Pressable>
  );
}

/**
 * The Month as a grid of seven columns, a week a row from the phone's first weekday: each day so
 * far tinted in five fixed steps, with its date and the member's share in whole units, shortened
 * only where the cell can't hold it (sooner at large text). Each day is a button TalkBack reads
 * with its date and full amount; the days to come are outlined and can't be chosen.
 */
function MonthGrid({
  month,
  today,
  currency,
  chosen,
  placeholder = false,
  onDay,
}: {
  month: string;
  today: string;
  currency?: Currency;
  chosen: string | null;
  placeholder?: boolean;
  onDay: (day: string) => void;
}) {
  const theme = useTheme();
  const large = useLargeText();
  const firstWeekday = useMemo(() => localeFirstWeekday(readPhoneCalendar().locale), []);
  const grid = useMemo(
    () => monthGrid(month, { firstWeekday, today }),
    [month, today, firstWeekday],
  );
  const shares = new Map(currency?.days.map(({ day, shareMinor }) => [day, shareMinor]));
  // Six figures fit a cell at 100% text, as the board draws them; four at large text.
  const cellLength = large ? 4 : 6;
  return (
    <View testID="spending-grid" style={{ gap: 4 }}>
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: 'row', gap: 4, paddingBottom: 2 }}
      >
        {grid.weekdays.map((weekday) => (
          <CompactText
            key={weekday}
            weight="semibold"
            tone="muted"
            style={{ flex: 1, textAlign: 'center', fontSize: 11.5 }}
          >
            {weekdayLetters[weekday]!}
          </CompactText>
        ))}
      </View>
      {grid.weeks.map((week, row) => (
        <View key={row} style={{ flexDirection: 'row', gap: 4 }}>
          {week.map((day, column) => {
            // Each column is the same share of the row; a cell's padding and border sit inside it.
            if (!day) return <View key={column} style={{ flex: 1 }} />;
            const future = day.date > today;
            const share = shares.get(day.date) ?? 0;
            const tint: DayTint =
              placeholder || future || !currency ? 0 : dayTint(share, currency.currency);
            const selected = !placeholder && day.date === chosen;
            // Today, while another day is chosen: the accent number and outline (SpendAndDays 3).
            const accent = day.today && !placeholder && !selected;
            const text = accent && tint < 3 ? theme.brand.main : theme.dayTint.text[tint];
            const cell = (
              <>
                <CompactText
                  weight="semibold"
                  style={{
                    fontSize: 13,
                    lineHeight: 16,
                    color: future ? theme.textMuted : text,
                    textDecorationLine: day.today ? 'underline' : 'none',
                  }}
                >
                  {String(day.day)}
                </CompactText>
                {/* Grows with text to 130%, keeping a few dp beside four figures in a 39 dp cell at
                    200% (QA round); a share still too wide shrinks to it. */}
                <Money
                  size="table"
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  style={{
                    fontSize: 10,
                    lineHeight: 13,
                    minHeight: 13,
                    color: text,
                  }}
                >
                  {placeholder || future || !currency
                    ? ''
                    : dayCellAmount(share, currency.currency, cellLength)}
                </Money>
              </>
            );
            const look = {
              minHeight: 48,
              borderRadius: 10,
              alignItems: 'center' as const,
              justifyContent: 'center' as const,
              gap: 1,
              // At large text, a few dp beside four figures; at 100% the board's cell, edge to edge.
              paddingHorizontal: large ? 3 : 0,
              backgroundColor: future ? 'transparent' : theme.dayTint.fill[tint],
              ...(future ? { borderWidth: 1, borderColor: theme.border } : {}),
              ...(accent ? { borderWidth: 1, borderColor: theme.brand.main } : {}),
            };
            if (future || placeholder)
              return (
                <View key={column} style={{ flex: 1 }}>
                  <View
                    testID={`spending-cell-${day.date}`}
                    accessible={false}
                    importantForAccessibility="no-hide-descendants"
                    style={look}
                  >
                    {cell}
                  </View>
                </View>
              );
            return (
              <View key={column} style={{ flex: 1 }}>
                <Pressable
                  testID={`spending-cell-${day.date}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${
                    share && currency
                      ? dayShareReadAloud(day.date, share, currency.currency)
                      : `${readAloudDay(day.date)}, nothing`
                  }${day.today ? ', today' : ''}`}
                  accessibilityState={{ selected }}
                  // Over the 4 dp gaps beside it, never onto the next day: 43 dp at 360 dp.
                  hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
                  onPress={() => onDay(day.date)}
                  style={look}
                >
                  {cell}
                  {selected ? (
                    // Outlined just outside the cell, as the board draws the day chosen.
                    <View
                      testID="spending-chosen"
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        top: -3,
                        left: -3,
                        right: -3,
                        bottom: -3,
                        borderRadius: 13,
                        borderWidth: 2,
                        borderColor: theme.text,
                      }}
                    />
                  ) : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** "Less", the five steps, "More": what each tint means. */
function Legend() {
  const theme = useTheme();
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 12 }}
    >
      <CompactText tone="secondary" style={{ fontSize: 11.5, paddingRight: 3 }}>
        Less
      </CompactText>
      {theme.dayTint.fill.map((fill, step) => (
        <View
          key={step}
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            backgroundColor: fill,
            ...(step === 0 ? { borderWidth: 1, borderColor: theme.borderStrong } : {}),
          }}
        />
      ))}
      <CompactText tone="secondary" style={{ fontSize: 11.5, paddingLeft: 3 }}>
        More
      </CompactText>
    </View>
  );
}

/** The chosen day: its total and each Expense with the member's share of it, always in full. */
function DayExpenses({
  day,
  today,
  currency,
  me,
  groups,
  onExpense,
}: {
  day: string;
  today: string;
  currency: Currency | null;
  me: string;
  groups: readonly SpendingGroup[];
  onExpense: (groupId: string, expenseId: string) => void;
}) {
  const expenses = currency?.expenses.filter((expense) => expense.day === day) ?? [];
  const total = currency?.days.find((entry) => entry.day === day)?.shareMinor ?? 0;
  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          minHeight: 36,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          columnGap: 8,
          paddingHorizontal: 2,
        }}
      >
        <CompactText variant="overline" accessibilityRole="header" spare>
          {`${dayHeading(day)}${day === today ? `${SEPARATOR}Today` : ''}`}
        </CompactText>
        {currency ? (
          <Money size="list" style={{ fontWeight: '600' }}>
            {fullAmount(total, currency.currency)}
          </Money>
        ) : null}
      </View>
      {expenses.length ? (
        <Card>
          {expenses.map((expense, index) => {
            const share = fullAmount(expense.shareMinor, currency!.currency),
              of = fullAmount(expense.amountMinor, currency!.currency),
              paid = payers(expense.paidBy, me);
            return (
              <View key={expense._id}>
                {index > 0 ? <Divider inset={58} /> : null}
                <ListRow
                  leading={
                    <IconTile
                      icon={groupIcon(
                        groups.find((group) => group.id === expense.group._id)?.category,
                      )}
                    />
                  }
                  title={expense.description}
                  titleLines={0}
                  meta={[expense.group.name, expense.tag, paid].filter(Boolean).join(SEPARATOR)}
                  metaLines={0}
                  accessibilityLabel={[
                    expense.description,
                    expense.group.name,
                    expense.tag,
                    paid,
                    `your share ${share} of ${of}`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  trailing={<RowAmount amount={share} caption={`of ${of}`} />}
                  onPress={() => onExpense(expense.group._id, expense._id)}
                />
              </View>
            );
          })}
        </Card>
      ) : null}
      <CompactText variant="small" tone="secondary" style={{ paddingHorizontal: 2 }}>
        {`${expenses.length ? `${counted(expenses.length, 'Expense')}. ` : 'Nothing shared on this day. '}Payments between members are not spending, so they are left out.`}
      </CompactText>
    </View>
  );
}

/**
 * Board SpendAndDays: Spending, from the Home card. A tab per currency with its Month's total; the
 * Month, paged over this Month and the eleven before it; its total; the Month's grid with a legend;
 * and the chosen day's Expenses with the member's share of each. It opens on today. Offline it
 * shows a saved Month with "Saved" and its time, or says the Month isn't on this phone yet.
 */
export const SpendingScreen = memo(function SpendingScreen({
  screen,
  today,
  me,
  zeroCurrency,
  knownCurrencies,
  groups,
  offline = false,
  onMonth,
  onDay,
  onCurrency,
  onExpense,
  onRetry,
}: {
  screen: SpendingScreenState;
  /** The phone's date, `YYYY-MM-DD`. */
  today: string;
  /** The signed-in member's id: "You paid". */
  me: string;
  /** The currency a Month with nothing says its zero in. */
  zeroCurrency: string;
  /** This Month's currencies: their tabs stay on every Month, at zero, so nothing jumps. */
  knownCurrencies: readonly string[];
  /** The member's Groups, for each row's icon. */
  groups: readonly SpendingGroup[];
  offline?: boolean;
  onMonth: (month: string) => void;
  onDay: (day: string) => void;
  onCurrency: (currency: string) => void;
  onExpense: (groupId: string, expenseId: string) => void;
  onRetry: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const { month, months, read } = screen;
  const at = months.indexOf(month);
  const previous = at > 0 ? months[at - 1]! : null,
    next = at >= 0 && at < months.length - 1 ? months[at + 1]! : null;
  const thisMonth = month === months[months.length - 1];
  const data = read.data;
  const currencies = data?.currencies ?? [];
  // Every currency of this Month keeps its tab on the others, at zero.
  const tabs: Currency[] = [
    ...currencies,
    ...knownCurrencies
      .filter((code) => !currencies.some((currency) => currency.currency === code))
      .map((code) => ({ currency: code, totalMinor: 0, dayCount: 0, days: [], expenses: [] })),
  ];
  const shown = tabs.find((currency) => currency.currency === screen.currency) ?? tabs[0] ?? null;
  const code = shown?.currency ?? zeroCurrency;
  const name = monthName(month);

  const pager = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginVertical: -4,
        marginHorizontal: -6,
      }}
    >
      <IconButton
        icon="chevron-back"
        label="Previous month"
        disabled={!previous}
        onPress={() => previous && onMonth(previous)}
      />
      <CompactText
        weight="semibold"
        accessibilityRole="header"
        style={{ fontSize: 17, flexShrink: 1, textAlign: 'center' }}
      >
        {monthTitle(month)}
      </CompactText>
      <IconButton
        icon="chevron-forward"
        label="Next month"
        disabled={!next}
        onPress={() => next && onMonth(next)}
      />
    </View>
  );

  // A Month still being read, or not on this phone: its grid's frame, and never a zero.
  if (data === null) {
    const unsaved = read.status === 'error' && read.unsaved;
    return (
      <View style={{ gap: 12 }}>
        {pager}
        {read.status === 'loading' || !read.message ? (
          <View accessibilityLabel="Loading your spending" accessibilityState={{ busy: true }}>
            <Skeleton width={180} line="total" />
            <Skeleton width={220} line="caption" />
          </View>
        ) : (
          <View style={{ gap: 10, paddingHorizontal: 2 }}>
            {unsaved ? (
              <CompactText
                accessibilityLiveRegion="polite"
                style={{ fontSize: 14, lineHeight: 20 }}
              >
                This month isn’t on this phone yet. Connect to load it.
              </CompactText>
            ) : (
              // A failed read: the usual error notice, read out at once.
              <CompactText accessibilityRole="alert" variant="small" tone="negative">
                {read.message}
              </CompactText>
            )}
            <View style={{ alignItems: 'flex-start' }}>
              <CompactButton label="Try again" variant="tonal" dense onPress={onRetry} />
            </View>
          </View>
        )}
        <Card padded>
          <MonthGrid month={month} today={today} chosen={null} placeholder onDay={onDay} />
        </Card>
      </View>
    );
  }

  const total = shown?.totalMinor ?? 0;
  const line = `${thisMonth ? 'Your share so far' : `Your share in ${name}`}${
    shown?.dayCount ? `${SEPARATOR}${spendingDays(shown.dayCount)}` : ''
  }`;

  return (
    <View style={{ gap: 12 }}>
      <RetainedNotice
        status={read.status}
        refreshedAt={read.refreshedAt}
        message={read.message}
        subject="your spending"
        retryLabel="Retry spending"
        offline={offline}
        onRetry={onRetry}
      />
      {tabs.length > 1 ? (
        <View
          accessibilityRole="tablist"
          accessibilityLabel="Currency"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
        >
          {tabs.map((currency) => (
            <CurrencyTab
              key={currency.currency}
              currency={currency}
              selected={currency === shown}
              onPress={() => onCurrency(currency.currency)}
            />
          ))}
        </View>
      ) : null}
      {pager}
      <View style={{ gap: 2, paddingHorizontal: 2, marginTop: -6 }}>
        {/* In full where the line holds it; TalkBack always hears it in full. */}
        <Money size="headline" accessibilityLabel={fullAmount(total, code)}>
          {amountToFit(total, code, moneyCharacters(width - pageInset - 4, 'headline', fontScale))}
        </Money>
        <CompactText variant="caption" tone="secondary">
          {line}
        </CompactText>
        {read.restored
          ? readTime({ refreshedAt: read.refreshedAt, restored: true, offline, tone: 'muted' })
          : null}
      </View>
      <Card padded>
        <MonthGrid
          month={month}
          today={today}
          currency={shown ?? undefined}
          chosen={screen.day}
          onDay={onDay}
        />
        {currencies.length ? (
          <>
            <Legend />
            <CompactText tone="secondary" style={{ fontSize: 11.5, lineHeight: 16, paddingTop: 4 }}>
              {`Days show whole ${units[code] ?? 'units'}, shortened where they do not fit. Tap one for the exact amount.`}
            </CompactText>
          </>
        ) : null}
      </Card>
      {!currencies.length ? (
        <View style={{ gap: 4, paddingVertical: 8, paddingHorizontal: 2 }}>
          <CompactText weight="semibold" style={{ fontSize: 16 }}>
            {`Nothing shared in ${name}`}
          </CompactText>
          <CompactText tone="secondary" style={{ fontSize: 14, lineHeight: 20 }}>
            Expenses you have a share in show here on the day they happened.
          </CompactText>
        </View>
      ) : screen.day ? (
        <DayExpenses
          day={screen.day}
          today={today}
          currency={shown}
          me={me}
          groups={groups}
          onExpense={onExpense}
        />
      ) : null}
    </View>
  );
});
