import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  localeFirstWeekday,
  monthGrid,
  toDateParam,
  type CalendarDay,
} from '@splitbook/shared/date';
import { BottomSheet, Chip, CompactText, IconButton, touch, useTap } from './compact';
import { expenseDate } from '@splitbook/shared/expense-day';
import type { DayKey } from '@splitbook/shared/zoned-calendar';
import { phoneMonth, readPhoneCalendar } from '../data/phone-clock';
import { usePhoneNow } from './phone-now';
import { dayBefore, gregorianDateFormat, spellDayKey } from './day-format';
import { useTheme } from './theme';

/** "Monday 19 October 2026": how the sheet names a day, day first on every phone (#640). */
const fullDay = (day: DayKey) => spellDayKey(day, { weekday: 'long', month: 'long', year: true });

/** Whether a YYYY-MM-DD string names a day that exists. */
function isRealDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  return toDateParam(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) === value;
}

/** The Month to open on: the date's own, or the phone's this Month when the date can't be shown. */
const monthOf = (value: string) =>
  /^[1-9]\d{3}-(0[1-9]|1[0-2])-\d{2}$/.test(value) ? value.slice(0, 7) : phoneMonth();

/**
 * The Expense date: Today and Yesterday, then a Month calendar whose week starts on the device
 * locale's first day. Any real date can be chosen, future ones included. A choice applies at
 * once, so Done, swiping down, tapping outside and Back all keep it.
 *
 * Its Month, weekdays and days are spelled in UTC from dates at midnight UTC: once the phone's
 * zone changes while the app runs, Hermes keeps the zone the app started in for its dates while
 * Intl follows the new one, so a local date spelled in the phone's zone is the day before (#1286).
 */
export function DateSheet({
  visible,
  value,
  locked,
  onChange,
  onDone,
}: {
  visible: boolean;
  /** The draft's YYYY-MM-DD date. */
  value: string;
  locked: boolean;
  onChange: (date: string) => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  // A drag that starts on a day never picks it (#665).
  const dayTap = useTap();
  const locale = useMemo(() => {
    const narrow = gregorianDateFormat({ weekday: 'narrow', timeZone: 'UTC' });
    return {
      firstWeekday: localeFirstWeekday(readPhoneCalendar().locale),
      // 7 January 2024 was a Sunday.
      weekdays: Array.from({ length: 7 }, (_, weekday) =>
        narrow.format(new Date(Date.UTC(2024, 0, 7 + weekday))),
      ),
    };
  }, []);
  const [month, setMonth] = useState(() => monthOf(value));
  useEffect(() => {
    // Each opening starts on the chosen date's Month.
    if (visible) setMonth(monthOf(value));
  }, [visible]);

  // The phone's days, which follow its zone while the app runs (#1298), drawn again at midnight
  // while the sheet is open (#1302).
  const today = usePhoneNow().day;
  const yesterday = dayBefore(today);
  // The editor re-renders on every keystroke; only a new Month or date is spelled out again,
  // and all of it from one reading of the phone's locale and zone.
  const calendar = useMemo(() => {
    const heading = gregorianDateFormat({ month: 'long', year: 'numeric', timeZone: 'UTC' });
    const digits = gregorianDateFormat({ day: 'numeric', timeZone: 'UTC' });
    const grid = monthGrid(month, { firstWeekday: locale.firstWeekday, today, selected: value });
    return {
      ...grid,
      title: heading.format(expenseDate(`${month}-01`)),
      // Always six rows, so the arrows stay put from Month to Month.
      weeks: Array.from({ length: 6 }, (_, row) =>
        (grid.weeks[row] ?? Array<CalendarDay | null>(7).fill(null)).map((cell) => {
          if (!cell) return null;
          return {
            ...cell,
            number: digits.format(expenseDate(cell.date)),
            label: `${fullDay(cell.date)}${cell.today ? ', today' : ''}`,
          };
        }),
      ),
      chosen: isRealDay(value) ? fullDay(value) : 'Choose a date',
    };
  }, [month, today, value, locale]);
  const choose = (date: string) => {
    if (locked) return;
    onChange(date);
    setMonth(monthOf(date));
  };

  return (
    <BottomSheet
      visible={visible}
      title="Date"
      onDone={onDone}
      footer={
        <CompactText tone="secondary" accessibilityLiveRegion="polite">
          {calendar.chosen}
        </CompactText>
      }
    >
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label="Today" selected={value === today} onPress={() => choose(today)} />
        <Chip label="Yesterday" selected={value === yesterday} onPress={() => choose(yesterday)} />
      </View>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: -8 }}>
          <IconButton
            icon="chevron-back-outline"
            label="Previous month"
            disabled={!calendar.previous}
            onPress={() => calendar.previous && setMonth(calendar.previous)}
          />
          <CompactText
            variant="heading"
            weight="medium"
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
            style={{ flex: 1, textAlign: 'center' }}
          >
            {calendar.title}
          </CompactText>
          <IconButton
            icon="chevron-forward-outline"
            label="Next month"
            disabled={!calendar.next}
            onPress={() => calendar.next && setMonth(calendar.next)}
          />
        </View>
        {/* Each day says its weekday, so the column letters stay silent. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', paddingVertical: 8 }}
        >
          {calendar.weekdays.map((weekday) => (
            <CompactText
              key={weekday}
              variant="small"
              tone="secondary"
              weight="medium"
              style={{ flex: 1, textAlign: 'center' }}
            >
              {locale.weekdays[weekday]}
            </CompactText>
          ))}
        </View>
        {calendar.weeks.map((week, row) => (
          // A native row per week, its cells updated in place from Month to Month, keeps the
          // days in date order for TalkBack; flattened rows came out interleaved.
          <View key={row} collapsable={false} style={{ flexDirection: 'row' }}>
            {week.map((cell, column) =>
              cell ? (
                <Pressable
                  key={column}
                  accessibilityRole="button"
                  accessibilityLabel={cell.label}
                  accessibilityState={{ selected: cell.selected, disabled: locked }}
                  disabled={locked}
                  {...dayTap.on(() => choose(cell.date))}
                  style={({ pressed }) => ({
                    flex: 1,
                    height: 46,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed && !dayTap.dragged ? 0.6 : 1,
                  })}
                >
                  <View
                    // Remounted on selection: Android keeps corners square when a background
                    // changes from transparent to a colour.
                    key={cell.selected ? 'selected' : 'idle'}
                    style={{
                      width: touch.dense,
                      height: touch.dense,
                      borderRadius: touch.dense / 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: cell.today && !cell.selected ? 1 : 0,
                      borderColor: theme.brand.main,
                      backgroundColor: cell.selected ? theme.brand.main : 'transparent',
                    }}
                  >
                    <CompactText
                      weight={cell.selected || cell.today ? 'semibold' : 'regular'}
                      tone={cell.today ? 'brand' : 'primary'}
                      style={cell.selected ? { color: theme.brand.contrastText } : undefined}
                    >
                      {cell.number}
                    </CompactText>
                  </View>
                </Pressable>
              ) : (
                <View key={column} style={{ flex: 1, height: 46 }} />
              ),
            )}
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}
