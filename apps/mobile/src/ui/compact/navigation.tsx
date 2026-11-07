import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import type { GroupDestination } from '../../data/types';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Icon, type IconName } from '../primitives';
import { IconButton } from './controls';
import { useLineBox, useTextColumn } from './layout';
import { touch } from './scale';
import { useTap } from './tap';
import { CompactText } from './text';

/**
 * The compact top bar: an optional back or close action, a title with a one-line subtitle,
 * an optional status (e.g. "Draft saved") and trailing actions.
 *
 * At large text (from 130%) the title and subtitle take as many lines as they need, and the
 * status goes under them, at the bar's end, where it would leave them less than
 * `largeTextColumn` beside it: at 200% on a 360dp phone, "Kept on this phone" squeezed "Add
 * expense" and its Group to dots, and a Group's subtitle lost its currency (#639).
 *
 * Back or close and the actions share one line. Below large text the title and subtitle take a
 * line each and everything is centred in the bar. At large text, where the title and its Group
 * wrap, they keep their centre on the title's first line, as a sheet's header keeps Done (#646):
 * at 200% on a 360dp phone, Back and ⋮ centred on "Expense" and its Group's three lines while
 * Edit, a button that keeps to its row's top, sat on "Expense" (#939). Each action centres in a
 * touch target's height, so one shorter than an icon, as the DEV badge or a dense Done, keeps to
 * the same line rather than its row's top (#939: the badge sat 11 dp above Back at 130%).
 */
export function TopBar({
  title,
  subtitle,
  leading,
  status,
  actions,
  prominent = true,
  subtitleLines = 1,
}: {
  title: string;
  subtitle?: string;
  /** `disabled` keeps the arrow visible but inert, as while an invitation is being joined. */
  leading?: { kind: 'back' | 'close'; label: string; onPress: () => void; disabled?: boolean };
  status?: ReactNode;
  actions?: ReactNode;
  /** Screen titles use the title size; tasks such as the Expense form use the heading size. */
  prominent?: boolean;
  /** Lines the subtitle may take, as a run's place across Groups at large text. */
  subtitleLines?: number;
}) {
  const theme = useTheme();
  const column = useTextColumn();
  // At large text, whichever of the title's first line and an action is shorter starts lower by
  // half the difference, so their centres meet. Room inside the title's box, not a margin: in the
  // row a status wraps in, Yoga centres the title by its own height, so a margin moved it down by
  // half and the title sat above × and ⋮ (#939).
  const firstLine = useLineBox(prominent ? 'title' : 'heading').height;
  const lift = column ? (firstLine - touch.min) / 2 : 0;
  const heading = (
    <View
      style={{
        flex: 1,
        minWidth: column && status ? column : 0,
        paddingHorizontal: 4,
        paddingTop: Math.max(0, -lift),
      }}
    >
      <CompactText
        variant={prominent ? 'title' : 'heading'}
        accessibilityRole="header"
        numberOfLines={column ? 0 : 1}
      >
        {title}
      </CompactText>
      {subtitle ? (
        <CompactText variant="caption" tone="secondary" numberOfLines={column ? 0 : subtitleLines}>
          {subtitle}
        </CompactText>
      ) : null}
    </View>
  );
  /** The height the title's first line centres in at large text, from the title's top. */
  const band = Math.max(touch.min, firstLine);
  /** Back or close, and the actions, beside the title's first line at large text. */
  const beside = { marginTop: Math.max(0, lift) };
  return (
    // The bar keeps its height for a title on one line, its row centred in it.
    <View
      style={{
        minHeight: 64,
        justifyContent: 'center',
        paddingVertical: 4,
        paddingLeft: leading ? 4 : 20,
        paddingRight: 4,
        backgroundColor: theme.bg,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: column ? 'flex-start' : 'center', gap: 2 }}>
        {leading ? (
          <View style={beside}>
            <IconButton
              icon={leading.kind === 'back' ? 'arrow-back' : 'close'}
              label={leading.label}
              onPress={leading.onPress}
              disabled={leading.disabled}
            />
          </View>
        ) : null}
        {column && status ? (
          // The status beside the title while both fit, under it where they don't.
          <View
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              alignContent: 'center',
              // The title fills its line; a status on a line of its own keeps to the end.
              justifyContent: 'flex-end',
              rowGap: 2,
            }}
          >
            {heading}
            {/* Beside the title, centred on its first line: stretched to its line, as tall as
                the title and its Group, and no taller than the band the title's first line
                centres in. On a line of its own it keeps its height, so the bar does too (#958). */}
            <View style={{ alignSelf: 'stretch', maxHeight: band, justifyContent: 'center' }}>
              {status}
            </View>
          </View>
        ) : (
          <>
            {heading}
            {status}
          </>
        )}
        {actions ? (
          // A row of their own, each centred in a touch target's height, so an action that keeps
          // to its row's top, as a button does, or is shorter than an icon, keeps to the line.
          <View style={{ ...beside, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            {eachAction(actions).map((action, index) => (
              <View key={index} style={{ minHeight: touch.min, justifyContent: 'center' }}>
                {action}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Each action on its own, out of the fragments that group them. */
function eachAction(actions: ReactNode): ReactNode[] {
  return Children.toArray(actions).flatMap((action) =>
    isValidElement<{ children?: ReactNode }>(action) && action.type === Fragment
      ? eachAction(action.props.children)
      : [action],
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
  // A drag that starts on a tab never chooses it, even a short one: no scrolling parent takes the
  // touch here (#693).
  const tap = useTap();
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
            {...tap.on(() => onChange(destination.value))}
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
              spare
            >
              {destination.label}
            </CompactText>
          </Pressable>
        );
      })}
    </View>
  );
}
