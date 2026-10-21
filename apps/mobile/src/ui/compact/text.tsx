import { useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Animated, Text, View, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import type { SemanticTokens } from '@splitbook/shared/design-tokens';
import { fonts, useTheme } from '../theme';
import { useStatusFade } from './motion';
import { moneySizes, textVariants, type MoneySize, type TextVariant } from './scale';

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'brand'
  | 'positive'
  | 'negative'
  | 'warning'
  | 'info'
  | 'inverse';

/** Status tones use the status foregrounds, which keep 4.5:1 on ordinary and tinted surfaces. */
export function toneColor(theme: SemanticTokens, tone: TextTone) {
  switch (tone) {
    case 'secondary':
      return theme.textSecondary;
    case 'muted':
      return theme.textMuted;
    case 'brand':
      return theme.brand.main;
    case 'positive':
      return theme.status.positive;
    case 'negative':
      return theme.status.negative;
    case 'warning':
      return theme.status.warning;
    case 'info':
      return theme.status.info;
    case 'inverse':
      return theme.bg;
    default:
      return theme.text;
  }
}

/**
 * Room a label sized to its words keeps to spare: a hair space (U+200A) after it. React Native
 * sizes such a label to the width it measured, and Android's TextView lays the text out again to
 * draw it (React Native 0.86 doesn't draw from the measured layout: `enablePreparedTextLayout`
 * is off). The second layout can need a fraction of a pixel more, most often at a low density,
 * where a pixel is a whole dp; then a label that fitted to within that fraction wraps its last
 * word onto a line its one-line box has no room for. Tea stall's badge drew "You owe Sam"
 * without "₹416.67" (#331); "Groups · 7" drew "Groups ·" and "One person" "One" (#639). The hair
 * space adds its width to the measure but never moves a word to the next line, as a line may end
 * past its room in white space.
 */
export const hairSpace = String.fromCodePoint(0x200a);

/**
 * Room a line cut in the middle keeps for its ellipsis: two no-break spaces after its words.
 * React Native 0.86's text view works out the cut with its own paint, which measures "…" in the
 * phone's font at the text's unscaled size (Roboto's is 0.67em), then draws it in Outfit (0.75em)
 * at the phone's text size. At 130% the line it drew was 3.7dp wider than the one it measured, and
 * Android clipped its end: "…evil.example.tes" (#766). The spaces (0.42em) run past instead, at
 * every size below the largest text, where such lines wrap (`LARGEST_TEXT_SCALE`), for any phone
 * font whose "…" is at least half an em.
 */
export const ellipsisRoom = String.fromCodePoint(0xa0).repeat(2);

export function CompactText({
  variant = 'body',
  tone = 'primary',
  weight,
  spare = false,
  style,
  children,
  ...props
}: TextProps & {
  /** The text itself, as for a heading the screen reader is moved to. */
  ref?: Ref<Text>;
  variant?: TextVariant;
  tone?: TextTone;
  weight?: 'regular' | 'medium' | 'semibold';
  /**
   * The text's box is as wide as its words, as a label beside something in a row, in a pill, a
   * button or a segment is: it ends in a hair space, room to spare (`hairSpace`). Text that fills
   * its line, or wraps across the screen, doesn't need it.
   */
  spare?: boolean;
}) {
  const theme = useTheme();
  const look = [
    textVariants[variant],
    {
      color:
        variant === 'overline' && tone === 'primary' ? theme.textSecondary : toneColor(theme, tone),
    },
    weight && { fontFamily: fonts[weight] },
    style,
  ];
  const cutInMiddle = props.numberOfLines === 1 && props.ellipsizeMode === 'middle';
  return spare || cutInMiddle ? (
    <Text {...props} style={look}>
      {children}
      {spare ? hairSpace : ellipsisRoom}
    </Text>
  ) : (
    <Text {...props} style={look}>
      {children}
    </Text>
  );
}

/**
 * A short status that changes in place, such as "Updated 10:42" becoming "Saved 10:42 ·
 * refreshing": the old text fades out where it was on screen while the new one fades in, instead
 * of the words jumping. Screen readers hear only the current text. `shrink` lets a long status
 * wrap inside a row rather than push its neighbours out. `instant` shows this text at once, with
 * nothing fading out beside it: for a status that must never be seen next to the one it
 * replaces, such as "Updating…" over out-of-date figures (#219).
 */
export function StatusText({
  children,
  variant = 'caption',
  tone = 'secondary',
  shrink = false,
  instant = false,
  style,
  ...props
}: TextProps & {
  children: string;
  variant?: TextVariant;
  tone?: TextTone;
  shrink?: boolean;
  instant?: boolean;
}) {
  const theme = useTheme();
  const change = useStatusFade(children, instant);
  const look = [textVariants[variant], { color: toneColor(theme, tone) }, style];
  const line = useRef<View>(null);
  /** The edge of its row the line keeps when its text grows or shrinks, as last laid out. */
  const edge = useRef<Edge>('left');
  const read = () => {
    edge.current = edgeOf(line.current) ?? edge.current;
  };
  useLayoutEffect(read);
  return (
    <View ref={line} onLayout={read} style={shrink ? { flexShrink: 1, minWidth: 0 } : undefined}>
      <Animated.View key={`in ${change.key}`} style={{ opacity: change.fade }}>
        <Text {...props} style={look}>
          {children}
        </Text>
      </Animated.View>
      {change.from !== null ? (
        <FadingOut
          key={`out ${change.key}`}
          text={change.from}
          look={look}
          opacity={change.out}
          edge={edge.current}
        />
      ) : null}
    </View>
  );
}

type Edge = 'left' | 'right';

/**
 * The edge of its parent a laid-out line sits nearer: the right for a status ending a row, the
 * left for one that starts a row or wrapped onto a line of its own. Null where there's no layout
 * to read, as in tests.
 */
function edgeOf(line: unknown): Edge | null {
  type Box = { getBoundingClientRect?: () => { x: number; width: number } };
  const own = line as (Box & { parentNode?: Box | null }) | null;
  const parent = own?.parentNode;
  if (typeof own?.getBoundingClientRect !== 'function') return null;
  if (typeof parent?.getBoundingClientRect !== 'function') return null;
  const at = own.getBoundingClientRect();
  const room = parent.getBoundingClientRect();
  const before = at.x - room.x;
  const after = room.x + room.width - (at.x + at.width);
  return after < before ? 'right' : 'left';
}

/** Room for the text a status fades out: wider than any status line on a phone. */
const outgoingRoom = 600;

/**
 * The text a status fades out, where it was on screen: held to the edge the line kept before
 * the change, as the line grows or shrinks from the other one (at 360dp and 130% on the
 * emulator, a status on a line of its own sat at the left, and its old text jumped 63dp to the
 * right before fading, #331). Placed in the change's own commit, so it is never drawn anywhere
 * else first. Unseen and unread.
 */
function FadingOut({
  text,
  look,
  opacity,
  edge,
}: {
  text: string;
  look: StyleProp<TextStyle>;
  opacity: Animated.AnimatedInterpolation<number>;
  /** The edge as the change found it; kept while it fades, wherever the line goes. */
  edge: Edge;
}) {
  const [side] = useState(edge);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ position: 'absolute', top: 0, width: outgoingRoom }, { [side]: 0 }]}
    >
      <Animated.Text numberOfLines={1} style={[look, { textAlign: side, opacity }]}>
        {text}
      </Animated.Text>
    </View>
  );
}

/** A formatted amount (the caller formats it) in IBM Plex Mono with tabular figures. */
export function Money({
  children,
  size = 'list',
  tone = 'primary',
  style,
  ...props
}: TextProps & { children: string; size?: MoneySize; tone?: TextTone }) {
  const theme = useTheme();
  return (
    <Text
      numberOfLines={1}
      {...props}
      style={[
        moneySizes[size],
        { fontFamily: fonts.mono, fontVariant: ['tabular-nums'], color: toneColor(theme, tone) },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** "Required" or "Optional" beside a field label, shown before any attempt to save. */
export function FieldMarker({ kind }: { kind: 'required' | 'optional' }) {
  const theme = useTheme();
  const required = kind === 'required';
  return (
    <View
      style={{
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 1,
        backgroundColor: required ? theme.brand.bg : theme.surfaceMuted,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.semibold,
          fontSize: 11,
          lineHeight: 15,
          color: required ? theme.brand.main : theme.textSecondary,
        }}
      >
        {required ? 'Required' : 'Optional'}
        {hairSpace}
      </Text>
    </View>
  );
}
