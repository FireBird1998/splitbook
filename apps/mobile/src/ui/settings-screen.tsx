import { ActivityIndicator, Pressable, View } from 'react-native';
import type { SessionUser } from '../data';
import type { AppearanceMode } from '../data/appearance';
import { parseWebOrigin } from '../web-origin';
import {
  Banner,
  Card,
  CompactAvatar,
  CompactButton,
  CompactText,
  Divider,
  IconTile,
  SectionHeader,
} from './compact';
import { Icon, type IconName } from './primitives';
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

/** A compact list row's frame, as in ListRow. */
const row = {
  minHeight: 60,
  paddingVertical: 8,
  paddingHorizontal: 14,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
} as const;

/** Content only; the parent screen supplies the top bar, scrolling and Android Back behavior. */
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
  const origin = (label: string, value: string) => (
    <View style={{ paddingVertical: 10, paddingHorizontal: 14, gap: 2 }}>
      <CompactText variant="caption" tone="secondary">
        {label}
      </CompactText>
      <CompactText selectable variant="small" style={{ fontFamily: fonts.mono }}>
        {value}
      </CompactText>
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      <CompactText tone="secondary">
        Choose how SplitBook looks and manage your session.
      </CompactText>

      <View style={{ gap: 6 }}>
        <SectionHeader title="Appearance" />
        <Card>
          <View accessibilityRole="radiogroup" accessibilityLabel="Appearance">
            {appearances.map((option, index) => {
              const selected = option.value === appearance;
              return (
                <View key={option.value}>
                  {index > 0 ? <Divider inset={66} /> : null}
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityHint={option.description}
                    accessibilityState={{ checked: selected, disabled: preferenceBusy }}
                    disabled={preferenceBusy}
                    onPress={() => onAppearanceChange(option.value)}
                    style={({ pressed }) => [
                      row,
                      {
                        backgroundColor: pressed ? theme.surfaceMuted : undefined,
                        opacity: preferenceBusy ? 0.6 : 1,
                      },
                    ]}
                  >
                    <IconTile icon={option.icon} />
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <CompactText weight="semibold">{option.label}</CompactText>
                      <CompactText variant="caption" tone="secondary">
                        {option.description}
                      </CompactText>
                    </View>
                    <Icon
                      name={selected ? 'radio-button-on-outline' : 'radio-button-off-outline'}
                      color={selected ? theme.brand.main : theme.textSecondary}
                    />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </Card>
        <CompactText variant="small" tone="secondary" style={{ paddingHorizontal: 2 }}>
          Your choice applies throughout the app.
        </CompactText>
      </View>
      {preferenceBusy && (
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}
        >
          <ActivityIndicator size="small" color={theme.brand.main} />
          <CompactText variant="small" tone="secondary" style={{ flex: 1 }}>
            {preferenceStatus === 'loading' ? 'Loading appearance…' : 'Saving appearance…'}
          </CompactText>
        </View>
      )}
      {(preferenceMessage || preferenceStatus === 'error') && (
        <Banner
          tone={preferenceStatus === 'error' ? 'error' : 'info'}
          message={
            preferenceMessage ?? 'Your appearance preference couldn’t be confirmed. Try again.'
          }
        >
          {preferenceStatus === 'error' ? (
            <CompactButton label="Try again" variant="text" dense onPress={onRetryPreference} />
          ) : null}
        </Banner>
      )}

      <View style={{ gap: 6 }}>
        <SectionHeader title="Account" />
        <Card>
          <View style={row}>
            <CompactAvatar name={user.name} />
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <CompactText weight="semibold" accessibilityRole="header">
                {user.name}
              </CompactText>
              <CompactText selectable variant="small" tone="secondary">
                {user.email}
              </CompactText>
            </View>
          </View>
        </Card>
      </View>

      <View style={{ gap: 6 }}>
        <SectionHeader title="Test environment" />
        <Card>
          <View style={[row, { alignItems: 'flex-start', paddingVertical: 12 }]}>
            <IconTile icon="flask-outline" />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <CompactText variant="heading" accessibilityRole="header">
                {environment.label}
              </CompactText>
              <CompactText variant="small" tone="secondary">
                This build uses a non-production ledger. Changes here are for testing.
              </CompactText>
            </View>
          </View>
          <Divider />
          {origin('App connection', apiOrigin)}
          <Divider />
          {origin('Web app', webOrigin)}
        </Card>
      </View>

      <View style={{ gap: 6 }}>
        <SectionHeader title="More on the web" />
        <Card padded>
          <View style={{ gap: 10 }}>
            <CompactText variant="small" tone="secondary">
              Manage Group members and Tags in the connected web app.
            </CompactText>
            <CompactButton
              label="Open SplitBook web"
              variant="tonal"
              block
              icon="open-outline"
              hint="Opens the web app for this test environment"
              onPress={onOpenWeb}
            />
          </View>
        </Card>
      </View>

      <Card padded>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="log-out-outline" size={20} />
            <CompactText variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
              Leaving this device?
            </CompactText>
          </View>
          <CompactText variant="small" tone="secondary">
            Sign-out clears your {signOutClears} from this device. Groups already saved remain
            available when you sign in again.
          </CompactText>
          <CompactText variant="small" tone="secondary">
            {signOutInterruptedSave}
          </CompactText>
          <CompactButton
            label="Sign out"
            variant="tonal"
            block
            icon="log-out-outline"
            onPress={onSignOut}
          />
        </View>
      </Card>
    </View>
  );
}
