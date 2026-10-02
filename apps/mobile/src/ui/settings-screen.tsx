import { ActivityIndicator, Pressable, View } from 'react-native';
import type { SessionUser } from '../data';
import type { AppearanceMode } from '../data/appearance';
import { parseWebOrigin } from '../web-origin';
import { Avatar, Button, Copy, Icon, Label, Panel, type IconName } from './primitives';
import { fonts, useTheme } from './theme';

export type SettingsAppearance = AppearanceMode;

/** What sign-out clears from this device, as both this panel and the sign-out confirmation say. */
export const signOutClears =
  'session, Expense drafts, unresolved payment records and save recovery keys, unsaved Group form, saved invitation, and local account data';
export const signOutInterruptedSave =
  'If a save was interrupted, check your saved history after signing in before creating it again.';

export interface SettingsScreenProps {
  user: SessionUser;
  appearance: SettingsAppearance;
  onAppearanceChange: (value: SettingsAppearance) => void;
  preferenceStatus: 'loading' | 'ready' | 'saving' | 'error';
  preferenceMessage: string | null;
  onRetryPreference: () => void;
  environment: { label: string; apiOrigin: string; webOrigin: string };
  onOpenWeb: () => void;
  onSignOut: () => void;
}

const appearances: Array<{
  value: SettingsAppearance;
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    value: 'system',
    label: 'System',
    description: 'Follow your phone’s appearance.',
    icon: 'phone-portrait-outline',
  },
  { value: 'light', label: 'Light', description: 'A bright, clear space.', icon: 'sunny-outline' },
  {
    value: 'dark',
    label: 'Dark',
    description: 'A softer view in low light.',
    icon: 'moon-outline',
  },
];

/** Content only; the parent screen supplies scrolling and Android Back behavior. */
export function SettingsScreen({
  user,
  appearance,
  onAppearanceChange,
  preferenceStatus,
  preferenceMessage,
  onRetryPreference,
  environment,
  onOpenWeb,
  onSignOut,
}: SettingsScreenProps) {
  const theme = useTheme();
  const preferenceBusy = preferenceStatus === 'loading' || preferenceStatus === 'saving';
  const apiOrigin = parseWebOrigin(environment.apiOrigin)?.origin ?? 'Unavailable';
  const webOrigin = parseWebOrigin(environment.webOrigin)?.origin ?? 'Unavailable';

  return (
    <View style={{ gap: 24 }}>
      <View style={{ gap: 10 }}>
        <Label>YOUR SPLITBOOK</Label>
        <Copy
          accessibilityRole="header"
          style={{ fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 }}
        >
          Settings
        </Copy>
        <Copy style={{ color: theme.textSecondary }}>
          Choose how SplitBook looks and manage your session.
        </Copy>
      </View>

      <Panel>
        <View style={{ gap: 6 }}>
          <Copy
            accessibilityRole="header"
            style={{ fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 }}
          >
            Appearance
          </Copy>
          <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
            Your choice applies throughout the app.
          </Copy>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={{ gap: 10 }}>
          {appearances.map((option) => {
            const selected = option.value === appearance;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityHint={option.description}
                accessibilityState={{ checked: selected, disabled: preferenceBusy }}
                disabled={preferenceBusy}
                onPress={() => onAppearanceChange(option.value)}
                style={({ pressed }) => ({
                  minHeight: 76,
                  padding: 14,
                  borderWidth: 1,
                  borderColor: selected ? theme.brand.main : theme.border,
                  borderRadius: 14,
                  backgroundColor: selected ? theme.brand.bg : theme.surface,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  opacity: preferenceBusy ? 0.6 : pressed ? 0.75 : 1,
                })}
              >
                <Icon
                  name={option.icon}
                  color={selected ? theme.brand.main : theme.textSecondary}
                />
                <View style={{ flex: 1, gap: 3 }}>
                  <Copy style={{ fontFamily: fonts.semibold }}>{option.label}</Copy>
                  <Copy style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 19 }}>
                    {option.description}
                  </Copy>
                </View>
                <Icon
                  name={selected ? 'radio-button-on-outline' : 'radio-button-off-outline'}
                  color={selected ? theme.brand.main : theme.textSecondary}
                  size={21}
                />
              </Pressable>
            );
          })}
        </View>
        {preferenceBusy && (
          <View
            accessibilityLiveRegion="polite"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <ActivityIndicator size="small" color={theme.brand.main} />
            <Copy style={{ flex: 1, color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
              {preferenceStatus === 'loading' ? 'Loading appearance…' : 'Saving appearance…'}
            </Copy>
          </View>
        )}
        {(preferenceMessage || preferenceStatus === 'error') && (
          <Copy
            accessibilityRole={preferenceStatus === 'error' ? 'alert' : undefined}
            accessibilityLiveRegion="polite"
            style={{
              color: preferenceStatus === 'error' ? theme.status.negative : theme.textSecondary,
              fontSize: 14,
              lineHeight: 21,
            }}
          >
            {preferenceMessage ?? 'Your appearance preference couldn’t be confirmed. Try again.'}
          </Copy>
        )}
        {preferenceStatus === 'error' && (
          <Button label="Try again" secondary onPress={onRetryPreference} />
        )}
      </Panel>

      <Panel>
        <Label>ACCOUNT</Label>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
          <Avatar name={user.name} />
          <View style={{ flex: 1, gap: 5 }}>
            <Copy
              accessibilityRole="header"
              style={{ fontFamily: fonts.semibold, fontSize: 21, lineHeight: 28 }}
            >
              {user.name}
            </Copy>
            <Copy selectable style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
              {user.email}
            </Copy>
          </View>
        </View>
      </Panel>

      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Icon name="flask-outline" color={theme.brand.main} size={20} />
          <Label>TEST ENVIRONMENT</Label>
        </View>
        <Copy
          accessibilityRole="header"
          style={{ fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 }}
        >
          {environment.label}
        </Copy>
        <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
          This build uses a non-production ledger. Changes here are for testing.
        </Copy>
        <View style={{ gap: 5 }}>
          <Copy style={{ fontFamily: fonts.medium, fontSize: 14 }}>App connection</Copy>
          <Copy
            selectable
            style={{
              fontFamily: fonts.mono,
              color: theme.textSecondary,
              fontSize: 12,
              lineHeight: 20,
            }}
          >
            {apiOrigin}
          </Copy>
        </View>
        <View style={{ gap: 5 }}>
          <Copy style={{ fontFamily: fonts.medium, fontSize: 14 }}>Web app</Copy>
          <Copy
            selectable
            style={{
              fontFamily: fonts.mono,
              color: theme.textSecondary,
              fontSize: 12,
              lineHeight: 20,
            }}
          >
            {webOrigin}
          </Copy>
        </View>
      </Panel>

      <Panel>
        <View style={{ gap: 8 }}>
          <Copy
            accessibilityRole="header"
            style={{ fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 }}
          >
            More on the web
          </Copy>
          <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
            Manage Group members, Tags, and recurring settings in the connected web app.
          </Copy>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open SplitBook web"
          accessibilityHint="Opens the web app for this test environment"
          onPress={onOpenWeb}
          style={({ pressed }) => ({
            minHeight: 48,
            paddingHorizontal: 16,
            paddingVertical: 13,
            borderRadius: 12,
            backgroundColor: theme.brand.bg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <Copy style={{ flex: 1, fontFamily: fonts.semibold, color: theme.brand.main }}>
            Open SplitBook web
          </Copy>
          <Icon name="open-outline" size={19} color={theme.brand.main} />
        </Pressable>
      </Panel>

      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Icon name="log-out-outline" size={20} />
          <Copy
            accessibilityRole="header"
            style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 }}
          >
            Leaving this device?
          </Copy>
        </View>
        <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
          Sign-out clears your {signOutClears} from this device. Groups already saved remain
          available when you sign in again.
        </Copy>
        <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
          {signOutInterruptedSave}
        </Copy>
        <Button label="Sign out" secondary icon="log-out-outline" onPress={onSignOut} />
      </Panel>
    </View>
  );
}
