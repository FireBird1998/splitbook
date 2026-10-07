import { GoogleSignInButton } from 'react-native-nitro-google-signin';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  Banner,
  BusyMark,
  Card,
  CompactAvatar,
  CompactText,
  Divider,
  IconTile,
  SectionHeader,
} from './compact';
import type { PersonaId, SignInOption } from '../data/types';
import { Icon } from './primitives';
import { useTheme } from './theme';

const personas: { id: PersonaId; name: string; detail: string }[] = [
  { id: 'alex', name: 'Alex Rivera', detail: 'Organizes the shared adventures' },
  { id: 'sam', name: 'Sam Chen', detail: 'Keeps the household in order' },
  { id: 'priya', name: 'Priya Shah', detail: 'Always up for the next trip' },
];

/**
 * The sign-in options: Google for the invited beta, or a test persona in development. While
 * `busy`, every option is disabled, and the one signing in (`option`) shows #331's busy mark,
 * says so to screen readers, and keeps its size (#335). A persona's row stays at full strength
 * while the others are dimmed. Google's own button dims itself to 55% when disabled
 * (react-native-nitro-google-signin), so there only the busy mark stays at full strength.
 */
export function SignIn({
  busy,
  option,
  message,
  onSignIn,
  onGoogleSignIn,
}: {
  busy: boolean;
  /** While busy: the option signing in. Ignored otherwise. */
  option?: SignInOption;
  message: string | null;
  onSignIn: (id: PersonaId) => void;
  onGoogleSignIn?: () => void;
}) {
  const theme = useTheme();
  const chosen = busy ? option : undefined;
  const persona = personas.find(({ id }) => id === chosen);
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
              <View>
                <GoogleSignInButton
                  signInBehavior="none"
                  colorScheme={theme.mode}
                  size="wide"
                  style={{ width: '100%', height: 48 }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    chosen === 'google' ? 'Signing in with Google' : 'Sign in with Google'
                  }
                  accessibilityState={
                    chosen === 'google' ? { disabled: true, busy: true } : { disabled: busy }
                  }
                  onPress={onGoogleSignIn}
                  disabled={busy}
                />
                {/* Google's own button keeps its size and label; the busy mark sits at its end. */}
                {chosen === 'google' ? (
                  <View
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      right: 14,
                      justifyContent: 'center',
                    }}
                  >
                    <BusyMark color={theme.brand.main} />
                  </View>
                ) : null}
              </View>
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
            {personas.map(({ id, name, detail }) => (
              <View key={id}>
                <Divider />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    id === chosen ? `Signing in as ${name}` : `Continue as ${name}`
                  }
                  accessibilityState={
                    id === chosen ? { disabled: true, busy: true } : { disabled: busy }
                  }
                  disabled={busy}
                  onPress={() => onSignIn(id)}
                  style={({ pressed }) => ({
                    minHeight: 60,
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    backgroundColor: pressed ? theme.surfaceMuted : undefined,
                    opacity: busy && id !== chosen ? 0.45 : 1,
                  })}
                >
                  <CompactAvatar name={name} />
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <CompactText weight="semibold">{name}</CompactText>
                    <CompactText variant="caption" tone="secondary">
                      {detail}
                    </CompactText>
                  </View>
                  {/* One width for the arrow and the busy mark in its place, so nothing moves. */}
                  <View style={{ width: 20, alignItems: 'center' }}>
                    {id === chosen ? (
                      <BusyMark color={theme.brand.main} />
                    ) : (
                      <Icon name="arrow-forward-outline" color={theme.brand.main} size={20} />
                    )}
                  </View>
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
          {persona
            ? `Signing in as ${persona.name}…`
            : chosen === 'google'
              ? 'Signing in with Google…'
              : 'Signing in…'}
        </CompactText>
      )}
    </ScrollView>
  );
}

export const styles = StyleSheet.create({
  content: { padding: 24, paddingBottom: 40, gap: 20 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
