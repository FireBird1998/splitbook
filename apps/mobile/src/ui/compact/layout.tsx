import { Children, type ReactNode } from 'react';
import { Pressable, View, useWindowDimensions, type DimensionValue } from 'react-native';
import { useTheme } from '../theme';
import { Icon, type IconName } from '../primitives';
import { isLargeText, radius, space } from './scale';
import { CompactText, Money, type TextTone } from './text';

export const useLargeText = () => isLargeText(useWindowDimensions().fontScale);

/** A bordered surface. `error` marks invalid content; `locked` marks content that can't change. */
export function Card({
  children,
  state = 'default',
  padded = false,
}: {
  children: ReactNode;
  state?: 'default' | 'error' | 'locked';
  padded?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: state === 'locked' ? theme.surfaceMuted : theme.surface,
        borderColor: state === 'error' ? theme.negative.main : theme.border,
        borderWidth: state === 'error' ? 2 : 1,
        borderRadius: radius.card,
        padding: padded ? 14 : 0,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

export function Divider({ inset = 14 }: { inset?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{ height: 1, backgroundColor: theme.border, marginLeft: inset, marginRight: 14 }}
    />
  );
}

/** An overline title with an optional trailing action or note. */
export function SectionHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <View
      style={{
        minHeight: 32,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.gap,
        paddingHorizontal: 2,
      }}
    >
      <CompactText variant="overline" accessibilityRole="header">
        {title}
      </CompactText>
      {trailing}
    </View>
  );
}

export function IconTile({
  icon,
  tone = 'brand',
}: {
  icon: IconName;
  tone?: 'brand' | 'info' | 'warning';
}) {
  const theme = useTheme();
  const colors = {
    brand: [theme.brand.bg, theme.brand.main],
    info: [theme.info.bg, theme.status.info],
    warning: [theme.warning.bg, theme.status.warning],
  }[tone];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 40,
        height: 40,
        borderRadius: radius.tile,
        backgroundColor: colors[0],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={20} color={colors[1]} />
    </View>
  );
}

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

export function CompactAvatar({ name, small = false }: { name: string; small?: boolean }) {
  const theme = useTheme();
  const size = small ? 26 : 32;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: small ? 9 : 11,
        backgroundColor: theme.brand.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <CompactText
        variant="caption"
        tone="brand"
        weight="semibold"
        style={{ fontSize: small ? 10.5 : 12 }}
      >
        {initials(name)}
      </CompactText>
    </View>
  );
}

/**
 * A compact row: leading icon or avatar, a one-line title and meta, and a trailing value.
 * Pressable rows need an accessibility label that states everything the row shows.
 */
export function ListRow({
  leading,
  title,
  meta,
  metaTone = 'secondary',
  trailing,
  onPress,
  accessibilityLabel,
  highlighted = false,
}: {
  leading?: ReactNode;
  title: string;
  meta?: string;
  metaTone?: TextTone;
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  highlighted?: boolean;
}) {
  const theme = useTheme();
  const content = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <CompactText weight="semibold" numberOfLines={1}>
          {title}
        </CompactText>
        {meta ? (
          <CompactText variant="caption" tone={metaTone} numberOfLines={1}>
            {meta}
          </CompactText>
        ) : null}
      </View>
      {trailing ? <View style={{ alignItems: 'flex-end', gap: 1 }}>{trailing}</View> : null}
    </>
  );
  const style = {
    minHeight: 60,
    paddingVertical: 8,
    paddingHorizontal: 14,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: highlighted ? theme.brand.bg : undefined,
  };
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, meta].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [style, pressed && { backgroundColor: theme.surfaceMuted }]}
    >
      {content}
    </Pressable>
  );
}

/** A trailing amount with a caption beneath, for list rows. */
export function RowAmount({
  amount,
  caption,
  tone = 'primary',
  captionTone = 'secondary',
}: {
  amount?: string;
  caption?: string;
  tone?: TextTone;
  captionTone?: TextTone;
}) {
  return (
    <>
      {amount ? <Money tone={tone}>{amount}</Money> : null}
      {caption ? (
        <CompactText variant="caption" tone={captionTone} numberOfLines={1}>
          {caption}
        </CompactText>
      ) : null}
    </>
  );
}

export function Skeleton({
  width,
  height = 14,
  rounded = 6,
}: {
  width: DimensionValue;
  height?: number;
  rounded?: number;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: rounded, backgroundColor: theme.surfaceMuted }}
    />
  );
}

/** One thin indeterminate bar under the top bar: the single progress cue for a screen. */
export function LinearProgress({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={{ height: 3, backgroundColor: theme.brand.bg, overflow: 'hidden' }}
    >
      <View
        style={{
          position: 'absolute',
          left: '22%',
          width: '36%',
          top: 0,
          bottom: 0,
          backgroundColor: theme.brand.main,
        }}
      />
    </View>
  );
}

/** Selector tiles two per row; one per row at large text so labels and values never clip. */
export function TileGrid({ children }: { children: ReactNode }) {
  const large = useLargeText();
  const items = Children.toArray(children);
  const rows = large
    ? items.map((item) => [item])
    : items.reduce<ReactNode[][]>((acc, item, index) => {
        if (index % 2 === 0) acc.push([item]);
        else acc[acc.length - 1].push(item);
        return acc;
      }, []);
  return (
    <View style={{ gap: space.gap }}>
      {rows.map((row, index) => (
        <View key={index} style={{ flexDirection: 'row', gap: space.gap }}>
          {row.map((item, column) => (
            <View key={column} style={{ flex: 1, minWidth: 0 }}>
              {item}
            </View>
          ))}
          {!large && row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

export interface SummaryStat {
  label: string;
  value: string;
  tone?: TextTone;
}

/** Three stats side by side; at large text each stat becomes a label-and-value row. */
export function SummaryStats({ stats }: { stats: SummaryStat[] }) {
  const large = useLargeText();
  return (
    <View
      style={{
        flexDirection: large ? 'column' : 'row',
        gap: large ? 6 : space.gap,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      {stats.map((stat) => (
        <View
          key={stat.label}
          accessible
          accessibilityLabel={`${stat.label}: ${stat.value}`}
          style={
            large
              ? {
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: space.gap,
                }
              : { flex: 1, minWidth: 0, gap: 2 }
          }
        >
          <CompactText variant="caption" tone="secondary">
            {stat.label}
          </CompactText>
          <Money tone={stat.tone}>{stat.value}</Money>
        </View>
      ))}
    </View>
  );
}
