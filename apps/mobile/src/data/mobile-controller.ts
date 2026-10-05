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
import { canEditExpense, parseExpenseRecord } from './expense-record';
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
  validateExpenseDraft,
  visibleExpenseErrors,
  type ExpenseContext,
  type ExpenseDraft,
  type ExpenseEditor,
  type ExpenseField,
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
  parseGroups,
  parseInvitationPreview,
  parseInviteLink,
  parseJoinedGroup,
  parseLeftGroup,
  parseSession,
  parseSignIn,
} from './dto';
import { parseInvitationLink } from './invitation-links';
import { parseExpensePage, parseGroupBalances, parseHomeBalances } from './financial-dto';
import {
  createTransport,
  expiredMessage,
  RequestError,
  storageMessage,
  Superseded,
} from './transport';
import type {
  AccountStorageLease,
  ExpenseDraftSummary,
  GroupCreation,
  GroupDestination,
  GroupDraft,
  GroupFinancialState,
  GroupReturnContext,
  GroupSnackbar,
  HomeFinancialState,
  KeptDraft,
  LeaveGroupState,
  MobileConfig,
  MobileDependencies,
  MobileGroup,
  MobileSnapshot,
} from './types';

export { currentMonthKey, shiftMonthKey } from '@splitbook/shared/date';

/**
 * The initial display freshness policy (#103): a read verified this recently is shown
 * again without another request. Adjust it per controller with `displayFreshnessMs`.
 */
export const DISPLAY_FRESHNESS_MS = 30_000;

/**
 * What a display read describes, for invalidation: the Groups list, Home, one Group's
 * details, its running Balances, or the rest of its ledger (Expense pages and records,
 * Month summaries and Activity).
 */
function readScope(path: string) {
  if (path === '/api/groups') return 'groups';
  if (path === '/api/user/balances') return 'home';
  const [, groupId, rest] = /^\/api\/groups\/([a-f\d]{24})(.*)$/i.exec(path) ?? [];
  if (!groupId) return path;
  return rest === ''
    ? `group:${groupId}`
    : rest === '/balances'
      ? `balances:${groupId}`
      : `ledger:${groupId}`;
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

/**
 * Home's Expense drafts in this account's listed Groups. A draft with a submission or change
 * pending may already be recorded, so it's first; an unreadable one is left to its Group's form.
 */
function draftSummaries(
  records: { groupId: string; value: unknown }[],
  accountId: string,
  groups: MobileGroup[],
): ExpenseDraftSummary[] {
  const position = (groupId: string) => groups.findIndex((group) => group.id === groupId);
  return records
    .flatMap(({ groupId, value }) => {
      const group = groups.find((item) => item.id === groupId);
      if (!group) return [];
      try {
        const { draft, attempt, mutation } = parseStoredExpenseDraft(value, accountId, groupId);
        return [
          {
            groupId,
            groupName: group.name,
            expenseId: draft.original?._id ?? null,
            description: draft.description,
            amount: draft.amount,
            currency: draft.currency,
            unconfirmed: attempt !== null || mutation !== null,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort(
      (a, b) =>
        Number(b.unconfirmed) - Number(a.unconfirmed) || position(a.groupId) - position(b.groupId),
    );
}

function emptyExpenses(month: string | null = null): GroupFinancialState['expenses'] {
  return {
    month,
    status: 'idle',
    data: [],
    summary: null,
    pagination: null,
    message: null,
    moreStatus: 'idle',
    moreMessage: null,
    refreshedAt: null,
  };
}

function emptyFinancial(): GroupFinancialState {
  return {
    groupId: null,
    month: null,
    expenses: emptyExpenses(),
    balances: { status: 'idle', data: null, message: null, refreshedAt: null, stale: false },
  };
}

function emptyHome(): HomeFinancialState {
  return {
    status: 'idle',
    data: null,
    byGroup: {},
    message: null,
    refreshedAt: null,
    stale: false,
  };
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

function cleanSnapshot(auth: MobileSnapshot['auth']): MobileSnapshot {
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
    detail: { status: 'idle', id: null, data: null, message: null, refreshedAt: null },
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
  let googlePending = false;
  const now = dependencies.now ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot = cleanSnapshot({ status: 'restoring', user: null, message: null });
  let cookie: string | null = null;
  /**
   * The account `get-session` confirmed `cookie` for, stored beside it. Null while unverified: a
   * cookie from a sign-in reply, or one saved before accounts were recorded.
   */
  let cookieAccount: string | null = null;
  let generation = 0;
  let viewRequest = 0;
  let homeRequest = 0;
  let financialRequest = 0;
  let balancesRequest = 0;
  let settlementRequest = 0;
  let pendingRequest = 0;
  let keptDraftRequest = 0;
  let activityRequest = 0;
  let activityDetailRequest = 0;
  let historyRequest = 0;
  /** The Groups list's own read token: only a newer list read supersedes a list read. */
  let groupsRequest = 0;
  /** The latest Groups list read ended without an answer to show, so Home reads it again. */
  let groupsUnanswered = false;
  /**
   * The Groups the latest verified Groups list holds (null until one is read this session), and
   * those it left out. Saved copies are kept only for listed Groups and ones added since.
   */
  let listedGroups: Set<string> | null = null;
  let unlistedGroups = new Set<string>();
  let cacheEpoch = 0;
  // Set by returnToGroup: the next read of that Group and Month reads this many pages.
  let returnPages: { groupId: string; month: string | null; pages: number } | null = null;
  // Likewise for Activity, when the task began there.
  let returnActivityPages: { groupId: string; pages: number } | null = null;
  let offlineSession = false;
  const staleReads = new Map<string, number | null>();
  const freshness = dependencies.displayFreshnessMs ?? DISPLAY_FRESHNESS_MS;
  type Verified = { value: unknown; refreshedAt: number; version: number };
  /** This session's verified responses by path, with when each was received. */
  const reads = new Map<string, Omit<Verified, 'version'>>();
  /** At most one network read per path; later identical reads share it. */
  const inflight = new Map<string, { owner: number; version: number; read: Promise<Verified> }>();
  /** Bumped when a confirmed change, denial or newer ledger read makes a scope's responses obsolete. */
  const versions = new Map<string, number>();
  const invalidatedAt = new Map<string, number>();
  /**
   * Scopes whose saved copies a ledger change made obsolete but this device could not remove,
   * with when: a saved copy from before then is never shown again this session.
   */
  const untrusted = new Map<string, number>();
  /**
   * Views ('groups', 'home', 'group:<id>') with an explicit refresh still running: a pull,
   * Retry or confirmed change. Overlapping calls for those views never accept freshness.
   */
  let explicit = new Map<string, number>();
  /** Expense reads in flight, by Group: each may materialize recurring Expenses on the server. */
  let materializing = new Map<string, Set<Promise<unknown>>>();
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

  const publish = (next: MobileSnapshot) => {
    // Return feedback belongs to the Group view it was made for; leaving that view ends it.
    const showing = (groupId: string) => next.screen === 'group' && next.detail.id === groupId;
    if (next.snackbar && !showing(next.snackbar.groupId)) next = { ...next, snackbar: null };
    if (next.restoreScroll && !showing(next.restoreScroll.groupId))
      next = { ...next, restoreScroll: null };
    // Likewise Home's, and the Leave Group sheet belongs to Members and Group details.
    if (next.homeSnackbar && next.screen !== 'groups') next = { ...next, homeSnackbar: null };
    if (next.leave.status !== 'closed' && next.screen !== 'members')
      next = { ...next, leave: closedLeave() };
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const current = (owner: number) => owner === generation;
  /** The snapshot now, after an await that TypeScript's earlier narrowing doesn't see. */
  const latest = (): MobileSnapshot => snapshot;
  const assertCurrent = (owner: number) => {
    if (!current(owner)) throw new Superseded();
  };
  const invalidate = () => {
    generation += 1;
    cacheEpoch += 1;
    returnPages = returnActivityPages = null;
    offlineSession = false;
    staleReads.clear();
    reads.clear();
    inflight.clear();
    versions.clear();
    invalidatedAt.clear();
    untrusted.clear();
    explicit = new Map();
    materializing = new Map();
    running = { pull: [], automatic: [] };
    viewRequest += 1;
    groupsUnanswered = false;
    listedGroups = null;
    unlistedGroups = new Set();
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
      const cleanup = await Promise.allSettled([
        Promise.resolve().then(() => dependencies.accountLocal?.owner.clear()),
        ...(dependencies.accountLocal?.stores.map((storage) =>
          Promise.resolve().then(() => storage.clear()),
        ) ?? []),
      ]);
      if ([...(await immediate), ...cleanup].some((result) => result.status === 'rejected')) {
        if (mode === 'account-change') {
          // The new account's session goes too: revoked first, then its saved cookie cleared.
          if (cookie) revoking = cookie;
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
    publish({ ...cleared, invitation: { ...cleared.invitation, code: pendingCode } });
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
    publish({ ...cleared, invitation: { ...cleared.invitation, code: pendingCode } });
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
        publish(
          cleanSnapshot({
            status: 'error',
            user: null,
            message: 'Could not remove the saved session. Try signing out again.',
          }),
        );
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
  });
  const { request, verifyGoogleBackend } = transport;

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

  const publishReadFreshness = () => {
    const visible = [...staleReads.entries()].filter(([path]) => {
      const home = path === '/api/groups' || path === '/api/user/balances';
      return snapshot.screen === 'groups' ? home : !home;
    });
    const times = visible
      .map(([, time]) => time)
      .filter((value): value is number => value !== null);
    publish({
      ...snapshot,
      offline: {
        ...snapshot.offline,
        active: offlineSession || visible.length > 0,
        refreshedAt: times.length ? Math.min(...times) : null,
      },
    });
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

  const revalidateSession = async (owner: number) => {
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
  };

  const versionOf = (path: string) => versions.get(readScope(path)) ?? 0;

  /**
   * Saved copies are kept only for Groups the latest Groups list holds, or that Home has gained
   * since (a Group just created). One the list leaves out, such as an archived Group the member
   * can still open, is shown but never saved.
   */
  const savable = (path: string) => {
    const id = /^\/api\/groups\/([a-f\d]{24})/i.exec(path)?.[1];
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
    for (const scope of scopes) {
      versions.set(scope, (versions.get(scope) ?? 0) + 1);
      invalidatedAt.set(scope, time);
    }
    for (const path of [...reads.keys()]) if (scopes.includes(readScope(path))) reads.delete(path);
  };
  /** A confirmed Expense or Settlement change affects every page, Month, Balance, Home and Activity view. */
  const ledgerChanged = (groupId: string) =>
    invalidateReads(`ledger:${groupId}`, `balances:${groupId}`, 'home');
  /**
   * Their saved copies on this device go too, including each record and its history. The removal
   * is queued ahead of every later save or load of a saved copy, so none of them sees an older
   * one. A copy that can't be removed is no longer trusted this session; the member is never
   * signed out for it.
   */
  const removeLedgerCopies = async (groupId: string, owner: number) => {
    const lease = accountStorage(),
      time = now();
    if (!lease || !dependencies.readCache) return;
    try {
      await lease.write(() => dependencies.readCache!.invalidateLedger(lease.accountId, groupId));
    } catch (error) {
      if (current(owner) && !(error instanceof Superseded))
        for (const scope of [`ledger:${groupId}`, `balances:${groupId}`, 'home'])
          untrusted.set(scope, time);
    }
  };

  /** The view a display read belongs to, for explicit refresh intent. */
  const viewOf = (path: string) =>
    path === '/api/groups' || path === '/api/user/balances'
      ? path === '/api/groups'
        ? 'groups'
        : 'home'
      : `group:${/^\/api\/groups\/([a-f\d]{24})/i.exec(path)?.[1]}`;

  /** Runs an explicit refresh; while it runs, overlapping reads of these views read again too. */
  const explicitly = async <T>(views: string[], run: () => Promise<T>): Promise<T> => {
    const running = explicit;
    for (const view of views) running.set(view, (running.get(view) ?? 0) + 1);
    try {
      return await run();
    } finally {
      for (const view of views) {
        const left = (running.get(view) ?? 1) - 1;
        if (left > 0) running.set(view, left);
        else running.delete(view);
      }
    }
  };

  /** Reusable without a request: verified this session, recently, and never while offline. */
  const freshRead = (path: string) => {
    const saved = reads.get(path);
    const age = saved ? now() - saved.refreshedAt : Infinity;
    return saved &&
      !offlineSession &&
      !snapshot.offline.active &&
      // An explicit refresh of this view is still running: join it instead.
      !explicit.has(viewOf(path)) &&
      age >= 0 &&
      age < freshness
      ? saved
      : null;
  };

  /**
   * An Expense read may materialize recurring Expenses whenever it reaches the server,
   * even after its view moved on. When it settles, Balances and Home read before then are
   * obsolete: they are not reused, and a read of them still in flight is read again.
   */
  const trackExpenseRead = (groupId: string, owner: number, read: Promise<unknown>) => {
    const running = materializing;
    const pending = running.get(groupId) ?? new Set<Promise<unknown>>();
    running.set(groupId, pending);
    pending.add(read);
    const settle = () => {
      pending.delete(read);
      if (!pending.size && running.get(groupId) === pending) running.delete(groupId);
      if (current(owner)) invalidateReads(`balances:${groupId}`, 'home');
    };
    read.then(settle, settle);
  };
  /**
   * A superseded Expense read has settled. If its Group is still on screen with nothing
   * else reading it, re-read Balances so they include anything that read materialized.
   * The selected Month and its Expenses are unchanged.
   */
  const followSupersededExpenseRead = async (groupId: string, owner: number) => {
    const { financial } = snapshot;
    if (
      !current(owner) ||
      snapshot.screen !== 'group' ||
      snapshot.detail.id !== groupId ||
      materializing.has(groupId) ||
      financial.expenses.status === 'loading' ||
      financial.expenses.moreStatus === 'loading' ||
      financial.balances.status === 'loading'
    )
      return;
    publish({
      ...snapshot,
      financial: {
        ...financial,
        balances: { ...financial.balances, stale: financial.balances.data !== null },
      },
    });
    await loadBalances(false);
  };

  /**
   * Content to show at once while it is read again: this session's verified response, or
   * this device's saved copy for the same account and path. Never a substitute for the read.
   */
  const peek = async <T>(
    path: string,
    owner: number,
    parse: (value: unknown) => T,
  ): Promise<{ value: T; refreshedAt: number } | null> => {
    try {
      const saved = reads.get(path);
      if (saved) return { value: parse(saved.value), refreshedAt: saved.refreshedAt };
      const lease = accountStorage();
      if (!lease || !dependencies.readCache) return null;
      const epoch = cacheEpoch,
        version = versionOf(path);
      const stored = cachedRead(
        await lease.write(() => dependencies.readCache!.load(lease.accountId, path)),
        lease.accountId,
        path,
        now(),
      );
      if (
        !stored ||
        !current(owner) ||
        epoch !== cacheEpoch ||
        version !== versionOf(path) ||
        stored.refreshedAt <= (invalidatedAt.get(readScope(path)) ?? -Infinity)
      )
        return null;
      return { value: parse(stored.value), refreshedAt: stored.refreshedAt };
    } catch {
      // A missing or unreadable saved copy only means there is nothing to show early.
      return null;
    }
  };

  /**
   * One network read per path. A caller joins a read already in flight unless a confirmed
   * change or denial since it started made it obsolete. `validate` runs before anything is
   * kept, so a malformed response is never reused or saved.
   */
  const sharedRead = (path: string, owner: number, validate: (value: unknown) => unknown) => {
    const version = versionOf(path);
    const pending = inflight.get(path);
    if (pending?.owner === owner && pending.version === version) return pending.read;
    const lease = accountStorage(),
      epoch = cacheEpoch;
    const read = (async (): Promise<Verified> => {
      if (offlineSession || snapshot.offline.active) await revalidateSession(owner);
      const value = await request(path, owner);
      validate(value);
      const refreshedAt = now();
      // An obsolete response still reaches its callers, which read again; it is never kept.
      if (!current(owner) || version !== versionOf(path)) return { value, refreshedAt, version };
      reads.set(path, { value, refreshedAt });
      if (lease && dependencies.readCache) {
        try {
          await lease.write(async () => {
            if (epoch !== cacheEpoch || version !== versionOf(path) || !savable(path))
              throw new Superseded();
            await dependencies.readCache!.save(lease.accountId, path, {
              version: 1,
              accountId: lease.accountId,
              path,
              refreshedAt,
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
                message:
                  'Could not save this view for offline use. Online data is still available.',
              },
            });
        }
      }
      return { value, refreshedAt, version };
    })();
    inflight.set(path, { owner, version, read });
    const settle = () => {
      if (inflight.get(path)?.read === read) inflight.delete(path);
    };
    read.then(settle, settle);
    return read;
  };

  /**
   * Explicitly opt in display reads only; request() and every mutation stay live.
   * `wanted` says whether the caller still shows this read; only then is an obsolete
   * response read again.
   */
  const readCached = async <T>(
    path: string,
    owner: number,
    parse: (value: unknown) => T,
    wanted?: () => boolean,
  ): Promise<T> => {
    const lease = accountStorage(),
      view = viewRequest,
      epoch = cacheEpoch,
      startVersion = versionOf(path),
      shown = wanted ?? (() => view === viewRequest),
      // Home's Groups list keeps its provenance while another view is open (startReadView),
      // so its read records where its answer came from on whatever screen it lands.
      recorded = path === '/api/groups' ? shown : () => view === viewRequest;
    try {
      let result = await sharedRead(path, owner, parse);
      // A confirmed change during the read made its response obsolete: read once more,
      // joining the read that change already started where there is one.
      for (
        let attempt = 0;
        attempt < 2 && result.version !== versionOf(path) && current(owner) && shown();
        attempt += 1
      )
        result = await sharedRead(path, owner, parse);
      const parsed = parse(result.value);
      if (recorded() && current(owner)) {
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
      const overtaken = () => epoch !== cacheEpoch || startVersion !== versionOf(path);
      const again = () => {
        if (!current(owner) || !shown()) throw new Superseded();
        return readCached(path, owner, parse, wanted);
      };
      if (overtaken()) return again();
      const stored = await lease.write(() => dependencies.readCache!.load(lease.accountId, path));
      const copy = cachedRead(stored, lease.accountId, path, now());
      // As in peek, a saved copy older than a change it couldn't be removed for is never shown.
      const cached =
        copy && copy.refreshedAt > (untrusted.get(readScope(path)) ?? -Infinity) ? copy : null;
      if (!current(owner)) throw new Superseded();
      if (overtaken()) return again();
      if (view === viewRequest) offlineSession = true;
      if (recorded()) {
        staleReads.set(path, cached?.refreshedAt ?? null);
        publishReadFreshness();
      }
      if (!cached)
        throw new RequestError(
          'This view was not saved on this device. Connect to load it.',
          0,
          'OFFLINE_UNAVAILABLE',
        );
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
   * Cold start: the saved Home of the account that last signed in on this device. Read straight
   * from this device, every part at once and outside the account queue, so nothing waits on the
   * network or on another account write. Null without a readable saved Groups list.
   */
  const readSavedHome = async (device: ReturnType<typeof readDeviceAccount>) => {
    const cache = dependencies.readCache;
    if (!dependencies.offlineIdentity || !cache) return null;
    try {
      const { accountId = null, identity: session = null } = (await device) ?? {};
      if (
        !accountId ||
        !session ||
        session.user.id !== accountId ||
        session.expiresAt.getTime() <= now()
      )
        return null;
      const saved = async <T>(path: string, parse: (value: unknown) => T) => {
        const read = cachedRead(await cache.load(accountId, path), accountId, path, now());
        return read && { value: parse(read.value), refreshedAt: read.refreshedAt };
      };
      const [groups, home, drafts] = await Promise.all([
        saved('/api/groups', parseGroups),
        saved('/api/user/balances', parseHomeBalances).catch(() => null),
        (async () => (await dependencies.expenseDrafts?.list?.(accountId)) ?? [])().catch(() => []),
      ]);
      if (
        !groups?.value.every((group) =>
          group.members.some((member) => member.user.id === accountId),
        )
      )
        return null;
      return {
        user: session.user,
        groups: groups.value,
        home,
        drafts: draftSummaries(drafts, accountId, groups.value),
      };
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
    if (!saved || !current(owner) || accountCleanupRequired || saved.user.id !== cookieAccount)
      return;
    publish({
      ...snapshot,
      auth: { status: 'restoring', user: saved.user, message: null },
      groups: { status: 'loading', data: saved.groups, message: null, loaded: true },
      home: saved.home
        ? {
            ...emptyHome(),
            status: 'loading',
            data: saved.home.value.buckets,
            byGroup: saved.home.value.byGroup,
            refreshedAt: saved.home.refreshedAt,
          }
        : emptyHome(),
      drafts: saved.drafts,
    });
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
      !dependencies.readCache
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
      publish({
        ...cleanSnapshot({ status: 'authenticated', user: session.user, message: null }),
        ...savedHome(session.user.id),
        ...recovered,
        offline: { active: true, refreshedAt: null, message: null },
      });
      await loadGroups(owner);
      if (current(owner)) await refreshHome();
      return true;
    } catch (error) {
      if (error instanceof Superseded) throw error;
      return false;
    }
  };

  const memberOfAll = (groups: MobileGroup[]) =>
    groups.every((group) =>
      group.members.some((member) => member.user.id === snapshot.auth.user?.id),
    );

  /** `reuse` accepts a list verified within the display freshness window. */
  const loadGroups = (owner: number, reuse = false) =>
    reuse ? listGroups(owner, true) : explicitly(['groups'], () => listGroups(owner, false));
  /** Home's Groups list is read again when its latest read ended without an answer. */
  const rereadGroups = (owner: number) =>
    groupsUnanswered && current(owner) ? loadGroups(owner, true) : Promise.resolve();
  /**
   * Shows Home and reads the Groups list. The read has its own token, so it publishes its
   * answer (the list or a failure) whatever screen the member has moved to; only a newer list
   * read supersedes it. A read that ends with no answer leaves Home to read the list again.
   */
  const listGroups = async (owner: number, reuse: boolean): Promise<void> => {
    assertCurrent(owner);
    viewRequest += 1;
    const listRead = ++groupsRequest;
    groupsUnanswered = false;
    const path = '/api/groups';
    startReadView();
    publish({
      ...snapshot,
      screen: 'groups',
      groups: { ...snapshot.groups, status: 'loading', message: null },
      detail: { status: 'idle', id: null, data: null, message: null, refreshedAt: null },
    });
    try {
      const fresh = reuse ? freshRead(path) : null;
      const reading = fresh
        ? null
        : readCached(path, owner, parseGroups, () => listRead === groupsRequest);
      reading?.catch(() => undefined);
      // The version current just after the answer settles. readCached already reads again for a
      // change during the read; the checks below catch one between the answer and its use.
      const answered = reading?.then(() => versionOf(path));
      answered?.catch(() => undefined);
      if (reading && !snapshot.groups.data.length) {
        const saved = await peek(path, owner, parseGroups);
        if (
          saved &&
          current(owner) &&
          listRead === groupsRequest &&
          !snapshot.groups.data.length &&
          memberOfAll(saved.value)
        )
          publish({ ...snapshot, groups: { ...snapshot.groups, data: saved.value, loaded: true } });
      }
      const groups = fresh ? parseGroups(fresh.value) : await reading!;
      const version = answered ? await answered : versionOf(path);
      assertCurrent(owner);
      if (listRead !== groupsRequest) return;
      if (version !== versionOf(path)) throw new Superseded();
      // Do not display a malformed server response as somebody else's groups.
      if (!memberOfAll(groups)) {
        throw new RequestError('The server returned invalid group membership. Please refresh.');
      }
      // Groups this session shows, has read or is reading that the list leaves out.
      const lost = new Set<string>();
      if (reading && !staleReads.has(path)) {
        const listed = new Set(groups.map((group) => group.id));
        for (const key of [
          ...snapshot.groups.data.map(({ id }) => `/api/groups/${id}`),
          ...reads.keys(),
          ...inflight.keys(),
        ]) {
          const id = /^\/api\/groups\/([a-f\d]{24})/i.exec(key)?.[1];
          if (id && !listed.has(id)) lost.add(id);
        }
        listedGroups = listed;
        unlistedGroups = lost;
        // They lose everything read for them, and Home with them. A read of one still running
        // is obsolete, so it is never kept or saved, and a view still showing it reads again.
        for (const id of lost)
          invalidateReads(`group:${id}`, `ledger:${id}`, `balances:${id}`, 'home');
        // With no list known yet, this device may hold Groups the trim drops, and Home's saved
        // figures with them: figures still being read are read again after it.
        if (!snapshot.groups.loaded && inflight.has('/api/user/balances')) invalidateReads('home');
      }
      const lease = accountStorage();
      if (reading && lease && dependencies.readCache && !staleReads.has(path)) {
        // The lost Groups' reads are already obsolete by version, so the trim moves no cache epoch:
        // reads running for another view or for Home go on and are saved.
        try {
          await lease.write(() =>
            dependencies.readCache!.retainGroups(
              lease.accountId,
              groups.map((group) => group.id),
            ),
          );
        } catch (error) {
          if (!current(owner) || error instanceof Superseded) throw error;
          await signOut();
          throw new Superseded();
        }
        if (!current(owner) || listRead !== groupsRequest) return;
        if (version !== versionOf(path)) throw new Superseded();
      }
      publish({
        ...snapshot,
        groups: { status: 'ready', data: groups, message: null, loaded: true },
      });
    } catch (error) {
      if (!current(owner) || listRead !== groupsRequest) return;
      if (error instanceof Superseded) {
        // No answer to show: Home reads the list again, at once if it's showing.
        groupsUnanswered = true;
        if (snapshot.screen === 'groups') await rereadGroups(owner);
        return;
      }
      publish({
        ...snapshot,
        groups: {
          ...snapshot.groups,
          status: error instanceof RequestError && error.status === 403 ? 'denied' : 'error',
          data: error instanceof RequestError && error.status === 403 ? [] : snapshot.groups.data,
          message:
            error instanceof RequestError
              ? error.message
              : 'The server returned invalid group data. Please refresh.',
        },
      });
    }
  };

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
      publish(cleanSnapshot({ status: 'restoring', user: null, message: null }));
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
    // A Group submission stored on this device reopens before anything else can be created.
    const recovered = await storedCreation(owner, session.user.id);
    publish({
      ...cleanSnapshot({ status: 'authenticated', user: session.user, message: null }),
      ...savedHome(session.user.id),
      ...recovered,
    });
    await saveVerifiedIdentity(session, owner);
    await loadGroups(owner);
    if (current(owner)) await refreshHome();
    if (!current(owner)) return;
    if (creationRecovery?.ownerId === session.user.id) {
      publish({
        ...snapshot,
        creation: creationRecovery.creation,
        screen: creationRecovery.creation.status === 'uncertain' ? 'groups' : 'create',
      });
    }
    creationRecovery = null;
    if (current(owner) && pendingCode) await previewInvitation(pendingCode);
  };

  /** Offline fallbacks and reused reads keep their original time. */
  const readAt = (path: string) =>
    staleReads.has(path) ? (staleReads.get(path) ?? null) : (reads.get(path)?.refreshedAt ?? now());

  /** `reuse` accepts figures verified within the display freshness window. */
  const readHome = async (reuse: boolean) => {
    if (snapshot.auth.status !== 'authenticated') return;
    const owner = generation;
    const read = ++homeRequest;
    const path = '/api/user/balances';
    const fresh = reuse ? freshRead(path) : null;
    if (fresh) {
      const { buckets, byGroup } = parseHomeBalances(fresh.value);
      publish({
        ...snapshot,
        home: {
          status: 'ready',
          data: buckets,
          byGroup,
          message: null,
          refreshedAt: fresh.refreshedAt,
          stale: false,
        },
      });
      return;
    }
    // The same account's figures stay readable, and keep their time, until replaced.
    publish({ ...snapshot, home: { ...snapshot.home, status: 'loading', message: null } });
    try {
      const reading = readCached(path, owner, parseHomeBalances, () => read === homeRequest);
      reading.catch(() => undefined);
      if (snapshot.home.data === null) {
        const saved = await peek(path, owner, parseHomeBalances);
        if (saved && current(owner) && read === homeRequest && snapshot.home.data === null)
          publish({
            ...snapshot,
            home: {
              ...snapshot.home,
              data: saved.value.buckets,
              byGroup: saved.value.byGroup,
              refreshedAt: saved.refreshedAt,
            },
          });
      }
      const { buckets, byGroup } = await reading;
      if (!current(owner) || read !== homeRequest) return;
      publish({
        ...snapshot,
        home: {
          status: 'ready',
          data: buckets,
          byGroup,
          message: null,
          refreshedAt: readAt(path),
          stale: false,
        },
      });
    } catch (error) {
      if (!current(owner) || read !== homeRequest || error instanceof Superseded) return;
      const denied = error instanceof RequestError && error.status === 403;
      publish({
        ...snapshot,
        home: {
          ...(denied ? emptyHome() : snapshot.home),
          status: denied ? 'denied' : 'error',
          message:
            error instanceof RequestError
              ? error.message
              : 'Could not load your balances. Please try again.',
        },
      });
    }
  };
  /** Home's Expense drafts (`draftSummaries`), read from this device whenever Home loads. */
  const listDrafts = async () => {
    const lease = accountStorage();
    const storage = dependencies.expenseDrafts;
    if (!lease || !storage?.list) return;
    const owner = generation;
    try {
      const records = await lease.write(() => storage.list!(lease.accountId));
      if (!current(owner)) return;
      publish({
        ...snapshot,
        drafts: draftSummaries(records, lease.accountId, snapshot.groups.data),
      });
    } catch {
      // Home keeps the drafts it lists; each one is still in its Group.
    }
  };
  /** `reuse` accepts figures verified within the display freshness window. */
  const loadHome = async (reuse: boolean) => {
    await Promise.all([
      listDrafts(),
      reuse ? readHome(true) : explicitly(['home'], () => readHome(false)),
    ]);
  };
  /** Refresh and Retry always read again. */
  const refreshHome = () => loadHome(false);

  /**
   * `quiet`: a return to the foreground after Continue. It retries a pending revoke but stays on
   * the sign-in screen, never the session check or the unconfirmed sign-out again.
   */
  const restore = async (quiet = false) => {
    const owner = invalidate();
    if (!quiet) publish(cleanSnapshot({ status: 'restoring', user: null, message: null }));
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
        publish(cleanSnapshot({ status: 'signed-out', user: null, message: disabledMessage }));
        return;
      }
      if (cleanupRequired) await clearSaved(owner);
      // Any pending sign-out cleanup has finished, so this device's saved Home can be read,
      // alongside the session cookie and before anything is sent.
      const device = readDeviceAccount();
      const deviceHome = readSavedHome(device);
      await loadPending();
      assertCurrent(owner);
      const saved = await store(owner, () => dependencies.credentials.load());
      if (!saved) {
        publish(cleanSnapshot({ status: 'signed-out', user: null, message: null }));
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
        publish(cleanSnapshot({ status: 'signed-out', user: null, message: unrestorableMessage }));
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
      publish(
        cleanSnapshot({
          status: 'error',
          user: null,
          message: unverifiedOffline ? `${message} ${keptUntilConfirmedMessage}` : message,
        }),
      );
    }
  };

  const signIn = async (personaId: string) => {
    const owner = invalidate();
    publish(cleanSnapshot({ status: 'signing-in', user: null, message: null }));
    try {
      // A pending sign-out's revoke is sent once before its saved cookie goes.
      await finishSignOut(owner, true);
      await clearSaved(owner);
      if (!config.developmentPersonaEnabled) {
        publish(cleanSnapshot({ status: 'signed-out', user: null, message: disabledMessage }));
        return;
      }
      if (!['alex', 'sam', 'priya'].includes(personaId))
        throw new RequestError('Choose an available development persona.');
      parseSignIn(
        await request('/api/auth/demo-persona/sign-in', owner, {
          method: 'POST',
          body: { personaId },
        }),
      );
      if (!cookie)
        throw new RequestError('The server did not provide a usable session. Please try again.');
      await verifyAndLoad(owner);
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      if (error instanceof AccountCleanupError) {
        await failSession(owner, error.message, 'error');
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
    // An OS account chooser cannot be aborted like fetch. Keep one active until it returns.
    if (googlePending) return;
    googlePending = true;
    const owner = invalidate();
    publish(cleanSnapshot({ status: 'signing-in', user: null, message: null }));
    try {
      await finishSignOut(owner, true);
      await clearSaved(owner);
      if (!googleEnabled || !dependencies.googleSignIn) {
        await failSession(owner, 'Google sign-in is not configured for this build.');
        return;
      }
      await verifyGoogleBackend(owner);
      const identity = await dependencies.googleSignIn();
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
      // An account change that failed has already revoked its session; any other is revoked here.
      await failSession(
        owner,
        message,
        error instanceof AccountCleanupError ? 'error' : 'signed-out',
        error instanceof AccountCleanupError ? null : cookie,
      );
    } finally {
      googlePending = false;
    }
  };

  /**
   * Shows a saved copy of a Group that is not on screen yet, each part with its own time,
   * while it is read again. Returns whether anything was shown.
   */
  const showSavedGroup = async (
    id: string,
    owner: number,
    view: number,
    previousMonth: string | null | undefined,
  ) => {
    const saved = await peek(`/api/groups/${id}`, owner, parseGroup);
    const group = saved?.value;
    if (
      !saved ||
      !group ||
      group.id !== id ||
      !group.members.some((member) => member.user.id === snapshot.auth.user?.id)
    )
      return false;
    const month =
      group.category !== 'home'
        ? null
        : previousMonth === undefined
          ? currentMonthKey(new Date(now()))
          : previousMonth;
    const [expenses, balances] = await Promise.all([
      peek(expensePath(id, group.category, month, 1), owner, (value) =>
        parseExpensePage(value, id, group.defaultCurrency),
      ),
      peek(`/api/groups/${id}/balances`, owner, parseGroupBalances),
    ]);
    if (!current(owner) || view !== viewRequest || snapshot.detail.id !== id) return false;
    publish({
      ...snapshot,
      detail: { ...snapshot.detail, data: group, refreshedAt: saved.refreshedAt },
      financial: {
        groupId: id,
        month,
        expenses: expenses
          ? {
              ...emptyExpenses(month),
              status: 'loading',
              data: expenses.value.expenses,
              summary: expenses.value.summary,
              pagination: expenses.value.pagination,
              refreshedAt: expenses.refreshedAt,
            }
          : emptyExpenses(month),
        balances: balances
          ? {
              status: 'loading',
              data: balances.value,
              message: null,
              refreshedAt: balances.refreshedAt,
              stale: false,
            }
          : emptyFinancial().balances,
      },
    });
    return true;
  };

  /**
   * `reuse` (navigation, foreground) accepts reads verified within the display freshness
   * window. An explicit refresh keeps the Group explicit until it finishes, so overlapping
   * foreground refreshes join its reads instead of reusing older figures.
   */
  const openGroup = (id: string, reuse = true, destination?: GroupDestination) =>
    reuse
      ? showGroup(id, true, destination)
      : explicitly([`group:${id}`], () => showGroup(id, false, destination));
  /**
   * The same Group reopens on the destination already shown (an Expense task's return sets
   * it) and another Group starts on Expenses, unless `requested` names one. Only the shown
   * destination is read; the other is read when the member switches to it.
   */
  const showGroup = async (id: string, reuse: boolean, requested?: GroupDestination) => {
    if (snapshot.auth.status !== 'authenticated') return;
    const owner = generation;
    const previousMonth = snapshot.financial.groupId === id ? snapshot.financial.month : undefined;
    const verified = snapshot.detail.id === id ? snapshot.detail.data : null;
    // Refreshing this account's same Group keeps its figures; another Group starts empty.
    let retained = Boolean(verified && snapshot.financial.groupId === id);
    const destination =
      requested ?? (snapshot.detail.id === id ? snapshot.destination : 'expenses');
    const view = ++viewRequest;
    const path = `/api/groups/${id}`;
    startReadView();
    publish({
      ...snapshot,
      screen: 'group',
      destination,
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
    });
    const kept = loadKeptDraft(id);
    try {
      if (!objectId.safeParse(id).success)
        throw new RequestError('This group is no longer available.', 404);
      const fresh = reuse ? freshRead(path) : null;
      const reading = fresh ? null : readCached(path, owner, parseGroup);
      reading?.catch(() => undefined);
      // The saved copy follows the same Month rule as figures retained on screen.
      if (!retained) retained = await showSavedGroup(id, owner, view, previousMonth);
      const group = fresh ? parseGroup(fresh.value) : await reading!;
      assertCurrent(owner);
      if (view !== viewRequest) return;
      if (
        group.id !== id ||
        !group.members.some((member) => member.user.id === snapshot.auth.user?.id)
      ) {
        // As for a refusal from the server: what was read and saved for it goes too.
        await forgetGroup(id, 403, owner);
        throw new RequestError('You no longer have access to this group.', 403);
      }
      publish({
        ...snapshot,
        detail: { status: 'ready', id, data: group, message: null, refreshedAt: readAt(path) },
        financial: {
          ...snapshot.financial,
          // While a refresh reads the Group, the member can still choose another Month:
          // that newer choice wins over the Month this refresh started with.
          month:
            group.category !== 'home'
              ? null
              : retained
                ? snapshot.financial.month
                : previousMonth === undefined
                  ? currentMonthKey(new Date(now()))
                  : previousMonth,
        },
      });
      // The member may have switched destination while the Group was read.
      if (snapshot.destination === 'activity') {
        const { expenses, balances } = snapshot.financial;
        // Expenses and Balances (a saved copy may be showing) are read on the first switch.
        publish({
          ...snapshot,
          financial: {
            ...snapshot.financial,
            expenses: { ...expenses, status: 'idle' },
            balances: balances.status === 'loading' ? { ...balances, status: 'idle' } : balances,
          },
        });
        await readActivity(false);
      } else await readExpenses(false, reuse);
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      if (dropDeniedGroup(id, error)) return;
      // Figures already shown for this Group stay, with their time, beside the failure.
      // Sections this refresh would have read are no longer updating.
      const { expenses, balances } = snapshot.financial;
      publish({
        ...snapshot,
        detail: {
          ...snapshot.detail,
          status: error instanceof RequestError && error.status === 403 ? 'denied' : 'error',
          message:
            error instanceof RequestError
              ? error.message
              : 'The server returned invalid group data. Please try again.',
        },
        financial: {
          ...snapshot.financial,
          expenses: expenses.status === 'loading' ? { ...expenses, status: 'idle' } : expenses,
          balances: balances.status === 'loading' ? { ...balances, status: 'idle' } : balances,
        },
      });
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
    historyRequest += 1;
    const withdrawn = { ...editor, context: null, history: emptyExpenseHistory() };
    return ['detail', 'delete-review'].includes(editor.status)
      ? { ...withdrawn, status: 'blocked', draft: null, preview: null, latest: null, message }
      : withdrawn;
  };

  const evictGroupContent = (id: string, status: number) => {
    const message =
      status === 403
        ? 'You no longer have access to this group.'
        : 'This group is no longer available.';
    homeRequest += 1;
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
   * this device and its content on screen go, and the Groups list and Home read again.
   */
  const forgetGroup = async (groupId: string, status: number, owner: number) => {
    cacheEpoch += 1;
    invalidateReads(
      `group:${groupId}`,
      `ledger:${groupId}`,
      `balances:${groupId}`,
      'groups',
      'home',
    );
    evictGroupContent(groupId, status);
    const lease = accountStorage();
    if (lease && dependencies.readCache) {
      try {
        await lease.write(() => dependencies.readCache!.invalidateGroup(lease.accountId, groupId));
      } catch (error) {
        if (!current(owner) || error instanceof Superseded) throw error;
        await signOut();
        throw new Superseded();
      }
    }
  };

  const dropDeniedGroup = (id: string, error: unknown): boolean => {
    if (!(error instanceof RequestError) || ![403, 404].includes(error.status)) return false;
    viewRequest += 1;
    homeRequest += 1;
    // A Groups list or Home figures read before this, still running or not, never bring it back.
    invalidateReads('groups', 'home');
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
   * `reuse` accepts Balances verified within the display freshness window. Any Expense
   * read since then removed them, so reused Balances always follow the latest Expense read.
   */
  const readBalances = async (reuse: boolean) => {
    const group = snapshot.detail.data;
    // Record payment is a sheet over the Group: Balances underneath still follow its reads.
    if (snapshot.auth.status !== 'authenticated' || !overGroup() || !group) return;
    const owner = generation;
    const view = viewRequest;
    if (
      snapshot.financial.expenses.status === 'loading' ||
      snapshot.financial.expenses.moreStatus === 'loading'
    )
      return;
    const read = ++balancesRequest;
    const path = `/api/groups/${group.id}/balances`;
    const fresh = reuse ? freshRead(path) : null;
    if (fresh) {
      publish({
        ...snapshot,
        financial: {
          ...snapshot.financial,
          balances: {
            status: 'ready',
            data: parseGroupBalances(fresh.value),
            message: null,
            refreshedAt: fresh.refreshedAt,
            stale: false,
          },
        },
      });
      return;
    }
    publish({
      ...snapshot,
      financial: {
        ...snapshot.financial,
        balances: { ...snapshot.financial.balances, status: 'loading', message: null },
      },
    });
    try {
      const data = await readCached(
        path,
        owner,
        parseGroupBalances,
        () => view === viewRequest && read === balancesRequest,
      );
      if (!current(owner) || view !== viewRequest || read !== balancesRequest) return;
      publish({
        ...snapshot,
        financial: {
          ...snapshot.financial,
          balances: {
            status: 'ready',
            data,
            message: null,
            refreshedAt: readAt(path),
            stale: false,
          },
        },
      });
    } catch (error) {
      if (
        !current(owner) ||
        view !== viewRequest ||
        read !== balancesRequest ||
        error instanceof Superseded
      )
        return;
      if (dropDeniedGroup(group.id, error)) return;
      publish({
        ...snapshot,
        financial: {
          ...snapshot.financial,
          balances: {
            ...snapshot.financial.balances,
            status: 'error',
            message:
              error instanceof RequestError
                ? error.message
                : 'Could not load balances. Please try again.',
          },
        },
      });
    }
  };
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
  /** Balances, with the Group's unconfirmed payment read alongside. */
  const loadBalances = async (reuse: boolean) => {
    const groupId = overGroup() ? snapshot.detail.data?.id : undefined;
    const pending = groupId ? loadPendingPayment(groupId) : null;
    await readBalances(reuse);
    await pending;
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
  /** Retry always reads again, and keeps the Group explicit while it does. */
  const refreshBalances = () =>
    explicitly([`group:${snapshot.detail.data?.id}`], () => loadBalances(false));

  const expensePath = (groupId: string, category: string, month: string | null, page: number) => {
    // Every Theme's summary shows the member's own share and paid amount.
    const params = new URLSearchParams({
      page: String(page),
      limit: '20',
      includeMemberBreakdown: '1',
    });
    if (category === 'home' && month) {
      const { dateFrom, dateTo } = getLocalMonthIsoRange(month);
      params.set('dateFrom', dateFrom);
      params.set('dateTo', dateTo);
    }
    return `/api/groups/${groupId}/expenses?${params}`;
  };

  const selectMonth = async (month: string | null) => {
    if (
      snapshot.auth.status !== 'authenticated' ||
      snapshot.screen !== 'group' ||
      snapshot.detail.data?.category !== 'home'
    )
      return;
    if (month !== null) getLocalMonthIsoRange(month);
    const { financial } = snapshot;
    returnPages = null;
    publish({
      ...snapshot,
      // The member chose another view: an earlier position or offer no longer applies.
      restoreScroll: null,
      snackbar: null,
      financial: {
        ...financial,
        month,
        // A different Month never shows the previous Month's Expenses under its label.
        expenses: month === financial.month ? financial.expenses : emptyExpenses(month),
      },
    });
    await readExpenses(false, true);
  };

  const beginExpenseRead = (groupId: string) => {
    // Expense reads can materialize due recurring entries. Older Home and Balance
    // responses no longer describe the same ledger, even while the Group read is
    // pending. Their figures stay visible but unverified until read again afterwards,
    // and are never reused or saved from a read that started before this one.
    homeRequest += 1;
    balancesRequest += 1;
    invalidateReads(`balances:${groupId}`, 'home');
    const { home, financial } = snapshot;
    publish({
      ...snapshot,
      home: { ...home, status: 'idle', message: null, stale: home.data !== null },
      financial: {
        ...financial,
        balances: {
          ...financial.balances,
          status: 'loading',
          message: null,
          stale: financial.balances.data !== null,
        },
      },
    });
  };

  /** `reuse` (navigation, Month choice, foreground) accepts a first page verified within the window. */
  const readExpenses = async (append: boolean, reuse = false) => {
    const group = snapshot.detail.data;
    // The payment sheet leaves its Group visible: finish the Expense-to-Balances read chain
    // underneath it, even when the Group request completes after the sheet opens.
    if (snapshot.auth.status !== 'authenticated' || !overGroup() || !group) return;
    const expenses = snapshot.financial.expenses;
    const pagination = expenses.pagination;
    const parse = (value: unknown) => parseExpensePage(value, group.id, group.defaultCurrency);
    // A return reads the page range it left until that range is shown, even when a later
    // read, such as a foreground refresh, supersedes the first one.
    if (returnPages && returnPages.groupId !== group.id) returnPages = null;
    const through =
      !append && returnPages?.month === snapshot.financial.month ? returnPages.pages : 1;
    // A reused first page alone would drop the rest of the range a return needs.
    const fresh =
      !append && reuse && through === 1
        ? freshRead(expensePath(group.id, group.category, snapshot.financial.month, 1))
        : null;
    if (fresh) {
      const page = parse(fresh.value);
      financialRequest += 1;
      publish({
        ...snapshot,
        financial: {
          ...snapshot.financial,
          expenses: {
            month: snapshot.financial.month,
            status: 'ready',
            data: page.expenses,
            summary: page.summary,
            pagination: page.pagination,
            message: null,
            moreStatus: 'idle',
            moreMessage: null,
            refreshedAt: fresh.refreshedAt,
          },
        },
      });
      // No Expense read happened, so Balances verified after the last one can be reused too.
      await loadBalances(true);
      return;
    }
    let pageNumber = 1;
    if (append) {
      if (
        expenses.status !== 'ready' ||
        expenses.month !== snapshot.financial.month ||
        expenses.moreStatus === 'loading' ||
        !pagination ||
        pagination.page >= pagination.totalPages
      )
        return;
      pageNumber = pagination.page + 1;
    }
    if (!append)
      for (const path of staleReads.keys())
        if (path.startsWith(`/api/groups/${group.id}/expenses?`)) staleReads.delete(path);
    const owner = generation;
    const view = viewRequest;
    const read = ++financialRequest;
    const month = snapshot.financial.month;
    const path = expensePath(group.id, group.category, month, pageNumber);
    const shown = expenses.month === month ? expenses : emptyExpenses(month);
    beginExpenseRead(group.id);
    // A refresh keeps Expenses readable only when they belong to the Month being read.
    publish({
      ...snapshot,
      financial: {
        ...snapshot.financial,
        expenses: append
          ? { ...expenses, moreStatus: 'loading', moreMessage: null }
          : { ...shown, status: 'loading', message: null, moreStatus: 'idle', moreMessage: null },
      },
    });
    const wanted = () => current(owner) && view === viewRequest && read === financialRequest;
    const readPage = (number: number) => {
      const reading = readCached(
        expensePath(group.id, group.category, month, number),
        owner,
        parse,
        wanted,
      );
      // Even if this view moves on, Balances and Home read before it settles are replaced.
      trackExpenseRead(group.id, owner, reading);
      reading.catch(() => undefined);
      return reading;
    };
    try {
      const reading = readPage(pageNumber);
      // A Month not on screen shows its saved copy, with its own time, while it is read again.
      if (!append && !shown.data.length && shown.summary === null) {
        const saved = await peek(path, owner, parse);
        if (saved && wanted())
          publish({
            ...snapshot,
            financial: {
              ...snapshot.financial,
              expenses: {
                ...snapshot.financial.expenses,
                data: saved.value.expenses,
                summary: saved.value.summary,
                pagination: saved.value.pagination,
                refreshedAt: saved.refreshedAt,
              },
            },
          });
      }
      const first = await reading;
      if (!wanted()) return await followSupersededExpenseRead(group.id, owner);
      if (first.pagination.page !== pageNumber) throw new Error('Unexpected expense page.');
      const refreshedAt = append ? expenses.refreshedAt : readAt(path);
      const rows = [...(append ? expenses.data : []), ...first.expenses];
      let last = first;
      let more: { status: 'idle' | 'error'; message: string | null } = {
        status: 'idle',
        message: null,
      };
      try {
        while (last.pagination.page < Math.min(through, last.pagination.totalPages)) {
          const number = last.pagination.page + 1;
          const next = await readPage(number);
          if (!wanted()) return await followSupersededExpenseRead(group.id, owner);
          if (next.pagination.page !== number) throw new Error('Unexpected expense page.');
          rows.push(...next.expenses);
          last = next;
        }
      } catch (error) {
        // Losing access or this view moving on is handled below; otherwise keep what was read.
        if (
          error instanceof Superseded ||
          !wanted() ||
          (error instanceof RequestError && [403, 404].includes(error.status))
        )
          throw error;
        more = {
          status: 'error',
          message:
            error instanceof RequestError
              ? error.message
              : 'Could not load more expenses. Please try again.',
        };
      }
      publish({
        ...snapshot,
        financial: {
          ...snapshot.financial,
          expenses: {
            month,
            status: 'ready',
            data: [...new Map(rows.map((expense) => [expense.id, expense])).values()],
            summary: first.summary,
            pagination: last.pagination,
            message: null,
            moreStatus: more.status,
            moreMessage: more.message,
            refreshedAt,
          },
        },
      });
      // The range a return needed is shown; later refreshes start from the first page.
      if (!append && returnPages?.month === month) returnPages = null;
      await loadBalances(false);
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      // A superseded read that failed may still have reached the server.
      if (view !== viewRequest || read !== financialRequest)
        return await followSupersededExpenseRead(group.id, owner);
      if (dropDeniedGroup(group.id, error)) return;
      const unavailableOffline =
        error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE';
      publish({
        ...snapshot,
        financial: {
          ...snapshot.financial,
          // Balances were not re-read after this Expense read: keep them, still unverified.
          balances: unavailableOffline
            ? snapshot.financial.balances
            : {
                ...snapshot.financial.balances,
                status: 'error',
                message: 'Could not update balances. Please try again.',
              },
          expenses: append
            ? {
                ...snapshot.financial.expenses,
                moreStatus: 'error',
                moreMessage:
                  error instanceof RequestError
                    ? error.message
                    : 'Could not load more expenses. Please try again.',
              }
            : {
                ...snapshot.financial.expenses,
                status: 'error',
                message:
                  error instanceof RequestError
                    ? error.message
                    : 'Could not load expenses. Please try again.',
              },
        },
      });
      // A missing cached Month/page says nothing about all-time balances. Load
      // their independent cache only after the expense read has settled, keeping
      // recurring-materialization ordering and authorization checks intact.
      if (unavailableOffline) await loadBalances(false);
      else await loadPendingPayment(group.id);
    }
  };

  /** Retry always reads again, and keeps the Group explicit while it does. */
  const refreshExpenses = () =>
    explicitly([`group:${snapshot.detail.data?.id}`], () => readExpenses(false));
  const loadMoreExpenses = () => readExpenses(true);

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
    if (returnActivityPages && returnActivityPages.groupId !== groupId) returnActivityPages = null;
    const through = append ? pageNumber : (returnActivityPages?.pages ?? 1);
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
      const pagePath = (number: number) =>
        `/api/groups/${groupId}/activity?page=${number}&limit=20`;
      const readPage = (number: number) =>
        readCached(
          pagePath(number),
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
          refreshedAt: append ? snapshot.activity.refreshedAt : readAt(pagePath(1)),
        },
      });
      if (!append) returnActivityPages = null;
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
    if (
      snapshot.auth.status !== 'authenticated' ||
      snapshot.screen !== 'group' ||
      destination === snapshot.destination
    )
      return;
    const groupId = snapshot.detail.id;
    publish({
      ...snapshot,
      destination,
      activity:
        groupId && snapshot.activity.groupId !== groupId
          ? { ...emptyActivity(), groupId }
          : snapshot.activity,
    });
    // A Group read still in flight reads the destination shown when it completes.
    if (snapshot.detail.status === 'loading' || !snapshot.detail.data) return;
    if (destination === 'activity') {
      if (snapshot.activity.status === 'idle') await readActivity(false);
    } else if (
      snapshot.financial.groupId === groupId &&
      snapshot.financial.expenses.status === 'idle'
    )
      await readExpenses(false, true);
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
      const group = await readCached(`/api/groups/${groupId}`, owner, parseGroup);
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
        target = await readCached(`/api/groups/${groupId}/expenses/${expenseId}`, owner, (value) =>
          parseActivityExpense(value, groupId, expenseId),
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
    if (snapshot.screen === 'expense' && snapshot.expense.groupId === groupId)
      return snapshot.expense.returnTo;
    if (
      snapshot.screen !== 'group' ||
      snapshot.detail.id !== groupId ||
      snapshot.financial.groupId !== groupId
    )
      return null;
    const { expenses, month } = snapshot.financial;
    const { activity, destination } = snapshot;
    return {
      groupId,
      month,
      scrollY: Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0,
      pages: expenses.month === month && expenses.pagination ? expenses.pagination.page : 1,
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
    returnPages = returnActivityPages = null;
    startReadView();
    publish({
      ...snapshot,
      screen: 'expense',
      expense: {
        ...emptyExpenseEditor(),
        groupId,
        requestedExpenseId: expenseId ?? null,
        status: 'loading',
        returnTo,
      },
    });
    try {
      const lease = accountStorage();
      if (!lease || !dependencies.expenseDrafts) throw new Error('Draft storage is unavailable.');
      const stored = await lease.write(() => dependencies.expenseDrafts!.load(accountId, groupId));
      let record = stored === null ? null : parseStoredExpenseDraft(stored, accountId, groupId);
      if (!current(owner) || view !== viewRequest) return;
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
      const context = await readCached(`/api/groups/${groupId}`, owner, parseExpenseContext);
      if (!current(owner) || view !== viewRequest) return;
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
        if (!current(owner) || view !== viewRequest) return;
        record = held = null;
      }
      const original =
        (record === null || held) && expenseId
          ? await readCached(`/api/groups/${groupId}/expenses/${expenseId}`, owner, (value) =>
              parseExpenseRecord(value, groupId, expenseId),
            ).catch((error: unknown) => {
              // The Group was just read: what's missing is this Expense.
              throw error instanceof RequestError && error.status === 404
                ? new RequestError('This Expense isn’t available.', 404)
                : error;
            })
          : null;
      if (!current(owner) || view !== viewRequest) return;
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
      if (original) await readExpenseHistory(false);
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      publish({
        ...snapshot,
        expense: {
          ...snapshot.expense,
          status:
            error instanceof RequestError && [403, 404].includes(error.status)
              ? 'blocked'
              : snapshot.expense.draft
                ? 'resume'
                : 'blocked',
          message:
            error instanceof RequestError
              ? error.message
              : 'Could not open this Expense draft. Your saved draft has not been changed.',
        },
      });
    }
  };

  /**
   * The shown record's changes, newest first: its Group's Activity filtered to this Expense.
   * Until they're read, or when they can't be, the record keeps its added and last-changed
   * times; a failed read never affects the record itself. Try again also reads them while the
   * record is being edited.
   */
  const readExpenseHistory = async (append: boolean) => {
    const editor = snapshot.expense,
      previous = editor.history,
      groupId = editor.groupId,
      expenseId = editor.draft?.original?._id;
    if (
      snapshot.screen !== 'expense' ||
      !['detail', 'delete-review', 'editing'].includes(editor.status) ||
      !groupId ||
      !expenseId
    )
      return;
    const pagination = previous.expenseId === expenseId ? previous.pagination : null;
    if (
      append &&
      (previous.status !== 'ready' ||
        previous.moreStatus === 'loading' ||
        !pagination ||
        pagination.page >= pagination.totalPages)
    )
      return;
    const pageNumber = append ? pagination!.page + 1 : 1;
    const owner = generation,
      view = viewRequest,
      read = ++historyRequest;
    const wanted = () => current(owner) && view === viewRequest && read === historyRequest;
    const publishHistory = (history: Partial<typeof previous>) =>
      publish({
        ...snapshot,
        expense: { ...snapshot.expense, history: { ...previous, ...history } },
      });
    publishHistory(
      append
        ? { moreStatus: 'loading' }
        : { ...emptyExpenseHistory(), expenseId, status: 'loading' },
    );
    try {
      const page = await readCached(
        `/api/groups/${groupId}/activity?expenseId=${expenseId}&page=${pageNumber}&limit=20`,
        owner,
        (value) => parseActivityPage(value, groupId, pageNumber, expenseId),
        wanted,
      );
      if (!wanted()) return;
      const events = [...(append ? previous.events : []), ...page.events];
      publishHistory({
        expenseId,
        status: 'ready',
        events: [...new Map(events.map((event) => [event._id, event])).values()],
        pagination: page.pagination,
        message: null,
        moreStatus: 'idle',
      });
    } catch (error) {
      if (!wanted() || error instanceof Superseded) return;
      // Refused, not merely unread: the record and its changes are withdrawn, not kept.
      if (error instanceof RequestError && error.status === 403)
        return publish({ ...snapshot, expense: withdrawExpense(error.message) });
      publishHistory(
        append
          ? { moreStatus: 'error' }
          : {
              ...emptyExpenseHistory(),
              expenseId,
              status: 'error',
              message:
                error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE'
                  ? 'This Expense’s changes aren’t saved on this device. Connect to see them.'
                  : 'Couldn’t load this Expense’s changes.',
            },
      );
    }
  };
  const refreshExpenseHistory = () => readExpenseHistory(false);
  const loadOlderExpenseHistory = () => readExpenseHistory(true);

  /**
   * Try again on a saved record, once its Group has been read: the record and its changes are
   * read again, which saves them for offline use and stops their old saved copies keeping the
   * offline notice up. A record shown read-only is replaced. An edit, or a deletion under review,
   * keeps the version and revision it started from, so the server refuses it if that version is
   * no longer current. A record that's gone gives way to a notice, as when opening it; a refusal
   * is thrown, so the caller withdraws the Group as it does for the Group's own read.
   */
  const rereadExpenseRecord = async (owner: number, view: number) => {
    const onRecord = () => ['detail', 'delete-review', 'editing'].includes(snapshot.expense.status);
    const groupId = snapshot.expense.groupId,
      expenseId = snapshot.expense.draft?.original?._id;
    if (snapshot.screen !== 'expense' || !onRecord() || !groupId || !expenseId) return;
    const path = `/api/groups/${groupId}/expenses/${expenseId}`;
    const showing = () =>
      current(owner) &&
      view === viewRequest &&
      snapshot.screen === 'expense' &&
      onRecord() &&
      snapshot.expense.groupId === groupId &&
      snapshot.expense.draft?.original?._id === expenseId;
    try {
      const original = await readCached(path, owner, (value) =>
        parseExpenseRecord(value, groupId, expenseId),
      );
      if (!showing()) return;
      if (snapshot.expense.status === 'detail') {
        const draft = draftFromExpense(original);
        publish({
          ...snapshot,
          expense: { ...snapshot.expense, draft, preview: previewExpense(draft) },
        });
      }
    } catch (error) {
      if (!(error instanceof RequestError) || error.status !== 404) throw error;
      if (!showing()) return;
      // The Group was just read: what's missing is this Expense, and nothing saved of it is shown.
      const history = `/api/groups/${groupId}/activity?expenseId=${expenseId}&`;
      for (const stale of staleReads.keys())
        if (stale === path || stale.startsWith(history)) staleReads.delete(stale);
      // An edit stays with its Group's details; saving it is refused as for any missing Expense.
      if (snapshot.expense.status !== 'editing')
        publish({ ...snapshot, expense: withdrawExpense('This Expense isn’t available.') });
      return;
    }
    await readExpenseHistory(false);
  };

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
    options: Parameters<typeof request>[2],
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
        if (!refused) await removeLedgerCopies(groupId, owner);
      }
    }
  };

  /** After a confirmed change: every affected view reads again; earlier responses cannot return. */
  const refreshLedgerViews = async (groupId: string, owner: number, navigate: boolean) => {
    ledgerChanged(groupId);
    if (navigate || (snapshot.screen === 'group' && snapshot.detail.id === groupId))
      await openGroup(groupId, false);
    if (current(owner)) await refreshHome();
  };

  let scrollRequests = 0;
  /**
   * Show the Group view an Expense task returns to; the caller then reads it. A known origin
   * keeps its Month and asks for its scroll position; direct entry uses the default Month.
   * Back returns to the destination the task opened from; a confirmed change (with its
   * snackbar) returns to Expenses, where the change shows.
   */
  const returnToGroup = (groupId: string, snackbar: GroupSnackbar | null = null) => {
    const origin =
      snapshot.expense.returnTo?.groupId === groupId ? snapshot.expense.returnTo : null;
    const { detail, financial } = snapshot;
    returnPages = origin && { groupId, month: origin.month, pages: origin.pages };
    returnActivityPages =
      origin?.destination === 'activity' && !snackbar
        ? { groupId, pages: origin.activityPages }
        : null;
    publish({
      ...snapshot,
      screen: 'group',
      destination: snackbar ? 'expenses' : (origin?.destination ?? 'expenses'),
      detail:
        detail.id === groupId
          ? detail
          : { status: 'loading', id: groupId, data: null, message: null, refreshedAt: null },
      financial: !origin
        ? emptyFinancial()
        : financial.groupId === groupId && financial.month === origin.month
          ? financial
          : { ...emptyFinancial(), groupId, month: origin.month },
      restoreScroll: origin ? { groupId, y: origin.scrollY, request: ++scrollRequests } : null,
      snackbar,
    });
  };

  /** Offers the saved Expense's Month only when it differs from the Month the view returns to. */
  const ledgerSnackbar = (
    groupId: string,
    message: string,
    context: ExpenseContext,
    date?: string,
  ): GroupSnackbar => {
    const origin =
      snapshot.expense.returnTo?.groupId === groupId ? snapshot.expense.returnTo : null;
    const shown =
      context.group.category !== 'home'
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
    returnPages = returnActivityPages = null;
    publish({
      ...snapshot,
      screen: 'groups',
      detail: { status: 'idle', id: null, data: null, message: null, refreshedAt: null },
      financial: emptyFinancial(),
    });
    return settleHome();
  };
  /**
   * Every way back to Home ends here. Home's content shows where it came from, including a list
   * read that landed elsewhere; a Groups list read that ended without an answer is read again,
   * then the figures.
   */
  const settleHome = () => {
    publishReadFreshness();
    if (!groupsUnanswered) return loadHome(true);
    const owner = generation;
    return rereadGroups(owner).then(() => (current(owner) ? loadHome(true) : undefined));
  };

  /** Android Back and close keep the draft on this device and return where the task began. */
  const closeExpense = async () => {
    if (snapshot.screen !== 'expense' || expenseNavigationBlocked()) return;
    if (snapshot.expense.status === 'delete-review') return cancelExpenseDeletion();
    // Leaving waits for the latest entries to be stored; if that fails, the form stays open.
    if (snapshot.expense.persistence === 'saving') {
      const view = viewRequest,
        close = ++closeRequest;
      if (
        !(await draftWritten()) ||
        view !== viewRequest ||
        close !== closeRequest ||
        snapshot.screen !== 'expense' ||
        expenseNavigationBlocked()
      )
        return;
    }
    const editor = snapshot.expense;
    const { detail } = snapshot;
    const groupId = editor.groupId;
    // A Group removed after denial has nothing to return to.
    if (
      !groupId ||
      (detail.id === groupId && !detail.data && ['denied', 'error'].includes(detail.status))
    )
      return showHome();
    returnToGroup(groupId);
    await openGroup(groupId);
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

  const reconcileExpense = async () => {
    const editor = snapshot.expense;
    if (
      snapshot.screen !== 'expense' ||
      !editor.draft?.original ||
      !editor.groupId ||
      editor.status === 'saving'
    )
      return;
    const owner = generation,
      view = viewRequest;
    publish({ ...snapshot, expense: { ...editor, status: 'loading', latest: null } });
    try {
      const latest = parseExpenseRecord(
        await request(`/api/groups/${editor.groupId}/expenses/${editor.draft.original._id}`, owner),
        editor.groupId,
        editor.draft.original._id,
      );
      if (!current(owner) || view !== viewRequest) return;
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
      await lease.write(async () => {
        const value = await storage.load(lease.accountId, groupId);
        if (value === null) return;
        const stored = parseStoredExpenseDraft(value, lease.accountId, groupId);
        if (
          stored.draft.original?._id === original._id &&
          stored.mutation?.kind === mutation!.kind &&
          stored.mutation.revision === mutation!.revision &&
          stored.mutation.body === mutation!.body
        )
          await storage.remove(lease.accountId, groupId);
      });
      completed = true;
      if (!current(owner) || view !== viewRequest) return;
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
      refreshed = true;
      returnToGroup(
        groupId,
        kind === 'delete'
          ? ledgerSnackbar(groupId, `Expense deleted · ${original.description}`, context)
          : ledgerSnackbar(
              groupId,
              `Expense updated · ${draft.description.trim()}`,
              context,
              draft.date,
            ),
      );
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
        groupId,
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
    const balances = parseGroupBalances(await request(`/api/groups/${groupId}/balances`, owner));
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
    publish({
      ...snapshot,
      screen: 'settlement',
      settlement: { ...emptySettlement(), groupId, status: 'loading' },
    });
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
      showSettlementGroup(groupId, { groupId, message: 'Payment recorded', viewMonth: null }, null);
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
      snapshot.offline.active
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
   * Show the Group's Balances under a closing sheet; late sheet reads can't reopen it.
   * `pending` is the unconfirmed payment Balances offers afterwards.
   */
  const showSettlementGroup = (
    groupId: string,
    snackbar: GroupSnackbar | null,
    pending: PendingPayment | null,
  ) => {
    settlementRequest += 1;
    pendingRequest += 1;
    publish({
      ...snapshot,
      screen: 'group',
      destination: 'balances',
      detail:
        snapshot.detail.id === groupId
          ? snapshot.detail
          : { status: 'loading', id: groupId, data: null, message: null, refreshedAt: null },
      settlement: emptySettlement(),
      pendingPayment: pending,
      snackbar,
    });
  };

  /**
   * Close and Android Back return to Balances; nothing is recorded. An unconfirmed payment stays
   * on Balances, which reads again when the sheet's live read found newer balances or a payment's
   * outcome is unknown.
   */
  const closeSettlement = async () => {
    const { groupId, group, balances, attempt, draft } = snapshot.settlement;
    if (snapshot.screen !== 'settlement' || expenseNavigationBlocked()) return;
    if (!groupId) return showHome();
    const shown = snapshot.detail.id === groupId && snapshot.detail.data !== null;
    const newer =
      attempt !== null ||
      (group !== null &&
        JSON.stringify(balances) !== JSON.stringify(snapshot.financial.balances.data));
    const pending = attempt
      ? { groupId, draft }
      : snapshot.pendingPayment?.groupId === groupId
        ? snapshot.pendingPayment
        : null;
    showSettlementGroup(groupId, null, pending);
    if (!shown) await openGroup(groupId, true, 'balances');
    else if (newer) await loadBalances(false);
    else await loadPendingPayment(groupId);
  };

  const startCreate = () => {
    if (snapshot.auth.status !== 'authenticated') return;
    viewRequest += 1;
    publish({ ...snapshot, screen: 'create' });
  };

  const openSettings = () => {
    if (snapshot.auth.status !== 'authenticated' || expenseNavigationBlocked()) return;
    viewRequest += 1;
    publish({ ...snapshot, screen: 'settings' });
  };

  /** Where Members and Group details returns: the Group view, Month and scroll it opened from. */
  let membersReturn: GroupReturnContext | null = null;
  /** Shows the Group as known so far; a Group read still in flight updates the page. */
  const openMembers = (origin: { scrollY?: number } = {}) => {
    const groupId = shownGroup(snapshot)?.id;
    if (snapshot.auth.status !== 'authenticated' || snapshot.screen !== 'group' || !groupId) return;
    membersReturn = expenseReturn(groupId, origin.scrollY);
    publish({ ...snapshot, screen: 'members' });
  };
  /** Android Back and the arrow return to the destination, Month and scroll it opened from. */
  const closeMembers = async () => {
    if (snapshot.screen !== 'members' || snapshot.leave.status === 'leaving') return;
    const { id } = snapshot.detail;
    const origin = membersReturn?.groupId === id ? membersReturn : null;
    membersReturn = null;
    if (!id || !shownGroup(snapshot)) return showHome();
    returnPages = origin && { groupId: id, month: origin.month, pages: origin.pages };
    // Activity's older events are read again too, as on return from an Expense.
    returnActivityPages =
      origin?.destination === 'activity' ? { groupId: id, pages: origin.activityPages } : null;
    publish({
      ...snapshot,
      screen: 'group',
      restoreScroll: origin ? { groupId: id, y: origin.scrollY, request: ++scrollRequests } : null,
    });
    // Reads what the Group view missed while the page was open; recent reads are reused.
    await openGroup(id);
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
      returnPages = returnActivityPages = null;
      membersReturn = null;
      publish({
        ...snapshot,
        ...kept,
        screen: 'groups',
        detail: { status: 'idle', id: null, data: null, message: null, refreshedAt: null },
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
    await loadGroups(owner);
    if (current(owner)) await refreshHome();
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
    membersReturn = null;
    publish({ ...snapshot, screen: 'group', destination: check, leave: closedLeave() });
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

  const previewInvitation = async (code: string) => {
    const owner = generation;
    const view = ++viewRequest;
    publish({
      ...snapshot,
      screen: 'invite',
      invitation: { code, status: 'loading', preview: null, message: null },
    });
    try {
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

  const openInvitation = async (url: string) => {
    const code = parseInvitationLink(url, inviteOrigin);
    const owner = generation;
    try {
      await savePending(code);
    } catch {
      if (!current(owner)) return;
      publish({
        ...snapshot,
        screen: 'invite',
        invitation: {
          code,
          status: 'error',
          preview: null,
          message: 'Could not save this invitation on the device. Open the link again to retry.',
        },
      });
      return;
    }
    if (!current(owner) || pendingCode !== code) return;
    if (!code) {
      viewRequest += 1;
      publish({
        ...snapshot,
        screen: 'invite',
        invitation: {
          code: null,
          status: 'invalid',
          preview: null,
          message:
            'This link does not belong to this SplitBook environment, or is not a valid invitation.',
        },
      });
      return;
    }
    await previewInvitation(code);
  };

  const joinInvitation = async () => {
    if (
      snapshot.auth.status !== 'authenticated' ||
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
      if (view !== viewRequest || pendingCode !== code) return;
      await savePending(null);
      assertCurrent(owner);
      if (view !== viewRequest) return;
      publish({
        ...snapshot,
        invitation: { code: null, status: 'idle', preview: null, message: null },
      });
      const loadingGroups = loadGroups(owner);
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

  const retryInvitation = () => (pendingCode ? previewInvitation(pendingCode) : Promise.resolve());

  const invitationSignIn = () => publish({ ...snapshot, screen: 'groups' });

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
    publish({
      ...snapshot,
      screen: 'groups',
      detail: { status: 'idle', id: null, data: null, message: null, refreshedAt: null },
      financial: emptyFinancial(),
      invitation: { code: null, status: 'idle', preview: null, message: null },
    });
    try {
      await savePending(null);
      if (current(owner) && view === viewRequest) await settleHome();
    } catch {
      if (!current(owner) || view !== viewRequest) return;
      publish({
        ...snapshot,
        screen: 'invite',
        invitation: {
          code: null,
          status: 'error',
          preview: null,
          message: 'Could not remove the saved invitation. Please cancel again.',
        },
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
      if (view === viewRequest) await loadGroups(owner);
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
      if (!definite && view === viewRequest) await loadGroups(owner);
    }
    // A confirmed Group opens the way Home opens one, so its Expenses, Balances and Month are
    // read like any other Group's. A member who moved on before the confirmation stays there.
    if (created && view === viewRequest) await openGroup(created);
  };

  const checkCreatedGroups = () =>
    snapshot.auth.status === 'authenticated' ? loadGroups(generation) : Promise.resolve();

  const resumeCreationAfterCheck = () => {
    if (
      snapshot.auth.status !== 'authenticated' ||
      snapshot.groups.status !== 'ready' ||
      snapshot.creation.status !== 'uncertain'
    )
      return;
    publish({
      ...snapshot,
      screen: 'create',
      creation: { ...snapshot.creation, status: 'editing', message: null },
    });
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
    const returning = snapshot.screen !== 'groups';
    publish({ ...snapshot, screen: 'groups', creation: cleanSnapshot(snapshot.auth).creation });
    if (returning) return settleHome();
  };

  const back = () => {
    // An open event detail closes first; from any Group destination, Back returns Home.
    if (showingActivity() && snapshot.activity.selected) return closeActivityDetail();
    if (snapshot.screen === 'invite') {
      void cancelInvitation();
      return;
    }
    if (snapshot.creation.status === 'saving' || expenseNavigationBlocked()) return;
    if (snapshot.screen === 'expense') return closeExpense();
    if (snapshot.screen === 'settlement') return closeSettlement();
    // The Leave Group sheet closes first; while leaving, Back waits for the answer.
    if (snapshot.screen === 'members' && snapshot.leave.status !== 'closed')
      return cancelLeaveGroup();
    if (snapshot.screen === 'members') return closeMembers();
    return showHome();
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
    if (
      ['create', 'invite', 'settings', 'expense', 'settlement', 'members'].includes(snapshot.screen)
    ) {
      const owner = generation,
        view = viewRequest,
        screen = snapshot.screen;
      const groupId =
        screen === 'expense'
          ? snapshot.expense.groupId
          : screen === 'settlement'
            ? snapshot.settlement.groupId
            : screen === 'members'
              ? snapshot.detail.id
              : null;
      // Only the Group's own read can say access was lost, never the session check before it.
      let readingGroup = false;
      try {
        try {
          await revalidateSession(owner);
        } catch (error) {
          if (!(error instanceof RequestError) || !error.networkFailure || !dependencies.readCache)
            throw error;
          offlineSession = true;
        }
        if (!current(owner) || view !== viewRequest) return;
        readingGroup = true;
        if (screen === 'members' && groupId) {
          // Read as on the Group view: a foreground refresh reuses a recently verified read.
          const path = `/api/groups/${groupId}`;
          const fresh = reuse ? freshRead(path) : null;
          const group = fresh ? parseGroup(fresh.value) : await readCached(path, owner, parseGroup);
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
              refreshedAt: readAt(path),
            },
          });
        } else if (dependencies.readCache && groupId) {
          const context = await readCached(`/api/groups/${groupId}`, owner, parseExpenseContext);
          if (!current(owner) || view !== viewRequest) return;
          if (
            context.group.id !== groupId ||
            !context.group.members.some((member) => member.user.id === snapshot.auth.user?.id)
          )
            throw new RequestError('You no longer have access to this Group.', 403);
          if (screen === 'expense')
            publish({ ...snapshot, expense: { ...snapshot.expense, context } });
          else
            publish({ ...snapshot, settlement: { ...snapshot.settlement, group: context.group } });
          // Try again on a saved record reads the record and its changes too.
          if (screen === 'expense' && !reuse) {
            await rereadExpenseRecord(owner, view);
            if (!current(owner) || view !== viewRequest || snapshot.screen !== screen) return;
          }
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
          if (screen === 'expense')
            publish({
              ...snapshot,
              expense: {
                ...withdrawExpense(error.message),
                status: 'blocked',
                message: error.message,
              },
            });
          else if (screen === 'settlement')
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
          if (screen !== 'settlement') {
            // Members, or the Expense, now shows none of the Group: its saved copies no longer keep
            // the offline banner.
            for (const path of staleReads.keys())
              if (path.startsWith(`/api/groups/${groupId}`)) staleReads.delete(path);
            publishReadFreshness();
          }
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
    if (snapshot.screen === 'group' && snapshot.detail.id)
      return openGroup(snapshot.detail.id, reuse);
    const owner = generation;
    const groupsThenHome = async () => {
      await loadGroups(owner, reuse);
      if (current(owner)) await loadHome(reuse);
    };
    // An explicit refresh keeps both views explicit until Home has been read too.
    return reuse ? groupsThenHome() : explicitly(['groups', 'home'], groupsThenHome);
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
    publish(cleanSnapshot({ status: 'signed-out', user: null, message: null }));
    // Independent stores must both be purged. Wait for both attempts before
    // exposing recovery so a failed invitation clear cannot preserve a session.
    let confirmed: boolean;
    try {
      confirmed = await clearAccount(owner, 'sign-out');
    } catch {
      if (current(owner)) {
        publish(
          cleanSnapshot({
            status: 'error',
            user: null,
            message: 'Could not remove this account from the device. Try signing out again.',
          }),
        );
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
    publish({ ...cleared, invitation: { ...cleared.invitation, code: pendingCode } });
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
      listeners.clear();
      snapshot = cleanSnapshot({ status: 'signed-out', user: null, message: null });
    },
  };
}

export type MobileController = ReturnType<typeof createMobileController>;
