import { ActivityIndicator, View } from 'react-native';
import type { NotificationControls } from '../data/notification-controls';
import {
  Banner,
  Card,
  CompactButton,
  CompactText,
  Divider,
  IconTile,
  ListRow,
  SectionHeader,
  Skeleton,
} from './compact';
import { Icon } from './primitives';
import { useTheme } from './theme';

export interface NotificationSettingsProps {
  state: NotificationControls;
  onEnable: () => void;
  onDisable: () => void;
  onCategory: (category: 'expenseUpdates' | 'payments', enabled: boolean) => void;
  onRetry: () => void;
  onAndroidSettings: () => void;
}
export function NotificationSettings({
  state,
  onEnable,
  onDisable,
  onCategory,
  onRetry,
  onAndroidSettings,
}: NotificationSettingsProps) {
  const theme = useTheme();
  const confirmed = state.confirmed;
  const asking = state.status === 'pending' && !confirmed.enabled;
  const confirming = state.status === 'pending' && confirmed.enabled;
  const unavailable = state.status === 'ready' && !confirmed.available;
  const disabled = ['pending', 'offline', 'error'].includes(state.status);
  const problem = {
    blocked: {
      tone: 'warning' as const,
      title: 'Android is blocking notifications',
      message: 'Allow them in Android settings to get these alerts.',
    },
    denied: {
      tone: 'info' as const,
      message: 'Android didn’t allow notifications. Turn them on again when you’re ready.',
    },
    offline: {
      tone: 'offline' as const,
      message: 'Connect to change notification settings. Android settings still work offline.',
    },
    error: {
      tone: 'error' as const,
      message: 'Couldn’t confirm notification settings.',
    },
  };
  const banner = state.status in problem ? problem[state.status as keyof typeof problem] : null;
  return (
    <View style={{ gap: 6 }}>
      <SectionHeader title="Notifications" />
      <Card>
        {state.status === 'loading' ? (
          <View
            accessible
            accessibilityLabel="Loading notification settings…"
            accessibilityState={{ busy: true }}
            style={{
              minHeight: 60,
              paddingVertical: 8,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <Skeleton width={40} height={40} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width="62%" height={14} />
              <Skeleton width="38%" height={10} />
            </View>
            <Skeleton width={40} height={20} rounded={10} />
          </View>
        ) : unavailable ? (
          <ListRow
            leading={<IconTile icon="notifications-off-outline" tone="neutral" />}
            title="Notifications on this phone"
            titleLines={0}
            meta="Not available yet"
            metaLines={0}
          />
        ) : (
          <>
            <ListRow
              leading={<IconTile icon="notifications-outline" />}
              title="Notifications on this phone"
              titleLines={0}
              meta={
                asking
                  ? 'Asking Android…'
                  : state.status === 'blocked'
                    ? 'Blocked by Android'
                    : confirmed.enabled
                      ? 'On for all your Groups'
                      : 'Off'
              }
              metaTone={state.status === 'blocked' ? 'warning' : 'secondary'}
              metaLines={0}
              trailing={
                asking ? (
                  <ActivityIndicator
                    accessibilityLabel="Asking Android…"
                    size="small"
                    color={theme.brand.main}
                  />
                ) : undefined
              }
              trailingSwitch={
                asking
                  ? undefined
                  : {
                      value: confirmed.enabled,
                      disabled,
                      onChange: (value) => (value ? onEnable() : onDisable()),
                    }
              }
            />
            {confirmed.enabled ? (
              <>
                <Divider inset={66} />
                <ListRow
                  leading={<IconTile icon="receipt-outline" />}
                  title="Expense updates"
                  titleLines={0}
                  meta="Expenses you’re part of"
                  metaLines={0}
                  trailingSwitch={{
                    value: confirmed.expenseUpdates,
                    disabled,
                    onChange: (value) => onCategory('expenseUpdates', value),
                  }}
                />
                <Divider inset={66} />
                <ListRow
                  leading={<IconTile icon="swap-horizontal-outline" />}
                  title="Payments"
                  titleLines={0}
                  meta="Payments to or from you"
                  metaLines={0}
                  trailingSwitch={{
                    value: confirmed.payments,
                    disabled,
                    onChange: (value) => onCategory('payments', value),
                  }}
                />
                <Divider fullWidth />
                <ListRow
                  leading={<IconTile icon="settings-outline" tone="neutral" />}
                  title="Android notification settings"
                  titleLines={0}
                  meta="Sound, vibration and lock screen"
                  metaLines={0}
                  trailing={<Icon name="open-outline" size={18} color={theme.textSecondary} />}
                  accessibilityLabel="Android notification settings"
                  onPress={onAndroidSettings}
                />
              </>
            ) : null}
          </>
        )}
      </Card>
      {confirming ? (
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}
        >
          <ActivityIndicator size="small" color={theme.brand.main} />
          <CompactText variant="small" tone="secondary" style={{ flex: 1 }}>
            Confirming notification settings…
          </CompactText>
        </View>
      ) : banner ? (
        <Banner {...banner}>
          {state.status === 'blocked' ? (
            <CompactButton
              label="Open Android settings"
              variant="text"
              dense
              onPress={onAndroidSettings}
            />
          ) : state.status === 'offline' || state.status === 'error' ? (
            <CompactButton label="Try again" variant="text" dense onPress={onRetry} />
          ) : null}
        </Banner>
      ) : !unavailable ? (
        <CompactText variant="small" tone="secondary" style={{ paddingHorizontal: 2 }}>
          Alerts say only that something changed, never who or how much. Other phones keep their own
          settings.
        </CompactText>
      ) : null}
    </View>
  );
}
