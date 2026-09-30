import type { ReactNode } from 'react';
import type { GroupDestination } from '../../data/types';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Icon, type IconName } from '../primitives';
import { IconButton } from './controls';
import { CompactText } from './text';

/**
 * The compact top bar: an optional back or close action, a title with a one-line subtitle,
 * an optional status (e.g. "Draft saved") and trailing actions.
 */
export function TopBar({
  title,
  subtitle,
  leading,
  status,
  actions,
  prominent = true,
}: {
  title: string;
  subtitle?: string;
  leading?: { kind: 'back' | 'close'; label: string; onPress: () => void };
  status?: ReactNode;
  actions?: ReactNode;
  /** Screen titles use the title size; tasks such as the Expense form use the heading size. */
  prominent?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingVertical: 4,
        paddingLeft: leading ? 4 : 20,
        paddingRight: 4,
        backgroundColor: theme.bg,
      }}
    >
      {leading ? (
        <IconButton
          icon={leading.kind === 'back' ? 'arrow-back' : 'close'}
          label={leading.label}
          onPress={leading.onPress}
        />
      ) : null}
      <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 4 }}>
        <CompactText
          variant={prominent ? 'title' : 'heading'}
          accessibilityRole="header"
          numberOfLines={1}
        >
          {title}
        </CompactText>
        {subtitle ? (
          <CompactText variant="caption" tone="secondary" numberOfLines={1}>
            {subtitle}
          </CompactText>
        ) : null}
      </View>
      {status}
      {actions}
    </View>
  );
}

export type { GroupDestination };

const destinations: { value: GroupDestination; label: string; icon: IconName }[] = [
  { value: 'expenses', label: 'Expenses', icon: 'receipt-outline' },
  // Ionicons' "scale" is a bathroom scale; the balance scale in the design has no equivalent.
  { value: 'balances', label: 'Balances', icon: 'swap-horizontal-outline' },
  { value: 'activity', label: 'Activity', icon: 'pulse-outline' },
];

/** Bottom navigation, only inside a Group: every destination is scoped to that Group. */
export function GroupNavBar({
  groupName,
  value,
  onChange,
}: {
  groupName: string;
  value: GroupDestination;
  onChange: (value: GroupDestination) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={`${groupName} sections`}
      style={{
        minHeight: 80,
        flexDirection: 'row',
        paddingTop: 10,
        paddingBottom: 14,
        paddingHorizontal: 8,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        backgroundColor: theme.bgElevated,
      }}
    >
      {destinations.map((destination) => {
        const selected = destination.value === value;
        return (
          <Pressable
            key={destination.value}
            accessibilityRole="tab"
            accessibilityLabel={destination.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(destination.value)}
            style={{
              flex: 1,
              minHeight: 56,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <View
              // Android keeps a view's corners square when its background changes from
              // transparent to a colour, so the pill is remounted when it's selected.
              key={selected ? 'selected' : 'idle'}
              style={{
                width: 60,
                height: 32,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? theme.brand.bg : 'transparent',
              }}
            >
              <Icon
                name={destination.icon}
                size={24}
                color={selected ? theme.brand.main : theme.textSecondary}
              />
            </View>
            <CompactText
              variant="caption"
              tone={selected ? 'primary' : 'secondary'}
              weight={selected ? 'semibold' : 'medium'}
            >
              {destination.label}
            </CompactText>
          </Pressable>
        );
      })}
    </View>
  );
}
