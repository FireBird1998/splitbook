import { View } from 'react-native';
import type { MobileSnapshot } from '../data/types';
import { Banner, CompactButton, CompactText } from './compact';
import { Icon } from './primitives';
import { refreshedLabel } from './refresh-feedback';
import { useTheme } from './theme';

/**
 * The screen's one offline banner: what's shown was saved on this device, and when. Each write
 * says why it's unavailable where it is. `onRetry` is for screens without pull-to-refresh.
 */
export function OfflineNotice({
  state,
  onRetry,
}: {
  state: MobileSnapshot['offline'];
  onRetry?: () => void;
}) {
  if (!state.active && !state.message) return null;
  return (
    <>
      {state.active ? (
        <Banner
          tone="offline"
          title="You’re offline"
          message={`What’s shown was saved on this device${state.refreshedAt === null ? '' : ` at ${refreshedLabel(state.refreshedAt)}`} and may have changed since.`}
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
 * Try again. The rest of the screen, such as a Group's navigation, stays.
 */
export function NotAvailableOffline({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 32 }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.surfaceMuted,
        }}
      >
        <Icon name="cloud-offline-outline" size={26} />
      </View>
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
