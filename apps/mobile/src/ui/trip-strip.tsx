import { useState } from 'react';
import { View, useWindowDimensions, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { groupCurrencies } from '@splitbook/shared/group-currencies';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { deriveTripCodes } from '@splitbook/shared/trip-codes';
import type { MobileGroup } from '../data/types';
import { CompactText, isLargeText, scaledSp, space, textVariants } from './compact';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';
import { SEPARATOR } from '@splitbook/shared/separator';

// Trip dates are calendar days stored at midnight UTC.
const day = (date: Date, month: 'short' | 'long') =>
  `${date.getUTCDate()} ${date.toLocaleDateString('en', { month, timeZone: 'UTC' })}`;

/**
 * "17–20 Sep" to show and "17 to 20 September" to read; "Starts 17 Sep" without an end date,
 * and nothing without a start date.
 */
function tripDates({ startDate: start, endDate: end }: MobileGroup) {
  if (!start) return null;
  if (!end)
    return { shown: `Starts ${day(start, 'short')}`, spoken: `starts ${day(start, 'long')}` };
  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  if (!sameMonth)
    return {
      shown: `${day(start, 'short')} – ${day(end, 'short')}`,
      spoken: `${day(start, 'long')} to ${day(end, 'long')}`,
    };
  if (start.getUTCDate() === end.getUTCDate())
    return { shown: day(start, 'short'), spoken: day(start, 'long') };
  return {
    shown: `${start.getUTCDate()}–${day(end, 'short')}`,
    spoken: `${start.getUTCDate()} to ${day(end, 'long')}`,
  };
}

/** "INR, EUR and JPY", as the strip says its currencies. */
const spokenList = (codes: string[]) =>
  codes.length > 1 ? `${codes.slice(0, -1).join(', ')} and ${codes.at(-1)}` : (codes[0] ?? '');

const DASH = 4;
const DASH_GAP = 3;

/** The route's codes: IBM Plex Mono, whose every character is 0.6 of its size across. */
const CODE = { size: 22, letterSpacing: 1 };
const MEMBERS = { size: 11, letterSpacing: 1 };
const SMALL = Number(textVariants.small.fontSize);
const ROUTE_GAP = 10;
const PLANE = 18;
const PADDING = 16;
/** The perforation between the route and the stub: a dash's width and its margins. */
const PERFORATION = 1 + 2 * 14;

/** How wide a line of IBM Plex Mono is at this text size: 0.6 of its size for each character. */
const monoWidth = (text: string, size: number, fontScale: number, letterSpacing = 0) =>
  [...text].length * scaledSp(0.6 * size + letterSpacing, fontScale);

/**
 * Whether the stub fits beside the route on a strip `width` wide: the route's codes, its plane
 * and their gaps, the perforation, and the stub's widest line. Every text on the strip is set in
 * IBM Plex Mono, so these widths are exact. A Trip in five currencies at 100% on a 360 dp phone
 * didn't fit, and the route ran under the currencies (#886).
 */
function stubFitsBeside(
  width: number,
  fontScale: number,
  route: { from: string; to: string },
  stub: string[],
  members: string,
) {
  const codes =
    monoWidth(route.from, CODE.size, fontScale, CODE.letterSpacing) +
    monoWidth(route.to, CODE.size, fontScale, CODE.letterSpacing);
  const widest = Math.max(
    monoWidth(members, MEMBERS.size, fontScale, MEMBERS.letterSpacing),
    ...stub.map((line) => monoWidth(line, SMALL, fontScale)),
  );
  return codes + PLANE + 4 * ROUTE_GAP + PERFORATION + widest <= width - 2 * PADDING;
}

/**
 * A dashed rule drawn as short segments, as many as fit the length its caller gives it:
 * Android draws a one-sided dashed border solid.
 */
function Dashes({ vertical = false, style }: { vertical?: boolean; style?: ViewStyle }) {
  const theme = useTheme();
  const [length, setLength] = useState(0);
  const count = Math.floor((length + DASH_GAP) / (DASH + DASH_GAP));
  return (
    <View
      onLayout={({ nativeEvent: { layout } }) => setLength(vertical ? layout.height : layout.width)}
      style={[
        vertical ? { width: 1 } : { height: 1, flexDirection: 'row' },
        { justifyContent: 'space-between', overflow: 'hidden' },
        style,
      ]}
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={{
            width: vertical ? 1 : DASH,
            height: vertical ? DASH : 1,
            backgroundColor: theme.strip.muted,
          }}
        />
      ))}
    </View>
  );
}

/**
 * The Trip Theme's slim boarding-pass strip at the top of Expenses: route codes from the
 * Trip's name, a perforation, then its dates, member count and, for a Trip in more than one
 * currency, its currencies, main first (#730), as the web's strip lists them. Read as one image.
 * `strip.muted` drops below 4.5:1 at the gradient's light end, so it draws only the dashes.
 * Its height follows its text. At large text, or where the stub doesn't fit beside the route,
 * as a Trip in five currencies on a 360 dp phone doesn't (#886), the stub moves below the route.
 */
export function TripStrip({ group }: { group: MobileGroup }) {
  const theme = useTheme();
  const window = useWindowDimensions();
  // The strip's width: the screen's less its gutters, until a layout says otherwise, so the strip
  // that sits between the gutters draws once.
  const guess = window.width - 2 * space.gutter;
  const [laidOut, setLaidOut] = useState<number | null>(null);
  const width = laidOut ?? guess;
  const { from, to } = deriveTripCodes(group.name);
  const dates = tripDates(group);
  const count = group.members.length;
  const members = `${count} ${count === 1 ? 'member' : 'members'}`;
  const currencies = groupCurrencies(group);
  const several = currencies.length > 1;
  const list = currencies.join(SEPARATOR);
  // At large text, or where the stub doesn't fit beside the route, it goes under the route.
  const stacked =
    isLargeText(window.fontScale) ||
    !stubFitsBeside(
      width,
      window.fontScale,
      { from, to },
      [...(dates ? [dates.shown] : []), ...(several ? [list] : [])],
      members.toUpperCase(),
    );
  const code = {
    fontFamily: fonts.mono,
    fontSize: CODE.size,
    lineHeight: 28,
    letterSpacing: CODE.letterSpacing,
    color: theme.strip.text,
  };
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={[
        `${getGroupTheme(group.category).label} from ${from} to ${to}`,
        dates?.spoken,
        members,
        several ? `currencies ${spokenList(currencies)}` : null,
      ]
        .filter(Boolean)
        .join(', ')}
      style={{ borderRadius: 16, overflow: 'hidden' }}
    >
      <LinearGradient
        colors={theme.strip.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        onLayout={({ nativeEvent: { layout } }) =>
          setLaidOut(Math.abs(layout.width - guess) < 0.5 ? null : layout.width)
        }
        style={[
          {
            minHeight: 72,
            justifyContent: 'center',
            paddingHorizontal: PADDING,
            paddingVertical: 12,
          },
          stacked ? { gap: 10 } : { flexDirection: 'row', alignItems: 'center' },
        ]}
      >
        {/* Beside the stub, the route takes only the width the stub leaves. */}
        <View
          style={[
            { flexDirection: 'row', alignItems: 'center', gap: ROUTE_GAP },
            !stacked && { flex: 1 },
          ]}
        >
          <CompactText style={code}>{from}</CompactText>
          <Dashes style={{ flex: 1 }} />
          <Icon name="airplane-outline" size={PLANE} color={theme.strip.text} />
          <Dashes style={{ flex: 1 }} />
          <CompactText style={code}>{to}</CompactText>
        </View>
        <Dashes
          vertical={!stacked}
          style={
            stacked ? undefined : { alignSelf: 'stretch', marginHorizontal: (PERFORATION - 1) / 2 }
          }
        />
        <View
          style={
            stacked
              ? {
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  columnGap: 12,
                }
              : { alignItems: 'flex-end', gap: 2 }
          }
        >
          {dates ? (
            <CompactText
              variant="small"
              style={{ fontFamily: fonts.mono, color: theme.strip.text }}
            >
              {dates.shown}
            </CompactText>
          ) : null}
          <CompactText
            style={{
              fontFamily: fonts.mono,
              fontSize: MEMBERS.size,
              lineHeight: 15,
              letterSpacing: MEMBERS.letterSpacing,
              color: theme.strip.text,
            }}
          >
            {members.toUpperCase()}
          </CompactText>
          {several ? (
            <CompactText
              variant="small"
              style={{ fontFamily: fonts.mono, color: theme.strip.text }}
            >
              {list}
            </CompactText>
          ) : null}
        </View>
      </LinearGradient>
    </View>
  );
}
