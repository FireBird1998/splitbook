import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { deriveTripCodes } from '@splitbook/shared/trip-codes';
import type { MobileGroup } from '../data/types';
import { CompactText } from './compact';
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

/**
 * The Trip Theme's slim boarding-pass strip at the top of Expenses: route codes from the
 * Trip's name, a perforation, then its dates and member count. Read as one image.
 * `strip.muted` drops below 4.5:1 at the gradient's light end, so it draws only the dashes.
 */
export function TripStrip({ group }: { group: MobileGroup }) {
  const theme = useTheme();
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
  const dashes = {
    flex: 1,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.strip.muted,
  } as const;
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
        style={{
          minHeight: 72,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <View style={{ flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <CompactText style={code}>{from}</CompactText>
          <View style={dashes} />
          <Icon name="airplane-outline" size={18} color={theme.strip.text} />
          <View style={dashes} />
          <CompactText style={code}>{to}</CompactText>
        </View>
        <View
          style={{
            alignSelf: 'stretch',
            marginHorizontal: 14,
            borderLeftWidth: 1,
            borderStyle: 'dashed',
            borderColor: theme.strip.muted,
          }}
        />
        <View style={{ flexShrink: 1, alignItems: 'flex-end', gap: 2 }}>
          {dates ? (
            <CompactText
              variant="small"
              weight="semibold"
              style={{ color: theme.strip.text, textAlign: 'right' }}
            >
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
