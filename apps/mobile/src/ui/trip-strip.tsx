import { useState } from 'react';
import { View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { deriveTripCodes } from '@splitbook/shared/trip-codes';
import type { MobileGroup } from '../data/types';
import { CompactText, useLargeText } from './compact';
import { Icon } from './primitives';
import { fonts, useTheme } from './theme';

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

const DASH = 4;
const DASH_GAP = 3;

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
 * Trip's name, a perforation, then its dates and member count. Read as one image.
 * `strip.muted` drops below 4.5:1 at the gradient's light end, so it draws only the dashes.
 * Its height follows its text; at large text the dates move below the route.
 */
export function TripStrip({ group }: { group: MobileGroup }) {
  const theme = useTheme();
  const large = useLargeText();
  const { from, to } = deriveTripCodes(group.name);
  const dates = tripDates(group);
  const count = group.members.length;
  const members = `${count} ${count === 1 ? 'member' : 'members'}`;
  const code = {
    fontFamily: fonts.mono,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: 1,
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
      ]
        .filter(Boolean)
        .join(', ')}
      style={{ borderRadius: 16, overflow: 'hidden' }}
    >
      <LinearGradient
        colors={theme.strip.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          { minHeight: 72, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
          large ? { gap: 10 } : { flexDirection: 'row', alignItems: 'center' },
        ]}
      >
        {/* Beside the stub, the route takes only the width the stub leaves. */}
        <View
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 10 }, !large && { flex: 1 }]}
        >
          <CompactText style={code}>{from}</CompactText>
          <Dashes style={{ flex: 1 }} />
          <Icon name="airplane-outline" size={18} color={theme.strip.text} />
          <Dashes style={{ flex: 1 }} />
          <CompactText style={code}>{to}</CompactText>
        </View>
        <Dashes
          vertical={!large}
          style={large ? undefined : { alignSelf: 'stretch', marginHorizontal: 14 }}
        />
        <View
          style={
            large
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
            <CompactText variant="small" weight="semibold" style={{ color: theme.strip.text }}>
              {dates.shown}
            </CompactText>
          ) : null}
          <CompactText
            style={{
              fontFamily: fonts.mono,
              fontSize: 11,
              lineHeight: 15,
              letterSpacing: 1,
              color: theme.strip.text,
            }}
          >
            {members.toUpperCase()}
          </CompactText>
        </View>
      </LinearGradient>
    </View>
  );
}
