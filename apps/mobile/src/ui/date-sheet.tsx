import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  currentMonthKey,
  gregorianLocale,
  localeFirstWeekday,
  monthGrid,
  toDateParam,
  type CalendarDay,
} from '@splitbook/shared/date';
import { BottomSheet, Chip, CompactText, IconButton, touch } from './compact';
import { useTheme } from './theme';

/** The device's locale, e.g. "en-IN" or "fa-IR". */
const deviceLocale = () => Intl.DateTimeFormat().resolvedOptions().locale;

const formats = new Map<string, Intl.DateTimeFormat>();
/**
 * Spells dates in the device's language on the Gregorian calendar that Splitbook's dates use,
 * whatever the locale's own (fa-IR's is Persian). If a platform can't, they're Gregorian in
 * English. Hermes takes the calendar from the locale's `-u-ca-` extension.
 */
export function gregorianDateFormat(options: Intl.DateTimeFormatOptions) {
  const locale = deviceLocale();
  const key = `${locale} ${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat(gregorianLocale(locale), options);
    } catch {
      // A locale tag the platform rejects.
    }
    if (format?.resolvedOptions().calendar !== 'gregory')
      format = new Intl.DateTimeFormat('en-u-ca-gregory', options);
    formats.set(key, format);
  }
  return format;
}

/** A YYYY-MM-DD string as a local date, or null when that day doesn't exist. */
function localDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toDateParam(date) === value ? date : null;
}

/** The Month to open on: the date's own, or this Month when the date can't be shown. */
const monthOf = (value: string) =>
  /^[1-9]\d{3}-(0[1-9]|1[0-2])-\d{2}$/.test(value) ? value.slice(0, 7) : currentMonthKey();

/**
 * The Expense date: Today and Yesterday, then a Month calendar whose week starts on the device
 * locale's first day. Any real date can be chosen, future ones included. A choice applies at
 * once, so Done, swiping down, tapping outside and Back all keep it.
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
  const locale = useMemo(() => {
    const narrow = gregorianDateFormat({ weekday: 'narrow' });
    return {
      firstWeekday: localeFirstWeekday(deviceLocale()),
      // 7 January 2024 was a Sunday.
      weekdays: Array.from({ length: 7 }, (_, weekday) =>
        narrow.format(new Date(2024, 0, 7 + weekday)),
      ),
      month: gregorianDateFormat({ month: 'long', year: 'numeric' }),
      number: gregorianDateFormat({ day: 'numeric' }),
      day: gregorianDateFormat({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    };
  }, []);
  const [month, setMonth] = useState(() => monthOf(value));
  useEffect(() => {
    // Each opening starts on the chosen date's Month.
    if (visible) setMonth(monthOf(value));
  }, [visible]);

  const now = new Date();
  const today = toDateParam(now);
  const yesterday = toDateParam(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  // The editor re-renders on every keystroke; only a new Month or date is spelled out again.
  const calendar = useMemo(() => {
    const [year, number] = month.split('-').map(Number);
    const grid = monthGrid(month, { firstWeekday: locale.firstWeekday, today, selected: value });
    const chosen = localDay(value);
    return {
      ...grid,
      title: locale.month.format(new Date(year, number - 1, 1)),
      // Always six rows, so the arrows stay put from Month to Month.
      weeks: Array.from({ length: 6 }, (_, row) =>
        (grid.weeks[row] ?? Array<CalendarDay | null>(7).fill(null)).map((cell) => {
          if (!cell) return null;
          const date = new Date(year, number - 1, cell.day);
          return {
            ...cell,
            number: locale.number.format(date),
            label: `${locale.day.format(date)}${cell.today ? ', today' : ''}`,
          };
        }),
      ),
      chosen: chosen ? locale.day.format(chosen) : 'Choose a date',
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
                  onPress={() => choose(cell.date)}
                  style={({ pressed }) => ({
                    flex: 1,
                    height: 46,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.6 : 1,
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
