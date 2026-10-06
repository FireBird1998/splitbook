import { Animated, Text, View, type TextProps } from 'react-native';
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
 * refreshing": the old text fades out where it was while the new one fades in, instead of the
 * words jumping. Screen readers hear only the current text. `shrink` lets a long status wrap
 * inside a row rather than push its neighbours out.
 */
export function StatusText({
  children,
  variant = 'caption',
  tone = 'secondary',
  shrink = false,
  style,
  ...props
}: TextProps & { children: string; variant?: TextVariant; tone?: TextTone; shrink?: boolean }) {
  const theme = useTheme();
  const change = useStatusFade(children);
  const look = [textVariants[variant], { color: toneColor(theme, tone) }, style];
  return (
    <View style={shrink ? { flexShrink: 1, minWidth: 0 } : undefined}>
      <Animated.View style={{ opacity: change.fade }}>
        <Text {...props} style={look}>
          {children}
        </Text>
      </Animated.View>
      {change.from !== null ? (
        <Animated.Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          numberOfLines={1}
          style={[look, { position: 'absolute', top: 0, left: 0, right: 0, opacity: change.out }]}
        >
          {change.from}
        </Animated.Text>
      ) : null}
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
