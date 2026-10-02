import { View } from 'react-native';
import type { LoadStatus } from '../data/types';
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
