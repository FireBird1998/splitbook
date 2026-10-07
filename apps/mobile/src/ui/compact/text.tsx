import { useLayoutEffect, useRef, useState } from 'react';
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

export function CompactText({
  variant = 'body',
  tone = 'primary',
  weight,
  style,
  ...props
}: TextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: 'regular' | 'medium' | 'semibold';
}) {
  const theme = useTheme();
  return (
    <Text
      {...props}
      style={[
        textVariants[variant],
        {
          color:
            variant === 'overline' && tone === 'primary'
              ? theme.textSecondary
              : toneColor(theme, tone),
        },
        weight && { fontFamily: fonts[weight] },
        style,
      ]}
    />
  );
}

/**
 * A short status that changes in place, such as "Updated 10:42" becoming "Saved 10:42 ·
 * refreshing": the old text fades out where it was on screen while the new one fades in, instead
 * of the words jumping. Screen readers hear only the current text. `shrink` lets a long status
 * wrap inside a row rather than push its neighbours out.
 */
export function StatusText({
  children,
  variant = 'caption',
  tone = 'secondary',
  shrink = false,
  style,
  ...props
}: TextProps & {
  children: string;
  variant?: TextVariant;
  tone?: TextTone;
  shrink?: boolean;
}) {
  const theme = useTheme();
  const change = useStatusFade(children);
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
      </Text>
    </View>
  );
}
