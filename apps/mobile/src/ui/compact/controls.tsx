import { useContext } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Icon, type IconName } from '../primitives';
import { useReducedMotion } from './motion';
import { denseHitSlop, radius, touch } from './scale';
import { useTap, type Tap } from './tap';
import { BannerActionColor } from './feedback';
import { CompactText, FieldMarker, Money } from './text';

/** Spinning while busy; with reduce motion on, a still hourglass instead. */
export function BusyMark({ color }: { color: string }) {
  return useReducedMotion() ? (
    <Icon name="hourglass-outline" size={18} color={color} />
  ) : (
    <ActivityIndicator size="small" color={color} />
  );
}

/**
 * Primary, tonal (brand.bg) or text button. `amount` renders a monospace value after the label,
 * as in "Save expense ₹1,249.50". Disabled buttons should carry a `hint` saying why.
 * `destructive` uses the coral status colour instead of the brand, as for Leave Group.
 * `amountBelow` puts the amount under the words, in one centred column, as a long label and its
 * amount need at the largest text sizes (Record payment's, #639).
 *
 * `busy` is what the button is doing, as in "Saving expense…": a spinner and that label take
 * the label's place, at full strength, and screen readers hear the busy label with the busy
 * state. The label stays laid out underneath, unseen, so the button keeps its size. A busy
 * button can't be pressed. Its accessibility state always says whether it is busy, false as much
 * as true: React Native on Android rewrites a view's ", busy" only when the state it is sent
 * names `busy`, so a button whose wait ended without saying so went on reading "busy" (#335).
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
  destructive = false,
  hint,
  accessibilityLabel,
  busy,
  amountBelow = false,
  tap,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'tonal' | 'text';
  dense?: boolean;
  block?: boolean;
  icon?: IconName;
  amount?: string;
  disabled?: boolean;
  destructive?: boolean;
  hint?: string;
  accessibilityLabel?: string;
  busy?: string;
  amountBelow?: boolean;
  /**
   * The `useTap` it shares with the other presses of its screen or sheet (#684). Without one it
   * keeps its own: a drag that starts on any button never presses it (#693).
   */
  tap?: Tap;
}) {
  const theme = useTheme();
  const own = useTap();
  const press = tap ?? own;
  // In a Banner, an enabled text action takes the Banner's status colour (#807).
  const inBanner = useContext(BannerActionColor);
  const tones = destructive
    ? { main: theme.status.negative, bg: theme.negative.bg }
    : {
        main: variant === 'text' && !disabled && inBanner ? inBanner : theme.brand.main,
        bg: theme.brand.bg,
      };
  const color = variant === 'primary' ? theme.brand.contrastText : tones.main;
  const size = dense ? 14 : 15;
  // Room to spare (#331): a button as wide as its words, opened again, otherwise wrapped its last
  // word out of sight ("Skip for now" read "Skip for"). Wider than the button, as at 200% text,
  // the words wrap inside themselves, beside the icon, rather than run past its edges (#639).
  const words = (
    <CompactText
      weight="semibold"
      spare
      style={{ color, fontSize: size, flexShrink: 1, minWidth: 0, textAlign: 'center' }}
    >
      {label}
    </CompactText>
  );
  const money = amount ? <Money style={{ color }}>{amount}</Money> : null;
  const content = (
    <>
      {icon ? <Icon name={icon} size={18} color={color} /> : null}
      {amountBelow && money ? (
        <View style={{ flexShrink: 1, minWidth: 0, alignItems: 'center' }}>
          {words}
          {money}
        </View>
      ) : (
        <>
          {words}
          {money}
        </>
      )}
    </>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ?? accessibilityLabel ?? (amount ? `${label} ${amount}` : label)}
      accessibilityHint={hint}
      accessibilityState={{ disabled: disabled || busy !== undefined, busy: busy !== undefined }}
      disabled={disabled || busy !== undefined}
      {...press.on(onPress)}
      hitSlop={dense ? denseHitSlop : undefined}
      style={({ pressed }) => ({
        minHeight: dense ? touch.dense : touch.min,
        alignSelf: block ? 'stretch' : 'flex-start',
        borderRadius: radius.tile,
        paddingHorizontal: variant === 'text' ? 12 : dense ? 14 : 18,
        // One line: the icon stays beside the words' first line. A row that wrapped its parts
        // tipped over on a fraction of a pixel and put "New Group"'s "+" above the words (#639).
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor:
          variant === 'primary' ? tones.main : variant === 'tonal' ? tones.bg : 'transparent',
        opacity: busy ? 1 : disabled ? 0.45 : pressed && !press.dragged ? 0.8 : 1,
      })}
    >
      {busy === undefined ? (
        content
      ) : (
        <>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: 0 }}
          >
            {content}
          </View>
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              paddingHorizontal: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <BusyMark color={color} />
            <CompactText
              weight="semibold"
              numberOfLines={1}
              style={{ color, fontSize: size, flexShrink: 1 }}
            >
              {busy}
            </CompactText>
          </View>
        </>
      )}
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
  spokenValue,
  onPress,
  required = false,
  error,
  locked = false,
}: {
  icon: IconName;
  label: string;
  value: string;
  /** The full value for screen readers when `value` is shortened to fit, e.g. a date. */
  spokenValue?: string;
  onPress?: () => void;
  required?: boolean;
  error?: string;
  locked?: boolean;
}) {
  const theme = useTheme();
  // A drag that starts on a tile never opens its editor (#693).
  const tap = useTap();
  const spoken = [
    `${label}${required ? ', required' : ''}: ${spokenValue ?? value}`,
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
      {...tap.on(onPress)}
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
        backgroundColor: locked || (pressed && !tap.dragged) ? theme.surfaceMuted : theme.surface,
      })}
    >
      <Icon name={icon} size={20} color={error ? theme.status.negative : theme.brand.main} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <CompactText variant="caption" tone={error ? 'negative' : 'secondary'} spare>
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
                spare
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
  disabled = false,
}: {
  label: string;
  /** When the spoken name needs more context than the visible label, e.g. "Tag: Groceries". */
  accessibilityLabel?: string;
  selected?: boolean;
  onPress: () => void;
  role?: 'radio' | 'button';
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{
        ...(role === 'radio' ? { checked: selected } : { selected }),
        ...(disabled ? { disabled: true } : {}),
      }}
      disabled={disabled}
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
        spare
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
  // A drag that starts on it never presses it (#693).
  const tap = useTap();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...tap.on(onPress)}
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
        opacity: pressed && !tap.dragged ? 0.85 : 1,
        elevation: 4,
      })}
    >
      <Icon name={icon} size={24} color={theme.brand.contrastText} />
      <CompactText weight="semibold" spare style={{ color: theme.brand.contrastText }}>
        {label}
      </CompactText>
    </Pressable>
  );
}
