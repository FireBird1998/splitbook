import { NotAvailableOffline, OfflineNotice } from './src/ui/offline-notice';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from 'react';
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
import { ControllerExpenseEditor } from './src/ui/controller-expense-editor';
import { useMobileSnapshot, sameSelection } from './src/ui/use-mobile-snapshot';
import { scrollToShow } from './src/ui/scroll';
import { returnScrollTarget, visibleRowAnchor, type RowPlaces } from './src/ui/return-scroll';
import { recordOutline } from './src/ui/expense-record-view';
import { DetailsNotice, RefreshStatus, RetainedNotice } from './src/ui/financial-views';
import { currentDayKey } from './src/ui/list-day-header';
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
import { GroupBalancesView, recordWaitsForDetails, settledIn } from './src/ui/group-balances';
import { RecordPaymentSheet } from './src/ui/record-payment-sheet';
import { GroupActivity } from './src/ui/group-activity';
import { GroupMembers } from './src/ui/group-members';
import type { MobileGroup, MobileSnapshot } from './src/data/types';
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
  const state = useMobileSnapshot(
    controller,
    ({ auth, screen }) => ({ auth, screen }),
    sameSelection,
  );
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
  const checking = state.auth.status === 'restoring' && state.auth.user !== null;
  if (configurationReady && authenticated && state.screen === 'expense')
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        {/* Height-based on Android, so the pinned Save bar sits directly above the keyboard. */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ExpenseScreen />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  // Record payment is a sheet over the Group's Balances.
  if (configurationReady && authenticated && ['group', 'settlement'].includes(state.screen))
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <GroupScreen />
      </SafeAreaView>
    );
  if (configurationReady && authenticated && state.screen === 'members')
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <MembersScreen />
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
        <TaskScreen />
      </SafeAreaView>
    );
  if (configurationReady && (authenticated || checking) && state.screen === 'groups')
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
        <HomeScreen />
      </SafeAreaView>
    );
  return <AuthenticationScreen />;
}

function AuthenticationScreen() {
  const theme = useTheme();
  const state = useMobileSnapshot(
    controller,
    (snapshot) => ({
      auth: snapshot.auth,
      screen: snapshot.screen,
      creation: snapshot.creation,
      invitation: snapshot.invitation,
      expense: snapshot.expense,
      offline: snapshot.offline,
      quiet: refreshFeedback(snapshot).quiet,
      pull: refreshFeedback(snapshot).pull,
    }),
    sameSelection,
  );
  const authenticated = state.auth.status === 'authenticated' && state.auth.user !== null;
  const feedback = state;
  const joining = state.invitation.status === 'joining';
  const waiting = !configurationReady
    ? null
    : state.auth.status === 'restoring'
      ? 'Checking your session'
      : state.auth.status === 'signing-in'
        ? 'Signing in'
        : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[styles.between, { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16 }]}>
        {/* Shrinks so the wordmark and its short status never push Settings off screen. */}
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
          <RefreshStatus visible={feedback.quiet} />
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
      {/* #331's one progress cue while the session is checked or a sign-in runs. Its room
          stays when nothing runs, so the screen never moves (#335). */}
      {waiting ? <LinearProgress label={waiting} /> : <View style={{ height: progressHeight }} />}
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
          // The bar above is the check's progress, still with reduce motion on; this says what
          // it is, where the spinner was (#335).
          <View
            accessibilityLiveRegion="polite"
            style={{ alignItems: 'center', paddingHorizontal: 20, paddingVertical: 48 }}
          >
            <CompactText tone="secondary">Checking your session…</CompactText>
          </View>
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
            option={state.auth.status === 'signing-in' ? state.auth.option : undefined}
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
function TaskScreen() {
  const state = useMobileSnapshot(
    controller,
    (snapshot) => ({
      auth: snapshot.auth,
      screen: snapshot.screen,
      creation: snapshot.creation,
      invitation: snapshot.invitation,
      groups: snapshot.groups,
      offline: snapshot.offline,
      feedback: refreshFeedback(snapshot),
    }),
    (a, b) =>
      sameSelection({ ...a, feedback: null }, { ...b, feedback: null }) &&
      sameSelection(a.feedback, b.feedback),
  );
  const authenticated = state.auth.status === 'authenticated' && state.auth.user !== null;
  const theme = useTheme();
  const preference = useSyncExternalStore(appearance.subscribe, appearance.getSnapshot);
  const feedback = state.feedback;
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
const HomeScreen = memo(function HomeScreen() {
  const selected = useMobileSnapshot(
    controller,
    (snapshot) => {
      const feedback = refreshFeedback(snapshot);
      return {
        auth: snapshot.auth,
        groups: snapshot.groups,
        home: snapshot.home,
        creation: snapshot.creation,
        invitation: snapshot.invitation,
        drafts: snapshot.drafts,
        offline: snapshot.offline,
        homeSnackbar: snapshot.homeSnackbar,
        pull: feedback.pull,
        quiet: feedback.quiet,
        checking: feedback.checking,
        progress: feedback.progress,
        // Silence matters while figures are read; an unchanged fresh Home has no cue to hide.
        silent: snapshot.home.status === 'loading' && feedback.silent,
      };
    },
    sameSelection,
  );
  const state = selected;
  const theme = useTheme();
  const feedback = selected;
  const { checking } = feedback;
  const status = useMemo(
    () => <RefreshStatus visible={feedback.quiet || checking} checking={checking} />,
    [feedback.quiet, checking],
  );
  const refresh = useCallback(() => void controller.refresh(), []);
  const refreshFigures = useCallback(() => void controller.refreshHome(), []);
  const openDraft = useCallback(
    (draft: MobileSnapshot['drafts'][number]) =>
      void controller.openExpense(draft.groupId, draft.expenseId ?? undefined),
    [],
  );
  const openGroup = useCallback((groupId: string) => void controller.openGroup(groupId), []);
  return (
    <>
      <HomeTopBar
        userName={state.auth.user!.name}
        status={status}
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
        {/* Offline, the banner says so; that what's shown was saved on this device, only
            while some of it is (#332). */}
        <OfflineNotice
          state={state.offline}
          savedShown={!!(state.groups.restored || state.home.restored)}
        />
        <HomeBalances
          state={state.home}
          offline={state.offline.active}
          silent={feedback.silent}
          onRefresh={refreshFigures}
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
        <ContinueDrafts drafts={state.drafts} disabled={checking} onOpen={openDraft} />
        <HomeGroups
          groups={state.groups}
          byGroup={state.home.byGroup}
          balancesPending={state.home.status === 'idle' || state.home.status === 'loading'}
          newGroupLabel={state.creation.draft.name ? 'Continue Group form' : 'New Group'}
          offline={state.offline.active}
          disabled={checking}
          onNewGroup={controller.startCreate}
          onOpen={openGroup}
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
});

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

/**
 * A Group Home doesn't list yet, while it is first read: its placeholders take the shape of an
 * all-time Group's, the commoner kind, and nothing of it is shown (#219). `XXX` is ISO 4217's
 * code for no currency, as wide as any.
 */
const unlistedGroup = (id: string): MobileGroup => ({
  id,
  name: '',
  description: '',
  category: 'other',
  defaultCurrency: 'XXX',
  members: [],
  startDate: null,
  endDate: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

/** A Group: the compact shell around its Expenses, Balances or Activity destination. */
function GroupScreen() {
  const state = useMobileSnapshot(
    controller,
    (snapshot) => ({
      auth: snapshot.auth,
      screen: snapshot.screen,
      destination: snapshot.destination,
      detail: snapshot.detail,
      groups: snapshot.groups,
      financial: snapshot.financial,
      activity: snapshot.activity,
      settlement: snapshot.settlement,
      offline: snapshot.offline,
      share: snapshot.share,
      restoreScroll: snapshot.restoreScroll,
      keptDraft: snapshot.keptDraft,
      snackbar: snapshot.snackbar,
      pendingPayment: snapshot.pendingPayment,
      home: snapshot.home,
      feedback: refreshFeedback(snapshot),
    }),
    (a, b) =>
      sameSelection({ ...a, feedback: null }, { ...b, feedback: null }) &&
      sameSelection(a.feedback, b.feedback),
  );
  const feedback = state.feedback;
  // The top bar keeps the Group's name and actions while it is first read.
  const known = shownGroup(state);
  // Its details couldn't be read, but its Expenses answered, which proves the member belongs
  // (owner decision 2A, #219): the Group shows as Home lists it, with the failure on its details.
  const proven =
    state.detail.status === 'error' &&
    state.financial.groupId === state.detail.id &&
    state.financial.expenses.status === 'ready';
  const group = state.detail.data ?? (proven ? known : null);
  // While the Group is first read, each destination shows its own placeholders for it as Home
  // lists it, so they keep their shape when it answers (#219); nothing of it is read yet, but
  // Activity shows this phone's saved copy at once (#222). One Home doesn't list yet takes an
  // all-time Group's shape.
  const opening =
    !group &&
    state.detail.status === 'loading' &&
    state.detail.id &&
    // Activity's events need the Group's currency and members: not one Home doesn't list yet.
    (state.destination !== 'activity' || known)
      ? (known ?? unlistedGroup(state.detail.id))
      : null;
  const shown = group ?? opening;
  // Not saved on this phone, and offline: the navigation stays, without a banner.
  const unavailable = !group && state.detail.status === 'error' && state.offline.active;
  const activityMembers = useMemo(
    () => shown?.members.map(({ user }) => ({ id: user.id, name: user.name })),
    [shown?.members],
  );
  const userId = state.auth.user!.id;
  const eventOpen = state.destination === 'activity' && state.activity.selected !== null;
  const scroll = useRef<ScrollView>(null);
  // The destination's offset, recorded when an Expense opens so returning can restore it.
  const scrollY = useRef(0);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  const rowPlaces = useRef<RowPlaces>(new Map());
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScroll = useRef<MobileSnapshot['restoreScroll']>(null);
  const restoreRequest = useRef<number | null>(null);
  const shownScrollKey = useRef<string | null>(null);
  const scrollKey = `${state.detail.id}:${state.destination}:${state.financial.month}`;
  // An event opens over the list, which stays as it was underneath (#222's device check).
  const listed = useMemo(
    () => (state.activity.selected ? { ...state.activity, selected: null } : state.activity),
    [state.activity],
  );
  // Where the view was when the list's window moved (the newest page dropped, or came back),
  // before Android clamps the offset to a shorter list: the shift that keeps the row on screen
  // starts from there (#219). The list is the Month's Expenses, or Activity's events (#222).
  const firstPage =
    (state.destination === 'activity'
      ? state.activity.firstPage
      : state.financial.expenses.firstPage) ?? 1;
  const shownFirstPage = useRef(firstPage);
  const slideFrom = useRef<number | null>(null);
  // Synced during render, before the remounted ScrollView can report its content size.
  if (shownScrollKey.current !== scrollKey) {
    shownScrollKey.current = scrollKey;
    scrollY.current = 0;
    rowPlaces.current = new Map();
    contentHeight.current = 0;
    // Another view: where its window starts is no slide.
    shownFirstPage.current = firstPage;
    slideFrom.current = null;
  }
  if (shownFirstPage.current !== firstPage) {
    slideFrom.current = scrollY.current;
    shownFirstPage.current = firstPage;
  }
  if (!state.restoreScroll) pendingScroll.current = null;
  else if (state.restoreScroll.request !== restoreRequest.current) {
    restoreRequest.current = state.restoreScroll.request;
    pendingScroll.current = state.restoreScroll;
  }
  /** Applied once the returning view's content and row are laid out; a drag cancels it. */
  const restorePendingScroll = useCallback((height: number) => {
    contentHeight.current = height;
    const restore = pendingScroll.current;
    if (!restore || viewportHeight.current <= 0) return;
    const shown = controller.getSnapshot();
    if (
      shown.restoreScroll?.request !== restore.request ||
      shown.restoreScroll.groupId !== restore.groupId
    ) {
      pendingScroll.current = null;
      return;
    }
    const { status, data } = shown.financial.expenses;
    const events = shown.activity;
    const activity = shown.destination === 'activity';
    const settled =
      (activity ? events.status : status) === 'ready' ||
      (activity ? events.status : status) === 'error';
    let places = rowPlaces.current;
    if (restore.anchor) {
      // Rows may still be arriving after Back. A row still listed waits for its native layout;
      // a row removed or moved to another Month falls back only once the read has settled.
      const exists = activity
        ? events.events.some((row) => row._id === restore.anchor!.key)
        : data.some((row) => row.id === restore.anchor!.key);
      if (!settled || (exists && !places.has(restore.anchor.key))) return;
      if (!exists) places = new Map();
    }
    const y = returnScrollTarget(restore, places, {
      content: height,
      viewport: viewportHeight.current,
    });
    scroll.current?.scrollTo({ y, animated: false });
    scrollY.current = y;
    if (restore.anchor || Math.max(0, height - viewportHeight.current) >= restore.y || settled)
      pendingScroll.current = null;
  }, []);
  /** Native layout events arrive together; apply a row return after their last update. */
  const scheduleRestore = useCallback(() => {
    if (restoreTimer.current !== null) clearTimeout(restoreTimer.current);
    restoreTimer.current = setTimeout(() => {
      restoreTimer.current = null;
      restorePendingScroll(contentHeight.current);
    }, 0);
  }, [restorePendingScroll]);
  useEffect(() => {
    if (pendingScroll.current?.anchor) scheduleRestore();
    return () => {
      if (restoreTimer.current !== null) clearTimeout(restoreTimer.current);
    };
  }, [state.restoreScroll, state.financial.expenses.status, state.activity.status]);
  const onRowsLayout = useCallback(
    (rows: RowPlaces) => {
      if (shownScrollKey.current !== scrollKey) return;
      rowPlaces.current = rows;
      if (pendingScroll.current?.anchor) scheduleRestore();
    },
    [scrollKey, scheduleRestore],
  );
  const origin = useCallback(() => {
    const anchor = visibleRowAnchor(rowPlaces.current, scrollY.current, viewportHeight.current);
    return { scrollY: scrollY.current, ...(anchor ? { anchor } : {}) };
  }, []);
  /** The window moved: the view scrolls by `dy` from where it was then, so the row stays put. */
  const shift = useCallback((dy: number) => {
    const from = slideFrom.current ?? scrollY.current;
    slideFrom.current = null;
    scrollY.current = Math.max(0, from + dy);
    scroll.current?.scrollTo({ y: scrollY.current, animated: false });
  }, []);
  const openExpense = useCallback(
    (groupId: string, expenseId?: string) =>
      void controller.openExpense(groupId, expenseId, origin()),
    [origin],
  );
  const kept = state.keptDraft?.groupId === known?.id ? state.keptDraft : null;
  // Both open the kept record; a save that may already be recorded is checked, not resumed.
  const keptAction = kept?.unconfirmed
    ? { label: 'Check save', icon: 'alert-circle-outline' as const }
    : { label: 'Resume draft', icon: 'pencil-outline' as const };
  const resumeDraft = useCallback(() => void controller.resumeKeptDraft(origin()), [origin]);
  // On Expenses, also while the Group is first read; not when it can't be.
  const floating =
    known && (group || state.detail.status === 'loading') && state.destination === 'expenses'
      ? known
      : null;
  const discardDraft = useCallback(
    () =>
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
      ),
    [],
  );
  const selectMonth = useCallback((month: string | null) => void controller.selectMonth(month), []);
  const refreshExpenses = useCallback(() => void controller.refreshExpenses(), []);
  const loadMoreExpenses = useCallback(() => void controller.loadMoreExpenses(), []);
  const loadNewerExpenses = useCallback(() => void controller.loadNewerExpenses(), []);
  const openListedExpense = useCallback(
    (id: string) => {
      if (shown) openExpense(shown.id, id);
    },
    [shown?.id, openExpense],
  );
  const refreshActivity = useCallback(() => void controller.refreshActivity(), []);
  const loadMoreActivity = useCallback(() => void controller.loadMoreActivity(), []);
  const loadNewerActivity = useCallback(() => void controller.loadNewerActivity(), []);
  const selectActivity = useCallback(
    (id: string) => void controller.openActivityEvent(id, origin()),
    [origin],
  );
  // Offline, the banner says so; that what's shown was saved on this device, only while some of
  // it is: the Group's details, or the destination's own content (#219, #222, as Home since #332).
  const notice = unavailable ? null : (
    <OfflineNotice
      state={state.offline}
      savedShown={
        (!!state.detail.data && state.detail.restored === true) ||
        (state.destination === 'expenses'
          ? state.financial.expenses.month === state.financial.month &&
            state.financial.expenses.restored === true
          : state.destination === 'balances'
            ? state.financial.balances.data !== null && state.financial.balances.restored === true
            : state.activity.restored === true && state.activity.events.length > 0)
      }
    />
  );
  /** A failed refresh keeps the whole Group readable, with its time and a retry. */
  const groupNotice = (shown: MobileGroup) =>
    state.detail.status === 'error' && !state.detail.data ? (
      <DetailsNotice
        subject={shown.name}
        // Up to date only as the server answered them in this open, never a saved copy.
        balances={state.financial.balances.answeredThisOpen === true}
        onRetry={() => void controller.refresh()}
      />
    ) : (
      state.detail.status === 'error' && (
        <RetainedNotice
          status="error"
          refreshedAt={state.detail.refreshedAt}
          message={state.detail.message}
          subject={shown.name}
          retryLabel="Retry Group"
          offline={state.offline.active}
          onRetry={() => void controller.refresh()}
        />
      )
    );
  /** Activity's list, or an event of it. */
  const activity = (shown: MobileGroup, activityState: MobileSnapshot['activity']) => (
    <GroupActivity
      state={activityState}
      currentUserId={userId}
      currency={shown.defaultCurrency}
      members={activityMembers}
      offline={state.offline.active}
      dayKey={currentDayKey()}
      onRetry={refreshActivity}
      onMore={loadMoreActivity}
      onLoadNewer={loadNewerActivity}
      // The newest page dropped, or came back: the event on screen keeps its place.
      onShift={shift}
      onRowsLayout={activityState.selected ? undefined : onRowsLayout}
      onSelect={selectActivity}
      onClose={controller.closeActivityDetail}
    />
  );
  // Where the Group shows its destination, an open event shows over Activity's list, with what is
  // said of the Group above it; the list stays at its place underneath (#222's device check).
  const showsContent =
    !!shown &&
    state.detail.status !== 'denied' &&
    !unavailable &&
    !(state.detail.status === 'error' && !group);
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
      cover={
        eventOpen && showsContent && shown ? (
          <>
            {notice}
            {groupNotice(shown)}
            {activity(shown, state.activity)}
          </>
        ) : null
      }
      invite={{
        onPress: shareInvite,
        // Known is enough: a refresh in flight doesn't change who can be invited.
        disabled: state.share.status === 'loading' || !known,
        offline: state.offline.active,
      }}
      onMembers={() => controller.openMembers(origin())}
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
        // A throttled scroll event can miss the end of a drag or a fling, by up to 100 ms of
        // scrolling: the offset the view then keeps, after a slide or a return, comes from where
        // scrolling stopped (#219).
        onScrollEndDrag: (event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        },
        onMomentumScrollEnd: (event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        },
        onLayout: (event) => {
          viewportHeight.current = event.nativeEvent.layout.height;
        },
        onContentSizeChange: (_width, height) => {
          contentHeight.current = height;
          if (pendingScroll.current?.anchor) scheduleRestore();
          else restorePendingScroll(height);
        },
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
      {notice}
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
          // True whether it was never saved here, removed by a sign-out or withheld (#219).
          message={`${known?.name ?? 'This Group'} isn’t saved on this phone. Connect to load it.`}
          onRetry={() => void controller.refresh()}
        />
      ) : state.detail.status === 'error' && !group ? (
        <Notice
          title="Couldn’t open this Group"
          message={state.detail.message ?? 'Please try again.'}
          retry={() => void controller.refresh()}
        />
      ) : !shown ? (
        <SkeletonRows
          label="Loading this Group"
          rows={5}
          avatar={state.destination === 'activity'}
        />
      ) : (
        <>
          {groupNotice(shown)}
          {state.destination === 'activity' ? (
            activity(shown, listed)
          ) : state.destination === 'balances' ? (
            <GroupBalancesView
              group={shown}
              currentUserId={userId}
              state={state.financial}
              pending={state.pendingPayment}
              offline={state.offline.active}
              knownSettled={settledIn(state.home.byGroup[shown.id])}
              // The sheet needs the Group's details, which 2A can't show (#219).
              recordUnavailable={state.detail.data ? null : recordWaitsForDetails(shown.name)}
              onRecord={(paidBy, paidTo, currency) =>
                void controller.openRecordPayment(paidBy, paidTo, currency)
              }
              onCheckPayment={() => void controller.openPendingPayment()}
              onRefreshBalances={() => void controller.refreshBalances()}
            />
          ) : (
            <>
              {getGroupTheme(shown.category).header === 'strip' ? (
                <TripStrip group={shown} />
              ) : null}
              {shown.members.length === 1 ? (
                <CompactText variant="small" tone="secondary">
                  Your Group is ready. Invite someone to start sharing it.
                </CompactText>
              ) : null}
              <GroupExpensesView
                group={shown}
                currentUserId={userId}
                state={state.financial}
                kept={kept}
                savedExpenseId={
                  state.snackbar?.groupId === shown.id ? (state.snackbar.expenseId ?? null) : null
                }
                offline={state.offline.active}
                firstRead={opening !== null}
                dayKey={currentDayKey()}
                onSelectMonth={selectMonth}
                onRefreshExpenses={refreshExpenses}
                onLoadMore={loadMoreExpenses}
                onLoadNewer={loadNewerExpenses}
                // The newest page dropped: the row on screen keeps its place (#219).
                onShift={shift}
                onRowsLayout={onRowsLayout}
                onOpenExpense={openListedExpense}
                onResumeDraft={resumeDraft}
                onDiscardDraft={discardDraft}
              />
            </>
          )}
        </>
      )}
      {state.screen === 'settlement' ? (
        <RecordPaymentSheet
          visible
          state={state.settlement}
          currentUserId={userId}
          today={`Today, ${new Date().toLocaleDateString('en', { month: 'short', day: 'numeric' })}`}
          onChange={controller.updateSettlement}
          onLeaveField={controller.touchSettlementField}
          onAcknowledge={controller.acknowledgeSettlement}
          onRecord={() => void controller.recordSettlement()}
          onRetry={() => void controller.retrySettlementCheck()}
          onDiscard={() =>
            Alert.alert(
              'Discard this unconfirmed payment?',
              'This payment may already be recorded. Discarding removes its retry from this device and sends nothing. If access returns, check the Group’s payments before recording it again.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Discard',
                  style: 'destructive',
                  onPress: () => void controller.discardUnconfirmedSettlement(),
                },
              ],
            )
          }
          onClose={() => void controller.back()}
        />
      ) : null}
    </GroupShell>
  );
}

/** Members and Group details: a full screen over the Group, which Back returns to. */
function MembersScreen() {
  const state = useMobileSnapshot(
    controller,
    ({ auth, detail, groups, share, offline, leave }) => ({
      auth,
      detail,
      groups,
      share,
      offline,
      leave,
    }),
    sameSelection,
  );
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
const ExpenseScreen = memo(function ExpenseScreen() {
  const state = useMobileSnapshot(
    controller,
    ({ expense, financial, keptDraft, auth, offline }) => ({
      expense: {
        requestedExpenseId: expense.requestedExpenseId,
        groupId: expense.groupId,
        contextCheck: expense.contextCheck,
        accessLost: expense.accessLost,
      },
      row:
        expense.requestedExpenseId && financial.groupId === expense.groupId
          ? financial.expenses.data.find((row) => row.id === expense.requestedExpenseId)
          : undefined,
      keptDraft,
      auth,
      offline,
    }),
    (a, b) =>
      sameSelection(a.expense, b.expense) &&
      a.row === b.row &&
      a.keptDraft === b.keptDraft &&
      a.auth === b.auth &&
      a.offline === b.offline,
  );
  // The list row an Expense opens from already says much of what its record shows.
  const { groupId } = state.expense;
  const outline = useMemo(
    () => (state.row ? recordOutline(state.row, state.auth.user?.id) : null),
    [state.row, state.auth.user?.id],
  );
  return (
    <ControllerExpenseEditor
      controller={controller}
      kept={!!groupId && state.keptDraft?.groupId === groupId}
      currentUserId={state.auth.user?.id}
      outline={outline}
      notice={<OfflineNotice state={state.offline} onRetry={() => void controller.refresh()} />}
      emptyNotice={
        state.offline.active || state.offline.message ? (
          <OfflineNotice state={state.offline} savedShown={false} />
        ) : null
      }
      offline={state.offline.active}
      onClose={() => void controller.back()}
      onEdit={() => void controller.editExpense()}
      onReviewDelete={controller.reviewExpenseDeletion}
      onCancelDelete={controller.cancelExpenseDeletion}
      onDelete={() => void controller.deleteExpense()}
      onReconcile={() => void controller.reconcileExpense()}
      onReviewLatest={() => void controller.reviewLatestExpense()}
      onRefresh={() => void controller.refresh()}
      onLoadOlderHistory={() => void controller.loadOlderExpenseHistory()}
      onLoadNewerHistory={() => void controller.loadNewerExpenseHistory()}
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
        state.expense.contextCheck
          ? void controller.refresh()
          : state.expense.groupId &&
            void controller.openExpense(
              state.expense.groupId,
              state.expense.requestedExpenseId ?? undefined,
            )
      }
      onDiscardUnconfirmed={() =>
        Alert.alert(
          'Discard this unconfirmed save?',
          state.expense.accessLost
            ? 'This Expense save or change may already be recorded. Discarding removes it from this device and sends nothing. If access returns, check the Group’s Expenses before saving again.'
            : 'Check this Group’s Expenses first. If this Expense is already there, discard this save and don’t save the draft again. If it isn’t, discard this save, then correct the draft and save it. Discarding sends nothing.',
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
});
