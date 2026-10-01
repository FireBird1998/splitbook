import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Icon, type IconName } from '../primitives';
import { denseHitSlop, radius, touch } from './scale';
import { CompactText, FieldMarker, Money } from './text';

/**
 * Primary, tonal (brand.bg) or text button. `amount` renders a monospace value after the label,
 * as in "Save expense ₹1,249.50". Disabled buttons should carry a `hint` saying why.
 */
export function CompactButton({
  label,
  onPress,
  variant = 'primary',
  dense = false,
  block = false,
  icon,
  amount,
  disabled = false,
  hint,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'tonal' | 'text';
  dense?: boolean;
  block?: boolean;
  icon?: IconName;
  amount?: string;
  disabled?: boolean;
  hint?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const color = variant === 'primary' ? theme.brand.contrastText : theme.brand.main;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (amount ? `${label} ${amount}` : label)}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={dense ? denseHitSlop : undefined}
      style={({ pressed }) => ({
        minHeight: dense ? touch.dense : touch.min,
        alignSelf: block ? 'stretch' : 'flex-start',
        borderRadius: radius.tile,
        paddingHorizontal: variant === 'text' ? 12 : dense ? 14 : 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor:
          variant === 'primary'
            ? theme.brand.main
            : variant === 'tonal'
              ? theme.brand.bg
              : 'transparent',
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={18} color={color} /> : null}
      <CompactText weight="semibold" style={{ color, fontSize: dense ? 14 : 15 }}>
        {label}
      </CompactText>
      {amount ? <Money style={{ color }}>{amount}</Money> : null}
    </Pressable>
  );
}

/** A 48dp round icon button; icon-only controls always need a spoken label. */
export function IconButton({
  icon,
  label,
  onPress,
  color,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: touch.min,
        height: touch.min,
        borderRadius: touch.min / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.surfaceMuted : 'transparent',
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Icon name={icon} size={24} color={color ?? theme.text} />
    </Pressable>
  );
}

/**
 * A tile showing one Expense value (Date, Paid by, Split, Tag) that opens its sheet.
 * `error` describes what needs fixing; `locked` tiles can't be changed.
 */
export function SelectorTile({
  icon,
  label,
  value,
  onPress,
  required = false,
  error,
  locked = false,
}: {
  icon: IconName;
  label: string;
  value: string;
  onPress?: () => void;
  required?: boolean;
  error?: string;
  locked?: boolean;
}) {
  const theme = useTheme();
  const spoken = [
    `${label}${required ? ', required' : ''}: ${value}`,
    error,
    locked ? 'locked' : undefined,
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ disabled: locked || !onPress }}
      disabled={locked || !onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        paddingLeft: 12,
        paddingRight: 10,
        borderRadius: radius.tile,
        borderWidth: error ? 2 : 1,
        borderColor: error ? theme.negative.main : theme.border,
        backgroundColor: locked ? theme.surfaceMuted : pressed ? theme.surfaceMuted : theme.surface,
      })}
    >
      <Icon name={icon} size={20} color={error ? theme.status.negative : theme.brand.main} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <CompactText variant="caption" tone={error ? 'negative' : 'secondary'}>
            {label}
          </CompactText>
          {required ? <FieldMarker kind="required" /> : null}
        </View>
        <CompactText weight="semibold" numberOfLines={1}>
          {value}
        </CompactText>
      </View>
    </Pressable>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A single choice between two or three options, e.g. "One person" / "Several people".
 * Each option's touch area fills its share of the track, so the 44 pill gets a 50 target.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        paddingHorizontal: 1.5,
        borderRadius: radius.tile,
        backgroundColor: theme.surfaceMuted,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={{ flex: 1, paddingVertical: 3, paddingHorizontal: 1.5 }}
          >
            <View
              // Remounted on selection: Android keeps corners square when a background
              // changes from transparent to a colour.
              key={selected ? 'selected' : 'idle'}
              style={{
                minHeight: touch.dense,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? theme.surface : 'transparent',
              }}
            >
              <CompactText
                weight="semibold"
                tone={selected ? 'primary' : 'secondary'}
                style={{ fontSize: 14 }}
              >
                {option.label}
              </CompactText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A choice chip. As `radio` it belongs to a radiogroup (split methods); as `button` it is a
 * one-tap shortcut (Today, Yesterday) and reports `selected`.
 */
export function Chip({
  label,
  accessibilityLabel,
  selected = false,
  onPress,
  role = 'button',
}: {
  label: string;
  /** When the spoken name needs more context than the visible label, e.g. "Tag: Groceries". */
  accessibilityLabel?: string;
  selected?: boolean;
  onPress: () => void;
  role?: 'radio' | 'button';
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={role === 'radio' ? { checked: selected } : { selected }}
      onPress={onPress}
      hitSlop={denseHitSlop}
      style={{
        minHeight: touch.dense,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        borderRadius: radius.tile,
        borderWidth: 1,
        borderColor: selected ? theme.brand.main : theme.borderStrong,
        backgroundColor: selected ? theme.brand.bg : theme.surface,
      }}
    >
      {selected ? <Icon name="checkmark" size={16} color={theme.brand.main} /> : null}
      <CompactText
        weight={selected ? 'semibold' : 'medium'}
        tone={selected ? 'brand' : 'primary'}
        style={{ fontSize: 14 }}
      >
        {label}
      </CompactText>
    </Pressable>
  );
}

/** − value + for whole-number weights such as Shares. */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  const theme = useTheme();
  const canDecrease = value > min;
  const canIncrease = max === undefined || value < max;
  const step = (enabled: boolean, next: number, icon: IconName, spoken: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={() => onChange(next)}
      hitSlop={denseHitSlop}
      style={{
        width: touch.dense,
        height: touch.dense,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: enabled ? 1 : 0.4,
      }}
    >
      <Icon name={icon} size={20} color={theme.brand.main} />
    </Pressable>
  );
  return (
    <View
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: theme.borderStrong,
        borderRadius: radius.tile,
      }}
    >
      {step(canDecrease, value - 1, 'remove', `Decrease ${label}`)}
      <Money
        accessibilityLabel={`${label}: ${value}`}
        accessibilityLiveRegion="polite"
        style={{ minWidth: 26, textAlign: 'center' }}
      >
        {String(value)}
      </Money>
      {step(canIncrease, value + 1, 'add', `Increase ${label}`)}
    </View>
  );
}

/** The extended floating action, e.g. "Add expense" or "Resume draft", placed above the bottom navigation. */
export function FloatingAction({
  label,
  icon,
  onPress,
  bottom = 96,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  bottom?: number;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        right: 16,
        bottom,
        minHeight: 56,
        borderRadius: radius.fab,
        paddingLeft: 16,
        paddingRight: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: theme.brand.main,
        opacity: pressed ? 0.85 : 1,
        elevation: 4,
      })}
    >
      <Icon name={icon} size={24} color={theme.brand.contrastText} />
      <CompactText weight="semibold" style={{ color: theme.brand.contrastText }}>
        {label}
      </CompactText>
    </Pressable>
  );
}
