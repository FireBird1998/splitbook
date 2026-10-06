import { NotAvailableOffline, OfflineNotice } from './src/ui/offline-notice';
import { useCallback, useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
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
import {
  appearance,
  configurationReady,
  controller,
  environment,
  googleSignInEnabled,
} from './src/runtime';
import { ThemeContext, fonts, useTheme } from './src/ui/theme';
import { Button, Copy, Icon, Label, Loading, Notice } from './src/ui/primitives';
import {
  Badge,
  CompactText,
  FloatingAction,
  IconButton,
  LinearProgress,
  SkeletonRows,
  TopBar,
  progressHeight,
} from './src/ui/compact';
import { SignIn, styles } from './src/ui/screens';
import { GroupCreateForm, InvitationPreview } from './src/ui/group-workflows';
import { SettingsScreen, signOutClears, signOutInterruptedSave } from './src/ui/settings-screen';
import { ExpenseEditor } from './src/ui/expense-editor';
import { scrollToShow } from './src/ui/scroll';
import { recordOutline } from './src/ui/expense-record-view';
import { RefreshStatus, RetainedNotice } from './src/ui/financial-views';
import { GroupExpensesView } from './src/ui/group-expenses';
import { TripStrip } from './src/ui/trip-strip';
import {
  ContinueDrafts,
  GroupCreationCheck,
  HomeBalances,
  HomeGroups,
  HomeTopBar,
} from './src/ui/home';
import { refreshFeedback } from './src/ui/refresh-feedback';
import { GroupSnackbar, HomeSnackbar } from './src/ui/group-snackbar';
import { visibleFieldErrors } from './src/data/field-feedback';
import { groupFields } from './src/data/group-draft';
import { GroupShell } from './src/ui/group-shell';
import { GroupBalancesView, settledIn } from './src/ui/group-balances';
import { RecordPaymentSheet } from './src/ui/record-payment-sheet';
import { GroupActivity } from './src/ui/group-activity';
import { GroupMembers } from './src/ui/group-members';
import type { MobileSnapshot } from './src/data/types';
import { shownGroup } from './src/data/mobile-controller';
import { getGroupTheme } from '@splitbook/shared/group-themes';

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
      if (next === 'active') void controller.refresh('foreground');
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
  const feedback = refreshFeedback(state);
  // Cold start: the saved Home of the account that last signed in, while its session is checked.
  const checking = state.auth.status === 'restoring' && state.auth.user !== null;
  const joining = state.invitation.status === 'joining';
  if (configurationReady && authenticated && state.screen === 'expense')
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        {/* Height-based on Android, so the pinned Save bar sits directly above the keyboard. */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ExpenseScreen state={state} />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  // Record payment is a sheet over the Group's Balances.
  if (configurationReady && authenticated && ['group', 'settlement'].includes(state.screen))
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <GroupScreen state={state} />
      </SafeAreaView>
    );
  if (configurationReady && authenticated && state.screen === 'members')
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <MembersScreen state={state} />
      </SafeAreaView>
    );
  // Settings, Create Group and an invitation, which also opens before sign-in once the session
  // check has settled.
  if (
    configurationReady &&
    !['restoring', 'error', 'sign-out-unconfirmed'].includes(state.auth.status) &&
    (state.screen === 'invite' || (authenticated && ['settings', 'create'].includes(state.screen)))
  )
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <TaskScreen state={state} authenticated={authenticated} />
      </SafeAreaView>
    );
  if (configurationReady && (authenticated || checking) && state.screen === 'groups')
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <HomeScreen state={state} />
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[styles.between, { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16 }]}>
        {/* Shrinks so a long refresh status wraps instead of pushing Settings off screen. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 }}>
          {state.screen !== 'groups' ? (
            // Disabled while joining: the join finishes and opens its Group.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to Groups"
              accessibilityState={{ disabled: joining }}
              disabled={joining}
              onPress={controller.back}
              style={{
                minWidth: 48,
                minHeight: 48,
                justifyContent: 'center',
                opacity: joining ? 0.4 : 1,
              }}
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
          {/* In the fixed header, so it stays visible wherever the content is scrolled. */}
          <RefreshStatus visible={feedback.quiet} savedAt={feedback.savedAt} />
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
            <Label>{googleSignInEnabled ? 'STAGING' : 'DEV'}</Label>
          </View>
        )}
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {!configurationReady ? (
          <Notice
            title="Build setup needed"
            icon="build-outline"
            message="This build is missing its connection settings. Ask the beta organizer for the configured app, or follow the development setup guide."
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
        ) : state.auth.status === 'sign-out-unconfirmed' ? (
          <View style={{ paddingHorizontal: 24 }}>
            {/* Try again re-sends the revoke as the restore does; Continue sends nothing more. */}
            <Notice
              title="Couldn’t sign out of the server"
              message={state.auth.message ?? 'Try again, or continue signed out.'}
              retry={() => void controller.restore()}
            />
            <Button label="Continue" secondary onPress={() => controller.continueSignedOut()} />
          </View>
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
            onGoogleSignIn={
              googleSignInEnabled ? () => void controller.signInWithGoogle() : undefined
            }
          />
        ) : (
          <ScrollView
            key={state.screen}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.content}
            refreshControl={
              ['settings', 'expense'].includes(state.screen) ? undefined : (
                <RefreshControl
                  refreshing={feedback.pull}
                  onRefresh={() => void controller.refresh('pull')}
                  tintColor={theme.brand.main}
                  colors={[theme.brand.main]}
                />
              )
            }
          >
            <OfflineNotice state={state.offline} />
            <Loading label="Opening your Group…" />
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
                {environment.label.toUpperCase()}
              </Copy>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Settings, Create Group or an invitation: a compact top bar over the screen's content. */
function TaskScreen({ state, authenticated }: { state: MobileSnapshot; authenticated: boolean }) {
  const theme = useTheme();
  const preference = useSyncExternalStore(appearance.subscribe, appearance.getSnapshot);
  const feedback = refreshFeedback(state);
  const scroll = useRef<ScrollView>(null);
  const scrollContent = useRef<View>(null);
  // Place a form section near the top, so it stays visible when the keyboard opens.
  const reveal = useCallback((section: View) => {
    const content = scrollContent.current;
    if (!content) return;
    section.measureLayout(
      content,
      (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - 16), animated: false }),
      () => undefined,
    );
  }, []);
  const viewport = useRef(0);
  const offset = useRef(0);
  // Each screen's ScrollView starts at its top.
  useEffect(() => {
    offset.current = 0;
  }, [state.screen]);
  // Scroll just far enough to show a note that appeared under the actions, whole.
  const showWhole = useCallback((section: View) => {
    const content = scrollContent.current;
    if (!content) return;
    section.measureLayout(
      content,
      (_x, top, _width, height) => {
        const to = scrollToShow(
          { top, height },
          { offset: offset.current, viewport: viewport.current },
        );
        if (to !== null) scroll.current?.scrollTo({ y: to, animated: true });
      },
      () => undefined,
    );
  }, []);
  const invite = state.screen === 'invite';
  return (
    <>
      <TopBar
        title={
          state.screen === 'settings'
            ? 'Settings'
            : state.screen === 'create'
              ? 'Create a Group'
              : 'You’re invited'
        }
        // Disabled while joining: the join finishes and opens its Group (#152).
        leading={{
          kind: 'back',
          label: 'Back to Home',
          onPress: () => void controller.back(),
          disabled: state.invitation.status === 'joining',
        }}
        actions={
          authenticated && state.screen !== 'settings' ? (
            <IconButton
              icon="settings-outline"
              label="Settings"
              disabled={state.creation.status === 'saving' || state.invitation.status === 'joining'}
              onPress={controller.openSettings}
            />
          ) : (
            <View style={{ marginRight: 12 }}>
              <Badge label={googleSignInEnabled ? 'STAGING' : 'DEV'} />
            </View>
          )
        }
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          key={state.screen}
          ref={scroll}
          innerViewRef={scrollContent as RefObject<View>}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          scrollEventThrottle={100}
          onScroll={(event) => {
            offset.current = event.nativeEvent.contentOffset.y;
          }}
          onLayout={(event) => {
            viewport.current = event.nativeEvent.layout.height;
          }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 4,
            paddingBottom: 24,
            gap: 12,
          }}
          // A pull on New Group or an invitation checks the session, as the write it offers needs
          // (#286): on an invitation it then reads the invitation again.
          refreshControl={
            ['create', 'invite'].includes(state.screen) ? (
              <RefreshControl
                refreshing={feedback.pull}
                onRefresh={() => void controller.refresh('pull')}
                tintColor={theme.brand.main}
                colors={[theme.brand.main]}
              />
            ) : undefined
          }
        >
          {!invite && <OfflineNotice state={state.offline} />}
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
                void Linking.openURL(new URL('/settings', environment.webOrigin).href).catch(() => {
                  Alert.alert('Couldn’t open web settings', 'Check your browser and try again.');
                });
              }}
              onSignOut={() =>
                Alert.alert(
                  'Sign out on this device?',
                  `Your ${signOutClears} will be cleared. ${signOutInterruptedSave}`,
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
          ) : state.screen === 'create' ? (
            <GroupCreateForm
              draft={state.creation.draft}
              onChange={controller.updateCreation}
              onSubmit={() => void controller.createGroup()}
              busy={state.creation.status === 'saving'}
              uncertain={state.creation.status === 'uncertain'}
              offline={state.offline.active}
              message={state.creation.message}
              errors={visibleFieldErrors(groupFields, state.creation.validation)}
              focus={state.creation.validation.focus}
              onLeaveField={controller.touchCreationField}
              onReveal={reveal}
              onShowStatus={showWhole}
              onCheckGroups={() => void controller.checkCreatedGroups()}
              onDiscard={() =>
                Alert.alert('Discard this Group form?', 'Your unsaved entries will be cleared.', [
                  { text: 'Keep editing', style: 'cancel' },
                  {
                    text: 'Discard',
                    style: 'destructive',
                    onPress: () => void controller.discardCreation(),
                  },
                ])
              }
            />
          ) : (
            <InvitationPreview
              preview={state.invitation.preview}
              status={state.invitation.status === 'idle' ? 'loading' : state.invitation.status}
              message={state.invitation.message}
              signedIn={authenticated}
              offline={state.offline.active}
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
          )}
          {!invite && (
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
              <CompactText variant="caption" tone="secondary">
                {environment.label.toUpperCase()}
              </CompactText>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

/**
 * Home: balances by currency, drafts to resume, and the member's balance in each Group. At cold
 * start it is the saved Home, read-only until the session is confirmed.
 */
function HomeScreen({ state }: { state: MobileSnapshot }) {
  const theme = useTheme();
  const feedback = refreshFeedback(state);
  const { checking } = feedback;
  const refresh = () => void controller.refresh();
  return (
    <>
      <HomeTopBar
        userName={state.auth.user!.name}
        status={
          <RefreshStatus
            visible={feedback.quiet || checking}
            savedAt={feedback.savedAt}
            checking={checking}
          />
        }
        accountDisabled={
          checking || state.creation.status === 'saving' || state.invitation.status === 'joining'
        }
        refreshDisabled={checking}
        onRefresh={refresh}
        onAccount={controller.openSettings}
      />
      {/* The bar's room stays when nothing loads, so Home never moves. */}
      {feedback.progress ? (
        <LinearProgress label={feedback.progress} />
      ) : (
        <View style={{ height: progressHeight }} />
      )}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 }}
        refreshControl={
          <RefreshControl
            enabled={!checking}
            refreshing={feedback.pull}
            onRefresh={() => void controller.refresh('pull')}
            tintColor={theme.brand.main}
            colors={[theme.brand.main]}
          />
        }
      >
        <OfflineNotice state={state.offline} />
        <HomeBalances
          state={state.home}
          offline={state.offline.active}
          silent={feedback.silent}
          onRefresh={() => void controller.refreshHome()}
        />
        {state.creation.status === 'uncertain' && (
          <GroupCreationCheck
            message={state.creation.message}
            groupsReady={state.groups.status === 'ready'}
            onCheck={() => void controller.checkCreatedGroups()}
            onResume={controller.resumeCreationAfterCheck}
            onDiscard={() =>
              Alert.alert(
                'Discard this Group form?',
                'This Group may already be created. Check your Groups first. Discarding removes this form and its saved submission from this device, and sends nothing.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Discard',
                    style: 'destructive',
                    onPress: () => void controller.discardCreation(),
                  },
                ],
              )
            }
          />
        )}
        {/* Direct entry: the form returns to that Group's Expenses. */}
        <ContinueDrafts
          drafts={state.drafts}
          disabled={checking}
          onOpen={(draft) =>
            void controller.openExpense(draft.groupId, draft.expenseId ?? undefined)
          }
        />
        <HomeGroups
          groups={state.groups}
          byGroup={state.home.byGroup}
          newGroupLabel={state.creation.draft.name ? 'Continue Group form' : 'New Group'}
          offline={state.offline.active}
          disabled={checking}
          onNewGroup={controller.startCreate}
          onOpen={(groupId) => void controller.openGroup(groupId)}
          onRetry={refresh}
        />
        <CompactText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {environment.label}
        </CompactText>
      </ScrollView>
      {state.homeSnackbar ? (
        <HomeSnackbar notice={state.homeSnackbar} onDismiss={controller.dismissSnackbar} />
      ) : null}
    </>
  );
}

/** Shares the open Group's invitation link through Android's share sheet. */
function shareInvite() {
  void (async () => {
    const url = await controller.loadInviteLink();
    if (!url) {
      const message = controller.getSnapshot().share.message;
      if (message) Alert.alert('Couldn’t get an invitation link', message);
      return;
    }
    try {
      await Share.share({
        message: `Join our Group on SplitBook: ${url}`,
        title: 'SplitBook invitation',
      });
    } catch {
      Alert.alert('Couldn’t open sharing', 'Your invitation link is still available. Try again.');
    }
  })();
}

/** A Group: the compact shell around its Expenses, Balances or Activity destination. */
function GroupScreen({ state }: { state: MobileSnapshot }) {
  const feedback = refreshFeedback(state);
  const group = state.detail.data;
  // The top bar keeps the Group's name and actions while it is first read.
  const known = shownGroup(state);
  // Never opened on this phone, and offline: the navigation stays, without a banner.
  const unavailable = !group && state.detail.status === 'error' && state.offline.active;
  const userId = state.auth.user!.id;
  const eventOpen = state.destination === 'activity' && state.activity.selected !== null;
  const scroll = useRef<ScrollView>(null);
  // The destination's offset, recorded when an Expense opens so returning can restore it.
  const scrollY = useRef(0);
  const viewportHeight = useRef(0);
  const pendingScroll = useRef<number | null>(null);
  const restoreRequest = useRef<number | null>(null);
  const shownScrollKey = useRef<string | null>(null);
  const scrollKey = `${state.detail.id}:${state.destination}:${state.activity.selected?._id ?? ''}`;
  // Synced during render, before the remounted ScrollView can report its content size.
  if (shownScrollKey.current !== scrollKey) {
    shownScrollKey.current = scrollKey;
    scrollY.current = 0;
  }
  if (!state.restoreScroll) pendingScroll.current = null;
  else if (state.restoreScroll.request !== restoreRequest.current) {
    restoreRequest.current = state.restoreScroll.request;
    pendingScroll.current = state.restoreScroll.y;
  }
  /** Applied once the returning view's content is laid out; dragging or a new view cancels it. */
  const restorePendingScroll = (contentHeight: number) => {
    const y = pendingScroll.current;
    if (y === null) return;
    const reachable = Math.max(0, contentHeight - viewportHeight.current);
    scroll.current?.scrollTo({ y: Math.min(y, reachable), animated: false });
    scrollY.current = Math.min(y, reachable);
    const shown = controller.getSnapshot();
    const { status } = shown.destination === 'activity' ? shown.activity : shown.financial.expenses;
    if (reachable >= y || status === 'ready' || status === 'error') pendingScroll.current = null;
  };
  const openExpense = (groupId: string, expenseId?: string) =>
    void controller.openExpense(groupId, expenseId, { scrollY: scrollY.current });
  const kept = state.keptDraft?.groupId === known?.id ? state.keptDraft : null;
  // Both open the kept record; a save that may already be recorded is checked, not resumed.
  const keptAction = kept?.unconfirmed
    ? { label: 'Check save', icon: 'alert-circle-outline' as const }
    : { label: 'Resume draft', icon: 'pencil-outline' as const };
  const resumeDraft = () => void controller.resumeKeptDraft({ scrollY: scrollY.current });
  // On Expenses, also while the Group is first read; not when it can't be.
  const floating =
    known && (group || state.detail.status === 'loading') && state.destination === 'expenses'
      ? known
      : null;
  const discardDraft = () =>
    Alert.alert(
      'Discard this expense draft?',
      'Your saved entries will be removed from this device.',
      [
        { text: 'Keep draft', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () =>
            void controller.discardKeptDraft().then((discarded) => {
              if (!discarded) Alert.alert('Couldn’t discard this draft', 'Please try again.');
            }),
        },
      ],
    );
  return (
    <GroupShell
      group={known}
      destination={state.destination}
      onDestination={(destination) => void controller.selectDestination(destination)}
      back={{
        label: eventOpen ? 'Back to Activity' : 'Back to Home',
        onPress: () => void controller.back(),
      }}
      progress={feedback.progress}
      floating={floating !== null}
      invite={{
        onPress: shareInvite,
        // Known is enough: a refresh in flight doesn't change who can be invited.
        disabled: state.share.status === 'loading' || !known,
        offline: state.offline.active,
      }}
      onMembers={() => controller.openMembers({ scrollY: scrollY.current })}
      onRefresh={() => void controller.refresh()}
      pull={{ refreshing: feedback.pull, onRefresh: () => void controller.refresh('pull') }}
      scrollRef={scroll}
      scroll={{
        scrollEventThrottle: 100,
        onScroll: (event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        },
        onScrollBeginDrag: () => {
          pendingScroll.current = null;
        },
        onLayout: (event) => {
          viewportHeight.current = event.nativeEvent.layout.height;
        },
        onContentSizeChange: (_width, height) => restorePendingScroll(height),
      }}
      overlay={
        <>
          {floating ? (
            <FloatingAction
              label={kept ? keptAction.label : 'Add expense'}
              icon={kept ? keptAction.icon : 'add'}
              onPress={kept ? resumeDraft : () => openExpense(floating.id)}
              // Above the snackbar while it shows.
              bottom={state.snackbar ? 156 : undefined}
            />
          ) : null}
          {state.snackbar && group ? (
            <GroupSnackbar
              notice={state.snackbar}
              shownMonth={state.financial.month}
              onView={() => void controller.viewSnackbarMonth()}
              onDismiss={controller.dismissSnackbar}
            />
          ) : null}
        </>
      }
    >
      {unavailable ? null : <OfflineNotice state={state.offline} />}
      {state.detail.status === 'denied' ? (
        <Notice
          title="This Group isn’t available"
          message={state.detail.message ?? 'You may no longer be a member of this Group.'}
          icon="lock-closed-outline"
          retry={() => void controller.back()}
          retryLabel="Back to Home"
        />
      ) : unavailable ? (
        <NotAvailableOffline
          message={`${known?.name ?? 'This Group'} hasn’t been opened on this phone yet, so there’s no saved copy. Connect to load it.`}
          onRetry={() => void controller.refresh()}
        />
      ) : state.detail.status === 'error' && !group ? (
        <Notice
          title="Couldn’t open this Group"
          message={state.detail.message ?? 'Please try again.'}
          retry={() => void controller.refresh()}
        />
      ) : !group ? (
        <SkeletonRows
          label="Loading this Group"
          rows={5}
          avatar={state.destination === 'activity'}
        />
      ) : (
        <>
          {/* A failed refresh keeps the whole Group readable, with its time and a retry. */}
          {state.detail.status === 'error' && (
            <RetainedNotice
              status="error"
              stale={false}
              refreshedAt={state.detail.refreshedAt}
              message={state.detail.message}
              subject={group.name}
              retryLabel="Retry Group"
              onRetry={() => void controller.refresh()}
            />
          )}
          {state.destination === 'activity' ? (
            <GroupActivity
              state={state.activity}
              currentUserId={userId}
              currency={group.defaultCurrency}
              members={group.members.map(({ user }) => ({ id: user.id, name: user.name }))}
              offline={state.offline.active}
              refreshing={feedback.quiet}
              now={Date.now()}
              onRetry={() => void controller.refreshActivity()}
              onMore={() => void controller.loadMoreActivity()}
              onSelect={(id) => void controller.openActivityEvent(id, { scrollY: scrollY.current })}
              onClose={controller.closeActivityDetail}
            />
          ) : state.destination === 'balances' ? (
            <GroupBalancesView
              group={group}
              currentUserId={userId}
              state={state.financial}
              pending={state.pendingPayment}
              offline={state.offline.active}
              refreshing={feedback.quiet}
              silent={feedback.silent}
              knownSettled={settledIn(state.home.byGroup[group.id])}
              onRecord={(paidBy, paidTo, currency) =>
                void controller.openRecordPayment(paidBy, paidTo, currency)
              }
              onCheckPayment={() => void controller.openPendingPayment()}
              onRefreshBalances={() => void controller.refreshBalances()}
            />
          ) : (
            <>
              {getGroupTheme(group.category).header === 'strip' ? (
                <TripStrip group={group} />
              ) : null}
              {group.members.length === 1 ? (
                <CompactText variant="small" tone="secondary">
                  Your Group is ready. Invite someone to start sharing it.
                </CompactText>
              ) : null}
              <GroupExpensesView
                group={group}
                currentUserId={userId}
                state={state.financial}
                kept={kept}
                savedExpenseId={
                  state.snackbar?.groupId === group.id ? (state.snackbar.expenseId ?? null) : null
                }
                offline={state.offline.active}
                refreshing={feedback.quiet}
                now={Date.now()}
                onSelectMonth={(month) => void controller.selectMonth(month)}
                onRefreshExpenses={() => void controller.refreshExpenses()}
                onLoadMore={() => void controller.loadMoreExpenses()}
                onOpenExpense={(expenseId) => openExpense(group.id, expenseId)}
                onResumeDraft={resumeDraft}
                onDiscardDraft={discardDraft}
              />
            </>
          )}
        </>
      )}
      <RecordPaymentSheet
        visible={state.screen === 'settlement'}
        state={state.settlement}
        currentUserId={userId}
        today={`Today, ${new Date().toLocaleDateString('en', { month: 'short', day: 'numeric' })}`}
        onChange={controller.updateSettlement}
        onLeaveField={controller.touchSettlementField}
        onAcknowledge={controller.acknowledgeSettlement}
        onRecord={() => void controller.recordSettlement()}
        onClose={() => void controller.back()}
      />
    </GroupShell>
  );
}

/** Members and Group details: a full screen over the Group, which Back returns to. */
function MembersScreen({ state }: { state: MobileSnapshot }) {
  const group = shownGroup(state);
  return (
    <GroupMembers
      group={group}
      currentUserId={state.auth.user!.id}
      back={{ label: 'Back to Group', onPress: () => void controller.back() }}
      invite={{
        onPress: shareInvite,
        disabled: state.share.status === 'loading' || !group,
        offline: state.offline.active,
      }}
      leave={{
        state: state.leave,
        offline: state.offline.active,
        onOpen: () => void controller.reviewLeaveGroup(),
        onConfirm: () => void controller.leaveGroup(),
        onCancel: controller.cancelLeaveGroup,
        onCheck: () => void controller.showLeaveCheck(),
      }}
      notice={<OfflineNotice state={state.offline} onRetry={() => void controller.refresh()} />}
      unavailable={state.detail.message}
    />
  );
}

/** Adding, editing or reviewing an Expense: a full-screen task without the Group's navigation. */
function ExpenseScreen({ state }: { state: MobileSnapshot }) {
  // The list row an Expense opens from already says much of what its record shows.
  const { requestedExpenseId, groupId } = state.expense;
  const row =
    requestedExpenseId && state.financial.groupId === groupId
      ? state.financial.expenses.data.find((expense) => expense.id === requestedExpenseId)
      : undefined;
  return (
    <ExpenseEditor
      state={state.expense}
      currentUserId={state.auth.user?.id}
      outline={row ? recordOutline(row, state.auth.user?.id) : null}
      notice={<OfflineNotice state={state.offline} onRetry={() => void controller.refresh()} />}
      offline={state.offline.active}
      onClose={() => void controller.back()}
      onEdit={() => void controller.editExpense()}
      onReviewDelete={controller.reviewExpenseDeletion}
      onCancelDelete={controller.cancelExpenseDeletion}
      onDelete={() => void controller.deleteExpense()}
      onReconcile={() => void controller.reconcileExpense()}
      onReviewLatest={() => void controller.reviewLatestExpense()}
      onLoadOlderHistory={() => void controller.loadOlderExpenseHistory()}
      onRetryHistory={() => void controller.refreshExpenseHistory()}
      onAcceptCurrent={() =>
        Alert.alert('Use the saved version?', 'Your version is removed from this device.', [
          { text: 'Keep my version', style: 'cancel' },
          {
            text: 'Use saved version',
            onPress: () => void controller.acceptCurrentExpense(),
          },
        ])
      }
      onChange={(patch) => void controller.updateExpenseDraft(patch)}
      onLeaveField={controller.touchExpenseField}
      onSave={() => void controller.saveExpense()}
      onResume={controller.resumeExpenseDraft}
      onRetry={() =>
        state.expense.groupId &&
        void controller.openExpense(
          state.expense.groupId,
          state.expense.requestedExpenseId ?? undefined,
        )
      }
      onDiscardUnconfirmed={() =>
        Alert.alert(
          'Discard this unconfirmed save?',
          'Check this Group’s Expenses first. If this Expense is already there, discard this save and don’t save the draft again. If it isn’t, discard this save, then correct the draft and save it. Discarding sends nothing.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Discard',
              style: 'destructive',
              onPress: () => void controller.discardUnconfirmedExpense(),
            },
          ],
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
  );
}
