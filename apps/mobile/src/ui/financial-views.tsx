import { View } from 'react-native';
import type { LoadStatus } from '../data/types';
import { Badge, StatusText, useLargeText, type TextTone } from './compact';
import { Button, Copy, Icon } from './primitives';
import { refreshedLabel } from './refresh-feedback';
import { useTheme } from './theme';

/**
 * The one quiet cue for a refresh or retry of content that stays on screen; `checking` marks
 * the saved Home while the session is checked. It gives no time: what is shown says when it
 * was read, "Saved" only for this device's copy, so a top bar never calls an answer from this
 * session "Saved".
 *
 * It stays on one line (#332). At large text its words say it alone, without the icon: on a
 * 360dp phone at 130% the icon left "Refreshing…" 6dp short, and it wrapped. Wherever it still
 * doesn't fit, it shrinks to fit rather than wrap or lose a word.
 */
export function RefreshStatus({
  visible,
  checking = false,
}: {
  visible: boolean;
  checking?: boolean;
}) {
  const large = useLargeText();
  if (!visible) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
      {large ? null : <Icon name="sync-outline" size={15} />}
      <StatusText
        shrink
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ fontSize: 13, lineHeight: 20 }}
      >
        {checking ? 'Checking…' : 'Refreshing…'}
      </StatusText>
    </View>
  );
}

/**
 * A view's own freshness slot: "Updated hh:mm", "Saved hh:mm · refreshing" while it is read
 * again, or a "Saved hh:mm" badge when its figures come from this device offline.
 */
export function Freshness({
  refreshedAt,
  refreshing = false,
  offline = false,
  tone = 'secondary',
}: {
  refreshedAt: number | null;
  refreshing?: boolean;
  offline?: boolean;
  tone?: TextTone;
}) {
  if (refreshedAt === null) return null;
  const time = refreshedLabel(refreshedAt);
  if (offline) return <Badge label={`Saved ${time}`} />;
  return (
    <StatusText tone={tone}>
      {refreshing ? `Saved ${time} · refreshing` : `Updated ${time}`}
    </StatusText>
  );
}

/**
 * A Group whose details couldn't be read, though its Expenses were, in this open (owner decision
 * 2A, #219): it says what failed and what is current, with a retry. Nothing is out of date, so it
 * shows no time, and the failure isn't the connection's.
 */
export function DetailsNotice({
  subject,
  balances,
  onRetry,
}: {
  subject: string;
  /** Balances were read too, after the Expenses. */
  balances: boolean;
  onRetry: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Icon name="alert-circle-outline" color={theme.status.negative} />
        {/* Its words change in place once Balances are read: they fade, as a status does. */}
        <StatusText
          shrink
          variant="body"
          tone="negative"
          accessibilityRole="alert"
          style={{ fontSize: 16, lineHeight: 24 }}
        >
          {`Couldn’t load ${subject}’s details. ${
            balances
              ? 'Expenses and balances below are up to date.'
              : 'Expenses below are up to date.'
          }`}
        </StatusText>
      </View>
      <Button label="Retry Group" secondary onPress={onRetry} />
    </View>
  );
}

/**
 * Explains figures kept on screen after a refresh failed, with when they were read and a retry.
 * Figures read again after a ledger change say nothing here: they keep their place and their
 * time, and the screen's one progress cue says they're being read, so nothing moves (#219).
 */
export function RetainedNotice({
  status,
  refreshedAt,
  message,
  subject,
  retryLabel,
  onRetry,
}: {
  status: LoadStatus;
  refreshedAt: number | null;
  message: string | null;
  subject: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const time = refreshedLabel(refreshedAt);
  if (status !== 'error') return null;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Icon name="cloud-offline-outline" color={theme.status.negative} />
        <Copy accessibilityRole="alert" style={{ flex: 1, color: theme.status.negative }}>
          {message ?? `Couldn’t refresh ${subject}.`} Showing {subject} from {time}.
        </Copy>
      </View>
      <Button label={retryLabel} secondary onPress={onRetry} />
    </View>
  );
}
