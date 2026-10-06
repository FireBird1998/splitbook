import { Children, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  View,
  useWindowDimensions,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';
import { Icon, type IconName } from '../primitives';
import { usePulse, useReveal, useSweep, sweepTrack, type Reveal } from './motion';
import { isLargeText, lineBox, radius, space, type LineKind } from './scale';
import { CompactText, Money, type TextTone } from './text';

export const useLargeText = () => isLargeText(useWindowDimensions().fontScale);

/** The height one line of `kind` takes at the current text size; see `lineBox`. */
export const useLineBox = (kind: LineKind) => lineBox(kind, useWindowDimensions().fontScale);

/** Decoration a screen reader skips, such as a skeleton. */
const hiddenFromReaders = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/** The shape of a Card's placeholder rows; see `Card`'s `loading`. */
export interface SkeletonShape {
  /** How many rows; 3 by default. */
  rows?: number;
  /** A 32 avatar leads each row, as in Activity, instead of a 40 tile with an amount after. */
  avatar?: boolean;
  /** A day heading above the rows, as in Expenses and Activity. */
  heading?: boolean;
  /** Dividers between the rows, as in the Groups list. */
  dividers?: boolean;
}

/**
 * A bordered surface. `error` marks invalid content; `locked` marks content that can't change.
 *
 * While `loading` is set, the body is a placeholder announced as busy under that label: the
 * children when given (a skeleton of the content's shape), otherwise skeleton rows shaped by
 * `skeleton`. When `loading` clears, the content fades in where the placeholder was; keep the
 * same Card in place (same position, same type) so it can. A `header` stays still throughout.
 */
export function Card({
  children,
  state = 'default',
  padded = false,
  header,
  loading,
  skeleton,
}: {
  children?: ReactNode;
  state?: 'default' | 'error' | 'locked';
  padded?: boolean;
  header?: ReactNode;
  loading?: string;
  skeleton?: SkeletonShape;
}) {
  const theme = useTheme();
  const reveal = useReveal(loading !== undefined);
  const body =
    loading !== undefined ? (
      <View accessibilityLabel={loading} accessibilityState={{ busy: true }}>
        {children ?? <SkeletonList {...skeleton} />}
      </View>
    ) : (
      children
    );
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
      {header}
      {reveal ? <Animated.View style={{ opacity: reveal }}>{body}</Animated.View> : body}
    </View>
  );
}

/**
 * Content that replaced a placeholder, fading in where it was. Pass `useReveal(loading)` from
 * the component that stays mounted while the placeholder gives way to the content; null leaves
 * the content as it is.
 */
export function FadeIn({
  reveal,
  style,
  children,
}: {
  reveal: Reveal | null;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return reveal ? (
    <Animated.View style={[style, { opacity: reveal }]}>{children}</Animated.View>
  ) : (
    <View style={style}>{children}</View>
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

/** A list row's box, shared with the skeleton rows that stand in for it. */
const listRow = {
  minHeight: 60,
  paddingVertical: 8,
  paddingHorizontal: 14,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 12,
};

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
  const style = { ...listRow, backgroundColor: highlighted ? theme.brand.bg : undefined };
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

/**
 * A placeholder block in the border colour, breathing between half and full strength with
 * every other skeleton on screen (still with reduce motion on). With `line`, it stands for one
 * line of that text: it takes the line's height at the current text size, and draws a bar a
 * little under the font size, so the text takes its place without moving anything.
 */
export function Skeleton({
  width,
  height = 14,
  rounded = 6,
  line,
}: {
  width: DimensionValue;
  height?: number;
  rounded?: number;
  line?: LineKind;
}) {
  const theme = useTheme();
  const opacity = usePulse();
  const { fontScale } = useWindowDimensions();
  const block = (size: number) => ({
    height: size,
    borderRadius: Math.min(rounded, size / 2),
    backgroundColor: theme.border,
    opacity,
  });
  if (!line) return <Animated.View {...hiddenFromReaders} style={{ width, ...block(height) }} />;
  const box = lineBox(line, fontScale);
  return (
    <View {...hiddenFromReaders} style={{ width, height: box.height, justifyContent: 'center' }}>
      <Animated.View style={block(box.bar)} />
    </View>
  );
}

/**
 * Lines of placeholder text, one under another, `gap` apart; see `Skeleton`'s `line`. A line
 * with a `count` stands for a paragraph that wraps onto that many lines: they sit together with
 * no gap, as a wrapped paragraph's lines do, and the last is shorter.
 */
export function SkeletonText({
  lines,
  gap = 0,
  style,
}: {
  lines: { width: DimensionValue; line: LineKind; count?: number }[];
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View {...hiddenFromReaders} style={[{ gap }, style]}>
      {lines.map(({ width, line, count = 1 }, index) =>
        count === 1 ? (
          <Skeleton key={index} width={width} line={line} />
        ) : (
          <View key={index}>
            {Array.from({ length: count }, (_, row) => (
              <Skeleton key={row} width={row === count - 1 ? '55%' : width} line={line} />
            ))}
          </View>
        ),
      )}
    </View>
  );
}

/**
 * A placeholder exactly the size of content whose value is already known, such as a list row's
 * amount on the record it opens: the content is laid out but unseen, so it takes its real
 * width, wraps where it would, and the row around it wraps where it would; a breathing block
 * sits over it. `bar` draws a text's bar, inset from its line's top and bottom, instead of a
 * block over the whole box. Hidden from screen readers.
 */
export function SkeletonOf({
  children,
  bar = false,
  rounded = 6,
  align = 'flex-start',
}: {
  children: ReactNode;
  bar?: boolean;
  rounded?: number;
  /** How it sits across its parent: at the start, as text in a column, or centred in a row. */
  align?: 'flex-start' | 'center';
}) {
  const theme = useTheme();
  const opacity = usePulse();
  return (
    <View {...hiddenFromReaders} style={{ alignSelf: align, maxWidth: '100%' }}>
      <View style={{ opacity: 0 }}>{children}</View>
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: bar ? '18%' : 0,
          bottom: bar ? '18%' : 0,
          borderRadius: rounded,
          backgroundColor: theme.border,
          opacity,
        }}
      />
    </View>
  );
}

/** Rows with a list row's exact box, as `ListRow` and the day headings above them lay out. */
function SkeletonList({
  rows = 3,
  avatar = false,
  heading = false,
  dividers = false,
}: SkeletonShape) {
  return (
    <>
      {heading ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 }}>
          <Skeleton width="28%" line="small" />
        </View>
      ) : null}
      {Array.from({ length: rows }, (_, row) => (
        <View key={row}>
          {dividers && row > 0 ? <Divider inset={66} /> : null}
          <View style={listRow}>
            {avatar ? (
              <Skeleton width={32} height={32} rounded={11} />
            ) : (
              <Skeleton width={40} height={40} rounded={radius.tile} />
            )}
            <View style={{ flex: 1, minWidth: 0, gap: avatar ? 2 : 1 }}>
              <Skeleton width="62%" line="body" />
              <Skeleton width="38%" line="caption" />
            </View>
            {avatar ? null : (
              <View style={{ alignItems: 'flex-end', gap: 1 }}>
                <Skeleton width={64} line="list" />
                <Skeleton width={44} line="caption" />
              </View>
            )}
          </View>
        </View>
      ))}
    </>
  );
}

/**
 * A first load's placeholder list in its own Card: rows with a leading tile (or avatar), two
 * lines and, for tiles, an amount. Announced as busy under `label`. Where the content's Card
 * takes its place, use that Card's `loading` instead, so the content fades in.
 */
export function SkeletonRows({ label, ...shape }: SkeletonShape & { label: string }) {
  return (
    <View accessibilityLabel={label} accessibilityState={{ busy: true }}>
      <Card>
        <SkeletonList {...shape} />
      </Card>
    </View>
  );
}

/**
 * One thin indeterminate bar under the top bar: the single progress cue for a screen. A brand
 * segment, a little over a third of the track, sweeps across it and repeats while the bar is
 * shown; with reduce motion on it rests where the still bar always sat.
 */
export function LinearProgress({ label }: { label: string }) {
  const theme = useTheme();
  const sweep = useSweep();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      onLayout={sweep.onLayout}
      style={{ height: 3, backgroundColor: theme.brand.bg, overflow: 'hidden' }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          width: `${sweepTrack.segment * 100}%`,
          top: 0,
          bottom: 0,
          borderRadius: 1.5,
          backgroundColor: theme.brand.main,
          transform: [{ translateX: sweep.translateX }],
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

/**
 * Three stats side by side; at large text each stat becomes a label-and-value row. While
 * `loading`, three skeleton stats of the same shape stand in (hidden from screen readers, as
 * the screen's own placeholder announces the load); when it clears, the stats fade in. Keep the
 * same SummaryStats in place across the change so they can.
 */
export function SummaryStats({
  stats,
  loading = false,
}: {
  stats: SummaryStat[];
  loading?: boolean;
}) {
  const large = useLargeText();
  const reveal = useReveal(loading);
  const stat = large
    ? {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        alignItems: 'baseline' as const,
        gap: space.gap,
      }
    : { flex: 1, minWidth: 0, gap: 2 };
  const content = (
    <View
      {...(loading ? hiddenFromReaders : {})}
      style={{
        flexDirection: large ? 'column' : 'row',
        gap: large ? 6 : space.gap,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      {loading
        ? [0, 1, 2].map((index) => (
            <View key={index} style={stat}>
              <Skeleton width={large ? '32%' : '60%'} line="caption" />
              <Skeleton width={large ? '28%' : '85%'} line="list" />
            </View>
          ))
        : stats.map((item) => (
            <View
              key={item.label}
              accessible
              accessibilityLabel={`${item.label}: ${item.value}`}
              style={stat}
            >
              <CompactText variant="caption" tone="secondary">
                {item.label}
              </CompactText>
              <Money tone={item.tone}>{item.value}</Money>
            </View>
          ))}
    </View>
  );
  return reveal ? <Animated.View style={{ opacity: reveal }}>{content}</Animated.View> : content;
}
