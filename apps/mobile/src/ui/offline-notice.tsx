import { View } from 'react-native';
import type { MobileSnapshot } from '../data/types';
import { Banner, Card, CompactButton, CompactText } from './compact';
import { Icon } from './primitives';
import { refreshedLabel } from './refresh-feedback';
import { useTheme } from './theme';

/** Why saving, deleting an Expense or creating a Group waits while offline. */
export const savingNeedsConnection = 'Saving needs a connection.';

/**
 * The screen's one offline banner: what's shown was saved on this device, and when. Each write
 * says why it's unavailable where it is. `onRetry` is for screens without pull-to-refresh.
 * Without `savedShown`, nothing on screen is this device's saved copy: it says only that the app
 * is offline (#332).
 */
export function OfflineNotice({
  state,
  onRetry,
  savedShown = true,
}: {
  state: MobileSnapshot['offline'];
  onRetry?: () => void;
  savedShown?: boolean;
}) {
  if (!state.active && !state.message) return null;
  return (
    <>
      {state.active ? (
        <Banner
          tone="offline"
          title="You’re offline"
          message={
            savedShown
              ? `What’s shown was saved on this device${state.refreshedAt === null ? '' : ` at ${refreshedLabel(state.refreshedAt)}`} and may have changed since.`
              : 'Connect to load the latest.'
          }
        >
          {onRetry ? (
            <CompactButton label="Try again" variant="text" dense onPress={onRetry} />
          ) : null}
        </Banner>
      ) : null}
      {state.message ? <Banner tone="warning" message={state.message} /> : null}
    </>
  );
}

/**
 * In place of a view this device has no saved copy of while offline: a compact message with
 * Try again. The rest of the screen, such as a Group's navigation, stays. A `compact` one sits
 * in a destination below saved content, starting at the left, so a floating action clears it;
 * the full one stands alone, as for a Group never opened here.
 */
export function NotAvailableOffline({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  const theme = useTheme();
  const icon = (
    <View
      style={{
        width: compact ? 40 : 56,
        height: compact ? 40 : 56,
        borderRadius: compact ? 12 : 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.surfaceMuted,
      }}
    >
      <Icon name="cloud-offline-outline" size={compact ? 20 : 26} />
    </View>
  );
  if (compact)
    return (
      <Card padded>
        <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 12 }}>
          {icon}
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <CompactText variant="heading" accessibilityRole="header">
              Not available offline
            </CompactText>
            <CompactText variant="small" tone="secondary">
              {message}
            </CompactText>
            <View style={{ marginTop: 6 }}>
              <CompactButton label="Try again" variant="tonal" dense onPress={onRetry} />
            </View>
          </View>
        </View>
      </Card>
    );
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 32 }}
    >
      {icon}
      <CompactText variant="heading" accessibilityRole="header" style={{ textAlign: 'center' }}>
        Not available offline
      </CompactText>
      <CompactText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
        {message}
      </CompactText>
      <View style={{ alignSelf: 'center' }}>
        <CompactButton label="Try again" onPress={onRetry} />
      </View>
    </View>
  );
}
