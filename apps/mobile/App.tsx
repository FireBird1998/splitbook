import { useEffect, useSyncExternalStore } from 'react';
import {
  AppState,
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Outfit_400Regular } from '@expo-google-fonts/outfit/400Regular';
import { Outfit_500Medium } from '@expo-google-fonts/outfit/500Medium';
import { Outfit_600SemiBold } from '@expo-google-fonts/outfit/600SemiBold';
import { Outfit_700Bold } from '@expo-google-fonts/outfit/700Bold';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { configurationReady, controller } from './src/runtime';
import { ThemeContext, fonts, useTheme } from './src/ui/theme';
import { Avatar, Button, Copy, Icon, Label, Loading, Notice } from './src/ui/primitives';
import { EmptyGroups, GroupCard, GroupDetail, SignIn, styles } from './src/ui/screens';

export default function App() {
  const mode = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    IBMPlexMono_500Medium,
    ...Ionicons.font,
  });
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={getSemanticTokens(mode)}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        {fontsLoaded || fontError ? <SplitBook /> : <Loading label="Opening SplitBook…" />}
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}

function SplitBook() {
  const theme = useTheme();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    if (!configurationReady) return;
    void controller.restore();
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void controller.refresh();
    });
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (controller.getSnapshot().screen === 'group') {
        controller.back();
        return true;
      }
      return false;
    });
    return () => {
      appState.remove();
      back.remove();
    };
  }, []);

  const authenticated = state.auth.status === 'authenticated' && state.auth.user !== null;
  const refreshing = state.groups.status === 'loading' || state.detail.status === 'loading';
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[styles.between, { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          {authenticated && state.screen === 'group' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to Groups"
              onPress={controller.back}
              style={{ minWidth: 48, minHeight: 48, justifyContent: 'center' }}
            >
              <Icon name="arrow-back-outline" color={theme.text} />
            </Pressable>
          ) : (
            <View
              style={{
                backgroundColor: theme.brand.main,
                width: 32,
                height: 36,
                borderRadius: 9,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Copy
                style={{ color: theme.brand.contrastText, fontFamily: fonts.bold, fontSize: 22 }}
              >
                s
              </Copy>
            </View>
          )}
          <Copy style={{ fontFamily: fonts.semibold, fontSize: 23, letterSpacing: -0.6 }}>
            splitbook<Copy style={{ color: theme.brand.main, fontSize: 24 }}>.</Copy>
          </Copy>
        </View>
        {authenticated ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={() => void controller.signOut()}
            style={{
              minHeight: 48,
              minWidth: 48,
              justifyContent: 'center',
              alignItems: 'flex-end',
            }}
          >
            <Icon name="log-out-outline" size={23} />
          </Pressable>
        ) : (
          <View
            style={{
              paddingHorizontal: 9,
              paddingVertical: 5,
              borderRadius: 7,
              backgroundColor: theme.brand.bg,
            }}
          >
            <Label>DEV</Label>
          </View>
        )}
      </View>
      {!configurationReady ? (
        <Notice
          title="Development build"
          icon="build-outline"
          message="Configure the local backend in apps/mobile/.env.local, then restart Metro. Google sign-in arrives with the staging build."
        />
      ) : state.auth.status === 'restoring' ? (
        <Loading label="Checking your session…" />
      ) : state.auth.status === 'error' ? (
        <View style={{ paddingHorizontal: 24 }}>
          <Notice
            title="Couldn’t check your session"
            message={state.auth.message ?? 'Please try again.'}
            retry={() => void controller.restore()}
          />
          <Button
            label="Sign out on this device"
            secondary
            onPress={() => void controller.signOut()}
          />
        </View>
      ) : !authenticated ? (
        <SignIn
          busy={state.auth.status === 'signing-in'}
          message={state.auth.message}
          onSignIn={(id) => void controller.signIn(id)}
        />
      ) : (
        <ScrollView
          key={state.screen === 'group' ? `group:${state.detail.id}` : 'groups'}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void controller.refresh()}
              tintColor={theme.brand.main}
              colors={[theme.brand.main]}
            />
          }
        >
          {state.screen === 'groups' ? (
            <>
              <View style={{ gap: 12, marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <Avatar name={state.auth.user!.name} small />
                  <Copy style={{ fontSize: 14, color: theme.textSecondary }}>
                    Hey, {state.auth.user!.name.split(' ')[0]}
                  </Copy>
                </View>
                <Copy
                  accessibilityRole="header"
                  style={{
                    fontFamily: fonts.semibold,
                    fontSize: 36,
                    lineHeight: 42,
                    letterSpacing: -1,
                  }}
                >
                  Your shared spaces
                </Copy>
                <Copy style={{ color: theme.textSecondary }}>
                  Trips, home, and everything in between.
                </Copy>
              </View>
              <View style={styles.between}>
                <Label>YOUR GROUPS</Label>
                <Copy style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.textSecondary }}>
                  {state.groups.data.length.toString().padStart(2, '0')}
                </Copy>
              </View>
              {state.groups.status === 'error' || state.groups.status === 'denied' ? (
                <Notice
                  title="Couldn’t load your Groups"
                  message={state.groups.message ?? 'Please try again.'}
                  retry={() => void controller.refresh()}
                />
              ) : state.groups.status === 'loading' && !state.groups.data.length ? (
                <Loading label="Finding your Groups…" />
              ) : state.groups.status === 'ready' && !state.groups.data.length ? (
                <EmptyGroups onRefresh={() => void controller.refresh()} />
              ) : (
                state.groups.data.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    onPress={() => void controller.openGroup(group.id)}
                  />
                ))
              )}
            </>
          ) : state.detail.status === 'denied' ? (
            <Notice
              title="This Group isn’t available"
              message={state.detail.message ?? 'You may no longer be a member of this Group.'}
              icon="lock-closed-outline"
              retry={controller.back}
              retryLabel="Back to Groups"
            />
          ) : state.detail.status === 'error' ? (
            <Notice
              title="Couldn’t open this Group"
              message={state.detail.message ?? 'Please try again.'}
              retry={() => void controller.refresh()}
            />
          ) : state.detail.data ? (
            <GroupDetail group={state.detail.data} currentUserId={state.auth.user!.id} />
          ) : (
            <Loading label="Opening your Group…" />
          )}
          <View
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
              paddingTop: 10,
            }}
          >
            <Icon name="flask-outline" size={12} />
            <Copy style={{ color: theme.textSecondary, fontSize: 11, lineHeight: 18 }}>
              LOCAL DEVELOPMENT · FICTIONAL DATA
            </Copy>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
