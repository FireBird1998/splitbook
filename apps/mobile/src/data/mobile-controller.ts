import {
  CancelledError,
  focusManager,
  onlineManager,
  QueryClient,
  type QueryFunctionContext,
} from '@tanstack/query-core';
import {
  activityPageKey,
  groupKey,
  matchGroup,
  matchScope,
  queryKeyPath,
  type QueryKey,
  type QueryScope,
} from '@splitbook/shared/query-keys';
import { cachedRead } from './offline-cache';
import {
  activityExpenseId,
  emptyActivity,
  emptyExpenseHistory,
  parseActivityPage,
  parseActivityExpense,
} from './activity';
import {
  emptySettlement,
  parseRecordedSettlement,
  parseSettlementAttempt,
  settlementBody,
  settlementCorrectionSummary,
  settlementFields,
  settlementSuggestion,
  validateSettlementDraft,
  type PendingPayment,
  type SettlementDraft,
  type SettlementField,
} from './settlement';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import {
  assertSettlementMembers,
  assertSettlementAuthorization,
  assertGroupCurrency,
} from '@splitbook/shared/expense-validation';
import { canEditExpense, parseExpenseRecord, type ExpenseRecord } from './expense-record';
import {
  parseAmountMinor,
  MoneyValidationError,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import {
  emptyExpenseEditor,
  emptyExpenseValidation,
  draftFromExpense,
  buildExpenseBody,
  buildExpensePatch,
  expenseCorrectionSummary,
  expenseDraftChanged,
  expenseFields,
  parseCreatedExpenseId,
  parseExpenseContext,
  parseStoredExpenseDraft,
  previewExpense,
  refusedRetryNotice,
  rebaseExpenseDraft,
  sameExpenseDraft,
  savedAsSent,
  validateExpenseDraft,
  visibleExpenseErrors,
  type ExpenseContext,
  type ExpenseDraft,
  type ExpenseDraftStore,
  type ExpenseEditor,
  type ExpenseField,
  type ExpenseMutation,
  type ExpenseValidation,
} from './expense-draft';
import { decodeStoredSession, encodeStoredSession } from './cookies';
import { emptyFormValidation, rejectFields, touchField } from './field-feedback';
import {
  groupCorrectionSummary,
  groupFields,
  parseGroupCreation,
  validateGroupDraft,
  type GroupField,
} from './group-draft';
import { createGroupSchema } from '@splitbook/shared/validators/group';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { currentMonthKey, getLocalMonthIsoRange, toDateParam } from '@splitbook/shared/date';

import {
  objectId,
  parseCreatedGroup,
  parseGroup,
  parseInvitationPreview,
  parseInviteLink,
  parseJoinedGroup,
  parseLeftGroup,
  parseSession,
  parseSignIn,
} from './dto';
import { parseInvitationLink } from './invitation-links';
import { parseGroupBalances } from './financial-dto';
import { createHomeQueries, emptyHome, homePath, notSaved, type Envelope } from './home-queries';
import { createGroupQueries, emptyExpenses } from './group-queries';
import { createExpenseQueries } from './expense-queries';
import { untrustedCopies } from './untrusted-copies';
import {
  createTransport,
  expiredMessage,
  RequestError,
  storageMessage,
  groupRefused,
  singleFlight,
  Superseded,
  type RequestOptions,
} from './transport';
import type {
  AccountStorageLease,
  GroupCreation,
  GroupDestination,
  GroupDraft,
  GroupFinancialState,
  GroupReturnContext,
  GroupSnackbar,
  KeptDraft,
  LeaveGroupState,
  MobileConfig,
  MobileDependencies,
  MobileSnapshot,
  PersonaId,
  Route,
} from './types';

export { currentMonthKey, shiftMonthKey } from '@splitbook/shared/date';

/**
 * The initial display freshness policy (#103): a read verified this recently is shown
 * again without another request. Adjust it per controller with `displayFreshnessMs`.
 */
export const DISPLAY_FRESHNESS_MS = 30_000;

/**
 * Whether a display read is in this invalidation scope: the Groups list ('groups'), Home
 * ('home'), or for one Group its details, its running Balances or the rest of its ledger
 * (Expense pages and records, Month summaries and Activity): 'group:<id>', 'balances:<id>',
 * 'ledger:<id>'. The shared key matchers decide it.
 */
const inScope = (scope: string) => {
  const [name, groupId] = scope.split(':') as [QueryScope, string?];
  return (key: unknown) =>
    matchScope(name)(key) && (groupId === undefined || matchGroup(groupId)(key));
};
/** What a map of scopes holds for this read's scope. */
const scoped = <T>(map: Map<string, T>, key: QueryKey) =>
  [...map].find(([scope]) => inScope(scope)(key))?.[1];

/** A read a change, a denial or a Groups list made obsolete, which its caller no longer shows. */
class Obsolete extends Superseded {}
/** A Group's refusal, in the transport's words. */
const refusal = (status: number) => new RequestError(groupRefused(status), status);
/**
 * A confirmed change's message (#219): `snackbar` as the change confirmed it, with the saved row
 * to highlight; `shown`, as it shows now; and `change`, the change's count once the Group's view
 * knows of it, which a read must begin after to show the saved row as saved.
 */
interface Confirmation {
  snackbar: GroupSnackbar;
  subject: 'Expenses' | 'Balances';
  shown: GroupSnackbar;
  change: number;
}

/** The view on screen, which a pull or an automatic refresh belongs to. */
export function shownView({
  screen,
  detail,
  destination,
}: Pick<MobileSnapshot, 'screen' | 'detail' | 'destination'>) {
  return screen === 'group' ? `group:${detail.id}:${destination}` : screen;
}

/** The open Group: as read, or from the saved Groups list until it has been. */
export function shownGroup({ detail, groups }: Pick<MobileSnapshot, 'detail' | 'groups'>) {
  return detail.data ?? groups.data.find((group) => group.id === detail.id) ?? null;
}

function emptyFinancial(): GroupFinancialState {
  return {
    groupId: null,
    month: null,
    expenses: emptyExpenses(),
    balances: { status: 'idle', data: null, message: null, refreshedAt: null, stale: false },
  };
}

/** Home, where every session starts and ends. */
const home: Route = { screen: 'groups' };
type GroupRoute = Extract<Route, { screen: 'group' }>;

/** Marks a fresh session's snapshot (`cleanSnapshot`), which only the route's writer publishes. */
declare const freshSession: unique symbol;
/** The snapshot's fields that the route decides. */
type RouteFields = 'screen' | 'destination' | 'restoreScroll';
/** A fresh session's snapshot: Home, with nothing of any account. */
export type FreshSnapshot = MobileSnapshot & { readonly [freshSession]?: true };
/**
 * What the controller publishes, other than through the route's writer: never the screen, a
 * Group's destination or the scroll a return asks for, which come from the route (ADR 0006,
 * M8-2), and never a fresh session, which `cleanHome` publishes. Passing one fails typecheck.
 */
export type Unrouted = Omit<MobileSnapshot, RouteFields> & { readonly [freshSession]?: never };

/** No Group shown: Home's, and every fresh session's. */
function noGroup(): MobileSnapshot['detail'] {
  return { status: 'idle', id: null, data: null, message: null, refreshedAt: null };
}

const unrestorableMessage = 'Your saved session could not be restored. Please sign in again.';
const keptUntilConfirmedMessage = 'Your saved data is kept. Connect once to confirm your session.';
const disabledMessage = 'Development persona sign-in is disabled in this build.';
/** Shown with Try again and Continue while the server hasn't confirmed revoking a session. */
const unconfirmedSignOut =
  'This device is signed out, but the server didn’t confirm that the session ended. Try again, or continue signed out.';

class AccountCleanupError extends Error {
  constructor() {
    super('Could not remove this account from the device. Try signing out again.');
  }
}
/** This device's storage blocks the action. The message is safe to show; raw errors never are. */
class DeviceStorageError extends Error {}
const recoveryStorageMissing =
  'Payments need this device to keep a recovery copy of each submission, and that storage isn’t available right now. Try again, or sign out and back in.';
const recoveryStorageUnreadable =
  'Couldn’t read this device’s payment recovery records, so payments can’t be recorded right now. Any unresolved payment is kept. Try again, or restart the app.';
const rejectionMessages: Record<string, string> = {
  INVALID_TAG: 'Choose an active Tag in this Group. Your entries are kept.',
  INVALID_MEMBERS: 'Review the payer and participants: Group membership changed.',
  CURRENCY_MISMATCH: 'The Group currency changed. Review the currency before saving.',
  VALIDATION_ERROR: 'Check the amount, description, date, and participants before saving.',
};

function expenseRejectionMessage(error: unknown) {
  return error instanceof RequestError && error.status === 422 && error.code
    ? rejectionMessages[error.code]
    : undefined;
}

/**
 * A retry the server definitely refused. Its first try may still be recorded, so the save is kept
 * until the member discards it on purpose. 401 is the session's, 403 and 404 mean lost access,
 * and 408 and 429 pass.
 */
function refusesRetry(error: unknown) {
  return (
    error instanceof RequestError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![401, 403, 404, 408, 429].includes(error.status)
  );
}

/** Human copy only: parser and schema errors are never shown to members. */
function expenseFailureMessage(error: unknown, fallback: string) {
  if (error instanceof RequestError || error instanceof MoneyValidationError) return error.message;
  return (error instanceof Error && rejectionMessages[error.message]) || fallback;
}

/** A draft's typed amount, when it is a valid positive amount in its currency. */
function enteredAmount(amount: string, currency: string) {
  try {
    const minor = parseAmountMinor(amount, currency);
    return minor > 0 ? toMajorAmount(minor, currency) : null;
  } catch {
    return null;
  }
}

function closedLeave(): LeaveGroupState {
  return { groupId: null, status: 'closed', code: null, message: null, draft: false, check: null };
}

/** The server's refusals to let a member leave, with fallbacks for its own words. */
const leaveRefusals: Record<string, string> = {
  OPEN_BALANCE: 'Settle up before you leave this Group.',
  LAST_ADMIN: 'Make someone else an admin before you leave.',
  LEAVE_CONFLICT: 'This Group changed while you were leaving. Try again.',
};
const unconfirmedSaveBeforeLeaving =
  'An Expense save in this Group isn’t confirmed yet. Check it on Expenses first: it may already be recorded and change your balance.';
const unconfirmedPaymentBeforeLeaving =
  'A payment in this Group isn’t confirmed yet. Check it on Balances first: it may already be recorded and change your balance.';
const keptWorkUnreadable =
  'Couldn’t check this device for drafts or unconfirmed saves in this Group, so you haven’t left. Close this and try again.';

function cleanSnapshot(auth: MobileSnapshot['auth']): FreshSnapshot {
  return {
    auth,
    offline: { active: false, refreshedAt: null, message: null },
    pull: null,
    automatic: null,
    screen: 'groups',
    destination: 'expenses',
    expense: emptyExpenseEditor(),
    restoreScroll: null,
    snackbar: null,
    homeSnackbar: null,
    leave: closedLeave(),
    settlement: emptySettlement(),
    pendingPayment: null,
    keptDraft: null,
    activity: emptyActivity(),
    home: emptyHome(),
    drafts: [],
    financial: emptyFinancial(),
    creation: {
      draft: {
        name: '',
        description: '',
        category: 'trip',
        defaultCurrency: 'INR',
        startDate: '',
        endDate: '',
      },
      status: 'editing',
      message: null,
      validation: emptyFormValidation(),
      attempt: null,
    },
    invitation: { code: null, status: 'idle', preview: null, message: null },
    share: { status: 'idle', url: null, message: null },
    groups: { status: 'idle', data: [], message: null, loaded: false },
    detail: noGroup(),
  };
}

function origin(value: string): string {
  const parsed = new URL(value);
  if (
    !['https:', 'http:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error('Configure an HTTP(S) backend origin without a path or credentials.');
  }
  return parsed.origin;
}

/** A payment whose response was lost: it may be recorded, and only an explicit retry sends it. */
const unconfirmedPayment =
  'This payment may already be recorded. Retry sends the same record, so it can’t be counted twice.';
/** A Group submission whose reply never arrived: it may exist, and only an explicit retry sends it. */
const unconfirmedGroup =
  'The Group may have been created. Check your Groups before creating another.';
/** Group creation sends nothing it couldn't store first. */
const groupNotStored =
  'This device couldn’t keep a recovery copy of the Group, so nothing was sent. Your details are kept. Try again.';
/** A stored Group submission this version can't read: it can't be resent, only discarded. */
const groupUnreadable =
  'A saved Group submission on this device can’t be read, so nothing was sent. Discard this form to continue.';
/** Another suggestion was chosen while a payment is unconfirmed: one payment at a time. */
const earlierPayment = 'This earlier payment isn’t confirmed yet, so it comes first.';
/** Only suggested payments are recorded, so one that's gone from the latest balances isn't. */
const suggestionChanged =
  'This suggested payment has changed. Close this to see the latest balances.';

/**
 * Session transport and Group/financial reads. Secure credential
 * persistence is injected by the native runtime. It never imports React or a
 * native SDK, and it never treats a raw Better Auth token as a signed cookie.
 */
export function createMobileController(config: MobileConfig, dependencies: MobileDependencies) {
  const apiBase = origin(config.apiBaseUrl);
  const authOrigin = origin(config.authOrigin);
  const inviteOrigin = origin(config.inviteOrigin ?? config.authOrigin);
  const secureTransport = apiBase.startsWith('https:');
  const googleEnabled = Boolean(
    config.googleWebClientId && secureTransport && authOrigin === apiBase,
  );
  /**
   * The Google sign-in under way: its session's generation, and whether the OS account chooser
   * is open. Another waits while the chooser is open and while this one is current. Once
   * replaced, it finishes its reply, and any revoke, without holding up the next.
   */
  let googleAttempt: { owner: number; choosing: boolean } | null = null;
  const now = dependencies.now ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot: MobileSnapshot = cleanSnapshot({ status: 'restoring', user: null, message: null });
  let cookie: string | null = null;
  /**
   * The account `get-session` confirmed `cookie` for, stored beside it. Null while unverified: a
   * cookie from a sign-in reply, or one saved before accounts were recorded.
   */
  let cookieAccount: string | null = null;
  let generation = 0;
  let viewRequest = 0;
  let settlementRequest = 0;
  let pendingRequest = 0;
  let keptDraftRequest = 0;
  let activityRequest = 0;
  let activityDetailRequest = 0;
  /**
   * The Groups the latest verified Groups list holds (null until one is read this session), and
   * those it left out. Saved copies are kept only for listed Groups and ones added since.
   */
  let listedGroups: Set<string> | null = null;
  let unlistedGroups = new Set<string>();
  let cacheEpoch = 0;
  /** Where the member is (ADR 0006, M8-2). Only `navigate` changes it. */
  let route: Route = home;
  /** The latest return's request to scroll back (`restoreScroll`); the next return asks anew. */
  let scrollRequests = 0;
  /**
   * A confirmed change's message while it shows (`shown`), which says so from the moment the change
   * is confirmed; `confirmed` keeps it true to the Group's view as its reads land (#219).
   */
  let confirmation: Confirmation | null = null;
  /** The Activity pages of a return (`GroupReread`) that a read has already shown again. */
  const rereadsShown = new WeakSet<object>();
  let offlineSession = false;
  const staleReads = new Map<string, number | null>();
  const freshness = dependencies.displayFreshnessMs ?? DISPLAY_FRESHNESS_MS;
  /** A saved copy is never fresh (ADR 0006, AMEND-2). */
  const staleTime = ({ state }: { state: { data?: unknown } }) =>
    (state.data as Envelope | undefined)?.source === 'saved' ? 0 : freshness;
  /**
   * The one owner of this controller's display reads (ADR 0006, M1-1): it fetches, joins and
   * keeps every server response a view shows, under the shared query keys (#210). No automatic
   * retries, so a failed read falls back to the saved copy at once; structural sharing on; fresh
   * for the display freshness window on TanStack's own clock, `Date.now`; never paused (M1-4,
   * M1-6). A read stays until a change, a denial or the session's end removes it.
   */
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        structuralSharing: true,
        staleTime,
        networkMode: 'always',
        // Never paused, yet a reconnect still reads again what a screen observes (M1-4).
        refetchOnReconnect: true,
        gcTime: Infinity,
      },
    },
  });
  /** Bumped when a confirmed change, denial or newer ledger read makes a scope's responses obsolete. */
  const versions = new Map<string, number>();
  const invalidatedAt = new Map<string, number>();
  /**
   * Scopes whose saved copies a change, a denial or a Groups list made obsolete but this device
   * could not remove, with when: never shown again, and deleted at the next start (#212).
   */
  const untrusted = untrustedCopies(dependencies);
  /** Groups this session lost, with the refusal and when (`losses` counts them). */
  const lostGroups = new Map<string, { status: number; at: number }>();
  let losses = 0;
  let storeQueue: Promise<unknown> = Promise.resolve();
  let cleanupRequired = false;
  let accountCleanupRequired = false;
  let accountQueue: Promise<unknown> = Promise.resolve();
  let cleanupMarkerQueue: Promise<unknown> = Promise.resolve();
  let cleanupSequence = 0;
  /**
   * A session cookie this device has given up but the server hasn't confirmed revoking. It is
   * only ever sent to `/api/auth/sign-out`, survives a new generation, and goes once the server
   * confirms, on Continue, or after sign-in has sent it once.
   */
  let revoking: string | null = null;
  /**
   * The pending sign-out has already cleared the saved invitation, so a retry keeps one opened
   * since, for whoever signs in next. Kept in the sign-out record too, for a restart.
   */
  let invitationCleared = false;
  let pendingCode: string | null = null;
  let pendingLoaded = false;
  let creationRecovery: { ownerId: string; creation: GroupCreation } | null = null;
  let pendingQueue: Promise<unknown> = Promise.resolve();
  /** Pulls and automatic refreshes still running, by the view each started on; newest last. */
  let running: Record<'pull' | 'automatic', string[]> = { pull: [], automatic: [] };

  const savePending = (code: string | null) => {
    pendingLoaded = true;
    pendingCode = code;
    const operation = pendingQueue
      .catch(() => undefined)
      .then(() =>
        code ? dependencies.pendingInvitation?.save(code) : dependencies.pendingInvitation?.clear(),
      );
    pendingQueue = operation;
    return operation;
  };

  const loadPending = async () => {
    await pendingQueue.catch(() => undefined);
    if (pendingLoaded) return;
    const code = await dependencies.pendingInvitation?.load();
    if (pendingLoaded) return;
    pendingLoaded = true;
    pendingCode = code && /^[a-f\d]{8}$/.test(code) ? code : null;
    if (code && !pendingCode) await savePending(null);
  };

  /**
   * The screen and its parameters come from the route: a Group's destination and the scroll
   * position a return asks for, and on Home no Group. Elsewhere the destination stays the last.
   */
  const placed = (next: Unrouted): MobileSnapshot => {
    const at = route,
      given: Partial<MobileSnapshot> = next;
    return {
      ...next,
      screen: at.screen,
      destination:
        at.screen === 'group' ? at.destination : (given.destination ?? snapshot.destination),
      restoreScroll: at.screen === 'group' ? at.restoreScroll : null,
      detail: at.screen === 'groups' && next.detail.id !== null ? noGroup() : next.detail,
    };
  };
  /**
   * A confirmed change's message as the Group's view now stands (#219). It says what couldn't be
   * updated only while its read after the change failed (offline too): never for a read that
   * didn't run, and no longer once one lands. It highlights the saved row only on a list read
   * after the change: never the row as it was, or while it is read again.
   */
  const confirmed = (next: MobileSnapshot, made: Confirmation) => {
    const { groupId, message, viewMonth, expenseId } = made.snackbar,
      { financial } = next,
      { expenses, balances } = financial;
    const read = groupQueries.listedSince(groupId, financial, made.change);
    const stale =
      made.subject === 'Expenses' && !read && expenses.status === 'error'
        ? 'Expenses'
        : balances.changed && balances.status === 'error'
          ? 'Balances'
          : null;
    const listed = read && !!expenseId && expenses.data.some(({ id }) => id === expenseId);
    const shown: GroupSnackbar = {
      groupId,
      message: stale ? `${message}. ${stale} couldn’t be updated yet — pull to refresh.` : message,
      viewMonth,
      ...(listed ? { expenseId } : {}),
    };
    // Unchanged, it stays the same message, so nothing shows anew.
    const before = made.shown;
    if (before.message !== shown.message || before.expenseId !== shown.expenseId)
      made.shown = shown;
    return made.shown;
  };
  const publish = (unrouted: Unrouted) => {
    let next = expenseQueries.project(groupQueries.project(homeQueries.project(placed(unrouted))));
    // Return feedback belongs to the Group view it was made for; leaving that view ends it.
    const showing = (groupId: string) => next.screen === 'group' && next.detail.id === groupId;
    if (next.snackbar && !showing(next.snackbar.groupId)) next = { ...next, snackbar: null };
    // A confirmed change's message ends once another replaces it, or it is dismissed or left.
    if (confirmation && next.snackbar !== confirmation.shown) confirmation = null;
    if (confirmation) next = { ...next, snackbar: confirmed(next, confirmation) };
    // Likewise Home's, and the Leave Group sheet belongs to Members and Group details.
    if (next.homeSnackbar && next.screen !== 'groups') next = { ...next, homeSnackbar: null };
    if (next.leave.status !== 'closed' && next.screen !== 'members')
      next = { ...next, leave: closedLeave() };
    snapshot = next;
    listeners.forEach((listener) => listener());
    homeQueries.bindLater();
    groupQueries.bindLater();
    expenseQueries.bindLater();
  };
  /**
   * The route's one writer (ADR 0006, M8-2): moves the member to `to` and publishes it, with
   * what that screen starts from (`start`). Only the member's own commands, and the end of a
   * session, call it; reads never do.
   */
  const navigate = (to: Route, start: Partial<Omit<MobileSnapshot, RouteFields>> = {}) => {
    route = to;
    // A return's request to scroll is used up, so the next return asks again.
    if (to.screen === 'group' && to.restoreScroll)
      scrollRequests = Math.max(scrollRequests, to.restoreScroll.request);
    publish({ ...snapshot, ...start });
  };
  /** Home with nothing of any account, where each session starts and ends. */
  const cleanHome = (auth: MobileSnapshot['auth']) => navigate(home, cleanSnapshot(auth));
  /** A return's pending re-read of this Group: kept on the Group view and what opens over it. */
  const rereadOf = (groupId: string) =>
    'reread' in route && route.groupId === groupId ? route.reread : null;
  /** A Group view on `destination`, which keeps a return's pending re-read of that Group. */
  const groupAt = (
    groupId: string,
    destination: GroupDestination,
    reread = rereadOf(groupId),
  ): GroupRoute => ({ screen: 'group', groupId, destination, restoreScroll: null, reread });
  const current = (owner: number) => owner === generation;
  /** The snapshot now, after an await that TypeScript's earlier narrowing doesn't see. */
  const latest = (): MobileSnapshot => snapshot;
  const assertCurrent = (owner: number) => {
    if (!current(owner)) throw new Superseded();
  };
  const invalidate = () => {
    generation += 1;
    cacheEpoch += 1;
    offlineSession = false;
    staleReads.clear();
    versions.clear();
    invalidatedAt.clear();
    untrusted.clear();
    running = { pull: [], automatic: [] };
    viewRequest += 1;
    listedGroups = null;
    unlistedGroups = new Set();
    confirmation = null;
    lostGroups.clear();
    // Nothing read for the session that ended is reused, joined, shown or saved (M10-2).
    homeQueries.reset();
    groupQueries.reset();
    expenseQueries.reset();
    queryClient.clear();
    transport.abortAll();
    cookie = null;
    cookieAccount = null;
    return generation;
  };

  // Serialize SecureStore operations as well as guarding UI responses. A save
  // already executing when logout occurs must finish before logout's clear.
  const store = <T>(owner: number, operation: () => Promise<T>): Promise<T> => {
    const result = storeQueue
      .catch(() => undefined)
      .then(async () => {
        assertCurrent(owner);
        const value = await operation();
        assertCurrent(owner);
        return value;
      });
    storeQueue = result;
    return result;
  };

  const clearSaved = async (owner: number) => {
    cleanupRequired = true;
    await store(owner, () => dependencies.credentials.clear());
    cleanupRequired = false;
  };

  const queueAccount = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = accountQueue.catch(() => undefined).then(operation);
    accountQueue = result;
    return result;
  };

  const accountStorage = (): AccountStorageLease | null => {
    if (
      !dependencies.accountLocal ||
      snapshot.auth.status !== 'authenticated' ||
      !snapshot.auth.user ||
      accountCleanupRequired
    )
      return null;
    const owner = generation;
    const accountId = snapshot.auth.user.id;
    return {
      accountId,
      write: <T>(operation: () => Promise<T>) =>
        queueAccount(async () => {
          assertCurrent(owner);
          if (
            snapshot.auth.status !== 'authenticated' ||
            snapshot.auth.user?.id !== accountId ||
            accountCleanupRequired
          )
            throw new Superseded();
          const result = await operation();
          assertCurrent(owner);
          return result;
        }),
    };
  };

  /** The session cookie in the saved session, or null when there is none to send. */
  const savedCookie = async (owner: number) => {
    const saved = await store(owner, () => dependencies.credentials.load());
    return saved ? (decodeStoredSession(saved, secureTransport)?.cookie ?? null) : null;
  };

  /**
   * Revokes a session this device has given up, with its cookie: the one kept in `revoking`, or
   * else the saved one. It goes only to `/api/auth/sign-out`, and `request` sends nothing to a
   * backend that fails the Google check. Once the server confirms (2xx) the saved cookie is
   * cleared; otherwise it stays for a retry, unless `once` (sign-in sends a pending revoke once,
   * whatever the answer). Resolves whether anything is left to revoke.
   */
  const revokeSession = async (owner: number, once = false) => {
    revoking ??= await savedCookie(owner);
    const target = revoking;
    if (!target) return true;
    let confirmed = false;
    try {
      await request('/api/auth/sign-out', owner, {
        method: 'POST',
        body: {},
        sessionCookie: target,
        logout: true,
      });
      confirmed = true;
    } catch (error) {
      if (error instanceof Superseded) throw error;
    }
    if (!confirmed && !once) return false;
    if (revoking === target) revoking = null;
    await clearSaved(owner);
    return true;
  };

  /**
   * Revokes the session a sign-in's reply set after something replaced that sign-in. It was
   * never adopted or saved. It goes only to `/api/auth/sign-out`, and once, whatever the answer,
   * as a sign-in sends a pending revoke: whatever replaced the sign-in has moved on. It belongs
   * to no session, so a later session change, or `dispose`, never stops it, and nothing is sent
   * to a backend that fails the Google check.
   */
  const revokeAbandoned = async (abandoned: string) => {
    await revokeDetached(abandoned);
  };

  /**
   * Purges account-local data. A sign-out also revokes its session alongside the purge, so a
   * failed purge never skips the revoke and a slow revoke never delays the purge. The cleanup
   * marker is cleared only once both are done. Rejects with AccountCleanupError when anything
   * local fails; otherwise resolves whether the server confirmed the revoke (see `revokeSession`).
   */
  const clearAccount = (owner: number, mode: 'sign-out' | 'account-change', once = false) => {
    accountCleanupRequired = true;
    const cleanupId = ++cleanupSequence;
    // A retry keeps an invitation opened since the sign-out first cleared it.
    const clearsInvitation = mode === 'sign-out' && !invitationCleared;
    // Persist logout intent before waiting for an older financial write, and before the saved
    // cookie can go. A terminated process must not leave a restorable account.
    const marking = cleanupMarkerQueue
      .catch(() => undefined)
      .then(async () => {
        assertCurrent(owner);
        const [marker] = await Promise.allSettled([
          dependencies.accountLocal?.cleanupMarker.mark(),
          ...(mode === 'sign-out'
            ? [dependencies.accountLocal?.signOutRecord?.mark({ invitationCleared })]
            : []),
        ]);
        if (marker.status === 'rejected') throw marker.reason;
      });
    cleanupMarkerQueue = marking;
    // The marker keeps the saved cookie until the server confirms. Without it the cookie can't
    // wait: it goes at once (the sign-out record still blocks a restore if that fails too), and
    // the revoke is sent from memory.
    const revoked =
      mode === 'sign-out'
        ? marking
            .then(
              () => Boolean(dependencies.accountLocal),
              () => false,
            )
            .then(async (kept) => {
              if (!kept) {
                revoking ??= await savedCookie(owner);
                await Promise.allSettled([clearSaved(owner)]);
              }
              return revokeSession(owner, once);
            })
        : Promise.resolve(true);
    const immediate = Promise.allSettled([
      marking,
      ...(clearsInvitation
        ? [
            savePending(null).then(() => {
              invitationCleared = true;
            }),
          ]
        : []),
    ]);
    const purged = queueAccount(async () => {
      assertCurrent(owner);
      // A saved copy being written finishes first; those waiting were cancelled (M3-2).
      await Promise.all([homeQueries.idle(), groupQueries.idle(), expenseQueries.idle()]);
      const cleanup = await Promise.allSettled([
        Promise.resolve().then(() => dependencies.accountLocal?.owner.clear()),
        ...(dependencies.accountLocal?.stores.map((storage) =>
          Promise.resolve().then(() => storage.clear()),
        ) ?? []),
      ]);
      if ([...(await immediate), ...cleanup].some((result) => result.status === 'rejected')) {
        if (mode === 'account-change') {
          // The new account's session goes too: revoked first, then its saved cookie cleared.
          // It's no longer held, so the failed sign-in doesn't revoke it again.
          if (cookie && current(owner)) {
            revoking = cookie;
            cookie = null;
          }
          if (!(await revokeSession(owner).catch(() => false)))
            await Promise.allSettled([clearSaved(owner)]);
        }
        throw new AccountCleanupError();
      }
    });
    return Promise.allSettled([purged, revoked]).then(async (results) => {
      const [purge, revoke] = results;
      const done = purge.status === 'fulfilled' && revoke.status === 'fulfilled' && revoke.value;
      // A sign-out left pending records that its invitation is cleared, so a restart keeps one
      // opened since. Never after a newer cleanup, which may have finished the sign-out.
      if (!done && clearsInvitation && invitationCleared) {
        const recording = cleanupMarkerQueue
          .catch(() => undefined)
          .then(async () => {
            assertCurrent(owner);
            if (cleanupId !== cleanupSequence) throw new Superseded();
            await dependencies.accountLocal?.signOutRecord?.mark({ invitationCleared: true });
          });
        cleanupMarkerQueue = recording;
        await Promise.allSettled([recording]);
      }
      for (const result of results)
        if (result.status === 'rejected') {
          if (result.reason instanceof Superseded) throw result.reason;
          throw new AccountCleanupError();
        }
      if (!done) return false;
      try {
        assertCurrent(owner);
        const clearing = cleanupMarkerQueue
          .catch(() => undefined)
          .then(async () => {
            assertCurrent(owner);
            if (cleanupId !== cleanupSequence) throw new Superseded();
            await Promise.all([
              dependencies.accountLocal?.cleanupMarker.clear(),
              ...(mode === 'sign-out' ? [dependencies.accountLocal?.signOutRecord?.clear()] : []),
            ]);
            if (cleanupId === cleanupSequence) {
              accountCleanupRequired = false;
              invitationCleared = false;
            }
          });
        cleanupMarkerQueue = clearing;
        await clearing;
      } catch {
        throw new AccountCleanupError();
      }
      return true;
    });
  };

  /**
   * Before a restore or sign-in, finishes a sign-out this device hasn't: one recorded on disk
   * (the cleanup marker or the sign-out record) or still running here, purging and revoking as
   * sign-out does; or else a revoke kept only in memory, with nothing to purge. Resolves false
   * while the server hasn't confirmed the revoke. `once` (sign-in) sends it once regardless.
   */
  const finishSignOut = async (owner: number, once = false) => {
    try {
      const [marked, recorded] = await Promise.all([
        dependencies.accountLocal?.cleanupMarker.load(),
        // A sign-out record this device can't read blocks nothing: the marker is the main record.
        dependencies.accountLocal?.signOutRecord?.load().catch(() => null),
      ]);
      assertCurrent(owner);
      if (recorded?.invitationCleared) invitationCleared = true;
      if (marked || recorded || accountCleanupRequired)
        return await clearAccount(owner, 'sign-out', once);
      return revoking ? await revokeSession(owner, once) : true;
    } catch (error) {
      if (error instanceof Superseded) throw error;
      throw new AccountCleanupError();
    }
  };

  /** The server hasn't confirmed revoking a session: nothing of an account, and Try again. */
  const showUnconfirmedSignOut = (owner: number) => {
    if (!current(owner)) return;
    const cleared = cleanSnapshot({
      status: 'sign-out-unconfirmed',
      user: null,
      message: unconfirmedSignOut,
    });
    navigate(home, { ...cleared, invitation: { ...cleared.invitation, code: pendingCode } });
  };

  const failSession = async (
    owner: number,
    message: string,
    status: 'signed-out' | 'error' = 'signed-out',
    /** A session cookie this device couldn't keep: revoked from memory before the clear. */
    unsaved: string | null = null,
  ) => {
    if (!current(owner)) return;
    if (snapshot.auth.user && (snapshot.creation.draft.name || snapshot.screen === 'create')) {
      creationRecovery = {
        ownerId: snapshot.auth.user.id,
        creation: {
          ...snapshot.creation,
          ...(snapshot.creation.status === 'saving'
            ? ({
                status: 'uncertain',
                message:
                  'The Group may have been created. Check your Groups before creating another.',
              } as const)
            : {}),
        },
      };
    }
    const next = invalidate();
    const cleared = cleanSnapshot({ status, user: null, message });
    navigate(home, { ...cleared, invitation: { ...cleared.invitation, code: pendingCode } });
    let confirmed = true;
    if (unsaved) {
      revoking = unsaved;
      // Superseded: the restore or sign-in that replaced this sends it. A failed clear shows below.
      confirmed = await revokeSession(next).catch(() => true);
    }
    try {
      await clearSaved(next);
    } catch {
      if (current(next)) {
        cleanHome({
          status: 'error',
          user: null,
          message: 'Could not remove the saved session. Try signing out again.',
        });
      }
      return;
    }
    if (!confirmed) showUnconfirmedSignOut(next);
  };

  const transport = createTransport({
    apiBase,
    authOrigin,
    secureTransport,
    googleEnabled,
    googleWebClientId: config.googleWebClientId,
    fetch: dependencies.fetch,
    now,
    timer: dependencies.timer,
    session: {
      current,
      cookie: () => cookie,
      saveCookie: async (owner, next) => {
        // A server refresh of a verified cookie keeps its account; any other cookie is unverified.
        await store(owner, () =>
          dependencies.credentials.save(encodeStoredSession(next, cookieAccount)),
        );
        assertCurrent(owner);
        cookie = next;
      },
    },
    onExpired: failSession,
    // Today's denial purge: its reads, saved copies and content on screen go.
    onGroupDenied: (groupId, status, owner) => forgetGroup(groupId, status, owner),
    // Balances and Home follow every read of a Group or its Expenses (M1-5, AMEND-1); an Expense
    // list read also leaves their saved copies from before it unshown (#191).
    onLedgerRead: (groupId, owner, expenses) => {
      if (current(owner)) (expenses ? invalidateReads : outdate)(`balances:${groupId}`, 'home');
    },
  });
  const { request, verifyGoogleBackend, revokeDetached } = transport;

  /**
   * A read answered: from the server (`saved` undefined), or from this device's copy saved at
   * `saved`. The Group's view reads a page at a time, so for it only a change of what the
   * offline banner says publishes (`onlyChanges`, #219).
   */
  const answered = (path: string, saved?: number | null, onlyChanges = false) => {
    offlineSession ||= saved !== undefined;
    if (saved === undefined) staleReads.delete(path);
    else staleReads.set(path, saved);
    publishReadFreshness({ onlyChanges });
  };
  /** The session the declarative views read in: their queries, saved copies and checks. */
  const session = {
    client: queryClient,
    rows: dependencies.savedQueries,
    account: () => account(),
    generation: () => generation,
    current,
    snapshot: latest,
    // Their reads publish their answer wherever the member is (#190): the snapshot follows them.
    publish: (next: Partial<MobileSnapshot>) => publish({ ...snapshot, ...next }),
    lease: () => accountStorage(),
    owns: (accountId: string) => accountStorage()?.accountId === accountId,
    versionOf: (key: QueryKey) => versionOf(key),
    distrusted: (key: QueryKey, early: boolean) =>
      Math.max(scoped(untrusted, key) ?? -Infinity, early ? (scoped(invalidatedAt, key) ?? 0) : 0),
    read: async (path: string, owner: number, signal?: AbortSignal) => {
      if (offlineSession || snapshot.offline.active) await revalidateSession(owner);
      return request(path, owner, { signal });
    },
    answered: (path: string, saved?: number | null) => answered(path, saved),
    now,
  };
  /** Home's two queries and their saved copies (ADR 0006, M1-1, M3-1). */
  const homeQueries = createHomeQueries({
    ...session,
    environment: apiBase,
    drafts: dependencies.expenseDrafts,
    shows: () => route.screen === 'groups' && snapshot.auth.status === 'authenticated',
    listed: (listed, lost) => {
      [listedGroups, unlistedGroups] = [listed, lost];
      for (const id of lost)
        invalidateReads(`group:${id}`, `ledger:${id}`, `balances:${id}`, 'home');
    },
    // In both stores: the older one's copies, and the Group views' rows on the persister.
    retain: async (accountId, listed) => {
      await dependencies.readCache?.retainGroups(accountId, listed);
      await groupQueries.retain(accountId, listed);
      await expenseQueries.retain(accountId, listed);
    },
    distrust: (accountId, scopes) => untrusted.mark(accountId, scopes, now()),
    invalidate: (...scopes) => invalidateReads(...scopes),
  });
  /** A Group's own view: the Group, its Expenses and its Balances (ADR 0006, M1-1, #219). */
  const groupQueries = createGroupQueries({
    ...session,
    answered: (path, saved) => answered(path, saved, true),
    route: () => route,
    savable: (key) => savable(key),
    freshness,
    offline: () => offlineSession || snapshot.offline.active,
    lose: (groupId, owner) => forgetGroup(groupId, 403, owner),
    expensesRead: (groupId, fresh) => {
      // A list read again from its start no longer shows the saved copies its pages showed.
      if (fresh)
        for (const path of staleReads.keys())
          if (path.startsWith(`/api/groups/${groupId}/expenses?`)) staleReads.delete(path);
      // Expense reads can add due recurring Expenses. Older Home and Balances no longer describe
      // the same ledger: they stay on screen, unverified, until read again after it (M1-5).
      invalidateReads(`balances:${groupId}`, 'home');
      const { home, financial } = snapshot,
        shown = financial.groupId === groupId ? financial.balances : null;
      // Each page of a read reports here: only what it changes on screen is published.
      if (
        home.status === 'idle' &&
        home.message === null &&
        home.stale === (home.data !== null) &&
        (!shown ||
          (shown.status === 'loading' &&
            shown.message === null &&
            shown.stale === (shown.data !== null)))
      )
        return;
      publish({
        ...snapshot,
        home: { ...home, status: 'idle', message: null, stale: home.data !== null },
        financial:
          financial.groupId !== groupId
            ? financial
            : {
                ...financial,
                balances: {
                  ...financial.balances,
                  status: 'loading',
                  message: null,
                  stale: financial.balances.data !== null,
                },
              },
      });
    },
  });
  /** An Expense record, its Group and its history (ADR 0006, M1-1, #220). */
  const expenseQueries = createExpenseQueries({
    ...session,
    answered: (path, saved) => answered(path, saved, true),
    route: () => route,
    savable: (key) => savable(key),
    freshness,
    offline: () => offlineSession || snapshot.offline.active,
    group: {
      options: (groupId) => groupQueries.groupOptions(groupId),
      read: (groupId, owner, options) => groupQueries.readGroup(groupId, owner, options),
    },
    checkSession: (owner) => checkSession(owner),
    refused: (groupId, error) => refuseExpenseGroup(groupId, error),
    gone: (paths) => {
      // The Group was just read: what's missing is this Expense, and nothing saved of it shows.
      for (const path of staleReads.keys())
        if (paths.some((prefix) => path.startsWith(prefix))) staleReads.delete(path);
      // An edit stays with its Group's details, and a save in flight is its own: saving either is
      // refused as for any missing Expense.
      if (['detail', 'delete-review'].includes(snapshot.expense.status))
        publish({ ...snapshot, expense: withdrawExpense('This Expense isn’t available.') });
    },
  });
  const listening = [
    homeQueries.listen(focusManager, onlineManager, dependencies.netInfo),
    groupQueries.listen(focusManager, onlineManager),
    expenseQueries.listen(focusManager, onlineManager),
  ];
  const disconnect = () => listening.forEach((stop) => stop());

  /**
   * Records the cookie, on disk, for the account `get-session` just confirmed. Only a recorded
   * cookie can show that account's saved content on a restart or restore it offline, so on an
   * account change this runs once the purge has finished and the new owner is saved.
   */
  const recordCookieAccount = async (owner: number, accountId: string) => {
    if (cookieAccount === accountId) return;
    try {
      await store(owner, () => {
        if (!cookie) throw new Superseded();
        return dependencies.credentials.save(encodeStoredSession(cookie, accountId));
      });
      cookieAccount = accountId;
    } catch (error) {
      if (!(error instanceof Superseded)) await failSession(owner, storageMessage, 'error', cookie);
      throw new Superseded();
    }
  };

  const publishReadFreshness = ({ onlyChanges = false } = {}) => {
    const visible = [...staleReads.entries()].filter(([path]) => {
      const home = path === '/api/groups' || path === '/api/user/balances';
      return snapshot.screen === 'groups' ? home : !home;
    });
    const times = visible
      .map(([, time]) => time)
      .filter((value): value is number => value !== null);
    const active = offlineSession || visible.length > 0,
      refreshedAt = times.length ? Math.min(...times) : null;
    if (
      onlyChanges &&
      snapshot.offline.active === active &&
      snapshot.offline.refreshedAt === refreshedAt
    )
      return;
    publish({ ...snapshot, offline: { ...snapshot.offline, active, refreshedAt } });
  };
  const startReadView = () => {
    // Home remains in memory while a child view is open, including its provenance.
    for (const path of staleReads.keys())
      if (path !== '/api/groups' && path !== '/api/user/balances') staleReads.delete(path);
    publishReadFreshness();
  };

  const saveVerifiedIdentity = async (
    session: NonNullable<ReturnType<typeof parseSession>>,
    owner: number,
  ) => {
    const lease = accountStorage();
    if (lease && dependencies.offlineIdentity) {
      try {
        await lease.write(() =>
          dependencies.offlineIdentity!.save({
            user: session.user,
            session: { userId: session.user.id, expiresAt: session.expiresAt.toISOString() },
          }),
        );
      } catch (error) {
        if (!current(owner) || error instanceof Superseded) throw error;
      }
    }
  };

  /** Reads that need the session checked first, as on a reconnect, share one check. */
  const revalidateSession = singleFlight(async (owner: number) => {
    await verifyGoogleBackend(owner);
    const session = parseSession(await request('/api/auth/get-session', owner));
    assertCurrent(owner);
    if (
      !session ||
      session.expiresAt.getTime() <= now() ||
      session.user.id !== snapshot.auth.user?.id
    ) {
      await failSession(owner, expiredMessage);
      throw new Superseded();
    }
    offlineSession = false;
    await saveVerifiedIdentity(session, owner);
  });
  /** The session check before a screen over a Group reads it again; offline, saved copies show. */
  const checkSession = async (owner: number) => {
    try {
      await revalidateSession(owner);
    } catch (error) {
      if (!(error instanceof RequestError) || !error.networkFailure || !dependencies.readCache)
        throw error;
      offlineSession = true;
    }
  };

  /** The signed-in account in the environment the app reads from: every query key holds both. */
  const account = () => {
    if (!snapshot.auth.user) throw new Superseded();
    return { environment: apiBase, accountId: snapshot.auth.user.id };
  };
  /** A page of 20 of the Group's Activity events. */
  const activityKey = (groupId: string, page: number) =>
    activityPageKey(account(), groupId, { page, limit: 20 });

  const versionOf = (key: QueryKey) => scoped(versions, key) ?? 0;

  /**
   * Saved copies are kept only for Groups the latest Groups list holds, or that Home has gained
   * since (a Group just created). One the list leaves out, such as an archived Group the member
   * can still open, is shown but never saved.
   */
  const savable = (key: QueryKey) => {
    const id = key.length === 5 ? key[3] : null;
    return (
      !id ||
      !listedGroups ||
      listedGroups.has(id) ||
      (!unlistedGroups.has(id) && snapshot.groups.data.some((group) => group.id === id))
    );
  };

  /**
   * Responses in these scopes are obsolete: they are no longer reused, shown from the
   * saved copy this session, joined, or saved again. Their next display reads again.
   */
  const invalidateReads = (...scopes: string[]) => {
    const time = now();
    for (const scope of scopes) invalidatedAt.set(scope, time);
    outdate(...scopes);
  };
  /**
   * Reads in these scopes are out of date: not reused, joined or saved. Their queries go, and a read
   * of them still in flight is cancelled: whoever still shows it, Home's observers too, reads again.
   */
  const outdate = (...scopes: string[]) => {
    for (const scope of scopes) versions.set(scope, (versions.get(scope) ?? 0) + 1);
    queryClient.removeQueries({
      predicate: ({ queryKey }) => scopes.some((scope) => inScope(scope)(queryKey)),
    });
    homeQueries.rebind();
    groupQueries.rebind();
    expenseQueries.rebind();
  };
  /** A confirmed Expense or Settlement change affects every page, Month, Balance, Home and Activity view. */
  const ledgerChanged = (groupId: string) =>
    invalidateReads(`ledger:${groupId}`, `balances:${groupId}`, 'home');
  /**
   * Their saved copies on this device go too, including each record and its history, and Home's
   * totals (M2-2). The removal is queued ahead of every later save or load of a saved copy, so
   * none of them sees an older one. A copy that can't be removed is no longer trusted this
   * session; the member is never signed out for it.
   */
  const removeLedgerCopies = async (groupId: string, owner: number) => {
    const lease = accountStorage(),
      time = now();
    if (!lease) return;
    try {
      await lease.write(async () => {
        await dependencies.readCache?.invalidateLedger(lease.accountId, groupId);
        await groupQueries.forget(lease.accountId, groupId, 'ledger');
        await expenseQueries.forget(lease.accountId, groupId);
        await homeQueries.forget(lease.accountId, [homePath]);
      });
    } catch (error) {
      if (current(owner) && !(error instanceof Superseded))
        untrusted.mark(lease.accountId, [`ledger:${groupId}`, `balances:${groupId}`, 'home'], time);
    }
  };

  /**
   * The request behind each query's latest read. When the query cache cancels a read, whoever
   * sent or joined it waits for that request, and takes a refusal it answered with.
   */
  const requests = new WeakMap<object, Promise<Envelope>>();

  /**
   * One network read through the query cache: a read of the same key already in flight is
   * joined, never sent twice, and a confirmed change or denial cancels one it made obsolete.
   * `validate` runs before anything is kept, so a malformed response is never reused or saved.
   * The answer is saved on this device for offline use, unless it is obsolete by then.
   */
  const fetchRead = (key: QueryKey, owner: number, validate: (value: unknown) => unknown) => {
    let started: Promise<Envelope> | undefined;
    const read = async ({ signal }: QueryFunctionContext): Promise<Envelope> => {
      const path = queryKeyPath(key),
        version = versionOf(key),
        lease = accountStorage(),
        epoch = cacheEpoch;
      if (offlineSession || snapshot.offline.active) await revalidateSession(owner);
      // A cancel ends it as cancelled, never as a network failure: it is never offline.
      const value = await request(path, owner, { signal });
      validate(value);
      // Verified on the query cache's clock, which decides its freshness too.
      const verified: Envelope = { source: 'network', refreshedAt: Date.now(), value };
      if (!current(owner) || version !== versionOf(key) || !lease || !dependencies.readCache)
        return verified;
      try {
        await lease.write(async () => {
          if (epoch !== cacheEpoch || version !== versionOf(key) || !savable(key))
            throw new Superseded();
          await dependencies.readCache!.save(lease.accountId, path, {
            version: 1,
            accountId: lease.accountId,
            path,
            refreshedAt: verified.refreshedAt,
            value,
          });
        });
      } catch (error) {
        if (!current(owner)) throw new Superseded();
        // A newer cache epoch only means this response isn't saved; it still answers its
        // callers. A response for a Group since lost is obsolete by version and read again.
        if (!(error instanceof Superseded) && epoch === cacheEpoch)
          publish({
            ...snapshot,
            offline: {
              ...snapshot.offline,
              message: 'Could not save this view for offline use. Online data is still available.',
            },
          });
      }
      return verified;
    };
    const options = queryClient.defaultQueryOptions({
      queryKey: key,
      queryFn: (context: QueryFunctionContext) => (started = read(context)),
    });
    // Always a read: whether a verified one may be reused instead is the caller's (freshRead).
    const query = queryClient.getQueryCache().build(queryClient, options);
    const fetching = query.fetch(options);
    if (started) requests.set(query, started);
    // The request behind the read, whether this call sent it or joined it.
    return { fetching, request: requests.get(query) };
  };

  /**
   * Explicitly opt in display reads only; request() and every mutation stay live.
   * `wanted` says whether the caller still shows this read; only then is an obsolete
   * response read again.
   */
  const readCached = async <T>(
    key: QueryKey,
    owner: number,
    parse: (value: unknown) => T,
    wanted?: () => boolean,
  ): Promise<T> => {
    const path = queryKeyPath(key),
      lease = accountStorage(),
      view = viewRequest,
      epoch = cacheEpoch,
      startVersion = versionOf(key),
      shown = wanted ?? (() => view === viewRequest),
      lostBefore = losses;
    try {
      let result: Envelope | null = null;
      // A confirmed change or denial during the read cancelled it, as obsolete: while the caller
      // still shows it, read again, joining the read that change already started where there is
      // one. Each cancel takes a change of its own, so this ends; an obsolete answer is never
      // shown. A cancel is never a failure to reach the server, so it never falls back to the
      // saved copy.
      while (!result) {
        const read = fetchRead(key, owner, parse);
        try {
          result = await read.fetching;
        } catch (error) {
          if (!(error instanceof CancelledError)) throw error;
          // The request ends first, so whatever its answer set off has finished: a session
          // that ended, or a Group whose refusal is this read's answer.
          const answer = await read.request?.then(
            () => null,
            (failure: unknown) => failure,
          );
          if (!current(owner) || answer instanceof Superseded) throw new Superseded();
          if (answer instanceof RequestError && answer.kind !== 'cancelled') throw answer;
          // Losing its Group cancelled it: that refusal is its answer, so it's never sent again.
          const loss = key.length === 5 ? lostGroups.get(key[3]) : undefined;
          if (loss && loss.at > lostBefore) throw refusal(loss.status);
          if (!shown()) throw new Obsolete();
        }
      }
      const parsed = parse(result.value);
      if (view === viewRequest && current(owner)) {
        staleReads.delete(path);
        publishReadFreshness();
      }
      return parsed;
    } catch (error) {
      if (
        !(error instanceof RequestError) ||
        !error.networkFailure ||
        !lease ||
        !dependencies.readCache
      )
        throw error;
      // A newer cache epoch, or a change, denial or Groups list that made this path obsolete,
      // may have dropped the saved copy read here: read again, while the caller still shows it.
      const overtaken = () => epoch !== cacheEpoch || startVersion !== versionOf(key);
      const again = () => {
        if (!current(owner) || !shown()) throw new Superseded();
        return readCached(key, owner, parse, wanted);
      };
      if (overtaken()) return again();
      const stored = await lease.write(() => dependencies.readCache!.load(lease.accountId, path));
      const copy = cachedRead(stored, lease.accountId, path, now());
      // As in peek, a saved copy older than a change it couldn't be removed for is never shown.
      const cached = copy && copy.refreshedAt > (scoped(untrusted, key) ?? -Infinity) ? copy : null;
      if (!current(owner)) throw new Superseded();
      if (overtaken()) return again();
      if (view === viewRequest) {
        offlineSession = true;
        staleReads.set(path, cached?.refreshedAt ?? null);
        publishReadFreshness();
      }
      // The server couldn't be reached, and this read already fell back: nothing more to try.
      if (!cached)
        throw new RequestError(notSaved, 0, 'OFFLINE_UNAVAILABLE', false, null, 'network');
      return parse(cached.value);
    }
  };

  /** The saved Home shown while checking, kept for the same account so it never blanks. */
  const savedHome = (userId: string) =>
    snapshot.auth.status === 'restoring' && snapshot.auth.user?.id === userId
      ? { groups: snapshot.groups, home: snapshot.home, drafts: snapshot.drafts }
      : {};

  /**
   * Cold start: whose data this device holds (its owner) and the identity last verified for it,
   * read at once beside the session cookie. Null when either can't be read.
   */
  const readDeviceAccount = async () => {
    const local = dependencies.accountLocal;
    if (!local) return null;
    try {
      const [accountId, stored] = await Promise.all([
        local.owner.load(),
        dependencies.offlineIdentity?.load() ?? null,
      ]);
      return { accountId, identity: parseSession(stored ?? null) };
    } catch {
      return null;
    }
  };

  /**
   * Cold start: the saved Home of the account that last signed in on this device, from the
   * persister's rows and this device's drafts (`homeQueries.preview`). Null without one.
   */
  const readSavedHome = async (device: ReturnType<typeof readDeviceAccount>) => {
    if (!dependencies.offlineIdentity) return null;
    try {
      const { accountId = null, identity: session = null } = (await device) ?? {};
      if (!accountId || !session || session.user.id !== accountId) return null;
      if (session.expiresAt.getTime() <= now()) return null;
      const drafts = (async () => (await dependencies.expenseDrafts?.list?.(accountId)) ?? [])();
      const saved = await homeQueries.preview(accountId, drafts);
      return saved && { ...saved, auth: { status: 'restoring' as const, user: session.user } };
    } catch {
      // Without a readable saved copy, the session check shows on its own.
      return null;
    }
  };

  /**
   * Shown while the session is checked, and only when the cookie is recorded for the account it
   * belongs to; never once a sign-out cleanup has started. `auth.status` stays 'restoring', so
   * nothing is sent and every action waits for the check.
   */
  const showSavedHome = (owner: number, saved: Awaited<ReturnType<typeof readSavedHome>>) => {
    if (!saved || !current(owner) || accountCleanupRequired || saved.auth.user.id !== cookieAccount)
      return;
    publish({ ...snapshot, ...saved, auth: { ...saved.auth, message: null } });
  };

  /**
   * This account's stored Group submission, reopened as uncertain. Nothing is sent here. An
   * unreadable record is left as it is; Create looks for it again before sending anything.
   */
  const storedCreation = async (
    owner: number,
    accountId: string,
  ): Promise<{ creation?: GroupCreation }> => {
    const storage = dependencies.groupCreations;
    if (!storage || !dependencies.accountLocal) return {};
    try {
      const stored = await queueAccount(() => storage.load(accountId));
      assertCurrent(owner);
      if (stored === null) return {};
      const { draft, attempt } = parseGroupCreation(stored, accountId);
      return {
        creation: {
          draft,
          attempt,
          status: 'uncertain',
          message: unconfirmedGroup,
          validation: emptyFormValidation(),
        },
      };
    } catch (error) {
      if (error instanceof Superseded) throw error;
      return {};
    }
  };

  /** Only a cookie recorded for this device's owner, and that owner's identity, restore offline. */
  const restoreOffline = async (owner: number) => {
    if (
      !cookie ||
      !cookieAccount ||
      !dependencies.accountLocal ||
      !dependencies.offlineIdentity ||
      !dependencies.savedQueries
    )
      return false;
    try {
      const accountId = await dependencies.accountLocal.owner.load();
      const session = parseSession(await dependencies.offlineIdentity.load());
      assertCurrent(owner);
      if (
        !session ||
        session.user.id !== accountId ||
        accountId !== cookieAccount ||
        session.expiresAt.getTime() <= now()
      )
        return false;
      const recovered = await storedCreation(owner, session.user.id);
      offlineSession = true;
      openHome(session.user, {
        ...recovered,
        offline: { active: true, refreshedAt: null, message: null },
      });
      await homeQueries.settle(owner);
      return true;
    } catch (error) {
      if (error instanceof Superseded) throw error;
      return false;
    }
  };

  /** Home in a session just confirmed or restored offline: its figures wait for its first list. */
  const openHome = (user: NonNullable<MobileSnapshot['auth']['user']>, start = {}) => {
    homeQueries.hold();
    const signedIn = cleanSnapshot({ status: 'authenticated', user, message: null });
    navigate(home, { ...signedIn, ...savedHome(user.id), ...start });
  };
  /** Home, with the Groups list read again now (Check Groups, joining): it shows it loading. */
  const listOnHome = (owner: number) => {
    startReadView();
    return homeQueries.listFirst(owner, () => navigate(home));
  };
  /** Every way back to Home, whose content shows where it came from, even a list read elsewhere. */
  const backHome = () => homeQueries.back(publishReadFreshness);

  const verifyAndLoad = async (owner: number) => {
    await verifyGoogleBackend(owner);
    const session = parseSession(await request('/api/auth/get-session', owner));
    assertCurrent(owner);
    if (!session || session.expiresAt.getTime() <= now()) {
      await failSession(owner, expiredMessage);
      return;
    }
    // A saved Home of another account goes before that account's data is cleared.
    if (snapshot.auth.user && snapshot.auth.user.id !== session.user.id)
      cleanHome({ status: 'restoring', user: null, message: null });
    if (dependencies.accountLocal) {
      try {
        const savedOwner = await dependencies.accountLocal.owner.load();
        assertCurrent(owner);
        if (savedOwner !== session.user.id) {
          await clearAccount(owner, 'account-change');
          await queueAccount(async () => {
            assertCurrent(owner);
            await dependencies.accountLocal!.owner.save(session.user.id);
            assertCurrent(owner);
          });
        }
      } catch (error) {
        if (error instanceof Superseded) throw error;
        throw new AccountCleanupError();
      }
    }
    await recordCookieAccount(owner, session.user.id);
    await queueAccount(() => untrusted.drop());
    // A Group submission stored on this device reopens before anything else can be created.
    openHome(session.user, await storedCreation(owner, session.user.id));
    await saveVerifiedIdentity(session, owner);
    await homeQueries.settle(owner);
    if (!current(owner)) return;
    if (creationRecovery?.ownerId === session.user.id) {
      navigate(creationRecovery.creation.status === 'uncertain' ? home : { screen: 'create' }, {
        creation: creationRecovery.creation,
      });
    }
    creationRecovery = null;
    if (current(owner) && pendingCode) await previewInvitation(pendingCode);
  };

  /** Offline fallbacks and reused reads keep their original time. */
  const readAt = (key: QueryKey) => {
    const path = queryKeyPath(key);
    return staleReads.has(path)
      ? (staleReads.get(path) ?? null)
      : (queryClient.getQueryData<Envelope>(key)?.refreshedAt ?? Date.now());
  };

  /** Refresh and Retry always read again. */
  const refreshHome = () => homeQueries.refresh();

  /**
   * `quiet`: a return to the foreground after Continue. It retries a pending revoke but stays on
   * the sign-in screen, never the session check or the unconfirmed sign-out again.
   */
  const restore = async (quiet = false) => {
    const owner = invalidate();
    if (!quiet) cleanHome({ status: 'restoring', user: null, message: null });
    try {
      // A pending sign-out is finished first. Its cookie is only ever sent to revoke it: never
      // read with, restored offline or previewed with its saved Home.
      if (!(await finishSignOut(owner))) {
        await loadPending();
        assertCurrent(owner);
        if (!quiet) showUnconfirmedSignOut(owner);
        return;
      }
      if (!config.developmentPersonaEnabled && !googleEnabled) {
        await clearSaved(owner);
        cleanHome({ status: 'signed-out', user: null, message: disabledMessage });
        return;
      }
      if (cleanupRequired) await clearSaved(owner);
      // Any pending sign-out cleanup has finished, and saved copies this device couldn't remove
      // are gone, so its saved Home can be read, alongside the session cookie, before any request.
      await queueAccount(() => untrusted.drop());
      const device = readDeviceAccount();
      const deviceHome = readSavedHome(device);
      await loadPending();
      assertCurrent(owner);
      const saved = await store(owner, () => dependencies.credentials.load());
      if (!saved) {
        cleanHome({ status: 'signed-out', user: null, message: null });
        if (pendingCode) await previewInvitation(pendingCode);
        return;
      }
      const session = decodeStoredSession(saved, secureTransport);
      if (!session) {
        await failSession(owner, unrestorableMessage);
        return;
      }
      // The cookie was recorded for another account than the one this device holds data for:
      // that data goes as on sign-out, before anything is shown or sent with the cookie.
      const held = await device;
      assertCurrent(owner);
      if (
        session.accountId &&
        held &&
        (held.accountId !== session.accountId ||
          (held.identity && held.identity.user.id !== session.accountId))
      ) {
        // This ends the recorded account's session too; offline, its cookie stays for a retry.
        if (!(await clearAccount(owner, 'sign-out'))) {
          showUnconfirmedSignOut(owner);
          return;
        }
        cleanHome({ status: 'signed-out', user: null, message: unrestorableMessage });
        return;
      }
      cookie = session.cookie;
      cookieAccount = session.accountId;
      showSavedHome(owner, await deviceHome);
      await verifyAndLoad(owner);
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      if (error instanceof RequestError && error.networkFailure && (await restoreOffline(owner)))
        return;
      const message =
        error instanceof RequestError || error instanceof AccountCleanupError
          ? error.message
          : 'Could not restore your session. Please try again.';
      // An unverified cookie never restores offline, and nothing was purged: say so beside Sign
      // out, which would remove that data, so the member connects once instead.
      const unverifiedOffline =
        error instanceof RequestError && error.networkFailure && cookie !== null && !cookieAccount;
      cleanHome({
        status: 'error',
        user: null,
        message: unverifiedOffline ? `${message} ${keptUntilConfirmedMessage}` : message,
      });
    }
  };

  const signIn = async (personaId: PersonaId) => {
    // A sign-in this one replaces may already have its session, saved here.
    const replacing = snapshot.auth.status === 'signing-in';
    const owner = invalidate();
    cleanHome({ status: 'signing-in', user: null, message: null, option: personaId });
    try {
      // A pending sign-out's revoke is sent once before its saved cookie goes, and so is the
      // session of a sign-in this one replaced.
      await finishSignOut(owner, true);
      if (replacing) await revokeSession(owner, true);
      await clearSaved(owner);
      if (!config.developmentPersonaEnabled) {
        cleanHome({ status: 'signed-out', user: null, message: disabledMessage });
        return;
      }
      if (!['alex', 'sam', 'priya'].includes(personaId))
        throw new RequestError('Choose an available development persona.');
      parseSignIn(
        await request('/api/auth/demo-persona/sign-in', owner, {
          method: 'POST',
          body: { personaId },
          onAbandoned: revokeAbandoned,
        }),
      );
      if (!cookie)
        throw new RequestError('The server did not provide a usable session. Please try again.');
      await verifyAndLoad(owner);
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      if (error instanceof AccountCleanupError) {
        // The session the reply gave is revoked, unless the failed account change already did.
        await failSession(owner, error.message, 'error', cookie);
        return;
      }
      const message =
        error instanceof RequestError && error.status === 404
          ? 'Development personas are unavailable. Check that the development server is in demo mode and seeded.'
          : error instanceof RequestError && error.status === 403
            ? 'Development persona sign-in was denied by the server.'
            : error instanceof RequestError
              ? error.message
              : 'Could not sign in with this development persona. Please try again.';
      // A session the reply already gave, such as when the check after it fails, is revoked.
      await failSession(owner, message, 'signed-out', cookie);
    }
  };

  const signInWithGoogle = async () => {
    // An OS account chooser cannot be aborted like fetch. Keep one active until it returns, and
    // one Google sign-in at a time until something replaces it.
    if (googleAttempt && (googleAttempt.choosing || current(googleAttempt.owner))) return;
    // As for a persona sign-in, a sign-in this one replaces may already have its session.
    const replacing = snapshot.auth.status === 'signing-in';
    const owner = invalidate();
    const attempt = { owner, choosing: false };
    googleAttempt = attempt;
    cleanHome({ status: 'signing-in', user: null, message: null, option: 'google' });
    try {
      await finishSignOut(owner, true);
      if (replacing) await revokeSession(owner, true);
      await clearSaved(owner);
      if (!googleEnabled || !dependencies.googleSignIn) {
        await failSession(owner, 'Google sign-in is not configured for this build.');
        return;
      }
      await verifyGoogleBackend(owner);
      attempt.choosing = true;
      const identity = await dependencies.googleSignIn().finally(() => {
        attempt.choosing = false;
      });
      assertCurrent(owner);
      if (identity.status !== 'success') {
        await failSession(
          owner,
          identity.status === 'cancelled'
            ? 'Sign-in cancelled. Choose Sign in with Google when you are ready.'
            : identity.message,
        );
        return;
      }
      if (!identity.idToken || !identity.nonce)
        throw new RequestError('Google did not return a usable identity. Please try again.');
      parseSignIn(
        await request('/api/auth/sign-in/social', owner, {
          method: 'POST',
          body: { provider: 'google', idToken: { token: identity.idToken, nonce: identity.nonce } },
          onAbandoned: revokeAbandoned,
        }),
      );
      if (!cookie)
        throw new RequestError('The server did not provide a usable session. Please try again.');
      await verifyAndLoad(owner);
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      const message =
        error instanceof AccountCleanupError
          ? error.message
          : error instanceof RequestError && error.code?.toLowerCase() === 'email_not_allowed'
            ? 'This Google account is not invited to the beta. Choose an approved account.'
            : error instanceof RequestError && [401, 403].includes(error.status)
              ? 'Google sign-in was not accepted. Try again with an approved beta account.'
              : error instanceof RequestError
                ? error.message
                : 'Could not sign in with Google. Please try again.';
      // A session the reply already gave is revoked, unless a failed account change already did.
      await failSession(
        owner,
        message,
        error instanceof AccountCleanupError ? 'error' : 'signed-out',
        cookie,
      );
    } finally {
      if (googleAttempt === attempt) googleAttempt = null;
    }
  };

  /**
   * `reuse` (navigation, foreground) accepts reads verified within the display freshness
   * window; otherwise (a pull, Retry or a confirmed change) every read of the view is sent again.
   */
  const openGroup = (id: string, reuse = true, destination?: GroupDestination) =>
    showGroup(id, reuse, destination);
  /**
   * The same Group reopens on the destination already shown (an Expense task's return sets
   * it) and another Group starts on Expenses, unless `requested` names one. Only the shown
   * destination is read; the other is read when the member switches to it. The Group view on
   * screen (a refresh, or the read after a return) is read where it is, without navigating.
   * Its queries read the Group, then the Month's Expenses, then Balances (`groupQueries`).
   */
  const showGroup = async (id: string, reuse: boolean, requested?: GroupDestination) => {
    if (snapshot.auth.status !== 'authenticated') return;
    const owner = generation;
    const previousMonth = snapshot.financial.groupId === id ? snapshot.financial.month : undefined;
    const verified = snapshot.detail.id === id ? snapshot.detail.data : null;
    // Refreshing this account's same Group keeps its figures; another Group starts empty.
    const retained = Boolean(verified && snapshot.financial.groupId === id);
    const destination =
      requested ?? (snapshot.detail.id === id ? snapshot.destination : 'expenses');
    const view = ++viewRequest;
    startReadView();
    const start: Partial<MobileSnapshot> = {
      share: { status: 'idle', url: null, message: null },
      detail: {
        status: 'loading',
        id,
        data: verified,
        message: null,
        refreshedAt: verified ? snapshot.detail.refreshedAt : null,
      },
      financial: retained ? snapshot.financial : { ...emptyFinancial(), groupId: id },
      keptDraft: snapshot.keptDraft?.groupId === id ? snapshot.keptDraft : null,
      // Events already read for this Group stay readable until Activity is read again.
      activity:
        retained && snapshot.activity.groupId === id && snapshot.activity.status !== 'denied'
          ? {
              ...snapshot.activity,
              selected: null,
              target: { status: 'none' },
              status: 'idle',
              moreStatus: 'idle',
              message: null,
            }
          : { ...emptyActivity(), groupId: id },
    };
    const at = route,
      shown = at.screen === 'group' && at.groupId === id;
    if (shown && at.destination === destination) publish({ ...snapshot, ...start });
    // Still on this Group's view, a return's scroll position still applies.
    else
      navigate(
        {
          ...groupAt(id, destination),
          restoreScroll: shown ? at.restoreScroll : null,
        },
        start,
      );
    // The view on screen, with its figures, is read again; anything else opens it anew.
    groupQueries.open(id, { again: shown && retained, previousMonth });
    const kept = loadKeptDraft(id);
    try {
      if (!objectId.safeParse(id).success)
        throw new RequestError('This group is no longer available.', 404);
      await groupQueries.read(owner, { fresh: !reuse });
      if (
        !current(owner) ||
        view !== viewRequest ||
        snapshot.detail.id !== id ||
        !snapshot.detail.data
      )
        return;
      // The member may have switched destination while the Group was read.
      if (showingActivity()) await readActivity(false);
      else if (overGroup()) await loadPendingPayment(id);
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      dropDeniedGroup(id, error);
    }
    await kept;
  };

  /**
   * The open Expense once its Group refuses this member: its changes are cleared and no read
   * still on its way can bring them back. A saved record being viewed gives way to a notice
   * that it's unavailable. A draft or a save that may already be recorded stays, since it lives
   * on this device and can still be recovered.
   */
  const withdrawExpense = (message: string): MobileSnapshot['expense'] => {
    const editor = snapshot.expense;
    const withdrawn = { ...editor, context: null, history: emptyExpenseHistory() };
    return ['detail', 'delete-review'].includes(editor.status)
      ? { ...withdrawn, status: 'blocked', draft: null, preview: null, latest: null, message }
      : withdrawn;
  };

  const evictGroupContent = (id: string, status: number) => {
    const message = groupRefused(status);
    const expense = snapshot.expense.groupId === id ? withdrawExpense(message) : snapshot.expense;
    publish({
      ...snapshot,
      groups: { ...snapshot.groups, data: snapshot.groups.data.filter((group) => group.id !== id) },
      home: emptyHome(),
      detail:
        snapshot.detail.id === id
          ? {
              ...snapshot.detail,
              data: null,
              refreshedAt: null,
              status: status === 403 ? 'denied' : 'error',
              message,
            }
          : snapshot.detail,
      financial: snapshot.financial.groupId === id ? emptyFinancial() : snapshot.financial,
      activity:
        snapshot.activity.groupId === id
          ? { ...emptyActivity(), groupId: id, status: 'denied', message }
          : snapshot.activity,
      expense,
      settlement:
        snapshot.settlement.groupId === id
          ? { ...snapshot.settlement, group: null, balances: [] }
          : snapshot.settlement,
    });
  };

  /**
   * The member can no longer see this Group (denied, gone, or left): its reads, its saved copy on
   * this device and its content on screen go, and the Groups list and Home read again. A refusal
   * that arrives while that removal runs, such as one of the Expenses read beside the Group
   * (#219), is the same loss: it joins it.
   */
  const forgetGroup = (groupId: string, status: number, owner: number) => {
    const running = forgetting.get(groupId);
    if (running?.owner === owner) return running.removal;
    const removal = removeGroup(groupId, status, owner).finally(() => {
      if (forgetting.get(groupId)?.removal === removal) forgetting.delete(groupId);
    });
    forgetting.set(groupId, { owner, removal });
    return removal;
  };
  const forgetting = new Map<string, { owner: number; removal: Promise<void> }>();
  const removeGroup = async (groupId: string, status: number, owner: number) => {
    cacheEpoch += 1;
    lostGroups.set(groupId, { status, at: ++losses });
    const scopes = [
      `group:${groupId}`,
      `ledger:${groupId}`,
      `balances:${groupId}`,
      'groups',
      'home',
    ];
    // Its views observe nothing more, so their removed queries are never read back (F5).
    groupQueries.lose(groupId);
    expenseQueries.lose(groupId);
    // A Groups list read before this could list it again, unless the latest one already leaves it
    // out: that list, still being saved perhaps, stands (#219, a read beside the Group's).
    const listed = !listedGroups || listedGroups.has(groupId);
    // The Group leaves the screen in the publish that shows Home's queries reading again.
    homeQueries.quietly(() => {
      invalidateReads(...scopes.filter((scope) => listed || scope !== 'groups'));
      evictGroupContent(groupId, status);
    });
    const lease = accountStorage(),
      time = now();
    if (!lease) return;
    try {
      // In both stores: the older one's copies of the Group, and the persister's rows of its view,
      // its list and Home.
      await lease.write(async () => {
        await dependencies.readCache?.invalidateGroup(lease.accountId, groupId);
        await groupQueries.forget(lease.accountId, groupId, 'group');
        await expenseQueries.forget(lease.accountId, groupId);
        await homeQueries.forget(lease.accountId);
      });
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) throw error;
      // A saved copy that can't be removed is never shown again; the member stays signed in (#212).
      untrusted.mark(lease.accountId, scopes, time);
    }
  };

  const dropDeniedGroup = (id: string, error: unknown): boolean => {
    if (!(error instanceof RequestError) || ![403, 404].includes(error.status)) return false;
    viewRequest += 1;
    groupQueries.lose(id);
    expenseQueries.lose(id);
    // A Groups list or Home figures read before this, still running or not, never bring it back.
    homeQueries.quietly(() => invalidateReads('groups', 'home'));
    publish({
      ...snapshot,
      groups: { ...snapshot.groups, data: snapshot.groups.data.filter((group) => group.id !== id) },
      detail: {
        status: error.status === 403 ? 'denied' : 'error',
        id,
        data: null,
        message: error.message,
        refreshedAt: null,
      },
      financial: emptyFinancial(),
      activity:
        snapshot.activity.groupId === id
          ? { ...emptyActivity(), groupId: id, status: 'denied', message: error.message }
          : snapshot.activity,
      home: emptyHome(),
      share: { status: 'idle', url: null, message: null },
    });
    return true;
  };

  /** The Group, or the Record payment sheet over it. */
  const overGroup = () => ['group', 'settlement'].includes(snapshot.screen);
  /**
   * The Group's unconfirmed payment, read from this device. Balances offers it whatever the
   * suggestions say, so a payment whose response was lost can always be retried.
   */
  const loadPendingPayment = async (groupId: string) => {
    const owner = generation,
      read = ++pendingRequest,
      lease = accountStorage(),
      storage = dependencies.settlementAttempts;
    if (!lease || !storage) return;
    let pending: PendingPayment | null;
    try {
      const stored = await lease.write(() => storage.load(lease.accountId, groupId));
      pending =
        stored === null
          ? null
          : { groupId, draft: parseSettlementAttempt(stored, lease.accountId, groupId).draft };
    } catch (error) {
      if (error instanceof Superseded || !current(owner)) return;
      // An unreadable record is left as it is; the sheet says so when it's opened.
      pending = { groupId, draft: null };
    }
    if (!current(owner) || read !== pendingRequest || snapshot.detail.id !== groupId) return;
    if (JSON.stringify(pending) !== JSON.stringify(snapshot.pendingPayment))
      publish({ ...snapshot, pendingPayment: pending });
  };
  /**
   * The Group's kept Expense draft, read from this device so Expenses can offer it. Reading
   * never opens or changes it.
   */
  const loadKeptDraft = async (groupId: string) => {
    const owner = generation,
      read = ++keptDraftRequest,
      lease = accountStorage(),
      storage = dependencies.expenseDrafts;
    if (!lease || !storage) return;
    let kept: KeptDraft | null;
    try {
      const stored = await lease.write(() => storage.load(lease.accountId, groupId));
      const record =
        stored === null ? null : parseStoredExpenseDraft(stored, lease.accountId, groupId);
      kept = record && {
        groupId,
        draft: {
          description: record.draft.description.trim(),
          amount: enteredAmount(record.draft.amount, record.draft.currency),
          currency: record.draft.currency,
          edit: !!record.draft.original,
        },
        unconfirmed: !!(record.attempt || record.mutation),
      };
    } catch (error) {
      if (error instanceof Superseded || !current(owner)) return;
      // An unreadable record is left as it is; opening it explains the problem.
      kept = { groupId, draft: null, unconfirmed: false };
    }
    if (!current(owner) || read !== keptDraftRequest || snapshot.detail.id !== groupId) return;
    if (JSON.stringify(kept) !== JSON.stringify(snapshot.keptDraft))
      publish({ ...snapshot, keptDraft: kept });
  };
  /**
   * The view's Expenses and Balances read from `from` on (`groupQueries`), with the Group's
   * unconfirmed payment, which Balances offers, read from this device alongside.
   */
  const readFinancial = async (from: 'expenses' | 'balances', fresh = false) => {
    const groupId = overGroup() ? snapshot.detail.data?.id : undefined;
    const pending = groupId ? loadPendingPayment(groupId) : null;
    const owner = generation,
      view = viewRequest;
    try {
      await groupQueries.read(owner, { from, fresh });
    } catch (error) {
      if (current(owner) && view === viewRequest && groupId && !(error instanceof Superseded))
        dropDeniedGroup(groupId, error);
    }
    await pending;
  };
  /** Retry always reads again. */
  const refreshBalances = () => readFinancial('balances', true);

  const selectMonth = async (month: string | null) => {
    const at = route;
    if (
      snapshot.auth.status !== 'authenticated' ||
      at.screen !== 'group' ||
      snapshot.detail.data?.category !== 'home'
    )
      return;
    if (month !== null) getLocalMonthIsoRange(month);
    const { financial } = snapshot;
    // A return's pages of the Month being left, still being read, go with that read: they were
    // never shown, and that Month is read from its first page when it shows again.
    if (at.reread?.expenses && at.reread.expenses.month !== month)
      groupQueries.dropReturn(at.reread.expenses);
    // The member chose another view: an earlier position, offer or Expense range no longer applies.
    navigate(
      {
        ...at,
        restoreScroll: null,
        reread: at.reread && { ...at.reread, expenses: null },
      },
      {
        snackbar: null,
        financial: {
          ...financial,
          month,
          // A different Month never shows the previous Month's Expenses under its label.
          expenses: month === financial.month ? financial.expenses : emptyExpenses(month),
        },
      },
    );
    await readFinancial('expenses');
  };

  /** Retry always reads again, the pages loaded too (M1-3). */
  const refreshExpenses = () => readFinancial('expenses', true);
  /** The next older page; past 5 pages the list slides, and the newest page drops (M7-2). */
  const loadMoreExpenses = () => groupQueries.loadMore(generation);
  /** The page before the list once it has slid: the oldest page drops (M7-2). */
  const loadNewerExpenses = () => groupQueries.loadNewer(generation);

  const readActivity = async (append: boolean) => {
    const previous = snapshot.activity,
      groupId = previous.groupId;
    if (snapshot.auth.status !== 'authenticated' || !showingActivity() || !groupId) return;
    const pagination = previous.pagination;
    if (
      append &&
      (previous.status !== 'ready' ||
        previous.moreStatus === 'loading' ||
        !pagination ||
        pagination.page >= pagination.totalPages)
    )
      return;
    const pageNumber = append ? pagination!.page + 1 : 1;
    // A return reads the pages it left until they're shown, so its position still exists.
    const reread = append ? null : rereadOf(groupId)?.activity;
    const range = reread && !rereadsShown.has(reread) ? reread : null;
    const through = append ? pageNumber : (range?.pages ?? 1);
    if (!append) activityDetailRequest += 1;
    const owner = generation,
      view = viewRequest,
      read = ++activityRequest;
    publish({
      ...snapshot,
      activity: {
        ...previous,
        ...(!append ? { selected: null, target: { status: 'none' as const } } : {}),
        status: append ? 'ready' : 'loading',
        moreStatus: append ? 'loading' : 'idle',
        message: null,
      },
    });
    try {
      if (!objectId.safeParse(groupId).success)
        throw new RequestError('This Group is unavailable.', 404);
      const wanted = () => current(owner) && view === viewRequest && read === activityRequest;
      const readPage = (number: number) =>
        readCached(
          activityKey(groupId, number),
          owner,
          (value) => parseActivityPage(value, groupId, number),
          wanted,
        );
      let page = await readPage(pageNumber);
      if (!wanted()) return;
      const events = [...(append ? previous.events : []), ...page.events];
      let moreStatus: 'idle' | 'error' = 'idle';
      try {
        while (page.pagination.page < Math.min(through, page.pagination.totalPages)) {
          page = await readPage(page.pagination.page + 1);
          if (!wanted()) return;
          events.push(...page.events);
        }
      } catch (error) {
        // Losing access or this view moving on is handled below; otherwise keep what was read.
        if (
          error instanceof Superseded ||
          !wanted() ||
          (error instanceof RequestError && [403, 404].includes(error.status))
        )
          throw error;
        moreStatus = 'error';
      }
      publish({
        ...snapshot,
        activity: {
          ...snapshot.activity,
          events: [...new Map(events.map((event) => [event._id, event])).values()],
          pagination: page.pagination,
          status: 'ready',
          moreStatus,
          message: null,
          refreshedAt: append ? snapshot.activity.refreshedAt : readAt(activityKey(groupId, 1)),
        },
      });
      if (range) rereadsShown.add(range);
    } catch (error) {
      if (
        !current(owner) ||
        view !== viewRequest ||
        read !== activityRequest ||
        error instanceof Superseded
      )
        return;
      const denied = error instanceof RequestError && [403, 404].includes(error.status);
      if (denied) dropDeniedGroup(groupId, error);
      publish({
        ...snapshot,
        activity: denied
          ? { ...emptyActivity(), groupId, status: 'denied', message: error.message }
          : {
              ...previous,
              selected: null,
              target: { status: 'none' },
              status: append ? 'ready' : 'error',
              moreStatus: append ? 'error' : 'idle',
              message:
                error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE'
                  ? error.message
                  : 'Could not refresh Activity. Previously loaded events may be stale. A missing event does not mean the ledger change failed.',
            },
      });
    }
  };
  const showingActivity = () => snapshot.screen === 'group' && snapshot.destination === 'activity';

  /**
   * Switch the Group's bottom-navigation destination. Content already read stays as it is;
   * a destination is read only when it hasn't been read since the Group was opened.
   * Expenses and Balances share one read, because Balances follow the Expense read.
   */
  const selectDestination = async (destination: GroupDestination) => {
    const at = route;
    if (
      snapshot.auth.status !== 'authenticated' ||
      at.screen !== 'group' ||
      destination === at.destination
    )
      return;
    const groupId = snapshot.detail.id;
    navigate(
      { ...at, destination },
      {
        activity:
          groupId && snapshot.activity.groupId !== groupId
            ? { ...emptyActivity(), groupId }
            : snapshot.activity,
      },
    );
    // A Group read still in flight reads the destination shown when it completes.
    if (snapshot.detail.status === 'loading' || !snapshot.detail.data) return;
    if (destination === 'activity') {
      if (snapshot.activity.status === 'idle') await readActivity(false);
    } else if (
      snapshot.financial.groupId === groupId &&
      (at.destination === 'activity' || snapshot.financial.expenses.status === 'idle')
    )
      // Read unless verified within the freshness window.
      await readFinancial('expenses');
  };

  /** Open a Group on its Activity destination. */
  const openActivity = async (groupId: string) => {
    if (snapshot.auth.status !== 'authenticated' || expenseNavigationBlocked()) return;
    if (snapshot.screen === 'group' && snapshot.detail.id === groupId)
      return selectDestination('activity');
    await openGroup(groupId, true, 'activity');
  };
  const refreshActivity = () => readActivity(false);
  const loadMoreActivity = () => readActivity(true);

  const selectActivity = async (eventId: string) => {
    const activity = snapshot.activity;
    if (
      !showingActivity() ||
      snapshot.auth.status !== 'authenticated' ||
      activity.status !== 'ready'
    )
      return;
    const event = activity.events.find((item) => item._id === eventId),
      groupId = activity.groupId;
    if (!event || !groupId) return;
    const owner = generation,
      view = viewRequest,
      read = ++activityDetailRequest;
    publish({
      ...snapshot,
      activity: { ...activity, selected: event, target: { status: 'loading' } },
    });
    let targetRequested = false;
    try {
      const group = parseGroup(
        await groupQueries.readGroup(groupId, owner, { wanted: () => view === viewRequest }),
      );
      if (!current(owner) || view !== viewRequest || read !== activityDetailRequest) return;
      if (
        group.id !== groupId ||
        !group.members.some((member) => member.user.id === snapshot.auth.user?.id)
      )
        throw new RequestError('You no longer have access to this Group.', 403);
      const expenseId = activityExpenseId(event);
      let target: typeof activity.target = { status: 'none' };
      if (expenseId) {
        targetRequested = true;
        target = parseActivityExpense(
          await expenseQueries.recordOf(groupId, expenseId, owner, () => view === viewRequest),
          groupId,
          expenseId,
        );
      }
      if (!current(owner) || view !== viewRequest || read !== activityDetailRequest) return;
      publish({ ...snapshot, activity: { ...snapshot.activity, target } });
    } catch (error) {
      if (
        !current(owner) ||
        view !== viewRequest ||
        read !== activityDetailRequest ||
        error instanceof Superseded
      )
        return;
      if (
        error instanceof RequestError &&
        (error.status === 403 || (!targetRequested && error.status === 404))
      ) {
        dropDeniedGroup(groupId, error);
        return;
      }
      publish({
        ...snapshot,
        activity: {
          ...snapshot.activity,
          target: {
            status: error instanceof RequestError && error.status === 404 ? 'unavailable' : 'error',
          },
        },
      });
    }
  };
  const closeActivityDetail = () => {
    activityDetailRequest += 1;
    publish({
      ...snapshot,
      activity: { ...snapshot.activity, selected: null, target: { status: 'none' } },
    });
  };
  /**
   * An event about an Expense opens that Expense's record, and Back returns to Activity;
   * any other event, such as a payment, opens what was recorded.
   */
  const openActivityEvent = async (eventId: string, origin: { scrollY?: number } = {}) => {
    const { activity } = snapshot;
    const event = activity.events.find((item) => item._id === eventId);
    const expenseId = event && activityExpenseId(event);
    if (!expenseId || !showingActivity() || activity.status !== 'ready' || !activity.groupId)
      return selectActivity(eventId);
    await openExpense(activity.groupId, expenseId, origin);
  };

  const today = () => toDateParam(new Date(now()));
  const revalidateExpense = (
    validation: ExpenseValidation,
    draft: ExpenseDraft,
    context: ExpenseContext | null,
  ): ExpenseValidation => ({
    ...validation,
    errors: visibleExpenseErrors(validateExpenseDraft(draft, context, today()), validation),
  });
  /** Explain every invalid field and request focus on the first; nothing is sent. */
  const rejectInvalidExpense = (
    editor: ExpenseEditor,
    draft: ExpenseDraft,
    context: ExpenseContext | null,
  ) => {
    const errors = validateExpenseDraft(draft, context, today());
    const field = expenseFields.find((name) => errors[name]);
    if (!field) return false;
    publish({
      ...snapshot,
      expense: {
        ...editor,
        context,
        status: 'editing',
        message: expenseCorrectionSummary(errors),
        validation: {
          ...editor.validation,
          submitted: true,
          errors,
          focus: { field, request: (editor.validation.focus?.request ?? 0) + 1 },
        },
      },
    });
    return true;
  };
  const touchExpenseField = (field: ExpenseField) => {
    const editor = snapshot.expense;
    if (
      snapshot.screen !== 'expense' ||
      editor.status !== 'editing' ||
      !editor.draft ||
      editor.validation.touched.includes(field)
    )
      return;
    publish({
      ...snapshot,
      expense: {
        ...editor,
        validation: revalidateExpense(
          { ...editor.validation, touched: [...editor.validation.touched, field] },
          editor.draft,
          editor.context,
        ),
      },
    });
  };

  // A draft write still pending doesn't block leaving: closing waits for it.
  const expenseNavigationBlocked = () =>
    (snapshot.screen === 'expense' &&
      (snapshot.expense.status === 'saving' || snapshot.expense.persistence === 'error')) ||
    (snapshot.screen === 'settlement' && snapshot.settlement.status === 'saving');

  let draftWrite: Promise<void> = Promise.resolve();
  /** A Save accepted while Back waits for a draft write wins: Back then stays on the form. */
  let closeRequest = 0;
  /**
   * Save and close wait for the latest draft write, so nothing is sent or left from entries
   * this device doesn't hold. False when those entries couldn't be stored.
   */
  const draftWritten = async () => {
    let pending: Promise<void>;
    do {
      pending = draftWrite;
      await pending;
    } while (pending !== draftWrite);
    return snapshot.expense.persistence === 'saved';
  };

  /** Opening from the Group's own view records where to return; other entry is direct. */
  const expenseReturn = (groupId: string, scrollY = 0): GroupReturnContext | null => {
    // Retry, Discard and Use saved version reopen the same task, which keeps its origin.
    if (route.screen === 'expense' && route.groupId === groupId) return route.returnTo;
    if (
      route.screen !== 'group' ||
      snapshot.detail.id !== groupId ||
      snapshot.financial.groupId !== groupId
    )
      return null;
    const { expenses, month } = snapshot.financial;
    const { activity, destination } = snapshot;
    const firstPage = expenses.month === month ? (expenses.firstPage ?? 1) : 1;
    return {
      groupId,
      month,
      scrollY: Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0,
      pages: expenses.month === month && expenses.pagination ? expenses.pagination.page : 1,
      // Only once the list has slid past the newest page (#215).
      ...(firstPage > 1 ? { firstPage } : {}),
      destination,
      activityPages:
        destination === 'activity' && activity.groupId === groupId && activity.pagination
          ? activity.pagination.page
          : 1,
    };
  };

  const openExpense = async (
    groupId: string,
    expenseId?: string,
    origin: { scrollY?: number } = {},
  ) => {
    if (snapshot.auth.status !== 'authenticated' || !snapshot.auth.user) return;
    const owner = generation;
    const view = ++viewRequest;
    const accountId = snapshot.auth.user.id;
    const month = snapshot.financial.groupId === groupId ? snapshot.financial.month : null;
    const returnTo = expenseReturn(groupId, origin.scrollY);
    const showing = () => current(owner) && view === viewRequest;
    const wanted = () => view === viewRequest;
    startReadView();
    expenseQueries.open(groupId);
    navigate(
      { screen: 'expense', groupId, returnTo },
      {
        expense: {
          ...emptyExpenseEditor(),
          groupId,
          requestedExpenseId: expenseId ?? null,
          status: 'loading',
          returnTo,
        },
      },
    );
    let known = false,
      checked = false;
    try {
      const lease = accountStorage();
      if (!lease || !dependencies.expenseDrafts) throw new Error('Draft storage is unavailable.');
      const stored = await lease.write(() => dependencies.expenseDrafts!.load(accountId, groupId));
      let record = stored === null ? null : parseStoredExpenseDraft(stored, accountId, groupId);
      if (!showing()) return;
      // Another saved Expense opens read-only beside an ordinary draft. An unconfirmed save,
      // and a draft editing this same Expense, still come first.
      let held =
        record &&
        expenseId &&
        record.draft.original?._id !== expenseId &&
        !record.attempt &&
        !record.mutation
          ? record.draft
          : null;
      if (record && !held)
        publish({
          ...snapshot,
          expense: {
            ...snapshot.expense,
            draft: record.draft,
            attempt: record.attempt,
            mutation: record.mutation,
            preview: previewExpense(record.draft),
            status: 'loading',
            blank: record.blank,
          },
        });
      // The Group is read again on every open: for a new Expense it is the only check (#180).
      // The record is read beside it (owner decision, 2026-10-06): what the server answers shows
      // once the Group's check passes, and a refusal drops it.
      const checking = expenseQueries.group(owner, { wanted });
      checking.catch(() => undefined);
      const readRecord = (id: string) => {
        expenseQueries.want(id);
        const reading = expenseQueries.record(owner, { fresh: true, wanted });
        reading.catch(() => undefined);
        return reading;
      };
      let reading = (record === null || held) && expenseId ? readRecord(expenseId) : null;
      // What this device already knows of the record shows at once (the loading-state audit).
      known = !!reading && showing() && (await expenseQueries.known(owner, held));
      const context = parseExpenseContext(await checking);
      if (!showing()) return;
      if (
        context.group.id !== groupId ||
        !context.group.members.some((member) => member.user.id === accountId)
      )
        throw new RequestError('You no longer have access to this Group.', 403);
      const blank: ExpenseDraft = {
        amount: '',
        currency: context.group.defaultCurrency,
        description: '',
        date: toDateParam(
          month && month < currentMonthKey(new Date(now()))
            ? new Date(getLocalMonthIsoRange(month).dateTo)
            : new Date(now()),
        ),
        payerId: accountId,
        multiPayer: false,
        payers: [],
        splitMethod: 'equal',
        splitValues: {},
        participantIds: context.group.members.map((member) => member.user.id),
        category: 'other',
        tagId: '',
        notes: '',
      };
      // Earlier versions stored drafts that changed nothing; one would still hold the Group.
      // A new draft is compared with the start stored with it, not today's blank form, and
      // is kept when that start is unknown.
      if (
        record &&
        !record.attempt &&
        !record.mutation &&
        !expenseDraftChanged(record.draft, record.blank)
      ) {
        await lease.write(() => dependencies.expenseDrafts!.remove(accountId, groupId));
        if (!showing()) return;
        record = held = null;
        if (expenseId) reading ??= readRecord(expenseId);
      }
      expenseQueries.check();
      checked = true;
      const original = reading
        ? await reading.catch((error: unknown) => {
            // The Group was just read: what's missing is this Expense.
            throw error instanceof RequestError && error.status === 404
              ? new RequestError('This Expense isn’t available.', 404)
              : error;
          })
        : null;
      if (!showing()) return;
      // The member went on from what this device knew (Edit, Delete, or the Group's draft): what
      // they do stays (M6-1), and the record's changes are read.
      if (known && latest().expense.status !== 'detail') {
        publish({ ...snapshot, expense: { ...snapshot.expense, context } });
        if (latest().expense.draft?.original?._id === expenseId)
          await expenseQueries.history(owner, { fresh: true, wanted });
        return;
      }
      const draft = original ? draftFromExpense(original) : (record?.draft ?? blank);
      publish({
        ...snapshot,
        expense: {
          groupId,
          context,
          draft,
          preview: previewExpense(draft),
          status: record === null || held ? (original ? 'detail' : 'editing') : 'resume',
          attempt: record?.attempt ?? null,
          attemptRejected: !!record?.attempt && record.attemptRejected,
          mutation: record?.mutation ?? null,
          latest: null,
          requestedExpenseId: expenseId ?? null,
          receiptId: null,
          persistence: 'saved',
          validation: emptyExpenseValidation(),
          returnTo,
          // An unconfirmed save says why it comes before the Expense that was asked for.
          message:
            !record || record.draft.original?._id === expenseId
              ? null
              : record.attempt
                ? 'This Expense may already be saved. Finish saving it before opening another Expense; it can’t be recorded twice.'
                : record.mutation
                  ? 'This change may already be saved. Check the saved Expense before opening another Expense.'
                  : null,
          groupDraft: held,
          blank: record ? record.blank : blank,
          history: emptyExpenseHistory(),
        },
      });
      // The record is shown first; its changes follow when they've been read.
      if (original) await expenseQueries.history(owner, { fresh: true, wanted });
    } catch (error) {
      if (!showing() || error instanceof Superseded) return;
      const denied = error instanceof RequestError && [403, 404].includes(error.status);
      const shown = latest().expense;
      const message = expenseFailureMessage(
        error,
        'Could not open this Expense. Please try again.',
      );
      // The member went on from what this device knew: what they do is theirs (M6-1). A save in
      // flight, or one unconfirmed, is never touched; an edit or a delete review is told why.
      if (known && shown.status !== 'detail' && shown.draft) {
        if (['editing', 'delete-review'].includes(shown.status))
          publish({ ...snapshot, expense: { ...shown, message } });
        return;
      }
      // What this device knew of the record stays, beside its changes, when the record can't be
      // read now; it goes once the Expense is gone, or the Group refuses or can't check the member.
      if (known && shown.status === 'detail' && checked && !denied) {
        publish({ ...snapshot, expense: { ...shown, message } });
        return await expenseQueries.history(owner, { fresh: true, wanted }).catch(() => undefined);
      }
      if (known && shown.status === 'detail')
        return publish({ ...snapshot, expense: withdrawExpense(message) });
      publish({
        ...snapshot,
        expense: {
          ...snapshot.expense,
          status: denied ? 'blocked' : snapshot.expense.draft ? 'resume' : 'blocked',
          message:
            error instanceof RequestError
              ? error.message
              : 'Could not open this Expense draft. Your saved draft has not been changed.',
        },
      });
    }
  };

  /** Load older changes: the next older page; past 5 pages the window slides (M7-2). */
  const loadOlderExpenseHistory = () => expenseQueries.loadOlder();
  /** Load newer changes: the page before the window once it has slid; the oldest page drops. */
  const loadNewerExpenseHistory = () => expenseQueries.loadNewer();
  /** Try again on the record's changes, also while it is edited (M1-3). */
  const refreshExpenseHistory = () => expenseQueries.retryHistory();

  const resumeExpenseDraft = () => {
    const editor = snapshot.expense;
    if (snapshot.screen !== 'expense') return;
    // From a record read beside the Group's draft, Resume opens that draft.
    if (editor.status === 'detail' && editor.groupDraft) {
      const draft = editor.groupDraft;
      publish({
        ...snapshot,
        expense: {
          ...editor,
          draft,
          preview: previewExpense(draft),
          status: 'editing',
          message: null,
          groupDraft: null,
        },
      });
      return;
    }
    if (editor.status !== 'resume') return;
    publish({
      ...snapshot,
      expense: {
        ...editor,
        status: editor.attempt || editor.mutation ? 'uncertain' : 'editing',
        // Resuming answers the resume prompt, so its notices no longer apply. A save that
        // may already be recorded keeps explaining why it stays locked.
        message: editor.attempt
          ? editor.attemptRejected
            ? `SplitBook refused a retry of this save. ${refusedRetryNotice}`
            : 'This Expense may already be saved. Checking reuses the same submission, so it can’t be recorded twice.'
          : editor.mutation
            ? 'This change may already be saved. Check the saved Expense before changing anything else.'
            : null,
      },
    });
  };

  const updateExpenseDraft = async (patch: Partial<ExpenseDraft>) => {
    if (
      snapshot.screen !== 'expense' ||
      snapshot.expense.status !== 'editing' ||
      !snapshot.expense.draft
    )
      return;
    const lease = accountStorage();
    const storage = dependencies.expenseDrafts;
    if (!lease || !storage) return;
    const owner = generation;
    const groupId = snapshot.expense.groupId!;
    // A new split method clears the old method's values, unless values for it come too.
    const draft = {
      ...snapshot.expense.draft,
      ...patch,
      ...(patch.splitMethod &&
      patch.splitMethod !== snapshot.expense.draft.splitMethod &&
      !patch.splitValues
        ? { splitValues: {} }
        : {}),
    };
    // A tap that changes nothing writes nothing. Retry after a failed write always writes.
    if (snapshot.expense.persistence !== 'error' && sameExpenseDraft(draft, snapshot.expense.draft))
      return;
    // Only entries that differ from where the form started are kept on this device.
    const { blank } = snapshot.expense;
    const kept = expenseDraftChanged(draft, blank);
    publish({
      ...snapshot,
      expense: {
        ...snapshot.expense,
        draft,
        preview: previewExpense(draft),
        persistence: 'saving',
        message: null,
        validation: revalidateExpense(snapshot.expense.validation, draft, snapshot.expense.context),
      },
    });
    const write = (async () => {
      try {
        await lease.write(() =>
          kept
            ? storage.save(lease.accountId, groupId, {
                version: 1,
                accountId: lease.accountId,
                groupId,
                draft,
                ...(draft.original ? {} : { blank }),
              })
            : storage.remove(lease.accountId, groupId),
        );
        if (current(owner) && snapshot.expense.draft === draft)
          publish({ ...snapshot, expense: { ...snapshot.expense, persistence: 'saved' } });
      } catch {
        if (current(owner) && snapshot.expense.draft === draft)
          publish({
            ...snapshot,
            expense: {
              ...snapshot.expense,
              persistence: 'error',
              message:
                'Could not save your draft on this device. Keep this screen open and try again.',
            },
          });
      }
    })();
    draftWrite = write;
    await write;
  };

  const discardExpenseDraft = async () => {
    const editor = snapshot.expense;
    const lease = accountStorage();
    const storage = dependencies.expenseDrafts;
    if (
      snapshot.screen !== 'expense' ||
      !['editing', 'resume'].includes(editor.status) ||
      editor.attempt ||
      editor.mutation ||
      !editor.groupId ||
      !lease ||
      !storage
    )
      return;
    const owner = generation;
    const view = viewRequest;
    publish({ ...snapshot, expense: { ...editor, status: 'loading' } });
    try {
      await lease.write(() => storage.remove(lease.accountId, editor.groupId!));
      if (current(owner) && view === viewRequest)
        await openExpense(editor.groupId, editor.requestedExpenseId ?? undefined);
    } catch {
      if (current(owner) && view === viewRequest)
        publish({
          ...snapshot,
          expense: { ...editor, message: 'Could not discard this draft. Please retry.' },
        });
    }
  };

  /**
   * Discard, after the server refused a retry of an unconfirmed save and the member was told to
   * check the Group's Expenses first. Removes the save's submission from this device and keeps
   * the draft; nothing is sent, and a later Save is a new submission.
   */
  const discardUnconfirmedExpense = async () => {
    const editor = snapshot.expense;
    const lease = accountStorage();
    const storage = dependencies.expenseDrafts;
    if (
      snapshot.screen !== 'expense' ||
      !['resume', 'uncertain'].includes(editor.status) ||
      !editor.attempt ||
      !editor.attemptRejected ||
      !editor.draft ||
      !editor.groupId ||
      !lease ||
      !storage
    )
      return;
    const { groupId, draft, attempt } = editor;
    const owner = generation;
    const view = viewRequest;
    publish({ ...snapshot, expense: { ...editor, status: 'loading' } });
    try {
      const discarded = await lease.write(async () => {
        const stored = await storage.load(lease.accountId, groupId);
        const saved =
          stored === null ? null : parseStoredExpenseDraft(stored, lease.accountId, groupId);
        // Only the save this form shows; anything else this device holds now stays.
        if (
          !saved?.attempt ||
          saved.attempt.key !== attempt.key ||
          saved.attempt.body !== attempt.body
        )
          return false;
        await storage.save(lease.accountId, groupId, {
          version: 1,
          accountId: lease.accountId,
          groupId,
          draft,
          blank: editor.blank,
        });
        return true;
      });
      if (!current(owner) || view !== viewRequest) return;
      // What the device holds changed: show that instead.
      if (!discarded) return await openExpense(groupId, editor.requestedExpenseId ?? undefined);
      publish({
        ...snapshot,
        expense: {
          ...editor,
          attempt: null,
          attemptRejected: false,
          status: 'editing',
          persistence: 'saved',
          message:
            'The unconfirmed save is discarded. If this Expense is already in the Group’s Expenses, discard this draft too. If it isn’t, correct the draft and save it.',
        },
      });
    } catch {
      if (current(owner) && view === viewRequest)
        publish({
          ...snapshot,
          expense: { ...editor, message: 'Could not discard this unconfirmed save. Please retry.' },
        });
    }
  };

  /**
   * Resume draft, from the Group's Expenses: opens its kept draft straight into the form, or
   * a save that may already be recorded into its recovery.
   */
  const resumeKeptDraft = async (origin: { scrollY?: number } = {}) => {
    const groupId = snapshot.screen === 'group' ? snapshot.detail.id : null;
    if (!groupId) return;
    const opening = openExpense(groupId, undefined, origin);
    const view = viewRequest;
    await opening;
    const shown = latest();
    if (view === viewRequest && shown.screen === 'expense' && shown.expense.status === 'resume')
      resumeExpenseDraft();
  };

  /**
   * Discard, from the Group's Expenses: removes its ordinary draft from this device. A save
   * that may already be recorded is never discarded here. False when it is still kept.
   */
  const discardKeptDraft = async () => {
    const groupId = snapshot.screen === 'group' ? snapshot.detail.id : null;
    const lease = accountStorage();
    const storage = dependencies.expenseDrafts;
    if (!groupId || !lease || !storage) return false;
    try {
      const removed = await lease.write(async () => {
        const stored = await storage.load(lease.accountId, groupId);
        if (stored === null) return true;
        const record = parseStoredExpenseDraft(stored, lease.accountId, groupId);
        if (record.attempt || record.mutation) return false;
        await storage.remove(lease.accountId, groupId);
        return true;
      });
      await loadKeptDraft(groupId);
      return removed;
    } catch (error) {
      return error instanceof Superseded;
    }
  };

  /**
   * A ledger write that may have reached the server, whatever its outcome, makes the
   * Group's earlier reads obsolete: they are not reused, joined or saved afterwards. Their
   * saved copies are gone before it returns, unless the server definitely refused this
   * request (400 or 422) and so changed nothing.
   */
  const ledgerWrite = async (
    groupId: string,
    path: string,
    owner: number,
    options: Omit<RequestOptions, 'signal'>,
  ) => {
    let refused = false;
    try {
      return await request(path, owner, options);
    } catch (error) {
      refused = error instanceof RequestError && [400, 422].includes(error.status);
      throw error;
    } finally {
      if (current(owner)) {
        ledgerChanged(groupId);
        if (!refused) {
          // It may have reached the server: its Balances offer no payment until read again.
          groupQueries.changed(groupId);
          await removeLedgerCopies(groupId, owner);
        }
      }
    }
  };

  /**
   * After a confirmed change: every affected view reads again; earlier responses cannot return.
   * Its message highlights the saved row only on a list read after this (`confirmed`).
   */
  const refreshLedgerViews = async (groupId: string, owner: number, returned: boolean) => {
    const change = groupQueries.changed(groupId);
    if (confirmation?.snackbar.groupId === groupId) confirmation.change = change;
    ledgerChanged(groupId);
    if (returned || (snapshot.screen === 'group' && snapshot.detail.id === groupId))
      await openGroup(groupId, false);
    if (current(owner)) await refreshHome();
  };

  /**
   * The Group view a task over it returns to, on `destination`. With the view as it was when
   * the task opened (`origin`), it asks to scroll back there, with the next request, and reads
   * the pages it had again: the Expense pages of its Month, and Activity's on Activity.
   */
  const returnView = (
    groupId: string,
    destination: GroupDestination,
    origin: GroupReturnContext | null,
  ): GroupRoute => ({
    screen: 'group',
    groupId,
    destination,
    restoreScroll: origin && { groupId, y: origin.scrollY, request: scrollRequests + 1 },
    reread: origin && {
      groupId,
      expenses: {
        month: origin.month,
        pages: origin.pages,
        ...(origin.firstPage ? { first: origin.firstPage } : {}),
      },
      activity: destination === 'activity' ? { pages: origin.activityPages } : null,
    },
  });
  /** Where the Expense task on screen began, when it opened from this Group's view. */
  const expenseOrigin = (groupId: string) =>
    route.screen === 'expense' && route.returnTo?.groupId === groupId ? route.returnTo : null;
  /**
   * A confirmed change returns to Expenses, where the change shows, whatever the task began on.
   * A new Expense in a list that had slid past the newest page returns to it, at the top, where
   * it sorts and its highlight can show (#215). An edit or a delete keeps the window where it was
   * and reads its pages again, so the edited row shows where the member left it (owner decision
   * 1A, #219).
   */
  const savedReturn = (groupId: string, kind: 'create' | ExpenseMutation['kind']) => {
    const origin = expenseOrigin(groupId);
    return returnView(
      groupId,
      'expenses',
      kind === 'create' && origin?.firstPage
        ? { ...origin, firstPage: undefined, scrollY: 0, pages: 1 }
        : origin,
    );
  };

  /**
   * Show the Group view an Expense task returns to (`to`); the caller then reads it. A known
   * origin keeps its Month; direct entry uses the default Month.
   */
  const returnToGroup = (to: GroupRoute, snackbar: GroupSnackbar | null = null) => {
    const { groupId } = to,
      { detail, financial } = snapshot,
      origin = to.reread?.expenses;
    // A confirmed change says so at once; its message follows the reads after it (`confirmed`).
    confirmation = snackbar && { snackbar, subject: 'Expenses', shown: snackbar, change: Infinity };
    navigate(to, {
      detail:
        detail.id === groupId
          ? detail
          : { status: 'loading', id: groupId, data: null, message: null, refreshedAt: null },
      financial: !origin
        ? emptyFinancial()
        : financial.groupId === groupId && financial.month === origin.month
          ? financial
          : { ...emptyFinancial(), groupId, month: origin.month },
      snackbar,
    });
  };

  /** Offers the saved Expense's Month only when it differs from the Month the view returns to. */
  const ledgerSnackbar = (
    groupId: string,
    message: string,
    context: ExpenseContext | null,
    date?: string,
  ): GroupSnackbar => {
    const origin = expenseOrigin(groupId);
    // A Group not yet read here offers no other Month.
    const shown =
      context?.group.category !== 'home'
        ? null
        : origin
          ? origin.month
          : currentMonthKey(new Date(now()));
    const month = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : null;
    // A saved or updated Expense (dated) is highlighted while this shows; a deleted one has no row.
    const { status, receiptId } = snapshot.expense;
    return {
      groupId,
      message,
      viewMonth: shown && month && month !== shown ? month : null,
      ...(date && status === 'saved' && receiptId ? { expenseId: receiptId } : {}),
    };
  };

  const showHome = () => {
    viewRequest += 1;
    navigate(home, { financial: emptyFinancial() });
    return backHome();
  };

  /** Android Back and close keep the draft on this device and return where the task began. */
  const closeExpense = async () => {
    if (route.screen !== 'expense' || expenseNavigationBlocked()) return;
    if (snapshot.expense.status === 'delete-review') return cancelExpenseDeletion();
    // Leaving waits for the latest entries to be stored; if that fails, the form stays open.
    if (snapshot.expense.persistence === 'saving') {
      const view = viewRequest,
        close = ++closeRequest;
      if (
        !(await draftWritten()) ||
        view !== viewRequest ||
        close !== closeRequest ||
        route.screen !== 'expense' ||
        expenseNavigationBlocked()
      )
        return;
    }
    const to = parent(route);
    if (to.screen !== 'group') return showHome();
    returnToGroup(to);
    await openGroup(to.groupId);
  };

  const viewSnackbarMonth = async () => {
    const month = snapshot.snackbar?.viewMonth;
    if (month) await selectMonth(month);
  };
  const dismissSnackbar = () => {
    if (snapshot.snackbar || snapshot.homeSnackbar)
      publish({ ...snapshot, snackbar: null, homeSnackbar: null });
  };

  const editExpense = async () => {
    const editor = snapshot.expense;
    if (
      snapshot.screen !== 'expense' ||
      editor.status !== 'detail' ||
      editor.groupDraft ||
      !editor.draft?.original ||
      !canEditExpense(editor.draft.original)
    )
      return;
    // Nothing is stored until an entry changes.
    publish({ ...snapshot, expense: { ...editor, status: 'editing' } });
  };

  /**
   * An edit or delete is confirmed: its answer arrived, or the saved Expense shows it. Its stored
   * change leaves this device, only while the device still holds that same change.
   */
  const forgetConfirmedChange = (
    lease: AccountStorageLease,
    storage: ExpenseDraftStore,
    groupId: string,
    expenseId: string,
    mutation: ExpenseMutation,
  ) =>
    lease.write(async () => {
      const value = await storage.load(lease.accountId, groupId);
      if (value === null) return;
      const stored = parseStoredExpenseDraft(value, lease.accountId, groupId);
      if (
        stored.draft.original?._id === expenseId &&
        stored.mutation?.kind === mutation.kind &&
        stored.mutation.revision === mutation.revision &&
        stored.mutation.body === mutation.body
      )
        await storage.remove(lease.accountId, groupId);
    });
  /** The form shows a confirmed edit or delete saved, then returns to its Group, which says so. */
  const showConfirmedChange = (
    groupId: string,
    kind: ExpenseMutation['kind'],
    draft: ExpenseDraft,
    original: ExpenseRecord,
    context: ExpenseContext | null,
  ) => {
    publish({
      ...snapshot,
      expense: {
        ...snapshot.expense,
        draft: null,
        preview: null,
        mutation: null,
        status: 'saved',
        receiptId: original._id,
        message: kind === 'delete' ? 'Expense deleted.' : 'Expense updated.',
      },
    });
    returnToGroup(
      savedReturn(groupId, kind),
      kind === 'delete'
        ? ledgerSnackbar(groupId, `Expense deleted · ${original.description}`, context)
        : ledgerSnackbar(
            groupId,
            `Expense updated · ${draft.description.trim()}`,
            context,
            draft.date,
          ),
    );
  };

  /**
   * Check the saved Expense for an edit or delete that may not have been recorded. When it shows
   * the member's own change, whose answer was lost, the change finishes as if the answer had
   * arrived. Otherwise the member compares the versions, or the draft stays blocked. Checking only
   * reads: nothing is sent again.
   */
  const reconcileExpense = async () => {
    const editor = snapshot.expense;
    const { draft, groupId, mutation } = editor;
    const original = draft?.original;
    if (
      snapshot.screen !== 'expense' ||
      !draft ||
      !original ||
      !groupId ||
      editor.status === 'saving'
    )
      return;
    const owner = generation,
      view = viewRequest;
    publish({ ...snapshot, expense: { ...editor, status: 'loading', latest: null } });
    try {
      const latest = parseExpenseRecord(
        await request(`/api/groups/${groupId}/expenses/${original._id}`, owner),
        groupId,
        original._id,
      );
      if (!current(owner) || view !== viewRequest) return;
      if (mutation && savedAsSent(mutation, latest)) {
        const lease = accountStorage(),
          storage = dependencies.expenseDrafts;
        if (!lease || !storage) throw new Error('Draft storage is unavailable.');
        await forgetConfirmedChange(lease, storage, groupId, original._id, mutation);
        if (!current(owner)) return;
        // As after an answer that arrived: the app may have closed before the write's own
        // clean-up ran, so the Group's older saved copies go now.
        await removeLedgerCopies(groupId, owner);
        if (!current(owner)) return;
        if (view === viewRequest)
          showConfirmedChange(groupId, mutation.kind, draft, original, snapshot.expense.context);
        await refreshLedgerViews(groupId, owner, view === viewRequest);
        return;
      }
      publish({
        ...snapshot,
        expense: {
          ...snapshot.expense,
          latest,
          status: latest.isDeleted ? 'blocked' : 'conflict',
          message: latest.isDeleted
            ? 'This Expense has been deleted. Your draft is kept, but it cannot be saved.'
            : 'Compare your version with the saved one, then choose which to keep. Nothing is sent until you save again.',
        },
      });
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      const denied = error instanceof RequestError && [403, 404].includes(error.status);
      publish({
        ...snapshot,
        expense: {
          ...snapshot.expense,
          status: denied ? 'blocked' : 'uncertain',
          message: denied
            ? 'This Expense is unavailable or you no longer have access. Your draft is kept; saving is disabled.'
            : 'Could not check the current Expense. Your draft and original revision are kept. Try checking again.',
        },
      });
    }
  };

  const reviewLatestExpense = async () => {
    const editor = snapshot.expense;
    const lease = accountStorage(),
      storage = dependencies.expenseDrafts;
    if (
      snapshot.screen !== 'expense' ||
      editor.status !== 'conflict' ||
      !editor.latest ||
      !canEditExpense(editor.latest) ||
      !editor.draft ||
      !editor.groupId ||
      !lease ||
      !storage
    )
      return;
    const owner = generation,
      view = viewRequest;
    const draft = rebaseExpenseDraft(editor.draft, editor.latest);
    publish({ ...snapshot, expense: { ...editor, persistence: 'saving' } });
    try {
      await lease.write(() =>
        expenseDraftChanged(draft, editor.blank)
          ? storage.save(lease.accountId, editor.groupId!, {
              version: 1,
              accountId: lease.accountId,
              groupId: editor.groupId,
              draft,
            })
          : storage.remove(lease.accountId, editor.groupId!),
      );
      if (!current(owner) || view !== viewRequest) return;
      publish({
        ...snapshot,
        expense: {
          ...snapshot.expense,
          draft,
          mutation: null,
          latest: null,
          status: 'editing',
          persistence: 'saved',
          preview: previewExpense(draft),
          validation: revalidateExpense(snapshot.expense.validation, draft, editor.context),
          message: `Fields you didn’t change now show the saved values. ${
            draft.review
              ? 'Choose which version to keep in What’s different before saving.'
              : 'Check your version before saving.'
          }`,
        },
      });
    } catch {
      if (current(owner) && view === viewRequest)
        publish({
          ...snapshot,
          expense: {
            ...snapshot.expense,
            persistence: 'error',
            message: 'Could not retain the reviewed revision. Retry review before saving.',
          },
        });
    }
  };

  const acceptCurrentExpense = async () => {
    const editor = snapshot.expense;
    const lease = accountStorage(),
      storage = dependencies.expenseDrafts;
    if (
      snapshot.screen !== 'expense' ||
      !editor.latest ||
      !editor.groupId ||
      !lease ||
      !storage ||
      !['conflict', 'blocked'].includes(editor.status)
    )
      return;
    const owner = generation,
      view = viewRequest;
    publish({ ...snapshot, expense: { ...editor, status: 'loading' } });
    try {
      await lease.write(() => storage.remove(lease.accountId, editor.groupId!));
      if (!current(owner) || view !== viewRequest) return;
      await openExpense(editor.groupId, editor.latest._id);
    } catch {
      if (current(owner) && view === viewRequest)
        publish({
          ...snapshot,
          expense: { ...editor, message: 'Could not clear the recovered draft. Try again.' },
        });
    }
  };
  const reviewExpenseDeletion = () => {
    const editor = snapshot.expense;
    if (
      snapshot.screen === 'expense' &&
      editor.status === 'detail' &&
      !editor.groupDraft &&
      editor.draft?.original &&
      !editor.draft.original.isDeleted
    )
      publish({ ...snapshot, expense: { ...editor, status: 'delete-review' } });
  };
  const cancelExpenseDeletion = () => {
    if (snapshot.screen === 'expense' && snapshot.expense.status === 'delete-review')
      publish({ ...snapshot, expense: { ...snapshot.expense, status: 'detail' } });
  };
  const saveExpenseEdit = async (kind: 'edit' | 'delete' = 'edit') => {
    const editor = snapshot.expense;
    const { draft, groupId } = editor;
    const original = draft?.original;
    const lease = accountStorage();
    const storage = dependencies.expenseDrafts;
    if (
      snapshot.screen !== 'expense' ||
      editor.status !== (kind === 'delete' ? 'delete-review' : 'editing') ||
      // Saving and deleting need a connection; the form and the confirmation say so.
      snapshot.offline.active ||
      editor.persistence === 'error' ||
      !original ||
      !draft ||
      !groupId ||
      !lease ||
      !storage ||
      editor.mutation ||
      // A money field the saved Expense changed waits for the member's choice.
      (kind === 'edit' && !!draft.review?.length)
    )
      return;
    if (kind === 'edit' && rejectInvalidExpense(editor, draft, editor.context)) return;
    const owner = generation,
      view = viewRequest;
    let mutation: MobileSnapshot['expense']['mutation'] = editor.mutation;
    let completed = false;
    let refreshed = false;
    closeRequest += 1;
    publish({ ...snapshot, expense: { ...editor, status: 'saving', message: null } });
    try {
      // Save tapped straight after typing sends once that draft is stored, or not at all.
      if (editor.persistence === 'saving' && !(await draftWritten())) {
        if (current(owner) && view === viewRequest)
          publish({ ...snapshot, expense: { ...snapshot.expense, status: editor.status } });
        return;
      }
      const context = parseExpenseContext(await request(`/api/groups/${groupId}`, owner));
      if (!current(owner) || view !== viewRequest) return;
      if (
        context.group.id !== groupId ||
        !context.group.members.some((member) => member.user.id === lease.accountId)
      )
        throw new RequestError('You no longer have access to this Group.', 403);
      // Tags and members may have changed since the draft opened.
      if (kind === 'edit' && rejectInvalidExpense(snapshot.expense, draft, context)) return;
      const pending = {
        kind,
        revision: original.revision,
        body: kind === 'edit' ? buildExpensePatch(draft, context) : '',
      };
      await lease.write(() =>
        storage.save(lease.accountId, groupId, {
          version: 1,
          accountId: lease.accountId,
          groupId,
          draft,
          mutation: pending,
        }),
      );
      mutation = pending;
      if (!current(owner) || view !== viewRequest) return;
      publish({ ...snapshot, expense: { ...snapshot.expense, mutation, context } });
      const response = await ledgerWrite(
        groupId,
        `/api/groups/${groupId}/expenses/${original._id}`,
        owner,
        {
          method: kind === 'edit' ? 'PATCH' : 'DELETE',
          revision: mutation.revision,
          ...(kind === 'edit' ? { serializedBody: mutation.body } : {}),
        },
      );
      if (kind === 'edit') parseExpenseRecord(response, groupId, original._id);
      else {
        const deleted = parseExpenseRecord(
          await request(`/api/groups/${groupId}/expenses/${original._id}`, owner),
          groupId,
          original._id,
        );
        if (!deleted.isDeleted) throw new Error('Could not confirm deletion.');
      }
      await forgetConfirmedChange(lease, storage, groupId, original._id, mutation);
      completed = true;
      if (!current(owner) || view !== viewRequest) return;
      refreshed = true;
      showConfirmedChange(groupId, kind, draft, original, context);
      await refreshLedgerViews(groupId, owner, true);
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      const rejection = expenseRejectionMessage(error);
      if (mutation && rejection) {
        try {
          await lease.write(() =>
            storage.save(lease.accountId, groupId, {
              version: 1,
              accountId: lease.accountId,
              groupId,
              draft,
            }),
          );
          mutation = null;
          if (!current(owner) || view !== viewRequest) return;
          publish({
            ...snapshot,
            expense: {
              ...snapshot.expense,
              mutation: null,
              status: kind === 'delete' ? 'delete-review' : 'editing',
              persistence: 'saved',
              message: rejection,
            },
          });
          return;
        } catch {
          // Keep recovery locked if the confirmed rejection cannot be persisted.
        }
      }
      if (!current(owner) || view !== viewRequest) return;
      publish({
        ...snapshot,
        expense: {
          ...snapshot.expense,
          mutation,
          status: mutation
            ? 'uncertain'
            : error instanceof RequestError && [403, 404].includes(error.status)
              ? 'blocked'
              : kind === 'delete'
                ? 'delete-review'
                : 'editing',
          message: expenseFailureMessage(
            error,
            kind === 'delete'
              ? 'Could not delete this Expense. It has not been changed.'
              : 'Could not update this Expense. Your draft is kept.',
          ),
        },
      });
      if (mutation) await reconcileExpense();
    } finally {
      if (
        current(owner) &&
        view !== viewRequest &&
        snapshot.expense.draft === draft &&
        snapshot.expense.status === 'saving'
      ) {
        publish({
          ...snapshot,
          expense: {
            ...snapshot.expense,
            mutation: completed ? null : mutation,
            status: completed
              ? 'saved'
              : mutation
                ? 'uncertain'
                : kind === 'delete'
                  ? 'delete-review'
                  : 'editing',
            draft: completed ? null : draft,
            preview: completed ? null : snapshot.expense.preview,
            message: completed
              ? kind === 'delete'
                ? 'Expense deleted.'
                : 'Expense updated.'
              : 'Your draft is kept. Check the current record before continuing.',
          },
        });
      }
      if (current(owner) && completed && !refreshed)
        await refreshLedgerViews(groupId, owner, false);
    }
  };
  const saveExpense = async () => {
    if (snapshot.expense.draft?.original) return saveExpenseEdit();
    const editor = snapshot.expense;
    const lease = accountStorage();
    const storage = dependencies.expenseDrafts;
    if (
      snapshot.screen !== 'expense' ||
      // Saving needs a connection; the form says so.
      snapshot.offline.active ||
      // An unconfirmed save is finished from where it reopens, without resuming it first.
      !(
        editor.status === 'editing' ||
        (editor.attempt && ['resume', 'uncertain'].includes(editor.status))
      ) ||
      (!editor.attempt && editor.persistence === 'error') ||
      !editor.draft ||
      !editor.groupId ||
      !lease ||
      !storage
    )
      return;
    const { groupId, draft } = editor;
    // A retry resends its immutable attempt; only new input is checked locally first.
    if (!editor.attempt && rejectInvalidExpense(editor, draft, editor.context)) return;
    const owner = generation;
    const view = viewRequest;
    closeRequest += 1;
    publish({ ...snapshot, expense: { ...editor, status: 'saving', message: null } });
    let attempt = editor.attempt;
    let storing = false;
    let resolvedReceipt: string | null = null;
    let successHandled = false;
    try {
      // Save tapped straight after typing sends once that draft is stored, or not at all.
      if (editor.persistence === 'saving' && !(await draftWritten())) {
        if (current(owner) && view === viewRequest)
          publish({ ...snapshot, expense: { ...snapshot.expense, status: editor.status } });
        return;
      }
      // A successful authorized read is a connection/access check, never proof a write will succeed.
      const context = parseExpenseContext(await request(`/api/groups/${groupId}`, owner));
      if (!current(owner) || view !== viewRequest) return;
      if (
        context.group.id !== groupId ||
        !context.group.members.some((member) => member.user.id === lease.accountId)
      )
        throw new RequestError('You no longer have access to this Group.', 403);
      if (!attempt && rejectInvalidExpense(snapshot.expense, draft, context)) return;
      publish({ ...snapshot, expense: { ...snapshot.expense, context } });
      if (!attempt) {
        const body = buildExpenseBody(draft, context);
        const key = dependencies.newSubmissionKey?.();
        if (!key) throw new Error('Could not create a submission key.');
        const pending = { key, body };
        storing = true;
        await lease.write(() =>
          storage.save(lease.accountId, groupId, {
            version: 1,
            accountId: lease.accountId,
            groupId,
            draft,
            blank: editor.blank,
            attempt: pending,
          }),
        );
        storing = false;
        attempt = pending;
      }
      if (!current(owner) || view !== viewRequest) return;
      publish({
        ...snapshot,
        expense: { ...snapshot.expense, context, attempt, persistence: 'saved' },
      });
      const receiptId = parseCreatedExpenseId(
        await ledgerWrite(groupId, `/api/groups/${groupId}/expenses`, owner, {
          method: 'POST',
          serializedBody: attempt.body,
          idempotencyKey: attempt.key,
        }),
        groupId,
      );
      await lease.write(async () => {
        const stored = await storage.load(lease.accountId, groupId);
        if (stored === null) return;
        const saved = parseStoredExpenseDraft(stored, lease.accountId, groupId);
        // Another recovery may already have confirmed this request and created a new draft.
        if (saved.attempt?.key === attempt!.key && saved.attempt.body === attempt!.body)
          await storage.remove(lease.accountId, groupId);
      });
      resolvedReceipt = receiptId;
      if (!current(owner) || view !== viewRequest) return;
      publish({
        ...snapshot,
        expense: {
          ...snapshot.expense,
          status: 'saved',
          receiptId,
          attempt: null,
          attemptRejected: false,
          draft: null,
          preview: null,
          message: 'Expense saved.',
        },
      });
      successHandled = true;
      returnToGroup(
        savedReturn(groupId, 'create'),
        ledgerSnackbar(groupId, `Expense saved · ${draft.description.trim()}`, context, draft.date),
      );
      await refreshLedgerViews(groupId, owner, true);
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      const rejection = expenseRejectionMessage(error);
      // Only a first send's rejection frees the draft. A retry's first try may be recorded.
      if (attempt && !editor.attempt && rejection) {
        try {
          await lease.write(() =>
            storage.save(lease.accountId, groupId, {
              version: 1,
              accountId: lease.accountId,
              groupId,
              draft,
              blank: editor.blank,
            }),
          );
          if (!current(owner) || view !== viewRequest) return;
          publish({
            ...snapshot,
            expense: {
              ...snapshot.expense,
              attempt: null,
              status: 'editing',
              persistence: 'saved',
              message: rejection,
            },
          });
          return;
        } catch {
          /* Preserve the immutable attempt until local cleanup succeeds. */
        }
      }
      const refused = !!editor.attempt && refusesRetry(error);
      if (refused && current(owner)) {
        // Stored with the save, so Discard is still offered after reopening or a restart.
        try {
          await lease.write(async () => {
            const stored = await storage.load(lease.accountId, groupId);
            if (stored === null) return;
            const saved = parseStoredExpenseDraft(stored, lease.accountId, groupId);
            if (saved.attempt?.key === attempt!.key && saved.attempt.body === attempt!.body)
              await storage.save(lease.accountId, groupId, {
                ...(stored as object),
                attemptRejected: true,
              });
          });
        } catch (storeError) {
          if (storeError instanceof Superseded) return;
          /* This form still offers Discard; only a reopened one won't. */
        }
      }
      if (!current(owner) || view !== viewRequest) return;
      publish({
        ...snapshot,
        expense: {
          ...snapshot.expense,
          attempt,
          attemptRejected: refused || snapshot.expense.attemptRejected,
          persistence: storing ? 'error' : snapshot.expense.persistence,
          status: attempt ? 'uncertain' : 'editing',
          message: storing
            ? 'Could not save the submission on this device. No Expense was sent. Retry local storage before saving.'
            : refused
              ? `SplitBook refused this retry.${rejection ? ` ${rejection}` : ''} ${refusedRetryNotice}`
              : attempt
                ? `${error instanceof RequestError ? `${error.message} ` : ''}This Expense may already be saved. Checking reuses the same submission, so it can’t be recorded twice.`
                : expenseFailureMessage(
                    error,
                    'Could not prepare this Expense. Your draft is still here.',
                  ),
        },
      });
    } finally {
      // Warm links may replace the editor while transport/storage is pending.
      // Reconcile only this draft; never install it into a newer account or editor.
      if (
        current(owner) &&
        view !== viewRequest &&
        snapshot.expense.groupId === groupId &&
        snapshot.expense.draft === draft &&
        snapshot.expense.status === 'saving'
      ) {
        publish({
          ...snapshot,
          expense: {
            ...snapshot.expense,
            status: resolvedReceipt ? 'saved' : attempt ? 'uncertain' : 'editing',
            attempt: resolvedReceipt ? null : attempt,
            attemptRejected: !resolvedReceipt && snapshot.expense.attemptRejected,
            draft: resolvedReceipt ? null : draft,
            preview: resolvedReceipt ? null : snapshot.expense.preview,
            receiptId: resolvedReceipt,
            persistence: storing ? 'error' : snapshot.expense.persistence,
            message: resolvedReceipt
              ? 'Expense saved.'
              : attempt
                ? 'Resume this draft to confirm the same submission.'
                : 'Your draft is still here.',
          },
        });
      }
      if (current(owner) && resolvedReceipt && !successHandled && view !== viewRequest) {
        await refreshLedgerViews(groupId, owner, false);
      }
    }
  };

  const settlementContext = async (groupId: string, owner: number) => {
    const group = parseGroup(await request(`/api/groups/${groupId}`, owner));
    if (group.id !== groupId || !group.members.some((m) => m.user.id === snapshot.auth.user?.id))
      throw new RequestError('You no longer have access to this Group.', 403);
    const value = await request(`/api/groups/${groupId}/balances`, owner);
    const balances = parseGroupBalances(value);
    if (current(owner)) groupQueries.sheetBalances(groupId, value);
    return { group, balances };
  };
  /**
   * The Record payment sheet over Balances. Its reads are live; they never cancel the Group's
   * own reads, and leaving the Group or closing the sheet cancels them.
   */
  const openSettlements = async (groupId: string) => {
    if (snapshot.auth.status !== 'authenticated') return;
    const owner = generation,
      view = viewRequest,
      request = ++settlementRequest,
      lease = accountStorage(),
      storage = dependencies.settlementAttempts;
    const stale = () => !current(owner) || view !== viewRequest || request !== settlementRequest;
    navigate(
      { screen: 'settlement', groupId, reread: rereadOf(groupId) },
      { settlement: { ...emptySettlement(), groupId, status: 'loading' } },
    );
    try {
      if (!lease || !storage) throw new DeviceStorageError(recoveryStorageMissing);
      let recovery: ReturnType<typeof parseSettlementAttempt> | null;
      try {
        const stored = await lease.write(() => storage.load(lease.accountId, groupId));
        recovery =
          stored === null ? null : parseSettlementAttempt(stored, lease.accountId, groupId);
      } catch (error) {
        if (error instanceof Superseded || !current(owner)) throw error;
        // The stored record is left exactly as it is, for a later explicit retry.
        throw new DeviceStorageError(recoveryStorageUnreadable);
      }
      if (stale()) return;
      if (recovery) publish({ ...snapshot, settlement: { ...snapshot.settlement, ...recovery } });
      const context = await settlementContext(groupId, owner);
      if (stale()) return;
      publish({
        ...snapshot,
        settlement: {
          ...snapshot.settlement,
          ...context,
          status: recovery ? 'uncertain' : 'ready',
          message: recovery ? unconfirmedPayment : null,
        },
      });
    } catch (error) {
      if (stale() || error instanceof Superseded) return;
      publish({
        ...snapshot,
        settlement: {
          ...snapshot.settlement,
          status:
            error instanceof RequestError && [403, 404].includes(error.status)
              ? 'blocked'
              : snapshot.settlement.attempt
                ? 'uncertain'
                : 'error',
          // Storage problems say so, rather than pointing at the connection.
          message:
            error instanceof RequestError || error instanceof DeviceStorageError
              ? error.message
              : 'Couldn’t check the latest balances. Close this and try again when you’re connected.',
        },
      });
    }
  };
  const selectSettlement = (paidBy: string, paidTo: string, currency: string) => {
    const state = snapshot.settlement,
      account = snapshot.auth.user?.id;
    if (
      snapshot.screen !== 'settlement' ||
      state.status !== 'ready' ||
      state.attempt ||
      !state.group ||
      !account
    )
      return;
    const debt = state.balances
      .find((b) => b.currency === currency)
      ?.debts.find((d) => d.from.id === paidBy && d.to.id === paidTo);
    if (
      !debt ||
      currency !== state.group.defaultCurrency ||
      !canRecordSettlement(account, paidBy, paidTo) ||
      !state.group.members.some((m) => m.user.id === paidBy) ||
      !state.group.members.some((m) => m.user.id === paidTo)
    )
      return;
    publish({
      ...snapshot,
      settlement: {
        ...state,
        status: 'editing',
        draft: { paidBy, paidTo, currency, amount: String(debt.amount), note: '' },
        suggested: debt.amount,
        acknowledged: false,
        message: null,
        validation: emptyFormValidation(),
      },
    });
  };
  const updateSettlement = (patch: Partial<Pick<SettlementDraft, 'amount' | 'note'>>) => {
    const state = snapshot.settlement;
    if (
      snapshot.screen !== 'settlement' ||
      !['editing', 'review'].includes(state.status) ||
      state.attempt ||
      !state.draft
    )
      return;
    const draft = { ...state.draft, ...patch };
    publish({
      ...snapshot,
      settlement: {
        ...state,
        status: 'editing',
        draft,
        acknowledged: draft.amount === state.draft.amount && state.acknowledged,
        message: null,
        validation: { ...state.validation, errors: validateSettlementDraft(draft) },
      },
    });
  };
  /** Leaving a field shows its correction, if any; typing alone never does. */
  const touchSettlementField = (field: SettlementField) => {
    const state = snapshot.settlement;
    if (
      snapshot.screen !== 'settlement' ||
      !['editing', 'review'].includes(state.status) ||
      !state.draft ||
      state.validation.touched.includes(field)
    )
      return;
    publish({
      ...snapshot,
      settlement: {
        ...state,
        validation: touchField(state.validation, field, validateSettlementDraft(state.draft)),
      },
    });
  };
  /** "I meant to pay more than suggested": Record waits for it above the suggestion. */
  const acknowledgeSettlement = (acknowledged = true) => {
    if (
      snapshot.screen === 'settlement' &&
      ['editing', 'review'].includes(snapshot.settlement.status) &&
      !snapshot.settlement.attempt
    )
      publish({ ...snapshot, settlement: { ...snapshot.settlement, acknowledged } });
  };
  const recordSettlement = async () => {
    const state = snapshot.settlement,
      lease = accountStorage(),
      storage = dependencies.settlementAttempts;
    if (
      snapshot.screen !== 'settlement' ||
      !['editing', 'review', 'uncertain'].includes(state.status) ||
      !state.draft ||
      !state.groupId
    )
      return;
    // Corrections stay on their fields, every entry is kept, and nothing is requested.
    if (!state.attempt) {
      const errors = validateSettlementDraft(state.draft);
      const rejected = rejectFields(settlementFields, state.validation, errors);
      if (rejected) {
        publish({
          ...snapshot,
          settlement: {
            ...state,
            status: 'editing',
            message: settlementCorrectionSummary(errors),
            validation: rejected,
          },
        });
        return;
      }
    }
    // A payment is only sent once its retry identity is stored on this device.
    if (!lease || !storage) {
      publish({
        ...snapshot,
        settlement: {
          ...state,
          message:
            'This device can’t keep a recovery copy of the payment right now, so it can’t be recorded yet. Your entries are kept. Try again, or sign out and back in.',
        },
      });
      return;
    }
    const owner = generation,
      view = viewRequest,
      groupId = state.groupId,
      draft = state.draft;
    let attempt = state.attempt,
      completed = false;
    publish({ ...snapshot, settlement: { ...state, status: 'saving', message: null } });
    try {
      const context = await settlementContext(groupId, owner);
      if (!current(owner) || view !== viewRequest) return;
      assertSettlementMembers(
        new Set(context.group.members.map((m) => m.user.id)),
        draft.paidBy,
        draft.paidTo,
      );
      assertSettlementAuthorization(lease.accountId, draft.paidBy, draft.paidTo);
      if (!attempt) {
        const suggested = settlementSuggestion(context.balances, draft);
        // The suggestion is gone: recording it anyway would be a payment nobody suggested.
        if (suggested === 0) {
          publish({
            ...snapshot,
            settlement: {
              ...state,
              ...context,
              status: 'ready',
              draft: null,
              suggested: null,
              acknowledged: false,
              message: suggestionChanged,
              validation: emptyFormValidation(),
            },
          });
          return;
        }
        if (suggested !== state.suggested) {
          publish({
            ...snapshot,
            settlement: {
              ...state,
              ...context,
              suggested,
              status: 'review',
              acknowledged: false,
              message: 'The suggested amount changed. Check the amount, then record again.',
            },
          });
          return;
        }
        if (
          parseAmountMinor(draft.amount, draft.currency) >
            parseAmountMinor(suggested, draft.currency) &&
          !state.acknowledged
        ) {
          publish({
            ...snapshot,
            settlement: {
              ...state,
              status: 'review',
              message:
                'This payment exceeds the current suggestion. Acknowledge the difference before recording.',
            },
          });
          return;
        }
        assertGroupCurrency(context.group.defaultCurrency, draft.currency);
        const body = settlementBody(draft);
        const pending = { key: dependencies.newSubmissionKey?.() ?? '', body };
        const value = { version: 1, accountId: lease.accountId, groupId, ...pending };
        parseSettlementAttempt(value, lease.accountId, groupId);
        try {
          await lease.write(() => storage.save(lease.accountId, groupId, value));
        } catch (error) {
          if (error instanceof Superseded || !current(owner)) throw error;
          throw new DeviceStorageError(
            'Nothing was sent: this device couldn’t store a recovery copy of the payment. Your entries are kept. Choose Record payment again.',
          );
        }
        attempt = pending;
      }
      if (!current(owner) || view !== viewRequest) return;
      publish({ ...snapshot, settlement: { ...snapshot.settlement, attempt } });
      const response = await ledgerWrite(groupId, `/api/groups/${groupId}/settlements`, owner, {
        method: 'POST',
        serializedBody: attempt.body,
        idempotencyKey: attempt.key,
      });
      parseRecordedSettlement(response, groupId, attempt.body);
      await lease.write(async () => {
        const saved = await storage.load(lease.accountId, groupId);
        if (saved === null) return;
        const currentAttempt = parseSettlementAttempt(saved, lease.accountId, groupId).attempt;
        if (currentAttempt.key === attempt!.key && currentAttempt.body === attempt!.body)
          await storage.remove(lease.accountId, groupId);
      });
      completed = true;
      // The record is gone from this device, so Balances no longer offers it.
      if (current(owner) && snapshot.pendingPayment?.groupId === groupId) {
        pendingRequest += 1;
        publish({ ...snapshot, pendingPayment: null });
      }
      if (!current(owner) || view !== viewRequest) return;
      // The sheet closes onto Balances, which the refresh below reads again.
      showSettlementGroup(
        groupAt(groupId, 'balances'),
        { groupId, message: 'Payment recorded', viewMonth: null },
        null,
      );
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      const correctionCodes: Record<string, string> = {
        CURRENCY_MISMATCH: 'The Group currency changed. Close this and choose the payment again.',
        INVALID_MEMBERS:
          'The payer or recipient is no longer a Group member. Close this and choose another payment.',
        SAME_PARTY: 'Payer and recipient must be different people.',
        FORBIDDEN_SETTLEMENT: 'Only the payer or recipient can record this payment.',
        VALIDATION_ERROR: 'Check the actual amount, currency precision, and note before recording.',
      };
      const correction =
        error instanceof RequestError && error.status === 422 && error.code
          ? correctionCodes[error.code]
          : undefined;
      if (attempt && !state.attempt && correction) {
        try {
          await lease.write(async () => {
            const value = await storage.load(lease.accountId, groupId);
            if (value === null) return;
            const pending = parseSettlementAttempt(value, lease.accountId, groupId).attempt;
            if (pending.key === attempt!.key && pending.body === attempt!.body)
              await storage.remove(lease.accountId, groupId);
          });
          attempt = null;
          if (!current(owner) || view !== viewRequest) return;
          publish({
            ...snapshot,
            settlement: {
              ...snapshot.settlement,
              attempt: null,
              status: 'editing',
              acknowledged: false,
              message: correction,
            },
          });
          return;
        } catch {
          /* A failed local cleanup keeps the recovery record locked. */
        }
      }
      if (!current(owner) || view !== viewRequest) return;
      const denied =
        (error instanceof RequestError && [403, 404, 409, 422].includes(error.status)) ||
        (error instanceof Error &&
          ['INVALID_MEMBERS', 'FORBIDDEN_SETTLEMENT', 'SAME_PARTY'].includes(error.message));
      publish({
        ...snapshot,
        settlement: {
          ...snapshot.settlement,
          attempt,
          status: denied ? 'blocked' : attempt ? 'uncertain' : 'review',
          message: denied
            ? 'This payment can’t be recorded with your current access or details. Any unconfirmed record stays on this device.'
            : attempt
              ? unconfirmedPayment
              : error instanceof Error
                ? error.message
                : 'Could not record this payment. Your entries are kept.',
        },
      });
    } finally {
      if (
        current(owner) &&
        view !== viewRequest &&
        snapshot.settlement.draft === draft &&
        snapshot.settlement.status === 'saving'
      )
        publish({
          ...snapshot,
          settlement: {
            ...snapshot.settlement,
            attempt: completed ? null : attempt,
            draft: completed ? null : draft,
            status: completed ? 'ready' : attempt ? 'uncertain' : 'editing',
            message: completed
              ? 'Payment recorded.'
              : 'Your entries are retained. Review or explicitly retry after reconnecting.',
          },
        });
      if (current(owner) && completed) await refreshLedgerViews(groupId, owner, false);
    }
  };

  /**
   * Record on a suggested payment opens the sheet over Balances, pre-filled once a live read
   * confirms the suggestion. Recording needs a connection, so offline it does nothing.
   */
  const openRecordPayment = async (paidBy: string, paidTo: string, currency: string) => {
    const groupId = snapshot.detail.data?.id;
    if (
      snapshot.auth.status !== 'authenticated' ||
      snapshot.screen !== 'group' ||
      snapshot.destination !== 'balances' ||
      !groupId ||
      snapshot.offline.active ||
      // Balances out of date since a change written here offer no payment until read (#219).
      snapshot.financial.balances.changed
    )
      return;
    await openSettlements(groupId);
    // Closed while the live read ran.
    const { screen, settlement: state } = latest();
    if (screen !== 'settlement' || state.groupId !== groupId) return;
    // An unconfirmed payment opens instead, and says why when it isn't the one chosen.
    if (
      state.status === 'uncertain' &&
      state.draft &&
      (state.draft.paidBy !== paidBy || state.draft.paidTo !== paidTo)
    )
      publish({
        ...snapshot,
        settlement: {
          ...state,
          message: `${earlierPayment} ${state.message ?? unconfirmedPayment}`,
        },
      });
    if (state.status !== 'ready') return;
    selectSettlement(paidBy, paidTo, currency);
    if (!snapshot.settlement.draft)
      publish({ ...snapshot, settlement: { ...snapshot.settlement, message: suggestionChanged } });
  };

  /** Check payment on Balances opens the Group's unconfirmed payment in the sheet, to retry. */
  const openPendingPayment = async () => {
    const groupId = snapshot.detail.data?.id;
    if (
      snapshot.auth.status !== 'authenticated' ||
      snapshot.screen !== 'group' ||
      snapshot.destination !== 'balances' ||
      !groupId ||
      snapshot.pendingPayment?.groupId !== groupId ||
      snapshot.offline.active
    )
      return;
    await openSettlements(groupId);
    const { screen, settlement: state } = latest();
    // Resolved since Balances showed it: nothing is waiting any more.
    if (screen === 'settlement' && state.groupId === groupId && state.status === 'ready')
      publish({
        ...snapshot,
        settlement: {
          ...state,
          message: 'Nothing is waiting to be retried. Close this to see the latest balances.',
        },
      });
  };

  /**
   * Show the Group's Balances (`to`) under a closing sheet; late sheet reads can't reopen it.
   * `pending` is the unconfirmed payment Balances offers afterwards.
   */
  const showSettlementGroup = (
    to: GroupRoute,
    snackbar: GroupSnackbar | null,
    pending: PendingPayment | null,
  ) => {
    settlementRequest += 1;
    pendingRequest += 1;
    // A recorded payment says so at once; its message follows the reads after it (`confirmed`).
    confirmation = snackbar && { snackbar, subject: 'Balances', shown: snackbar, change: Infinity };
    navigate(to, {
      detail:
        snapshot.detail.id === to.groupId
          ? snapshot.detail
          : { status: 'loading', id: to.groupId, data: null, message: null, refreshedAt: null },
      settlement: emptySettlement(),
      pendingPayment: pending,
      snackbar,
    });
  };

  /** The Group view under the Record payment sheet, which it closes onto: Balances. */
  const underSheet = ({ groupId, reread }: Extract<Route, { screen: 'settlement' }>) =>
    groupAt(groupId, 'balances', reread);
  /**
   * Close and Android Back return to Balances; nothing is recorded. An unconfirmed payment stays
   * on Balances. Balances read again when the sheet's own check of the Group, or a payment whose
   * outcome is unknown, made them out of date (M1-5, AMEND-1).
   */
  const closeSettlement = async () => {
    const { group, balances, attempt, draft } = snapshot.settlement;
    if (route.screen !== 'settlement' || expenseNavigationBlocked()) return;
    const to = underSheet(route);
    const { groupId } = to;
    const shown = snapshot.detail.id === groupId && snapshot.detail.data !== null;
    // The sheet read Balances after its own check of the Group: when they're the ones shown,
    // they stand verified; newer ones, or a payment that may be recorded, are read again.
    if (
      shown &&
      attempt === null &&
      group !== null &&
      JSON.stringify(balances) === JSON.stringify(snapshot.financial.balances.data)
    )
      groupQueries.adoptSheetBalances(groupId);
    const pending = attempt
      ? { groupId, draft }
      : snapshot.pendingPayment?.groupId === groupId
        ? snapshot.pendingPayment
        : null;
    showSettlementGroup(to, null, pending);
    if (!shown) await openGroup(groupId, true, 'balances');
    else await readFinancial('balances');
  };

  const startCreate = () => {
    if (snapshot.auth.status !== 'authenticated') return;
    viewRequest += 1;
    navigate({ screen: 'create' });
  };

  const openSettings = () => {
    if (snapshot.auth.status !== 'authenticated' || expenseNavigationBlocked()) return;
    viewRequest += 1;
    navigate({ screen: 'settings' });
  };

  /**
   * Shows the Group as known so far; a Group read still in flight updates the page. The route
   * keeps where it returns: the Group view, Month and scroll it opened from.
   */
  const openMembers = (origin: { scrollY?: number } = {}) => {
    const groupId = shownGroup(snapshot)?.id;
    if (snapshot.auth.status !== 'authenticated' || route.screen !== 'group' || !groupId) return;
    navigate({
      screen: 'members',
      groupId,
      destination: route.destination,
      returnTo: expenseReturn(groupId, origin.scrollY),
      reread: rereadOf(groupId),
    });
  };
  /** Android Back and the arrow return to the destination, Month and scroll it opened from. */
  const closeMembers = async () => {
    if (route.screen !== 'members' || snapshot.leave.status === 'leaving') return;
    const to = parent(route);
    if (to.screen !== 'group') return showHome();
    navigate(to);
    // Reads what the Group view missed while the page was open; recent reads are reused.
    await openGroup(to.groupId);
  };

  /** Changes whenever the Leave Group sheet opens or closes, so a late answer can't reopen it. */
  let leaveRequest = 0;
  /**
   * What this device keeps for a Group: its Expense draft, and a save or payment that may
   * already be recorded. A draft that can't be read may hold such a save, so it counts as one.
   */
  const keptForGroup = async (groupId: string) => {
    const lease = accountStorage(),
      drafts = dependencies.expenseDrafts,
      payments = dependencies.settlementAttempts;
    if (!lease) return { draft: false, unconfirmed: null };
    const [expense, payment] = await lease.write(() =>
      Promise.all([
        drafts ? drafts.load(lease.accountId, groupId) : null,
        payments ? payments.load(lease.accountId, groupId) : null,
      ]),
    );
    let pendingSave = false;
    if (expense !== null) {
      try {
        const record = parseStoredExpenseDraft(expense, lease.accountId, groupId);
        pendingSave = !!(record.attempt || record.mutation);
      } catch {
        pendingSave = true;
      }
    }
    return {
      draft: expense !== null,
      unconfirmed: payment !== null ? 'payment' : pendingSave ? 'expense' : null,
    } as const;
  };
  /** The sheet once this device is checked: anything that may already be recorded comes first. */
  const leaveChecked = async (groupId: string): Promise<Partial<LeaveGroupState>> => {
    try {
      const { draft, unconfirmed } = await keptForGroup(groupId);
      if (!unconfirmed) return { status: 'confirm', draft };
      return {
        status: 'blocked',
        draft,
        message:
          unconfirmed === 'payment'
            ? unconfirmedPaymentBeforeLeaving
            : unconfirmedSaveBeforeLeaving,
        check: unconfirmed === 'payment' ? 'balances' : 'expenses',
      };
    } catch (error) {
      if (error instanceof Superseded) throw error;
      return { status: 'blocked', message: keptWorkUnreadable, check: null };
    }
  };

  /**
   * Leave Group, from Members and Group details: opens its confirm sheet once this device has
   * been checked for the Group's draft and for anything that may already be recorded. Leaving
   * needs a connection, so offline it does nothing.
   */
  const reviewLeaveGroup = async () => {
    const group = shownGroup(snapshot);
    if (
      snapshot.auth.status !== 'authenticated' ||
      snapshot.screen !== 'members' ||
      !group ||
      snapshot.offline.active ||
      snapshot.leave.status !== 'closed'
    )
      return;
    const owner = generation,
      attempt = ++leaveRequest,
      groupId = group.id;
    publish({ ...snapshot, leave: { ...closedLeave(), groupId, status: 'checking' } });
    try {
      const checked = await leaveChecked(groupId);
      if (!current(owner) || attempt !== leaveRequest || snapshot.screen !== 'members') return;
      publish({ ...snapshot, leave: { ...snapshot.leave, ...checked } });
    } catch {
      // Superseded: a sign-out or account change has already replaced the screen.
    }
  };

  /** Cancel, Back and the scrim close the sheet; nothing was sent. Not while leaving. */
  const cancelLeaveGroup = () => {
    if (['closed', 'leaving'].includes(snapshot.leave.status)) return;
    leaveRequest += 1;
    publish({ ...snapshot, leave: closedLeave() });
  };

  /**
   * Leave Group on the sheet. Sent only online, after this device is checked again for a save or
   * payment in the Group that may already be recorded. Once left, the Group's content and draft
   * go from this device and Home shows, read again, with a snackbar. A refusal (an open balance,
   * the last admin, a concurrent change) stays on the sheet in the server's words.
   */
  const leaveGroup = async () => {
    const state = snapshot.leave,
      group = shownGroup(snapshot);
    if (
      snapshot.auth.status !== 'authenticated' ||
      snapshot.screen !== 'members' ||
      !group ||
      state.groupId !== group.id ||
      !['confirm', 'refused', 'error'].includes(state.status) ||
      snapshot.offline.active
    )
      return;
    const owner = generation,
      attempt = ++leaveRequest,
      groupId = group.id,
      name = group.name;
    const shown = () => current(owner) && attempt === leaveRequest && latest().screen === 'members';
    publish({
      ...snapshot,
      leave: { ...state, status: 'leaving', code: null, message: null, check: null },
    });
    let draft = false,
      archived = false;
    try {
      const checked = await leaveChecked(groupId);
      if (!shown()) return;
      if (checked.status !== 'confirm') {
        publish({ ...snapshot, leave: { ...snapshot.leave, ...checked } });
        return;
      }
      draft = !!checked.draft;
      archived = parseLeftGroup(
        await request(`/api/groups/${groupId}/leave`, owner, { method: 'POST' }).finally(() => {
          // Whatever the answer, the membership, Balances and Home may have changed.
          if (current(owner))
            invalidateReads(`group:${groupId}`, `balances:${groupId}`, 'groups', 'home');
        }),
      ).archived;
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      const refusal =
        error instanceof RequestError && error.status === 409 && error.code
          ? leaveRefusals[error.code]
          : undefined;
      if (refusal && error instanceof RequestError) {
        if (shown())
          publish({
            ...snapshot,
            leave: {
              ...snapshot.leave,
              status: 'refused',
              code: error.code,
              message: error.serverMessage?.trim() || refusal,
              check: error.code === 'OPEN_BALANCE' ? 'balances' : null,
            },
          });
        return;
      }
      // Not a member, or no Group: the page says it isn't available, as on any denial.
      if (error instanceof RequestError && [403, 404].includes(error.status)) {
        try {
          // A 403 was already forgotten by the request itself.
          if (error.status === 404) await forgetGroup(groupId, 404, owner);
        } catch {
          return;
        }
        if (attempt === leaveRequest) publish({ ...snapshot, leave: closedLeave() });
        return;
      }
      if (shown())
        publish({
          ...snapshot,
          leave: {
            ...snapshot.leave,
            status: 'error',
            message:
              error instanceof RequestError
                ? error.message
                : 'Couldn’t confirm that you left this Group. Please try again.',
          },
        });
      return;
    }
    // Left. The Group's draft goes with it; a failure only leaves it unlisted on this device.
    const lease = accountStorage(),
      drafts = dependencies.expenseDrafts;
    if (draft && lease && drafts)
      await lease.write(() => drafts.remove(lease.accountId, groupId)).catch(() => undefined);
    if (!current(owner)) return;
    const showingLeave = attempt === leaveRequest && snapshot.screen === 'members';
    const kept = {
      keptDraft: snapshot.keptDraft?.groupId === groupId ? null : snapshot.keptDraft,
      pendingPayment: snapshot.pendingPayment?.groupId === groupId ? null : snapshot.pendingPayment,
    };
    if (showingLeave) {
      // Home opens before the Group is forgotten, so the page just left never shows the
      // "no longer have access" notice that a lost membership would.
      viewRequest += 1;
      navigate(home, {
        ...kept,
        financial: emptyFinancial(),
        leave: closedLeave(),
        homeSnackbar: {
          message: archived
            ? `You left ${name}. It’s archived because nobody else was in it.`
            : `You left ${name}.`,
        },
      });
    } else {
      publish({ ...snapshot, ...kept });
    }
    try {
      await forgetGroup(groupId, 403, owner);
    } catch {
      return;
    }
    // Something else opened while the request ran; it stays, and its Groups list is already updated.
    if (!showingLeave || !current(owner)) return;
    // Forgetting the Group made Home read its list and figures again: wait for both.
    await homeQueries.settle(owner, { list: true });
  };

  /**
   * Go to Balances (or Expenses) on the Leave Group sheet: closes it and this page, and opens the
   * Group where what blocks leaving shows, such as an open balance or an unconfirmed save.
   */
  const showLeaveCheck = async () => {
    const { groupId, check, status } = snapshot.leave;
    if (
      snapshot.screen !== 'members' ||
      !groupId ||
      !check ||
      status === 'leaving' ||
      snapshot.detail.id !== groupId
    )
      return;
    leaveRequest += 1;
    navigate(groupAt(groupId, check), { leave: closedLeave() });
    await openGroup(groupId, true, check);
  };

  /** Needs the Group to be known, not read just now; inviting needs a connection. */
  const loadInviteLink = async (): Promise<string | null> => {
    if (
      snapshot.auth.status !== 'authenticated' ||
      !shownGroup(snapshot) ||
      !snapshot.detail.id ||
      snapshot.offline.active ||
      snapshot.share.status === 'loading'
    )
      return null;
    const owner = generation;
    const view = viewRequest;
    const id = snapshot.detail.id;
    publish({ ...snapshot, share: { status: 'loading', url: null, message: null } });
    try {
      let link = parseInviteLink(await request(`/api/groups/${id}/invite-link`, owner));
      assertCurrent(owner);
      if (view !== viewRequest) return null;
      if (!link.inviteUrl || !link.expiresAt || link.expiresAt.getTime() <= now()) {
        try {
          link = parseInviteLink(
            await request(`/api/groups/${id}/invite-link`, owner, {
              method: 'POST',
              body: { expiresInDays: 7 },
            }),
          );
        } catch (error) {
          if (
            error instanceof Superseded ||
            (error instanceof RequestError && error.status >= 400 && error.status < 500)
          )
            throw error;
          // Generation rotates the code: after uncertainty, read it instead of posting again.
          link = parseInviteLink(await request(`/api/groups/${id}/invite-link`, owner));
        }
        assertCurrent(owner);
        if (view !== viewRequest) return null;
      }
      if (!link.inviteUrl || !link.expiresAt || link.expiresAt.getTime() <= now())
        throw new RequestError('There is no active invitation link.');
      if (parseInvitationLink(link.inviteUrl, inviteOrigin) !== link.inviteCode)
        throw new RequestError('The server returned an invitation for a different environment.');
      publish({ ...snapshot, share: { status: 'ready', url: link.inviteUrl, message: null } });
      return link.inviteUrl;
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return null;
      publish({
        ...snapshot,
        share: {
          status: 'error',
          url: null,
          message:
            error instanceof RequestError
              ? error.message
              : 'Could not read the invitation link. Please try again.',
        },
      });
      return null;
    }
  };

  /** The invitation screen, showing `invitation`. */
  const showInvitation = (invitation: MobileSnapshot['invitation']) =>
    navigate({ screen: 'invite' }, { invitation });
  const loadingInvitation = (code: string) =>
    ({ code, status: 'loading', preview: null, message: null }) as const;
  /** Shows the invitation, loading, and reads it. */
  const previewInvitation = (code: string) => {
    showInvitation(loadingInvitation(code));
    return readInvitation(code);
  };
  /** Retry reads the invitation on screen again, where it is. */
  const retryInvitation = () => {
    if (!pendingCode) return Promise.resolve();
    publish({ ...snapshot, invitation: loadingInvitation(pendingCode) });
    return readInvitation(pendingCode);
  };
  /**
   * Reads the invitation shown loading; it never moves the member. As every display read does, it
   * checks a session the app counts as offline online first, so Join is offered only once the
   * session is (#286).
   */
  const readInvitation = async (code: string) => {
    const owner = generation;
    const view = ++viewRequest;
    try {
      if (snapshot.auth.status === 'authenticated' && (offlineSession || snapshot.offline.active)) {
        await revalidateSession(owner);
        assertCurrent(owner);
        if (view !== viewRequest) return;
        // The invitation shows nothing saved on this device, so the app is online again.
        startReadView();
      }
      const preview = parseInvitationPreview(await request(`/api/join/${code}`, owner));
      assertCurrent(owner);
      if (view !== viewRequest) return;
      publish({ ...snapshot, invitation: { code, status: 'ready', preview, message: null } });
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      publish({
        ...snapshot,
        invitation: {
          code,
          status:
            error instanceof RequestError && error.status === 404
              ? 'invalid'
              : error instanceof RequestError && error.status === 403
                ? 'denied'
                : 'error',
          preview: null,
          message:
            error instanceof RequestError && error.status === 404
              ? 'This invitation is invalid, expired, or no longer available.'
              : error instanceof RequestError && error.status === 403
                ? 'This account cannot access the invitation.'
                : 'Could not load the invitation. Check your connection and try again.',
        },
      });
    }
  };

  /**
   * Signed out, with a sign-out the server hasn't confirmed: after Continue (#202), or while its
   * revoke is sent. A return to the foreground then only retries the revoke, quietly, on the
   * sign-in screen (`refreshView`, `restore`).
   */
  const signOutPending = () => snapshot.auth.status === 'signed-out' && accountCleanupRequired;

  const openInvitation = async (url: string) => {
    const code = parseInvitationLink(url, inviteOrigin);
    const owner = generation;
    // A sign-in or restore since then shows the saved invitation itself. The quiet revoke retry
    // that the link's return to the foreground starts doesn't, so it never stops this (#286).
    const shows = () => current(owner) || signOutPending();
    try {
      await savePending(code);
    } catch {
      if (!shows()) return;
      showInvitation({
        code,
        status: 'error',
        preview: null,
        message: 'Could not save this invitation on the device. Open the link again to retry.',
      });
      return;
    }
    if (!shows() || pendingCode !== code) return;
    if (!code) {
      viewRequest += 1;
      showInvitation({
        code: null,
        status: 'invalid',
        preview: null,
        message:
          'This link does not belong to this SplitBook environment, or is not a valid invitation.',
      });
      return;
    }
    if (signOutPending()) {
      // Until the sign-out is confirmed, the invitation waits on the sign-in screen, which says
      // it's saved, as after Continue and at a restart. It's read once the revoke is confirmed (a
      // return to the foreground or a restart retries it), or after sign-in (#286).
      viewRequest += 1;
      navigate(home, { invitation: { code, status: 'idle', preview: null, message: null } });
      return;
    }
    await previewInvitation(code);
  };

  const joinInvitation = async () => {
    if (
      snapshot.auth.status !== 'authenticated' ||
      // Joining needs a connection, as every other write does; the invitation says so (#286).
      snapshot.offline.active ||
      snapshot.invitation.status !== 'ready' ||
      !pendingCode
    )
      return;
    const owner = generation;
    const view = viewRequest;
    const code = pendingCode;
    publish({
      ...snapshot,
      invitation: { ...snapshot.invitation, status: 'joining', message: null },
    });
    try {
      const id = parseJoinedGroup(
        await request(`/api/join/${code}`, owner, { method: 'POST' }).finally(() => {
          if (current(owner)) invalidateReads('groups', 'home');
        }),
      );
      assertCurrent(owner);
      // SplitBook answered, so the app is online (ADR 0006: a successful request clears
      // offline), wherever the member is now. The join made Home's Groups and figures obsolete:
      // the next time Home shows they're read again, and this device's copies from earlier no
      // longer make Home say it's offline. Its figures still say when they were read (#332).
      for (const path of ['/api/groups', '/api/user/balances']) staleReads.delete(path);
      if (view !== viewRequest || pendingCode !== code) return;
      await savePending(null);
      assertCurrent(owner);
      if (view !== viewRequest) return;
      publish({
        ...snapshot,
        invitation: { code: null, status: 'idle', preview: null, message: null },
        // Online again, Home's figures are no longer its earlier failure to reach SplitBook:
        // the join made them obsolete, and they're read when Home next shows them (#332).
        home:
          snapshot.home.status === 'error'
            ? { ...snapshot.home, status: 'idle', message: null }
            : snapshot.home,
      });
      // Home, while the Groups list is read again with the joined Group; then that Group.
      const loadingGroups = listOnHome(owner);
      const loadingView = viewRequest;
      await loadingGroups;
      if (current(owner) && viewRequest === loadingView) await openGroup(id);
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      publish({
        ...snapshot,
        invitation: {
          ...snapshot.invitation,
          status:
            error instanceof RequestError && error.status === 404
              ? 'invalid'
              : error instanceof RequestError && error.status === 403
                ? 'denied'
                : 'error',
          message:
            error instanceof RequestError && error.status === 404
              ? 'This invitation is invalid, expired, or no longer available.'
              : error instanceof RequestError && error.status === 403
                ? 'This account is not allowed to join this Group.'
                : 'Could not confirm joining. Check the invitation again before retrying.',
        },
      });
    }
  };

  const invitationSignIn = () => navigate(home);

  const openInvitationGroup = async () => {
    const id = snapshot.invitation.preview?.id;
    if (!id || snapshot.auth.status !== 'authenticated') return;
    const owner = generation;
    await openGroup(id);
    if (!current(owner) || snapshot.detail.status !== 'ready') return;
    try {
      await savePending(null);
      if (current(owner))
        publish({
          ...snapshot,
          invitation: { code: null, status: 'idle', preview: null, message: null },
        });
    } catch {
      /* The Group is already open; a retained link never joins automatically. */
    }
  };

  /** Not now, Android Back and the arrow; a join in progress finishes and opens its Group. */
  const cancelInvitation = async () => {
    if (snapshot.invitation.status === 'joining') return;
    const view = ++viewRequest;
    const owner = generation;
    navigate(home, {
      financial: emptyFinancial(),
      invitation: { code: null, status: 'idle', preview: null, message: null },
    });
    try {
      await savePending(null);
      if (current(owner) && view === viewRequest) await backHome();
    } catch {
      if (!current(owner) || view !== viewRequest) return;
      showInvitation({
        code: null,
        status: 'error',
        preview: null,
        message: 'Could not remove the saved invitation. Please cancel again.',
      });
    }
  };

  const updateCreation = (patch: Partial<GroupDraft>) => {
    if (
      snapshot.auth.status !== 'authenticated' ||
      ['saving', 'uncertain'].includes(snapshot.creation.status)
    )
      return;
    const { creation } = snapshot;
    const draft = { ...creation.draft, ...patch };
    publish({
      ...snapshot,
      creation: {
        ...creation,
        draft,
        // An edit answers the previous correction; field errors stay beside their fields.
        status: 'editing',
        message: null,
        validation: { ...creation.validation, errors: validateGroupDraft(draft, today()) },
      },
    });
  };

  /** Leaving a field shows its correction, if any; typing alone never does. */
  const touchCreationField = (field: GroupField) => {
    const { creation } = snapshot;
    if (
      snapshot.screen !== 'create' ||
      ['saving', 'uncertain'].includes(creation.status) ||
      creation.validation.touched.includes(field)
    )
      return;
    publish({
      ...snapshot,
      creation: {
        ...creation,
        validation: touchField(
          creation.validation,
          field,
          validateGroupDraft(creation.draft, today()),
        ),
      },
    });
  };

  const createGroup = async () => {
    if (
      snapshot.auth.status !== 'authenticated' ||
      // Creating needs a connection; the form says so and keeps its entries.
      snapshot.offline.active ||
      ['saving', 'uncertain'].includes(snapshot.creation.status)
    )
      return;
    const owner = generation;
    const view = viewRequest;
    const draft = snapshot.creation.draft;
    const bounded = getGroupTheme(draft.category).dates === 'bounded';
    // Every correction is explained beside its field before anything is sent.
    const errors = validateGroupDraft(draft, today());
    const rejected = rejectFields(groupFields, snapshot.creation.validation, errors);
    if (rejected) {
      publish({
        ...snapshot,
        creation: {
          ...snapshot.creation,
          status: 'editing',
          message: groupCorrectionSummary(errors),
          validation: rejected,
        },
      });
      return;
    }
    const payload = createGroupSchema.safeParse({
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      alternateCurrencies: [],
      startDate: bounded && draft.startDate.trim() ? draft.startDate.trim() : null,
      endDate: bounded && draft.endDate.trim() ? draft.endDate.trim() : null,
    });
    if (!payload.success) {
      publish({
        ...snapshot,
        creation: {
          ...snapshot.creation,
          status: 'error',
          message: payload.error.issues[0].message,
        },
      });
      return;
    }
    // Unchanged details keep their key, so the server returns a Group whose response was lost
    // (to this retry, or to a transparent resend by the HTTP layer) instead of creating another.
    const body = JSON.stringify(payload.data);
    const previous = snapshot.creation.attempt;
    const key = previous?.body === body ? previous.key : dependencies.newSubmissionKey?.();
    if (!key) {
      publish({
        ...snapshot,
        creation: {
          ...snapshot.creation,
          status: 'error',
          message: 'Could not prepare this Group for sending. Nothing was sent. Try again.',
        },
      });
      return;
    }
    const attempt = { key, body };
    const lease = accountStorage();
    const storage = dependencies.groupCreations;
    // A Group is only sent once its retry identity is stored on this device.
    if (!lease || !storage) {
      publish({
        ...snapshot,
        creation: { ...snapshot.creation, status: 'editing', message: groupNotStored },
      });
      return;
    }
    publish({
      ...snapshot,
      creation: { ...snapshot.creation, attempt, status: 'saving', message: null },
    });
    let missed: ReturnType<typeof parseGroupCreation> | null;
    let unreadable = false;
    try {
      missed = await lease.write(async () => {
        const stored = await storage.load(lease.accountId);
        let kept: ReturnType<typeof parseGroupCreation> | null = null;
        try {
          kept = stored === null ? null : parseGroupCreation(stored, lease.accountId);
        } catch (error) {
          unreadable = true;
          throw error;
        }
        // A stored submission this form never showed comes first; nothing is sent over it.
        if (kept && kept.attempt.key !== previous?.key) return kept;
        await storage.save(lease.accountId, {
          version: 1,
          accountId: lease.accountId,
          key,
          body,
          draft,
        });
        return null;
      });
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      publish({
        ...snapshot,
        creation: {
          ...snapshot.creation,
          attempt: previous,
          status: 'editing',
          message: unreadable ? groupUnreadable : groupNotStored,
        },
      });
      return;
    }
    if (!current(owner)) return;
    if (missed) {
      publish({
        ...snapshot,
        creation: {
          ...snapshot.creation,
          ...missed,
          status: 'uncertain',
          message: unconfirmedGroup,
        },
      });
      // Home, where the Groups list read again shows whether it was created.
      if (view === viewRequest) await listOnHome(owner);
      return;
    }
    let created: string | null = null;
    try {
      const group = parseCreatedGroup(
        await request('/api/groups', owner, {
          method: 'POST',
          serializedBody: attempt.body,
          idempotencyKey: attempt.key,
        }).finally(() => {
          if (current(owner)) invalidateReads('groups', 'home');
        }),
      );
      assertCurrent(owner);
      if (
        !group.members.some(
          (member) => member.user.id === snapshot.auth.user?.id && member.role === 'admin',
        )
      )
        throw new RequestError('The server returned invalid creator membership.');
      // Confirmed, so this device no longer keeps the submission (unless a newer one replaced it).
      // If that removal fails, the Group is still confirmed: the stale copy reopens as uncertain
      // after a restart, and resubmitting it returns this same Group.
      try {
        await lease.write(async () => {
          const stored = await storage.load(lease.accountId);
          if ((stored as { key?: unknown } | null)?.key === key)
            await storage.remove(lease.accountId);
        });
      } catch (error) {
        if (error instanceof Superseded) throw error;
      }
      assertCurrent(owner);
      publish({
        ...snapshot,
        creation: cleanSnapshot(snapshot.auth).creation,
        groups: {
          status: 'ready',
          // A keyed retry returns the Group that a read after its lost response already listed.
          data: [group, ...snapshot.groups.data.filter((item) => item.id !== group.id)],
          message: null,
          loaded: true,
          // The rest of the list is still whatever it was: this device's copy, or not (#332).
          restored: snapshot.groups.restored,
        },
      });
      created = group.id;
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      const definite = error instanceof RequestError && error.status >= 400 && error.status < 500;
      publish({
        ...snapshot,
        creation: {
          ...snapshot.creation,
          status: definite ? 'error' : 'uncertain',
          message: definite
            ? error.status === 422
              ? 'Check the Group information and try again.'
              : error.message
            : 'The Group may have been created. Check your Groups before creating another.',
        },
      });
      if (!definite && view === viewRequest) await listOnHome(owner);
    }
    // A confirmed Group opens the way Home opens one, so its Expenses, Balances and Month are
    // read like any other Group's. A member who moved on before the confirmation stays there.
    if (!created || view !== viewRequest) return;
    await openGroup(created);
    // Then the Groups list is read again, as after a join, so the saved list holds the new Group
    // beside its saved copies, for an offline restart (#283). It lists it, so its trim keeps them.
    await homeQueries.listSince(owner);
  };

  /** Check Groups, on New Group or Home: Home, with the Groups list read again. */
  const checkCreatedGroups = () =>
    snapshot.auth.status === 'authenticated' ? listOnHome(generation) : Promise.resolve();

  const resumeCreationAfterCheck = () => {
    if (
      snapshot.auth.status !== 'authenticated' ||
      snapshot.groups.status !== 'ready' ||
      snapshot.creation.status !== 'uncertain'
    )
      return;
    navigate(
      { screen: 'create' },
      { creation: { ...snapshot.creation, status: 'editing', message: null } },
    );
  };

  /** Discard removes the Group form, and any submission of it stored on this device. */
  const discardCreation = async () => {
    if (snapshot.creation.status === 'saving') return;
    const lease = accountStorage();
    const storage = dependencies.groupCreations;
    if (lease && storage) {
      const owner = generation;
      try {
        await lease.write(() => storage.remove(lease.accountId));
      } catch (error) {
        if (current(owner) && !(error instanceof Superseded))
          publish({
            ...snapshot,
            creation: {
              ...snapshot.creation,
              message: 'Could not discard this Group form. Please retry.',
            },
          });
        return;
      }
      if (!current(owner) || latest().creation.status === 'saving') return;
    }
    // Leaving New Group (not Home's own Discard) settles Home the way Back does.
    const returning = route.screen !== 'groups';
    navigate(home, { creation: cleanSnapshot(snapshot.auth).creation });
    if (returning) return backHome();
  };

  /**
   * Back's table (ADR 0006, M8-2): where Back goes from `from`, the route on screen, once nothing
   * holds it. An Expense returns to the Group view it opened from, or to its Group's Expenses
   * after direct entry; Members to the Group view it opened from; the Record payment sheet to
   * the Group's Balances. An Expense whose Group refused the member, Members whose Group is no
   * longer shown, and everything else go Home.
   */
  const parent = (from: Route): Route => {
    const { detail } = snapshot;
    switch (from.screen) {
      case 'expense': {
        // A Group removed after denial has nothing to return to.
        if (
          detail.id === from.groupId &&
          !detail.data &&
          ['denied', 'error'].includes(detail.status)
        )
          return home;
        const origin = from.returnTo?.groupId === from.groupId ? from.returnTo : null;
        return returnView(from.groupId, origin?.destination ?? 'expenses', origin);
      }
      case 'members':
        return shownGroup(snapshot)
          ? returnView(from.groupId, from.destination, from.returnTo)
          : home;
      case 'settlement':
        return underSheet(from);
      default:
        return home;
    }
  };

  /**
   * Android Back and the top bar's arrow: the holds, in order, then the route's `parent`. An open
   * Activity event closes first; an invitation is cancelled (a join in progress holds it);
   * nothing happens while a Group, Expense or payment is saving, or while a draft couldn't be
   * stored; Members' Leave Group sheet closes first, and holds while leaving. An Expense's
   * delete review is cancelled first (`closeExpense`).
   */
  const back = () => {
    if (showingActivity() && snapshot.activity.selected) return closeActivityDetail();
    if (route.screen === 'invite') {
      void cancelInvitation();
      return;
    }
    if (snapshot.creation.status === 'saving' || expenseNavigationBlocked()) return;
    switch (route.screen) {
      case 'expense':
        return closeExpense();
      case 'settlement':
        return closeSettlement();
      case 'members':
        return snapshot.leave.status === 'closed' ? closeMembers() : cancelLeaveGroup();
      default:
        return showHome();
    }
  };

  /**
   * Re-read the visible view. A pull-to-refresh shows only the native pull indicator, and an
   * automatic (foreground) refresh nothing, each on the view it started on; Retry buttons use
   * the quiet status. Pull and Retry always read again; a foreground refresh reuses reads
   * verified within the display freshness window and joins identical reads already in flight.
   */
  const refresh = async (origin: 'pull' | 'retry' | 'foreground' = 'retry') => {
    if (origin === 'retry') return refreshView(false);
    const kind = origin === 'pull' ? 'pull' : 'automatic';
    const views = running[kind];
    const mark = (view: string | null) => {
      if (snapshot[kind] !== view)
        publish(kind === 'pull' ? { ...snapshot, pull: view } : { ...snapshot, automatic: view });
    };
    const view = shownView(snapshot);
    views.push(view);
    mark(view);
    // Returning to the foreground is TanStack's focus event (M1-6): it reaches the queries the
    // screen observes, and those past their stale time read again.
    if (origin === 'foreground') focusManager.onFocus();
    try {
      await refreshView(origin === 'foreground');
    } finally {
      views.splice(views.lastIndexOf(view), 1);
      // A sign-out or restore since then has already cleared it.
      if (running[kind] === views) mark(views.at(-1) ?? null);
    }
  };

  /** `reuse`: a foreground refresh may show reads verified within the display freshness window. */
  const refreshView = async (reuse: boolean) => {
    if (['restoring', 'signing-in'].includes(snapshot.auth.status)) return;
    if (
      snapshot.creation.status === 'saving' ||
      snapshot.invitation.status === 'joining' ||
      (snapshot.screen === 'expense' && snapshot.expense.status === 'saving') ||
      (snapshot.screen === 'settlement' && snapshot.settlement.status === 'saving')
    )
      return;
    if (snapshot.screen === 'invite' && snapshot.auth.status !== 'authenticated')
      return retryInvitation();
    // After Continue, a pending revoke is retried without leaving the sign-in screen.
    if (snapshot.auth.status !== 'authenticated')
      return restore(snapshot.auth.status === 'signed-out' && accountCleanupRequired);
    // Pulling on Activity re-reads Activity only; a Group that failed to load is read again.
    if (showingActivity() && snapshot.detail.status === 'ready') return refreshActivity();
    if (snapshot.screen === 'expense') return refreshExpense(reuse);
    if (['create', 'invite', 'settings', 'settlement', 'members'].includes(snapshot.screen)) {
      const owner = generation,
        view = viewRequest,
        screen = snapshot.screen;
      const groupId =
        screen === 'settlement'
          ? snapshot.settlement.groupId
          : screen === 'members'
            ? snapshot.detail.id
            : null;
      // Only the Group's own read can say access was lost, never the session check before it.
      let readingGroup = false;
      try {
        await checkSession(owner);
        if (!current(owner) || view !== viewRequest) return;
        readingGroup = true;
        if (screen === 'members' && groupId) {
          // Read as on the Group view: a foreground refresh reuses a recently verified read.
          const key = groupKey(account(), groupId);
          const group = parseGroup(
            await groupQueries.readGroup(groupId, owner, {
              fresh: !reuse,
              wanted: () => view === viewRequest,
            }),
          );
          if (!current(owner) || view !== viewRequest || snapshot.screen !== 'members') return;
          if (
            group.id !== groupId ||
            !group.members.some((member) => member.user.id === snapshot.auth.user?.id)
          ) {
            // As for a refusal: its saved copies and its place in the Group list go too.
            await forgetGroup(groupId, 403, owner);
            throw new RequestError('You no longer have access to this group.', 403);
          }
          publish({
            ...snapshot,
            detail: {
              status: 'ready',
              id: groupId,
              data: group,
              message: null,
              refreshedAt: readAt(key),
            },
          });
        } else if (dependencies.readCache && groupId) {
          const context = parseExpenseContext(
            await groupQueries.readGroup(groupId, owner, {
              wanted: () => view === viewRequest,
            }),
          );
          if (!current(owner) || view !== viewRequest) return;
          if (
            context.group.id !== groupId ||
            !context.group.members.some((member) => member.user.id === snapshot.auth.user?.id)
          )
            throw new RequestError('You no longer have access to this Group.', 403);
          publish({
            ...snapshot,
            settlement: { ...snapshot.settlement, group: context.group },
          });
        }
        readingGroup = false;
        publishReadFreshness();
        if (snapshot.screen === 'invite') await retryInvitation();
      } catch (error) {
        if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
        if (
          readingGroup &&
          groupId &&
          error instanceof RequestError &&
          [403, 404].includes(error.status)
        ) {
          dropDeniedGroup(groupId, error);
          if (screen === 'settlement')
            publish({
              ...snapshot,
              settlement: {
                ...snapshot.settlement,
                status: 'blocked',
                group: null,
                balances: [],
                message: error.message,
              },
            });
          // Members now shows none of the Group: its saved copies no longer keep the banner.
          else unshowGroup(groupId);
        } else if (snapshot.screen === 'create')
          publish({
            ...snapshot,
            creation: {
              ...snapshot.creation,
              message: 'Could not check your connection. Your Group information is still here.',
            },
          });
      }
      return;
    }
    // A Group's view returning to the foreground has been reached by TanStack's focus event, its
    // only foreground trigger (M1-6): this waits for what it started. A pull or Retry reads it all.
    if (snapshot.screen === 'group' && snapshot.detail.id)
      return reuse ? groupQueries.settle(generation) : openGroup(snapshot.detail.id, false);
    // A pull or Retry reads Home's Groups list, then its figures; a return to the foreground has
    // already reached them through TanStack's focus event (M1-6), and waits for what it started.
    return homeQueries.settle(generation, reuse ? { list: true } : { fresh: true });
  };
  /** A screen showing none of a Group: its saved copies no longer keep the offline banner. */
  const unshowGroup = (groupId: string) => {
    for (const path of staleReads.keys())
      if (path.startsWith(`/api/groups/${groupId}`)) staleReads.delete(path);
    publishReadFreshness();
  };
  /** The Expense's Group refused the member: the Expense shows none of it, as before (#192). */
  const refuseExpenseGroup = (groupId: string, error: RequestError) => {
    dropDeniedGroup(groupId, error);
    publish({
      ...snapshot,
      expense: {
        ...withdrawExpense(error.message),
        status: 'blocked',
        message: error.message,
      },
    });
    unshowGroup(groupId);
  };
  /**
   * The Expense screen. Its foreground read came through TanStack's focus event, its only
   * foreground trigger (M1-6); Try again reads the session, the Group, the record and its changes
   * again (#192). An Expense that shows nothing (never saved here, gone or refused) opens again,
   * as its own Try again does (#280 item 3).
   */
  const refreshExpense = async (reuse: boolean) => {
    const { groupId, draft, status, requestedExpenseId } = snapshot.expense;
    if (!reuse && groupId && !draft && status === 'blocked')
      return openExpense(groupId, requestedExpenseId ?? undefined);
    await (reuse ? expenseQueries.settle() : expenseQueries.retry());
    publishReadFreshness();
  };
  const signOut = async () => {
    creationRecovery = null;
    // The session in use, which starts a new sign-out; without one, this retries a pending one,
    // with the revoke it kept or else the saved cookie.
    if (cookie) {
      revoking = cookie;
      invitationCleared = false;
    }
    const owner = invalidate();
    cleanHome({ status: 'signed-out', user: null, message: null });
    // Independent stores must both be purged. Wait for both attempts before
    // exposing recovery so a failed invitation clear cannot preserve a session.
    let confirmed: boolean;
    try {
      confirmed = await clearAccount(owner, 'sign-out');
    } catch {
      if (current(owner)) {
        cleanHome({
          status: 'error',
          user: null,
          message: 'Could not remove this account from the device. Try signing out again.',
        });
      }
      return;
    }
    if (!confirmed) showUnconfirmedSignOut(owner);
  };

  /**
   * Continue, after the server didn't confirm a sign-out: sends nothing more and shows plain
   * signed-out. A saved cookie stays for the next restore to revoke; one held only in memory goes.
   */
  const continueSignedOut = () => {
    if (snapshot.auth.status !== 'sign-out-unconfirmed') return;
    revoking = null;
    invalidate();
    const cleared = cleanSnapshot({ status: 'signed-out', user: null, message: null });
    navigate(home, { ...cleared, invitation: { ...cleared.invitation, code: pendingCode } });
  };

  return {
    openActivity,
    selectDestination,
    selectActivity,
    openActivityEvent,
    closeActivityDetail,
    refreshActivity,
    loadMoreActivity,
    refreshExpenseHistory,
    loadOlderExpenseHistory,
    loadNewerExpenseHistory,
    reviewExpenseDeletion,
    cancelExpenseDeletion,
    deleteExpense: () => saveExpenseEdit('delete'),
    reconcileExpense,
    reviewLatestExpense,
    acceptCurrentExpense,
    editExpense,
    discardExpenseDraft,
    discardUnconfirmedExpense,
    resumeKeptDraft,
    discardKeptDraft,
    saveExpense,
    openExpense,
    closeExpense,
    viewSnackbarMonth,
    dismissSnackbar,
    resumeExpenseDraft,
    updateExpenseDraft,
    touchExpenseField,
    restore,
    signIn,
    signInWithGoogle,
    startCreate,
    openSettings,
    openMembers,
    closeMembers,
    reviewLeaveGroup,
    cancelLeaveGroup,
    leaveGroup,
    showLeaveCheck,
    accountStorage,
    openSettlements,
    openRecordPayment,
    openPendingPayment,
    closeSettlement,
    selectSettlement,
    updateSettlement,
    recordSettlement,
    acknowledgeSettlement,
    touchSettlementField,
    updateCreation,
    touchCreationField,
    createGroup,
    loadInviteLink,
    openInvitation,
    joinInvitation,
    retryInvitation,
    invitationSignIn,
    openInvitationGroup,
    cancelInvitation,
    checkCreatedGroups,
    resumeCreationAfterCheck,
    discardCreation,
    openGroup,
    back,
    refresh,
    refreshHome,
    refreshExpenses,
    refreshBalances,
    selectMonth,
    loadMoreExpenses,
    loadNewerExpenses,
    signOut,
    continueSignedOut,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      invalidate();
      disconnect();
      listeners.clear();
      cleanHome({ status: 'signed-out', user: null, message: null });
    },
  };
}

export type MobileController = ReturnType<typeof createMobileController>;
