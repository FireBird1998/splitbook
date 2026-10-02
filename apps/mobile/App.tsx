import { OfflineNotice } from './src/ui/offline-notice';
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
import { Avatar, Button, Copy, Icon, Label, Loading, Notice } from './src/ui/primitives';
import { EmptyGroups, GroupCard, SignIn, TripStrip, styles } from './src/ui/screens';
import { GroupCreateForm, InvitationPreview } from './src/ui/group-workflows';
import { SettingsScreen } from './src/ui/settings-screen';
import { ExpenseEditor } from './src/ui/expense-editor';
import {
  GroupExpensesView,
  HomeBalances,
  RefreshStatus,
  RetainedNotice,
} from './src/ui/financial-views';
import { refreshFeedback } from './src/ui/refresh-feedback';
import { GroupSnackbar } from './src/ui/group-snackbar';
import { visibleFieldErrors } from './src/data/field-feedback';
import { groupFields } from './src/data/group-draft';
import { GroupShell } from './src/ui/group-shell';
import { GroupBalancesView } from './src/ui/group-balances';
import { RecordPaymentSheet } from './src/ui/record-payment-sheet';
import { GroupActivity } from './src/ui/group-activity';
import type { MobileSnapshot } from './src/data/types';
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
  const preference = useSyncExternalStore(appearance.subscribe, appearance.getSnapshot);
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
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[styles.between, { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16 }]}>
        {/* Shrinks so a long refresh status wraps instead of pushing Settings off screen. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 }}>
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
            onGoogleSignIn={
              googleSignInEnabled ? () => void controller.signInWithGoogle() : undefined
            }
          />
        ) : (
          <ScrollView
            key={state.screen}
            ref={scroll}
            innerViewRef={scrollContent as RefObject<View>}
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
                    'Your session, expense drafts, unresolved payment records and save recovery keys, unsaved Group form, saved invitation, and local account data will be cleared. If a save was interrupted, check your saved history after signing in before creating it again.',
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
                message={state.creation.message}
                errors={visibleFieldErrors(groupFields, state.creation.validation)}
                focus={state.creation.validation.focus}
                onLeaveField={controller.touchCreationField}
                onReveal={reveal}
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
                {environment.label.toUpperCase()}
              </Copy>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A Group: the compact shell around its Expenses, Balances or Activity destination. */
function GroupScreen({ state }: { state: MobileSnapshot }) {
  const feedback = refreshFeedback(state);
  const group = state.detail.data;
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
    const { status } = controller.getSnapshot().financial.expenses;
    if (reachable >= y || status === 'ready' || status === 'error') pendingScroll.current = null;
  };
  const openExpense = (groupId: string, expenseId?: string) =>
    void controller.openExpense(groupId, expenseId, { scrollY: scrollY.current });
  const shareInvite = () => {
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
  };
  return (
    <GroupShell
      group={group}
      currentUserId={userId}
      destination={state.destination}
      onDestination={(destination) => void controller.selectDestination(destination)}
      back={{
        label: eventOpen ? 'Back to Activity' : 'Back to Home',
        onPress: () => void controller.back(),
      }}
      status={<RefreshStatus visible={feedback.quiet} savedAt={feedback.savedAt} />}
      invite={{
        onPress: shareInvite,
        disabled: state.share.status === 'loading' || state.detail.status !== 'ready',
        offline: state.offline.active,
      }}
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
        state.snackbar && group ? (
          <GroupSnackbar
            notice={state.snackbar}
            shownMonth={state.financial.month}
            onView={() => void controller.viewSnackbarMonth()}
            onDismiss={controller.dismissSnackbar}
          />
        ) : null
      }
    >
      <OfflineNotice state={state.offline} />
      {state.detail.status === 'denied' ? (
        <Notice
          title="This Group isn’t available"
          message={state.detail.message ?? 'You may no longer be a member of this Group.'}
          icon="lock-closed-outline"
          retry={() => void controller.back()}
          retryLabel="Back to Home"
        />
      ) : state.detail.status === 'error' && !group ? (
        <Notice
          title="Couldn’t open this Group"
          message={state.detail.message ?? 'Please try again.'}
          retry={() => void controller.refresh()}
        />
      ) : !group ? (
        <Loading label="Opening your Group…" />
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
              pulling={feedback.pull}
              now={Date.now()}
              onRetry={() => void controller.refreshActivity()}
              onMore={() => void controller.loadMoreActivity()}
              onSelect={(id) => void controller.selectActivity(id)}
              onClose={controller.closeActivityDetail}
            />
          ) : state.destination === 'balances' ? (
            <GroupBalancesView
              group={group}
              currentUserId={userId}
              state={state.financial}
              pending={state.pendingPayment}
              offline={state.offline.active}
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
              <Button
                label="Add expense"
                icon="add-outline"
                onPress={() => openExpense(group.id)}
              />
              {group.members.length === 1 && (
                <Copy>Your Group is ready. Invite someone to start sharing it.</Copy>
              )}
              <GroupExpensesView
                group={group}
                currentUserId={userId}
                state={state.financial}
                onSelectMonth={(month) => void controller.selectMonth(month)}
                onRefreshExpenses={() => void controller.refreshExpenses()}
                onLoadMore={() => void controller.loadMoreExpenses()}
                onOpenExpense={(expenseId) => openExpense(group.id, expenseId)}
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

/** Adding, editing or reviewing an Expense: a full-screen task without the Group's navigation. */
function ExpenseScreen({ state }: { state: MobileSnapshot }) {
  return (
    <ExpenseEditor
      state={state.expense}
      currentUserId={state.auth.user?.id}
      notice={<OfflineNotice state={state.offline} />}
      onClose={() => void controller.back()}
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
