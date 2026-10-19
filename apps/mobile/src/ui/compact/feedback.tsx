import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Icon, type IconName } from '../primitives';
import { radius, touch } from './scale';
import { CompactText } from './text';

export type BannerTone = 'info' | 'warning' | 'error' | 'offline';

const bannerIcons: Record<BannerTone, IconName> = {
  info: 'information-circle-outline',
  warning: 'alert-circle-outline',
  error: 'alert-circle-outline',
  offline: 'cloud-offline-outline',
};

/**
 * A compact message in context. Info marks an ordinary draft; warning marks a save that may
 * already be recorded or a conflict; error lists corrections; offline marks saved figures.
 * The headline (the title, or the message when there is none) uses the tone's status
 * foreground; the explanation under a title stays secondary so inline links stand out.
 * Warning and error interrupt screen readers; info and offline are announced politely.
 */
export function Banner({
  tone,
  title,
  message,
  standing = false,
  heading = false,
  trailing,
  children,
}: {
  tone: BannerTone;
  title?: string;
  /** The title heads what follows, such as a duplicate's details: read as a heading. */
  heading?: boolean;
  message: string;
  /** A notice that stays on the screen, e.g. an unconfirmed payment: announced politely. */
  standing?: boolean;
  /** Beside the title, such as a draft's amount. */
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const colors = {
    info: [theme.info.bg, theme.status.info],
    warning: [theme.warning.bg, theme.status.warning],
    error: [theme.negative.bg, theme.status.negative],
    offline: [theme.surfaceMuted, theme.textSecondary],
  }[tone];
  const urgent = !standing && (tone === 'warning' || tone === 'error');
  return (
    <View
      accessibilityRole={urgent ? 'alert' : 'summary'}
      accessibilityLiveRegion={urgent ? 'assertive' : 'polite'}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: radius.tile,
        backgroundColor: colors[0],
      }}
    >
      <Icon name={bannerIcons[tone]} size={20} color={colors[1]} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <CompactText
              variant="small"
              weight="semibold"
              accessibilityRole={heading ? 'header' : undefined}
              style={{ flex: 1, color: colors[1] }}
            >
              {title}
            </CompactText>
            {trailing}
          </View>
        ) : null}
        <CompactText
          variant="small"
          tone="secondary"
          style={title ? undefined : { color: colors[1] }}
        >
          {message}
        </CompactText>
        {children ? (
          // Its actions go onto a second line where large text leaves no room beside each other,
          // as "Resume draft" and "Discard draft" do at 130% on a 360dp phone (#664).
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, marginLeft: -4 }}
          >
            {children}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export type BadgeTone = 'positive' | 'negative' | 'warning' | 'neutral';

/** A short status pill such as "Adds up", "Not confirmed" or "Saved 10:42". */
export function Badge({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
}) {
  const theme = useTheme();
  const colors = {
    positive: [theme.positive.bg, theme.status.positive],
    negative: [theme.negative.bg, theme.status.negative],
    warning: [theme.warning.bg, theme.status.warning],
    neutral: [theme.surfaceMuted, theme.textSecondary],
  }[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingVertical: 3,
        paddingLeft: icon ? 6 : 8,
        paddingRight: 8,
        backgroundColor: colors[0],
      }}
    >
      {icon ? <Icon name={icon} size={16} color={colors[1]} /> : null}
      <CompactText variant="caption" weight="semibold" spare style={{ color: colors[1] }}>
        {label}
      </CompactText>
    </View>
  );
}

/**
 * A transient confirmation in inverse colours, e.g. "Expense saved" or "Saved to August" with
 * "View". Placed above the bottom navigation; the floating action moves above it.
 */
export function Snackbar({
  message,
  action,
  bottom = 92,
}: {
  message: string;
  action?: { label: string; onPress: () => void };
  bottom?: number;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom,
        minHeight: 48,
        borderRadius: radius.tile,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        paddingLeft: 16,
        paddingRight: 6,
        backgroundColor: theme.text,
        elevation: 6,
      }}
    >
      <CompactText variant="small" tone="inverse" style={{ flex: 1, fontSize: 14 }}>
        {message}
      </CompactText>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={{ minHeight: touch.min, paddingHorizontal: 12, justifyContent: 'center' }}
        >
          <CompactText weight="semibold" spare style={{ color: theme.brand.bg, fontSize: 14 }}>
            {action.label}
          </CompactText>
        </Pressable>
      ) : null}
    </View>
  );
}
