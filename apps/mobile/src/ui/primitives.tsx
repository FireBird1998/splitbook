import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { fonts, useTheme } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export function Icon({
  name,
  color,
  size = 22,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  const theme = useTheme();
  return (
    <Ionicons
      accessible={false}
      importantForAccessibility="no"
      name={name}
      size={size}
      color={color ?? theme.textSecondary}
    />
  );
}
export function Copy({ style, ...props }: TextProps) {
  const theme = useTheme();
  return (
    <Text
      {...props}
      style={[
        { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: theme.text },
        style,
      ]}
    />
  );
}
export function Label({ children, light = false }: { children: ReactNode; light?: boolean }) {
  const theme = useTheme();
  return (
    <Copy
      style={{
        fontFamily: fonts.semibold,
        fontSize: 11,
        lineHeight: 17,
        letterSpacing: 1.8,
        color: light ? theme.strip.muted : theme.textSecondary,
      }}
    >
      {children}
    </Copy>
  );
}
export function Button({
  label,
  accessibilityLabel = label,
  onPress,
  secondary = false,
  disabled = false,
  icon,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  icon?: IconName;
}) {
  const theme = useTheme();
  const color = secondary ? theme.brand.main : theme.brand.contrastText;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 48,
          borderRadius: 12,
          paddingHorizontal: 18,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: secondary ? theme.brand.bg : theme.brand.main,
          opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {icon && <Icon name={icon} color={color} size={18} />}
      <Copy style={{ color, fontFamily: fonts.semibold }}>{label}</Copy>
    </Pressable>
  );
}
export function Panel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 16,
        padding: 20,
        gap: 16,
      }}
    >
      {children}
    </View>
  );
}
export function Loading({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={theme.brand.main} />
      <Copy style={{ color: theme.textSecondary }}>{label}</Copy>
    </View>
  );
}
export function Notice({
  title,
  message,
  retry,
  retryLabel = 'Try again',
  icon = 'cloud-offline-outline',
}: {
  title: string;
  message: string;
  retry?: () => void;
  retryLabel?: string;
  icon?: IconName;
}) {
  const theme = useTheme();
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      <View style={{ padding: 18, backgroundColor: theme.brand.bg, borderRadius: 22 }}>
        <Icon name={icon} size={30} color={theme.brand.main} />
      </View>
      <Copy
        style={{ fontSize: 23, lineHeight: 29, fontFamily: fonts.semibold, textAlign: 'center' }}
      >
        {title}
      </Copy>
      <Copy style={{ color: theme.textSecondary, textAlign: 'center' }}>{message}</Copy>
      {retry && <Button label={retryLabel} onPress={retry} />}
    </View>
  );
}
export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: small ? 34 : 44,
        height: small ? 34 : 44,
        borderRadius: small ? 12 : 15,
        backgroundColor: theme.brand.bg,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Copy
        style={{ color: theme.brand.main, fontSize: small ? 12 : 15, fontFamily: fonts.semibold }}
      >
        {name
          .split(' ')
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0])
          .join('')}
      </Copy>
    </View>
  );
}
const styles = StyleSheet.create({
  state: { alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 48 },
});
