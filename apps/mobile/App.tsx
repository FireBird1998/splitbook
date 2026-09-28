import { useEffect, useSyncExternalStore } from 'react';
import {
  AppState,
  Appearance,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Share,
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
import { appearance, configurationReady, controller, environment } from './src/runtime';
import { ThemeContext, fonts, useTheme } from './src/ui/theme';
import { Avatar, Button, Copy, Icon, Label, Loading, Notice } from './src/ui/primitives';
import { EmptyGroups, GroupCard, GroupDetail, SignIn, styles } from './src/ui/screens';
import { GroupCreateForm, InvitationPreview, InviteSharePanel } from './src/ui/group-workflows';
import { SettingsScreen } from './src/ui/settings-screen';
import { ExpenseEditor } from './src/ui/expense-editor';
import { GroupFinancialViews, HomeBalances } from './src/ui/financial-views';

export default function App() {
  const preference = useSyncExternalStore(appearance.subscribe, appearance.getSnapshot);
  const systemMode = useColorScheme() === 'dark' ? 'dark' : 'light';
  const mode = preference.mode === 'system' ? systemMode : preference.mode;
  useEffect(() => {
    void appearance.restore();
  }, []);
  useEffect(() => {
    // Apply the device preference to native dialogs as well as React surfaces.
    Appearance.setColorScheme(preference.mode === 'system' ? 'unspecified' : preference.mode);
  }, [preference.mode]);
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
  const preference = useSyncExternalStore(appearance.subscribe, appearance.getSnapshot);
  useEffect(() => {
    if (!configurationReady) return;
    const startup = controller.restore();
    const openLink = (url: string) => {
      // Expo's own development launcher URL is not a Group invitation.
      if (url.includes('://expo-development-client/') || url.startsWith('exp+splitbook:')) return;
      void startup.then(() => controller.openInvitation(url));
    };
    const links = Linking.addEventListener('url', ({ url }) => openLink(url));
    void Linking.getInitialURL().then((url) => {
      if (url) openLink(url);
    });
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void controller.refresh();
    });
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (controller.getSnapshot().screen !== 'groups') {
        controller.back();
        return true;
      }
      return false;
    });
    return () => {
      appState.remove();
      links.remove();
      back.remove();
    };
  }, []);

  const authenticated = state.auth.status === 'authenticated' && state.auth.user !== null;
  const refreshing =
    state.screen === 'groups'
      ? state.groups.status === 'loading' || state.home.status === 'loading'
      : state.screen === 'group' &&
        (state.detail.status === 'loading' ||
          state.financial.expenses.status === 'loading' ||
          state.financial.balances.status === 'loading');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[styles.between, { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          {state.screen !== 'groups' ? (
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
        {authenticated && state.screen !== 'settings' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            accessibilityState={{
              disabled:
                state.creation.status === 'saving' ||
                state.invitation.status === 'joining' ||
                (state.screen === 'expense' &&
                  (state.expense.status === 'saving' || state.expense.persistence !== 'saved')),
            }}
            disabled={
              state.creation.status === 'saving' ||
              state.invitation.status === 'joining' ||
              (state.screen === 'expense' &&
                (state.expense.status === 'saving' || state.expense.persistence !== 'saved'))
            }
            onPress={controller.openSettings}
            style={{
              minHeight: 48,
              minWidth: 48,
              justifyContent: 'center',
              alignItems: 'flex-end',
            }}
          >
            <Icon name="settings-outline" size={23} />
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
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
        ) : state.screen === 'invite' ? (
          <ScrollView contentContainerStyle={styles.content}>
            <InvitationPreview
              preview={state.invitation.preview}
              status={state.invitation.status === 'idle' ? 'loading' : state.invitation.status}
              message={state.invitation.message}
              signedIn={authenticated}
              alreadyMember={state.groups.data.some(
                (group) => group.id === state.invitation.preview?.id,
              )}
              onJoin={() =>
                authenticated ? void controller.joinInvitation() : controller.invitationSignIn()
              }
              onOpenGroup={() => void controller.openInvitationGroup()}
              onRetry={() => void controller.retryInvitation()}
              onCancel={() => void controller.cancelInvitation()}
            />
          </ScrollView>
        ) : !authenticated ? (
          <SignIn
            busy={state.auth.status === 'signing-in'}
            message={
              state.auth.message ??
              (state.invitation.code
                ? 'Your invitation is saved. Sign in to continue, then choose whether to join.'
                : null)
            }
            onSignIn={(id) => void controller.signIn(id)}
          />
        ) : (
          <ScrollView
            key={state.screen === 'group' ? `group:${state.detail.id}` : state.screen}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.content}
            refreshControl={
              ['settings', 'expense'].includes(state.screen) ? undefined : (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void controller.refresh()}
                  tintColor={theme.brand.main}
                  colors={[theme.brand.main]}
                />
              )
            }
          >
            {state.screen === 'settings' ? (
              <SettingsScreen
                user={state.auth.user!}
                appearance={preference.mode}
                onAppearanceChange={(mode) => void appearance.select(mode)}
                preferenceStatus={preference.status}
                preferenceMessage={preference.message}
                onRetryPreference={() => void appearance.restore()}
                environment={environment}
                onOpenWeb={() => {
                  void Linking.openURL(new URL('/settings', environment.webOrigin).href).catch(
                    () => {
                      Alert.alert(
                        'Couldn’t open web settings',
                        'Check your browser and try again.',
                      );
                    },
                  );
                }}
                onSignOut={() =>
                  Alert.alert(
                    'Sign out on this device?',
                    'Your session, expense drafts and save recovery keys, unsaved Group form, saved invitation, and local account data will be cleared. If a save was interrupted, check your saved history after signing in before creating it again.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Sign out',
                        style: 'destructive',
                        onPress: () => void controller.signOut(),
                      },
                    ],
                  )
                }
              />
            ) : state.screen === 'expense' ? (
              <ExpenseEditor
                state={state.expense}
                onEdit={() => void controller.editExpense()}
                onReviewDelete={controller.reviewExpenseDeletion}
                onCancelDelete={controller.cancelExpenseDeletion}
                onDelete={() => void controller.deleteExpense()}
                onReconcile={() => void controller.reconcileExpense()}
                onReviewLatest={() => void controller.reviewLatestExpense()}
                onAcceptCurrent={() =>
                  Alert.alert(
                    'Use the current saved record?',
                    'This discards your local draft after checking the saved record.',
                    [
                      { text: 'Keep draft', style: 'cancel' },
                      {
                        text: 'Use saved record',
                        onPress: () => void controller.acceptCurrentExpense(),
                      },
                    ],
                  )
                }
                onChange={(patch) => void controller.updateExpenseDraft(patch)}
                onSave={() => void controller.saveExpense()}
                onResume={controller.resumeExpenseDraft}
                onRetry={() =>
                  state.expense.groupId &&
                  void controller.openExpense(
                    state.expense.groupId,
                    state.expense.requestedExpenseId ?? undefined,
                  )
                }
                onDiscard={() =>
                  Alert.alert(
                    'Discard this expense draft?',
                    'Your saved entries will be removed from this device.',
                    [
                      { text: 'Keep draft', style: 'cancel' },
                      {
                        text: 'Discard',
                        style: 'destructive',
                        onPress: () => void controller.discardExpenseDraft(),
                      },
                    ],
                  )
                }
              />
            ) : state.screen === 'create' ? (
              <GroupCreateForm
                draft={state.creation.draft}
                onChange={controller.updateCreation}
                onSubmit={() => void controller.createGroup()}
                busy={state.creation.status === 'saving'}
                uncertain={state.creation.status === 'uncertain'}
                message={state.creation.message}
                onCheckGroups={() => void controller.checkCreatedGroups()}
                onDiscard={() =>
                  Alert.alert('Discard this Group form?', 'Your unsaved entries will be cleared.', [
                    { text: 'Keep editing', style: 'cancel' },
                    { text: 'Discard', style: 'destructive', onPress: controller.discardCreation },
                  ])
                }
              />
            ) : state.screen === 'groups' ? (
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
                    Your overview
                  </Copy>
                  <Copy style={{ color: theme.textSecondary }}>
                    Balances and shared spaces, together.
                  </Copy>
                </View>
                <HomeBalances state={state.home} onRefresh={() => void controller.refreshHome()} />
                <Button
                  label={state.creation.draft.name ? 'Continue Group form' : 'Create Group'}
                  icon="add-outline"
                  onPress={controller.startCreate}
                />
                {state.creation.status === 'uncertain' && (
                  <View style={{ gap: 12 }}>
                    <Copy accessibilityRole="alert">{state.creation.message}</Copy>
                    <Button
                      label="Refresh my Groups"
                      secondary
                      onPress={() => void controller.checkCreatedGroups()}
                    />
                    <Button
                      label="I checked — return to my form"
                      secondary
                      disabled={state.groups.status !== 'ready'}
                      onPress={controller.resumeCreationAfterCheck}
                    />
                    <Button
                      label="Discard this form"
                      secondary
                      onPress={controller.discardCreation}
                    />
                  </View>
                )}
                <View style={styles.between}>
                  <Label>YOUR GROUPS</Label>
                  <Copy
                    style={{ fontFamily: fonts.mono, fontSize: 12, color: theme.textSecondary }}
                  >
                    {state.groups.data.length.toString().padStart(2, '0')}
                  </Copy>
                </View>
                {(state.groups.status === 'error' || state.groups.status === 'denied') && (
                  <Notice
                    title="Couldn’t load your Groups"
                    message={
                      state.groups.data.length
                        ? `${state.groups.message ?? 'Please try again.'} Showing previously verified Groups.`
                        : (state.groups.message ?? 'Please try again.')
                    }
                    retry={() => void controller.refresh()}
                  />
                )}
                {state.groups.status === 'loading' && !state.groups.data.length ? (
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
              <>
                <Notice
                  title="Couldn’t open this Group"
                  message={
                    state.detail.data
                      ? `${state.detail.message ?? 'Please try again.'} Showing previously verified Group information.`
                      : (state.detail.message ?? 'Please try again.')
                  }
                  retry={() => void controller.refresh()}
                />
                {state.detail.data && (
                  <GroupDetail group={state.detail.data} currentUserId={state.auth.user!.id} />
                )}
              </>
            ) : state.detail.data ? (
              <>
                <GroupDetail group={state.detail.data} currentUserId={state.auth.user!.id}>
                  <Button
                    label="Add expense"
                    icon="add-outline"
                    onPress={() => void controller.openExpense(state.detail.data!.id)}
                  />
                  {state.expense.status === 'saved' &&
                    state.expense.groupId === state.detail.id && (
                      <Copy accessibilityLiveRegion="polite">
                        {state.expense.message ?? 'Expense saved.'}
                      </Copy>
                    )}
                  <GroupFinancialViews
                    group={state.detail.data}
                    currentUserId={state.auth.user!.id}
                    state={state.financial}
                    onSelectMonth={(month) => void controller.selectMonth(month)}
                    onRefreshExpenses={() => void controller.refreshExpenses()}
                    onRefreshBalances={() => void controller.refreshBalances()}
                    onLoadMore={() => void controller.loadMoreExpenses()}
                    onOpenExpense={(expenseId) =>
                      void controller.openExpense(state.detail.id!, expenseId)
                    }
                  />
                </GroupDetail>
                {state.detail.data.members.length === 1 && (
                  <Copy>Your Group is ready. Invite someone to start sharing it.</Copy>
                )}
                <InviteSharePanel
                  status={state.share.status}
                  url={state.share.url}
                  message={state.share.message}
                  onLoad={() => void controller.loadInviteLink()}
                  onShare={() => {
                    void (async () => {
                      const url = await controller.loadInviteLink();
                      if (!url) return;
                      try {
                        await Share.share({
                          message: `Join our Group on SplitBook: ${url}`,
                          title: 'SplitBook invitation',
                        });
                      } catch {
                        Alert.alert(
                          'Couldn’t open sharing',
                          'Your invitation link is still available. Try again.',
                        );
                      }
                    })();
                  }}
                />
              </>
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
