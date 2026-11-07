import { Switch, View } from 'react-native';
import type { NotificationControls } from '../data/notification-controls';
import { Card, CompactButton, CompactText, SectionHeader } from './compact';

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
  const busy = state.status === 'pending' || state.status === 'loading';
  const confirmed = state.confirmed;
  const failed = ['offline', 'error'].includes(state.status);
  return (
    <View style={{ gap: 6 }}>
      <SectionHeader title="Notifications on this phone" />
      <Card>
        <View style={{ padding: 14, gap: 12 }}>
          <CompactText tone="secondary">
            Choose alerts across your Groups. Other phones keep their own settings.
          </CompactText>
          {!confirmed.available && state.status === 'ready' ? (
            <CompactText tone="secondary">Notifications aren’t available yet.</CompactText>
          ) : confirmed.enabled ? (
            <>
              <CompactText>Notifications are enabled on this phone.</CompactText>
              {(['expenseUpdates', 'payments'] as const).map((category) => (
                <View
                  key={category}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <CompactText>
                    {category === 'expenseUpdates' ? 'Expense updates' : 'Payments'}
                  </CompactText>
                  <Switch
                    accessibilityLabel={
                      category === 'expenseUpdates' ? 'Expense updates' : 'Payments'
                    }
                    value={confirmed[category]}
                    disabled={busy}
                    onValueChange={(value) => onCategory(category, value)}
                  />
                </View>
              ))}
              <CompactButton label="Turn off notifications" disabled={busy} onPress={onDisable} />
            </>
          ) : (
            <CompactButton label="Enable notifications" disabled={busy} onPress={onEnable} />
          )}
          {state.message ? <CompactText tone="secondary">{state.message}</CompactText> : null}
          {failed ? <CompactButton label="Retry notification settings" onPress={onRetry} /> : null}
          {confirmed.enabled || ['denied', 'blocked', 'offline', 'error'].includes(state.status) ? (
            <CompactButton label="Open Android notification settings" onPress={onAndroidSettings} />
          ) : null}
        </View>
      </Card>
    </View>
  );
}
