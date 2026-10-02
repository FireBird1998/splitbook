import { View } from 'react-native';
import type { LoadStatus } from '../data/types';
import { Badge, CompactText, type TextTone } from './compact';
import { Button, Copy, Icon } from './primitives';
import { refreshedLabel } from './refresh-feedback';
import { useTheme } from './theme';

/**
 * The one quiet cue for a refresh or retry of content that stays on screen, with when that
 * content was saved when known; `checking` marks the saved Home while the session is checked.
 */
export function RefreshStatus({
  visible,
  savedAt = null,
  checking = false,
}: {
  visible: boolean;
  savedAt?: number | null;
  checking?: boolean;
}) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
      <Icon name="sync-outline" size={15} />
      <Copy style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 20, flexShrink: 1 }}>
        {savedAt === null
          ? checking
            ? 'Checking…'
            : 'Refreshing…'
          : `Saved ${refreshedLabel(savedAt)} · ${checking ? 'checking' : 'refreshing'}`}
      </Copy>
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
    <CompactText variant="caption" tone={tone}>
      {refreshing ? `Saved ${time} · refreshing` : `Updated ${time}`}
    </CompactText>
  );
}

/**
 * Explains figures that stay visible but are not current: still being verified
 * after a ledger change, or kept after a refresh failed.
 */
export function RetainedNotice({
  status,
  stale,
  refreshedAt,
  message,
  subject,
  retryLabel,
  onRetry,
}: {
  status: LoadStatus;
  stale: boolean;
  refreshedAt: number | null;
  message: string | null;
  subject: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const time = refreshedLabel(refreshedAt);
  if (status === 'error')
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
  if (!stale) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Icon name="sync-outline" color={theme.textSecondary} />
      <Copy style={{ flex: 1, color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
        Updating {subject}. These figures are from {time} and may change.
      </Copy>
    </View>
  );
}
