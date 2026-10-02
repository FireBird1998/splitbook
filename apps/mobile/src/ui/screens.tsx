import { GoogleSignInButton } from 'react-native-nitro-google-signin';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { MobileGroup } from '../data';
import {
  Banner,
  Card,
  CompactAvatar,
  CompactText,
  Divider,
  IconTile,
  SectionHeader,
} from './compact';
import { Button, Copy, Icon, Panel, type IconName } from './primitives';
import { fonts, useTheme } from './theme';

const themeIcons: Record<string, IconName> = {
  trip: 'airplane-outline',
  home: 'home-outline',
  couple: 'heart-outline',
  work: 'briefcase-outline',
  other: 'layers-outline',
};

function dateRange(group: MobileGroup) {
  if (!group.startDate) return 'Dates to be decided';
  const format = (date: Date) =>
    date.toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return group.endDate
    ? `${format(group.startDate)} – ${format(group.endDate)}`
    : format(group.startDate);
}

export function SignIn({
  busy,
  message,
  onSignIn,
  onGoogleSignIn,
}: {
  busy: boolean;
  message: string | null;
  onSignIn: (id: string) => void;
  onGoogleSignIn?: () => void;
}) {
  const theme = useTheme();
  const personas = [
    { id: 'alex', name: 'Alex Rivera', detail: 'Organizes the shared adventures' },
    { id: 'sam', name: 'Sam Chen', detail: 'Keeps the household in order' },
    { id: 'priya', name: 'Priya Shah', detail: 'Always up for the next trip' },
  ];
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 }}
    >
      <View style={{ paddingVertical: 12, gap: 6 }}>
        <CompactText variant="overline">Less math. More living.</CompactText>
        <CompactText variant="title">Good company.{'\n'}Shared expenses.</CompactText>
        <CompactText tone="secondary">A little clarity for everything you share.</CompactText>
      </View>
      {onGoogleSignIn ? (
        <View style={{ gap: 6 }}>
          <SectionHeader title="Invited beta" />
          <Card padded>
            <View style={{ gap: 10 }}>
              <View style={{ gap: 2 }}>
                <CompactText variant="heading">Your people. One shared ledger.</CompactText>
                <CompactText variant="small" tone="secondary">
                  Use the Google account invited to SplitBook. If you have a Group invitation, you
                  can continue after signing in.
                </CompactText>
              </View>
              <GoogleSignInButton
                signInBehavior="none"
                colorScheme={theme.mode}
                size="wide"
                style={{ width: '100%', height: 48 }}
                accessibilityRole="button"
                accessibilityLabel="Sign in with Google"
                accessibilityState={{ disabled: busy, busy }}
                onPress={onGoogleSignIn}
                disabled={busy}
              />
              <CompactText variant="caption" tone="secondary">
                This beta has a separate test ledger. Entries will not move to your live account
                automatically.
              </CompactText>
            </View>
          </Card>
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <SectionHeader title="Local development" />
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 }}>
              <IconTile icon="flask-outline" />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <CompactText variant="heading">Choose a test persona</CompactText>
                <CompactText variant="small" tone="secondary">
                  Fictional people, connected to the local test ledger.
                </CompactText>
              </View>
            </View>
            {personas.map((persona) => (
              <View key={persona.id}>
                <Divider />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Continue as ${persona.name}`}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => onSignIn(persona.id)}
                  style={({ pressed }) => ({
                    minHeight: 60,
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    backgroundColor: pressed ? theme.surfaceMuted : undefined,
                    opacity: busy ? 0.45 : 1,
                  })}
                >
                  <CompactAvatar name={persona.name} />
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <CompactText weight="semibold">{persona.name}</CompactText>
                    <CompactText variant="caption" tone="secondary">
                      {persona.detail}
                    </CompactText>
                  </View>
                  <Icon name="arrow-forward-outline" color={theme.brand.main} size={20} />
                </Pressable>
              </View>
            ))}
          </Card>
        </View>
      )}
      {message && <Banner tone="error" message={message} />}
      {busy && (
        <CompactText
          variant="small"
          tone="secondary"
          accessibilityLiveRegion="polite"
          style={{ textAlign: 'center' }}
        >
          Signing in…
        </CompactText>
      )}
    </ScrollView>
  );
}

export function GroupCard({ group, onPress }: { group: MobileGroup; onPress: () => void }) {
  const theme = useTheme();
  const descriptor = getGroupTheme(group.category);
  const trip = descriptor.header === 'strip';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${group.name}, ${descriptor.label}, ${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}`}
      style={({ pressed }) => ({
        borderRadius: 18,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{ padding: 20, gap: 18, backgroundColor: trip ? theme.brand.main : theme.surface }}
      >
        <View style={styles.between}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon
              name={themeIcons[descriptor.id]}
              size={18}
              color={trip ? theme.brand.contrastText : theme.brand.main}
            />
            <Copy
              style={{
                fontFamily: fonts.medium,
                fontSize: 12,
                letterSpacing: 0.7,
                color: trip ? theme.brand.contrastText : theme.textSecondary,
              }}
            >
              {descriptor.label.toUpperCase()}
            </Copy>
          </View>
          <Icon
            name="arrow-forward-outline"
            color={trip ? theme.brand.contrastText : theme.textSecondary}
            size={20}
          />
        </View>
        <Copy
          style={{
            fontFamily: fonts.semibold,
            fontSize: 25,
            lineHeight: 30,
            letterSpacing: -0.5,
            color: trip ? theme.brand.contrastText : theme.text,
          }}
        >
          {group.name}
        </Copy>
        <Copy
          style={{
            fontSize: 13,
            lineHeight: 19,
            color: trip ? theme.brand.contrastText : theme.textSecondary,
          }}
        >
          {trip
            ? dateRange(group)
            : descriptor.id === 'home'
              ? 'Everyday costs, shared simply'
              : 'Your shared space'}
        </Copy>
      </View>
      <View
        style={[
          styles.between,
          {
            paddingHorizontal: 20,
            paddingVertical: 16,
            borderTopWidth: trip ? 0 : 1,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Icon name="people-outline" size={18} />
          <Copy style={{ fontSize: 14, color: theme.textSecondary }}>
            {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
          </Copy>
        </View>
        <Copy style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.textSecondary }}>
          {group.defaultCurrency}
        </Copy>
      </View>
    </Pressable>
  );
}

export function EmptyGroups({ onRefresh }: { onRefresh: () => void }) {
  const theme = useTheme();
  return (
    <Panel>
      <Icon name="people-outline" size={32} color={theme.brand.main} />
      <Copy style={{ fontFamily: fonts.semibold, fontSize: 24, lineHeight: 30 }}>
        A shared space starts here.
      </Copy>
      <Copy style={{ color: theme.textSecondary }}>
        You haven’t joined any Groups yet. Create a Group or open an invitation to get started.
      </Copy>
      <Button label="Refresh Groups" secondary onPress={onRefresh} icon="refresh-outline" />
    </Panel>
  );
}

export const styles = StyleSheet.create({
  content: { padding: 24, paddingBottom: 40, gap: 20 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
