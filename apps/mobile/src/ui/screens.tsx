import type { ReactNode } from 'react';
import { GoogleSignInButton } from 'react-native-nitro-google-signin';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { deriveTripCodes } from '@splitbook/shared/trip-codes';
import type { MobileGroup } from '../data';
import { Avatar, Button, Copy, Icon, Label, Panel, type IconName } from './primitives';
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
    <ScrollView contentContainerStyle={styles.content}>
      <View style={{ paddingVertical: 28, gap: 14 }}>
        <Label>LESS MATH. MORE LIVING.</Label>
        <Copy
          style={{ fontFamily: fonts.semibold, fontSize: 42, lineHeight: 46, letterSpacing: -1.4 }}
        >
          Good company.{'\n'}Shared expenses.
        </Copy>
        <Copy style={{ color: theme.textSecondary, fontSize: 17, lineHeight: 26 }}>
          A little clarity for everything you share.
        </Copy>
      </View>
      {onGoogleSignIn ? (
        <Panel>
          <Label>INVITED BETA</Label>
          <Copy style={{ fontFamily: fonts.semibold, fontSize: 22 }}>
            Your people. One shared ledger.
          </Copy>
          <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
            Use the Google account invited to SplitBook. If you have a Group invitation, you can
            continue after signing in.
          </Copy>
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
          <Copy style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 18 }}>
            This beta has a separate test ledger. Entries will not move to your live account
            automatically.
          </Copy>
        </Panel>
      ) : (
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="flask-outline" size={18} color={theme.brand.main} />
            <Label>LOCAL DEVELOPMENT</Label>
          </View>
          <Copy style={{ fontFamily: fonts.semibold, fontSize: 22 }}>Choose a test persona</Copy>
          <Copy style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 21 }}>
            Fictional people, connected to the local test ledger.
          </Copy>
          {personas.map((persona) => (
            <Pressable
              key={persona.id}
              accessibilityRole="button"
              accessibilityLabel={`Continue as ${persona.name}`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => onSignIn(persona.id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: 12,
                alignItems: 'center',
                borderTopWidth: 1,
                borderColor: theme.border,
                paddingVertical: 16,
                opacity: busy ? 0.45 : pressed ? 0.65 : 1,
              })}
            >
              <Avatar name={persona.name} />
              <View style={{ flex: 1 }}>
                <Copy style={{ fontFamily: fonts.semibold }}>{persona.name}</Copy>
                <Copy style={{ fontSize: 12, lineHeight: 18, color: theme.textSecondary }}>
                  {persona.detail}
                </Copy>
              </View>
              <Icon name="arrow-forward-outline" color={theme.brand.main} size={20} />
            </Pressable>
          ))}
        </Panel>
      )}
      {message && (
        <Copy
          accessibilityRole="alert"
          style={{ color: theme.status.negative, textAlign: 'center' }}
        >
          {message}
        </Copy>
      )}
      {busy && (
        <Copy
          accessibilityLiveRegion="polite"
          style={{ textAlign: 'center', color: theme.textSecondary }}
        >
          Signing in…
        </Copy>
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

export function GroupDetail({
  group,
  currentUserId,
  children,
}: {
  group: MobileGroup;
  currentUserId: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const descriptor = getGroupTheme(group.category);
  const codes = deriveTripCodes(group.name);
  return (
    <View style={{ gap: 24 }}>
      {descriptor.header === 'strip' ? (
        <LinearGradient
          colors={theme.strip.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 20, overflow: 'hidden' }}
        >
          <View style={{ padding: 24, gap: 20 }}>
            <View style={styles.between}>
              <Label light>YOUR SHARED ADVENTURE</Label>
              <Icon name="airplane" size={21} color={theme.strip.text} />
            </View>
            <Copy
              accessibilityRole="header"
              style={{
                color: theme.strip.text,
                fontFamily: fonts.semibold,
                fontSize: 30,
                lineHeight: 35,
                letterSpacing: -0.7,
              }}
            >
              {group.name}
            </Copy>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
              <Copy style={[styles.routeCode, { color: theme.strip.text }]}>{codes.from}</Copy>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.strip.muted }} />
              <Icon name="airplane-outline" color={theme.strip.text} size={21} />
              <View style={{ flex: 1, height: 1, backgroundColor: theme.strip.muted }} />
              <Copy style={[styles.routeCode, { color: theme.strip.text }]}>{codes.to}</Copy>
            </View>
            <Label light>GROUP CODE · {descriptor.label.toUpperCase()}</Label>
          </View>
          <View
            style={[
              styles.between,
              {
                borderTopWidth: 1,
                borderStyle: 'dashed',
                borderColor: theme.strip.muted,
                backgroundColor: theme.strip.stub,
                padding: 20,
              },
            ]}
          >
            <Copy style={{ color: theme.strip.text, fontSize: 14 }}>{dateRange(group)}</Copy>
            <Copy style={{ color: theme.strip.text, fontFamily: fonts.mono, fontSize: 12 }}>
              {group.members.length} {group.members.length === 1 ? 'MEMBER' : 'MEMBERS'}
            </Copy>
          </View>
        </LinearGradient>
      ) : (
        <View style={{ gap: 14, paddingVertical: 8 }}>
          <View
            style={{
              width: 56,
              height: 56,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 18,
              backgroundColor: theme.brand.bg,
            }}
          >
            <Icon name={themeIcons[descriptor.id]} size={27} color={theme.brand.main} />
          </View>
          <Label>{descriptor.label.toUpperCase()}</Label>
          <Copy
            accessibilityRole="header"
            style={{
              fontFamily: fonts.semibold,
              fontSize: 34,
              lineHeight: 40,
              letterSpacing: -0.9,
            }}
          >
            {group.name}
          </Copy>
          <Copy style={{ color: theme.textSecondary }}>
            {group.description ||
              (descriptor.id === 'home'
                ? 'A shared home. A little more clarity.'
                : descriptor.tagline)}
          </Copy>
        </View>
      )}
      {descriptor.header === 'strip' && group.description ? (
        <Copy style={{ color: theme.textSecondary }}>{group.description}</Copy>
      ) : null}
      {children}
      <Panel>
        <View style={styles.between}>
          <Copy style={{ color: theme.textSecondary }}>Default currency</Copy>
          <Copy style={{ fontFamily: fonts.mono }}>{group.defaultCurrency}</Copy>
        </View>
      </Panel>
      <View style={{ gap: 12 }}>
        <View style={styles.between}>
          <Copy style={{ fontFamily: fonts.semibold, fontSize: 22 }}>The people</Copy>
          <Copy style={{ fontSize: 13, color: theme.textSecondary }}>
            {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
          </Copy>
        </View>
        <Panel>
          {group.members.map((member, index) => (
            <View
              key={member.user.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingTop: index ? 16 : 0,
                borderTopWidth: index ? 1 : 0,
                borderColor: theme.border,
              }}
            >
              <Avatar name={member.user.name} />
              <View style={{ flex: 1 }}>
                <Copy style={{ fontFamily: fonts.medium }}>
                  {member.user.name}
                  {member.user.id === currentUserId ? ' · You' : ''}
                </Copy>
                <Copy style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 19 }}>
                  {member.role === 'admin' ? 'Group admin' : 'Member'}
                </Copy>
              </View>
              {member.role === 'admin' && (
                <Icon name="shield-checkmark-outline" size={18} color={theme.brand.main} />
              )}
            </View>
          ))}
        </Panel>
      </View>
    </View>
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
  routeCode: { fontFamily: fonts.mono, fontSize: 27, lineHeight: 36, letterSpacing: 2 },
});
