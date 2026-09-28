import { cachedRead } from './offline-cache';
import { emptyActivity, parseActivityPage, parseActivityExpense } from './activity';
import {
  emptySettlement,
  parseRecordedSettlement,
  parseSettlementAttempt,
  parseSettlementHistory,
  settlementBody,
  settlementSuggestion,
  type SettlementDraft,
} from './settlement';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import {
  assertSettlementMembers,
  assertSettlementAuthorization,
  assertGroupCurrency,
} from '@splitbook/shared/expense-validation';
import { canEditExpense, parseExpenseRecord } from './expense-record';
import { parseAmountMinor, MoneyValidationError } from '@splitbook/shared/exact-money';
import {
  emptyExpenseEditor,
  draftFromExpense,
  buildExpenseBody,
  buildExpensePatch,
  parseCreatedExpenseId,
  parseExpenseContext,
  parseStoredExpenseDraft,
  previewExpense,
  type ExpenseDraft,
} from './expense-draft';
import { readSessionCookie, validSessionCookie } from './cookies';
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
  parseSession,
  parseSignIn,
} from './dto';
import { parseInvitationLink } from './invitation-links';
import { parseExpensePage, parseGroupBalances, parseHomeBalances } from './financial-dto';
import type {
  AccountStorageLease,
  FetchResponse,
  GroupCreation,
  GroupDraft,
  GroupFinancialState,
  MobileConfig,
  MobileDependencies,
  MobileSnapshot,
} from './types';

export { currentMonthKey, shiftMonthKey } from '@splitbook/shared/date';

function emptyFinancial(): GroupFinancialState {
  return {
    groupId: null,
    month: null,
    expenses: {
      status: 'idle',
      data: [],
      summary: null,
      pagination: null,
      message: null,
      moreStatus: 'idle',
      moreMessage: null,
    },
    balances: { status: 'idle', data: null, message: null },
  };
}

const expiredMessage = 'Your session has expired. Sign in again to continue.';
const storageMessage = 'Could not safely save your session. Please try signing in again.';
const disabledMessage = 'Development persona sign-in is disabled in this build.';

class Superseded extends Error {}
class AccountCleanupError extends Error {
  constructor() {
    super('Could not remove this account from the device. Try signing out again.');
  }
}
class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code: string | null = null,
    readonly networkFailure = false,
  ) {
    super(message);
  }
}

function expenseRejectionMessage(error: unknown) {
  const rejectionMessages: Record<string, string> = {
    INVALID_TAG: 'Choose an active Tag in this Group. Your entries are kept.',
    INVALID_MEMBERS: 'Review the payer and participants: Group membership changed.',
    CURRENCY_MISMATCH: 'The Group currency changed. Review the currency before saving.',
    VALIDATION_ERROR: 'Check the amount, description, date, and participants before saving.',
  };
  return error instanceof RequestError && error.status === 422 && error.code
    ? rejectionMessages[error.code]
    : undefined;
}

function cleanSnapshot(auth: MobileSnapshot['auth']): MobileSnapshot {
  return {
    auth,
    offline: { active: false, refreshedAt: null, message: null },
    screen: 'groups',
    expense: emptyExpenseEditor(),
    settlement: emptySettlement(),
    activity: emptyActivity(),
    home: { status: 'idle', data: null, message: null },
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
    },
    invitation: { code: null, status: 'idle', preview: null, message: null },
    share: { status: 'idle', url: null, message: null },
    groups: { status: 'idle', data: [], message: null },
    detail: { status: 'idle', id: null, data: null, message: null },
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

/**
 * Development-persona transport and memory-only Group and financial reads. Secure credential
 * persistence is injected by the native runtime. It never imports React or a
 * native SDK, and it never treats a raw Better Auth token as a signed cookie.
 */
export function createMobileController(config: MobileConfig, dependencies: MobileDependencies) {
  const apiBase = origin(config.apiBaseUrl);
  const authOrigin = origin(config.authOrigin);
  const inviteOrigin = origin(config.inviteOrigin ?? config.authOrigin);
  const secureTransport = apiBase.startsWith('https:');
  const now = dependencies.now ?? Date.now;
  const listeners = new Set<() => void>();
  const requests = new Set<AbortController>();
  let snapshot = cleanSnapshot({ status: 'restoring', user: null, message: null });
  let cookie: string | null = null;
  let generation = 0;
  let viewRequest = 0;
  let homeRequest = 0;
  let financialRequest = 0;
  let balancesRequest = 0;
  let activityRequest = 0;
  let activityDetailRequest = 0;
  let cacheEpoch = 0;
  let offlineSession = false;
  const staleReads = new Map<string, number | null>();
  let storeQueue: Promise<unknown> = Promise.resolve();
  let cleanupRequired = false;
  let accountCleanupRequired = false;
  let accountQueue: Promise<unknown> = Promise.resolve();
  let cleanupMarkerQueue: Promise<unknown> = Promise.resolve();
  let cleanupSequence = 0;
  let pendingCode: string | null = null;
  let pendingLoaded = false;
  let creationRecovery: { ownerId: string; creation: GroupCreation } | null = null;
  let pendingQueue: Promise<unknown> = Promise.resolve();

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
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const current = (owner: number) => owner === generation;
  const assertCurrent = (owner: number) => {
    if (!current(owner)) throw new Superseded();
  };
  const invalidate = () => {
    generation += 1;
    cacheEpoch += 1;
    offlineSession = false;
    staleReads.clear();
    viewRequest += 1;
    requests.forEach((request) => request.abort());
    requests.clear();
    cookie = null;
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

  const clearAccount = (owner: number, mode: 'sign-out' | 'account-change') => {
    accountCleanupRequired = true;
    const cleanupId = ++cleanupSequence;
    // Persist logout intent and remove credentials before waiting for an older
    // financial write. A terminated process must not leave a restorable account.
    const marking = cleanupMarkerQueue
      .catch(() => undefined)
      .then(async () => {
        assertCurrent(owner);
        await dependencies.accountLocal?.cleanupMarker.mark();
      });
    cleanupMarkerQueue = marking;
    const immediate = Promise.allSettled([
      marking,
      ...(mode === 'sign-out' ? [clearSaved(owner), savePending(null)] : []),
    ]);
    return queueAccount(async () => {
      assertCurrent(owner);
      const cleanup = await Promise.allSettled([
        Promise.resolve().then(() => dependencies.accountLocal?.owner.clear()),
        ...(dependencies.accountLocal?.stores.map((storage) =>
          Promise.resolve().then(() => storage.clear()),
        ) ?? []),
      ]);
      if ([...(await immediate), ...cleanup].some((result) => result.status === 'rejected')) {
        if (mode === 'account-change') await Promise.allSettled([clearSaved(owner)]);
        throw new AccountCleanupError();
      }
      try {
        assertCurrent(owner);
        const clearing = cleanupMarkerQueue
          .catch(() => undefined)
          .then(async () => {
            assertCurrent(owner);
            if (cleanupId !== cleanupSequence) throw new Superseded();
            await dependencies.accountLocal?.cleanupMarker.clear();
            if (cleanupId === cleanupSequence) accountCleanupRequired = false;
          });
        cleanupMarkerQueue = clearing;
        await clearing;
      } catch {
        throw new AccountCleanupError();
      }
    });
  };

  const finishAccountCleanup = async (owner: number) => {
    try {
      const pending = await dependencies.accountLocal?.cleanupMarker.load();
      assertCurrent(owner);
      if (pending || accountCleanupRequired) await clearAccount(owner, 'sign-out');
    } catch (error) {
      if (error instanceof Superseded) throw error;
      throw new AccountCleanupError();
    }
  };

  const failSession = async (
    owner: number,
    message: string,
    status: 'signed-out' | 'error' = 'signed-out',
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
    }
  };

  const adoptCookie = async (response: FetchResponse, owner: number) => {
    assertCurrent(owner);
    let next: string | null | undefined;
    try {
      next = readSessionCookie(response.headers, secureTransport, now());
    } catch {
      await failSession(owner, storageMessage, 'error');
      throw new Superseded();
    }
    if (next === undefined) return;
    if (next === null) {
      await failSession(owner, expiredMessage);
      throw new Superseded();
    }
    if (next === cookie) return;
    try {
      await store(owner, () => dependencies.credentials.save(next));
      assertCurrent(owner);
      cookie = next;
    } catch (error) {
      if (!(error instanceof Superseded)) await failSession(owner, storageMessage, 'error');
      throw new Superseded();
    }
  };

  const request = async (
    path: string,
    owner: number,
    options: {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      revision?: number;
      body?: unknown;
      sessionCookie?: string | null;
      logout?: boolean;
      serializedBody?: string;
      idempotencyKey?: string;
    } = {},
  ): Promise<unknown> => {
    assertCurrent(owner);
    const abort = new AbortController();
    requests.add(abort);
    const timeout = setTimeout(() => abort.abort(), 20_000);
    let received = false;
    try {
      const outgoingCookie = options.sessionCookie === undefined ? cookie : options.sessionCookie;
      const response = await dependencies.fetch(`${apiBase}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Origin: authOrigin,
          ...(options.body === undefined && options.serializedBody === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
          ...(options.revision === undefined ? {} : { 'If-Match': String(options.revision) }),
          ...(outgoingCookie ? { Cookie: outgoingCookie } : {}),
        },
        credentials: 'omit',
        redirect: 'error',
        signal: abort.signal,
        ...(options.serializedBody === undefined
          ? options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }
          : { body: options.serializedBody }),
      });
      received = true;
      assertCurrent(owner);
      // Logout responses must never reinstall a cookie, even a surprising one.
      if (!options.logout) await adoptCookie(response, owner);
      assertCurrent(owner);
      if (response.status === 401 && !options.logout) {
        await failSession(owner, expiredMessage);
        throw new Superseded();
      }
      if (!response.ok) {
        const deniedGroup = /^\/api\/groups\/([a-f\d]{24})(?:\/|\?|$)/i.exec(path)?.[1];
        if (
          (response.status === 403 ||
            (response.status === 404 && path === `/api/groups/${deniedGroup}`)) &&
          deniedGroup
        ) {
          cacheEpoch += 1;
          evictGroupContent(deniedGroup, response.status);
          const lease = accountStorage();
          if (lease && dependencies.readCache) {
            try {
              await lease.write(() =>
                dependencies.readCache!.invalidateGroup(lease.accountId, deniedGroup),
              );
            } catch (error) {
              if (!current(owner) || error instanceof Superseded) throw error;
              await signOut();
              throw new Superseded();
            }
          }
        }
        const message =
          response.status === 403
            ? 'You no longer have access to this group.'
            : response.status === 404
              ? 'This group is no longer available.'
              : response.status === 429
                ? 'Too many attempts. Wait a moment and try again.'
                : 'The server could not complete this request. Please try again.';
        const details: unknown = await response.json().catch(() => null);
        const code =
          details &&
          typeof details === 'object' &&
          'code' in details &&
          typeof details.code === 'string'
            ? details.code
            : null;
        throw new RequestError(message, response.status, code);
      }
      const body = await response.json();
      assertCurrent(owner);
      return body;
    } catch (error) {
      if (!current(owner)) throw new Superseded();
      if (error instanceof RequestError || error instanceof Superseded) throw error;
      throw new RequestError(
        'Could not reach SplitBook. Check your connection and try again.',
        0,
        null,
        !received,
      );
    } finally {
      clearTimeout(timeout);
      requests.delete(abort);
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

  /** Explicitly opt in display reads only; request() and every mutation stay live. */
  const readCached = async <T>(
    path: string,
    owner: number,
    parse: (value: unknown) => T,
  ): Promise<T> => {
    const lease = accountStorage(),
      view = viewRequest,
      epoch = cacheEpoch;
    try {
      if (offlineSession || snapshot.offline.active) await revalidateSession(owner);
      const value = await request(path, owner);
      const parsed = parse(value);
      if (lease && dependencies.readCache) {
        try {
          await lease.write(async () => {
            if (epoch !== cacheEpoch) throw new Superseded();
            await dependencies.readCache!.save(lease.accountId, path, {
              version: 1,
              accountId: lease.accountId,
              path,
              refreshedAt: now(),
              value,
            });
          });
        } catch (error) {
          if (!current(owner) || error instanceof Superseded) throw error;
          publish({
            ...snapshot,
            offline: {
              ...snapshot.offline,
              message: 'Could not save this view for offline use. Online data is still available.',
            },
          });
        }
      }
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
      if (epoch !== cacheEpoch) throw new Superseded();
      const stored = await lease.write(() => dependencies.readCache!.load(lease.accountId, path));
      const cached = cachedRead(stored, lease.accountId, path, now());
      if (!current(owner) || epoch !== cacheEpoch) throw new Superseded();
      if (view === viewRequest) {
        offlineSession = true;
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

  const restoreOffline = async (owner: number) => {
    if (
      !cookie ||
      !dependencies.accountLocal ||
      !dependencies.offlineIdentity ||
      !dependencies.readCache
    )
      return false;
    try {
      const accountId = await dependencies.accountLocal.owner.load();
      const session = parseSession(await dependencies.offlineIdentity.load());
      assertCurrent(owner);
      if (!session || session.user.id !== accountId || session.expiresAt.getTime() <= now())
        return false;
      offlineSession = true;
      publish({
        ...cleanSnapshot({ status: 'authenticated', user: session.user, message: null }),
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

  const loadGroups = async (owner: number) => {
    assertCurrent(owner);
    const view = ++viewRequest;
    startReadView();
    publish({
      ...snapshot,
      screen: 'groups',
      groups: { status: 'loading', data: snapshot.groups.data, message: null },
      detail: { status: 'idle', id: null, data: null, message: null },
    });
    try {
      const groups = await readCached('/api/groups', owner, parseGroups);
      assertCurrent(owner);
      if (view !== viewRequest) return;
      // Do not display a malformed server response as somebody else's groups.
      if (
        !groups.every((group) =>
          group.members.some((member) => member.user.id === snapshot.auth.user?.id),
        )
      ) {
        throw new RequestError('The server returned invalid group membership. Please refresh.');
      }
      const lease = accountStorage();
      if (lease && dependencies.readCache && !staleReads.has('/api/groups')) {
        cacheEpoch += 1;
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
        if (!current(owner) || view !== viewRequest) return;
      }
      publish({ ...snapshot, groups: { status: 'ready', data: groups, message: null } });
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      publish({
        ...snapshot,
        groups: {
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
    const session = parseSession(await request('/api/auth/get-session', owner));
    assertCurrent(owner);
    if (!session || session.expiresAt.getTime() <= now()) {
      await failSession(owner, expiredMessage);
      return;
    }
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
    publish(cleanSnapshot({ status: 'authenticated', user: session.user, message: null }));
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

  const refreshHome = async () => {
    if (snapshot.auth.status !== 'authenticated') return;
    const owner = generation;
    const read = ++homeRequest;
    publish({ ...snapshot, home: { status: 'loading', data: null, message: null } });
    try {
      const data = await readCached('/api/user/balances', owner, parseHomeBalances);
      if (!current(owner) || read !== homeRequest) return;
      publish({ ...snapshot, home: { status: 'ready', data, message: null } });
    } catch (error) {
      if (!current(owner) || read !== homeRequest || error instanceof Superseded) return;
      publish({
        ...snapshot,
        home: {
          status: error instanceof RequestError && error.status === 403 ? 'denied' : 'error',
          data: null,
          message:
            error instanceof RequestError
              ? error.message
              : 'Could not load your balances. Please try again.',
        },
      });
    }
  };

  const restore = async () => {
    const owner = invalidate();
    publish(cleanSnapshot({ status: 'restoring', user: null, message: null }));
    try {
      await finishAccountCleanup(owner);
      if (!config.developmentPersonaEnabled) {
        await clearSaved(owner);
        publish(cleanSnapshot({ status: 'signed-out', user: null, message: disabledMessage }));
        return;
      }
      if (cleanupRequired) await clearSaved(owner);
      await loadPending();
      assertCurrent(owner);
      const saved = await store(owner, () => dependencies.credentials.load());
      if (!saved) {
        publish(cleanSnapshot({ status: 'signed-out', user: null, message: null }));
        if (pendingCode) await previewInvitation(pendingCode);
        return;
      }
      if (!validSessionCookie(saved, secureTransport)) {
        await failSession(owner, 'Your saved session could not be restored. Please sign in again.');
        return;
      }
      cookie = saved;
      await verifyAndLoad(owner);
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      if (error instanceof RequestError && error.networkFailure && (await restoreOffline(owner)))
        return;
      publish(
        cleanSnapshot({
          status: 'error',
          user: null,
          message:
            error instanceof RequestError || error instanceof AccountCleanupError
              ? error.message
              : 'Could not restore your session. Please try again.',
        }),
      );
    }
  };

  const signIn = async (personaId: string) => {
    const owner = invalidate();
    publish(cleanSnapshot({ status: 'signing-in', user: null, message: null }));
    try {
      await finishAccountCleanup(owner);
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
      await failSession(owner, message);
    }
  };

  const openGroup = async (id: string) => {
    if (snapshot.auth.status !== 'authenticated') return;
    const owner = generation;
    const previousMonth = snapshot.financial.groupId === id ? snapshot.financial.month : undefined;
    const verified = snapshot.detail.id === id ? snapshot.detail.data : null;
    const view = ++viewRequest;
    startReadView();
    publish({
      ...snapshot,
      screen: 'group',
      share: { status: 'idle', url: null, message: null },
      detail: { status: 'loading', id, data: verified, message: null },
      financial: { ...emptyFinancial(), groupId: id },
    });
    try {
      if (!objectId.safeParse(id).success)
        throw new RequestError('This group is no longer available.', 404);
      const group = await readCached(`/api/groups/${id}`, owner, parseGroup);
      assertCurrent(owner);
      if (view !== viewRequest) return;
      if (
        group.id !== id ||
        !group.members.some((member) => member.user.id === snapshot.auth.user?.id)
      ) {
        throw new RequestError('You no longer have access to this group.', 403);
      }
      publish({
        ...snapshot,
        detail: { status: 'ready', id, data: group, message: null },
        financial: {
          ...snapshot.financial,
          month:
            group.category === 'home'
              ? previousMonth === undefined
                ? currentMonthKey(new Date(now()))
                : previousMonth
              : null,
        },
      });
      await refreshExpenses();
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      if (dropDeniedGroup(id, error)) return;
      publish({
        ...snapshot,
        detail: {
          status: error instanceof RequestError && error.status === 403 ? 'denied' : 'error',
          id,
          data: verified,
          message:
            error instanceof RequestError
              ? error.message
              : 'The server returned invalid group data. Please try again.',
        },
      });
    }
  };

  const evictGroupContent = (id: string, status: number) => {
    const message =
      status === 403
        ? 'You no longer have access to this group.'
        : 'This group is no longer available.';
    homeRequest += 1;
    publish({
      ...snapshot,
      groups: { ...snapshot.groups, data: snapshot.groups.data.filter((group) => group.id !== id) },
      home: { status: 'idle', data: null, message: null },
      detail:
        snapshot.detail.id === id
          ? { ...snapshot.detail, data: null, status: status === 403 ? 'denied' : 'error', message }
          : snapshot.detail,
      financial: snapshot.financial.groupId === id ? emptyFinancial() : snapshot.financial,
      activity:
        snapshot.activity.groupId === id
          ? { ...emptyActivity(), groupId: id, status: 'denied', message }
          : snapshot.activity,
      expense:
        snapshot.expense.groupId === id ? { ...snapshot.expense, context: null } : snapshot.expense,
      settlement:
        snapshot.settlement.groupId === id
          ? { ...snapshot.settlement, group: null, balances: [], history: [] }
          : snapshot.settlement,
    });
  };

  const dropDeniedGroup = (id: string, error: unknown): boolean => {
    if (!(error instanceof RequestError) || ![403, 404].includes(error.status)) return false;
    viewRequest += 1;
    homeRequest += 1;
    publish({
      ...snapshot,
      groups: { ...snapshot.groups, data: snapshot.groups.data.filter((group) => group.id !== id) },
      detail: {
        status: error.status === 403 ? 'denied' : 'error',
        id,
        data: null,
        message: error.message,
      },
      financial: emptyFinancial(),
      activity:
        snapshot.activity.groupId === id
          ? { ...emptyActivity(), groupId: id, status: 'denied', message: error.message }
          : snapshot.activity,
      home: { status: 'idle', data: null, message: null },
      share: { status: 'idle', url: null, message: null },
    });
    return true;
  };

  const refreshBalances = async () => {
    const group = snapshot.detail.data;
    if (snapshot.auth.status !== 'authenticated' || snapshot.screen !== 'group' || !group) return;
    const owner = generation;
    const view = viewRequest;
    if (
      snapshot.financial.expenses.status === 'loading' ||
      snapshot.financial.expenses.moreStatus === 'loading'
    )
      return;
    const read = ++balancesRequest;
    publish({
      ...snapshot,
      financial: {
        ...snapshot.financial,
        balances: { status: 'loading', data: null, message: null },
      },
    });
    try {
      const data = await readCached(`/api/groups/${group.id}/balances`, owner, parseGroupBalances);
      if (!current(owner) || view !== viewRequest || read !== balancesRequest) return;
      publish({
        ...snapshot,
        financial: { ...snapshot.financial, balances: { status: 'ready', data, message: null } },
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
            status: 'error',
            data: null,
            message:
              error instanceof RequestError
                ? error.message
                : 'Could not load running balances. Please try again.',
          },
        },
      });
    }
  };

  const expensePath = (groupId: string, category: string, month: string | null, page: number) => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (category === 'home') {
      params.set('includeMemberBreakdown', '1');
      if (month) {
        const { dateFrom, dateTo } = getLocalMonthIsoRange(month);
        params.set('dateFrom', dateFrom);
        params.set('dateTo', dateTo);
      }
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
    publish({ ...snapshot, financial: { ...snapshot.financial, month } });
    await refreshExpenses();
  };

  const beginExpenseRead = () => {
    // Expense reads can materialize due recurring entries. Older Home responses
    // no longer describe the same ledger, even while the Group read is pending.
    homeRequest += 1;
    balancesRequest += 1;
    publish({
      ...snapshot,
      home: { status: 'idle', data: null, message: null },
      financial: {
        ...snapshot.financial,
        balances: { status: 'loading', data: null, message: null },
      },
    });
  };

  const readExpenses = async (append: boolean) => {
    const group = snapshot.detail.data;
    if (snapshot.auth.status !== 'authenticated' || snapshot.screen !== 'group' || !group) return;
    const expenses = snapshot.financial.expenses;
    const pagination = expenses.pagination;
    let pageNumber = 1;
    if (append) {
      if (
        expenses.status !== 'ready' ||
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
    beginExpenseRead();
    publish({
      ...snapshot,
      financial: {
        ...snapshot.financial,
        expenses: append
          ? { ...expenses, moreStatus: 'loading', moreMessage: null }
          : { ...emptyFinancial().expenses, status: 'loading' },
      },
    });
    try {
      const page = await readCached(
        expensePath(group.id, group.category, snapshot.financial.month, pageNumber),
        owner,
        (value) => parseExpensePage(value, group.id, group.defaultCurrency),
      );
      if (!current(owner) || view !== viewRequest || read !== financialRequest) return;
      if (page.pagination.page !== pageNumber) throw new Error('Unexpected expense page.');
      const existing = append ? expenses.data : [];
      const seen = new Set(existing.map((expense) => expense.id));
      publish({
        ...snapshot,
        financial: {
          ...snapshot.financial,
          expenses: {
            status: 'ready',
            data: [...existing, ...page.expenses.filter((expense) => !seen.has(expense.id))],
            summary: page.summary,
            pagination: page.pagination,
            message: null,
            moreStatus: 'idle',
            moreMessage: null,
          },
        },
      });
      await refreshBalances();
    } catch (error) {
      if (
        !current(owner) ||
        view !== viewRequest ||
        read !== financialRequest ||
        error instanceof Superseded
      )
        return;
      if (dropDeniedGroup(group.id, error)) return;
      publish({
        ...snapshot,
        financial: {
          ...snapshot.financial,
          balances: {
            status: 'error',
            data: null,
            message: 'Could not update running balances. Please try again.',
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
                ...emptyFinancial().expenses,
                status: 'error',
                message:
                  error instanceof RequestError
                    ? error.message
                    : 'Could not load expenses. Please try again.',
              },
        },
      });
    }
  };

  const refreshExpenses = () => readExpenses(false);
  const loadMoreExpenses = () => readExpenses(true);

  const readActivity = async (append: boolean) => {
    const previous = snapshot.activity,
      groupId = previous.groupId;
    if (snapshot.auth.status !== 'authenticated' || snapshot.screen !== 'activity' || !groupId)
      return;
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
      const page = await readCached(
        `/api/groups/${groupId}/activity?page=${pageNumber}&limit=20`,
        owner,
        (value) => parseActivityPage(value, groupId, pageNumber),
      );
      if (!current(owner) || view !== viewRequest || read !== activityRequest) return;
      const events = [
        ...new Map(
          [...(append ? previous.events : []), ...page.events].map((event) => [event._id, event]),
        ).values(),
      ];
      publish({
        ...snapshot,
        activity: {
          ...snapshot.activity,
          events,
          pagination: page.pagination,
          status: 'ready',
          moreStatus: 'idle',
          message: null,
        },
      });
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
  const openActivity = async (groupId: string) => {
    if (snapshot.auth.status !== 'authenticated' || expenseNavigationBlocked()) return;
    viewRequest += 1;
    startReadView();
    publish({ ...snapshot, screen: 'activity', activity: { ...emptyActivity(), groupId } });
    await readActivity(false);
  };
  const refreshActivity = () => readActivity(false);
  const loadMoreActivity = () => readActivity(true);

  const selectActivity = async (eventId: string) => {
    const activity = snapshot.activity;
    if (
      snapshot.screen !== 'activity' ||
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
      const expenseId = event.type.startsWith('expense_') ? event.metadata.expenseId : undefined;
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

  const expenseNavigationBlocked = () =>
    (snapshot.screen === 'expense' &&
      (snapshot.expense.status === 'saving' || snapshot.expense.persistence !== 'saved')) ||
    (snapshot.screen === 'settlement' && snapshot.settlement.status === 'saving');

  const openExpense = async (groupId: string, expenseId?: string) => {
    if (snapshot.auth.status !== 'authenticated' || !snapshot.auth.user) return;
    const owner = generation;
    const view = ++viewRequest;
    const accountId = snapshot.auth.user.id;
    const month = snapshot.financial.groupId === groupId ? snapshot.financial.month : null;
    startReadView();
    publish({
      ...snapshot,
      screen: 'expense',
      expense: {
        ...emptyExpenseEditor(),
        groupId,
        requestedExpenseId: expenseId ?? null,
        status: 'loading',
      },
    });
    try {
      const lease = accountStorage();
      if (!lease || !dependencies.expenseDrafts) throw new Error('Draft storage is unavailable.');
      const stored = await lease.write(() => dependencies.expenseDrafts!.load(accountId, groupId));
      const record = stored === null ? null : parseStoredExpenseDraft(stored, accountId, groupId);
      if (!current(owner) || view !== viewRequest) return;
      if (record)
        publish({
          ...snapshot,
          expense: {
            ...snapshot.expense,
            draft: record.draft,
            attempt: record.attempt,
            mutation: record.mutation,
            preview: previewExpense(record.draft),
            status: 'loading',
          },
        });
      const context = await readCached(`/api/groups/${groupId}`, owner, parseExpenseContext);
      if (!current(owner) || view !== viewRequest) return;
      if (
        context.group.id !== groupId ||
        !context.group.members.some((member) => member.user.id === accountId)
      )
        throw new RequestError('You no longer have access to this Group.', 403);
      const original =
        record === null && expenseId
          ? await readCached(`/api/groups/${groupId}/expenses/${expenseId}`, owner, (value) =>
              parseExpenseRecord(value, groupId, expenseId),
            )
          : null;
      if (!current(owner) || view !== viewRequest) return;
      const draft: ExpenseDraft = original
        ? draftFromExpense(original)
        : record === null
          ? {
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
            }
          : record.draft;
      publish({
        ...snapshot,
        expense: {
          groupId,
          context,
          draft,
          preview: previewExpense(draft),
          status: stored === null ? (original ? 'detail' : 'editing') : 'resume',
          attempt: record?.attempt ?? null,
          mutation: record?.mutation ?? null,
          latest: null,
          requestedExpenseId: expenseId ?? null,
          receiptId: null,
          persistence: 'saved',
          message:
            record && record.draft.original?._id !== expenseId
              ? 'This Group already has an unfinished Expense draft. Resume it, or explicitly discard it before opening another Expense.'
              : null,
        },
      });
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

  const resumeExpenseDraft = () => {
    if (snapshot.screen !== 'expense' || snapshot.expense.status !== 'resume') return;
    publish({
      ...snapshot,
      expense: {
        ...snapshot.expense,
        status: snapshot.expense.attempt || snapshot.expense.mutation ? 'uncertain' : 'editing',
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
    const draft = {
      ...snapshot.expense.draft,
      ...patch,
      ...(patch.splitMethod && patch.splitMethod !== snapshot.expense.draft.splitMethod
        ? { splitValues: {} }
        : {}),
    };
    publish({
      ...snapshot,
      expense: {
        ...snapshot.expense,
        draft,
        preview: previewExpense(draft),
        persistence: 'saving',
        message: null,
      },
    });
    try {
      await lease.write(() =>
        storage.save(lease.accountId, groupId, {
          version: 1,
          accountId: lease.accountId,
          groupId,
          draft,
        }),
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

  const refreshLedgerViews = async (groupId: string, owner: number, navigate: boolean) => {
    if (navigate || (snapshot.screen === 'group' && snapshot.detail.id === groupId))
      await openGroup(groupId);
    if (current(owner)) await refreshHome();
  };

  const editExpense = async () => {
    const editor = snapshot.expense;
    if (
      snapshot.screen !== 'expense' ||
      editor.status !== 'detail' ||
      !editor.draft?.original ||
      !canEditExpense(editor.draft.original)
    )
      return;
    publish({ ...snapshot, expense: { ...editor, status: 'editing' } });
    await updateExpenseDraft({});
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
            : 'Review the current saved record beside your draft. Nothing will be sent until you choose and save again.',
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
    const draft = { ...editor.draft, original: editor.latest };
    publish({ ...snapshot, expense: { ...editor, persistence: 'saving' } });
    try {
      await lease.write(() =>
        storage.save(lease.accountId, editor.groupId!, {
          version: 1,
          accountId: lease.accountId,
          groupId: editor.groupId,
          draft,
        }),
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
          message:
            'Your draft is ready for review against the current revision. Check every field before saving.',
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
      editor.persistence !== 'saved' ||
      !original ||
      !draft ||
      !groupId ||
      !lease ||
      !storage ||
      editor.mutation
    )
      return;
    const owner = generation,
      view = viewRequest;
    let mutation: MobileSnapshot['expense']['mutation'] = editor.mutation;
    let completed = false;
    let refreshed = false;
    publish({ ...snapshot, expense: { ...editor, status: 'saving', message: null } });
    try {
      const context = parseExpenseContext(await request(`/api/groups/${groupId}`, owner));
      if (!current(owner) || view !== viewRequest) return;
      if (
        context.group.id !== groupId ||
        !context.group.members.some((member) => member.user.id === lease.accountId)
      )
        throw new RequestError('You no longer have access to this Group.', 403);
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
      const response = await request(`/api/groups/${groupId}/expenses/${original._id}`, owner, {
        method: kind === 'edit' ? 'PATCH' : 'DELETE',
        revision: mutation.revision,
        ...(kind === 'edit' ? { serializedBody: mutation.body } : {}),
      });
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
          message: error instanceof Error ? error.message : 'Could not update this Expense.',
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
      !['editing', 'uncertain'].includes(editor.status) ||
      !editor.draft ||
      !editor.groupId ||
      !lease ||
      !storage
    )
      return;
    const owner = generation;
    const view = viewRequest;
    const { groupId, draft } = editor;
    publish({ ...snapshot, expense: { ...editor, status: 'saving', message: null } });
    let attempt = editor.attempt;
    let storing = false;
    let resolvedReceipt: string | null = null;
    let successHandled = false;
    try {
      // A successful authorized read is a connection/access check, never proof a write will succeed.
      const context = parseExpenseContext(await request(`/api/groups/${groupId}`, owner));
      if (!current(owner) || view !== viewRequest) return;
      if (
        context.group.id !== groupId ||
        !context.group.members.some((member) => member.user.id === lease.accountId)
      )
        throw new RequestError('You no longer have access to this Group.', 403);
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
        await request(`/api/groups/${groupId}/expenses`, owner, {
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
          draft: null,
          preview: null,
          message: 'Expense saved.',
        },
      });
      successHandled = true;
      await refreshLedgerViews(groupId, owner, true);
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      const rejection = expenseRejectionMessage(error);
      if (attempt && rejection) {
        try {
          await lease.write(() =>
            storage.save(lease.accountId, groupId, {
              version: 1,
              accountId: lease.accountId,
              groupId,
              draft,
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
      if (!current(owner) || view !== viewRequest) return;
      publish({
        ...snapshot,
        expense: {
          ...snapshot.expense,
          attempt,
          persistence: storing ? 'error' : snapshot.expense.persistence,
          status: attempt ? 'uncertain' : 'editing',
          message: storing
            ? 'Could not save the submission on this device. No Expense was sent. Retry local storage before saving.'
            : attempt
              ? `${error instanceof RequestError ? `${error.message} ` : ''}This Expense may already be saved. Retry this same submission to confirm it; its amount and participants are locked until then.`
              : error instanceof RequestError || error instanceof MoneyValidationError
                ? error.message
                : 'Check the amount, date, participants, currency, and active Tag. Your draft is still here.',
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
  const openSettlements = async (groupId: string) => {
    if (snapshot.auth.status !== 'authenticated') return;
    const owner = generation,
      view = ++viewRequest,
      lease = accountStorage(),
      storage = dependencies.settlementAttempts;
    publish({
      ...snapshot,
      screen: 'settlement',
      settlement: { ...emptySettlement(), groupId, status: 'loading' },
    });
    try {
      if (!lease || !storage) throw new Error('Payment recovery storage is unavailable.');
      const stored = await lease.write(() => storage.load(lease.accountId, groupId));
      const recovery =
        stored === null ? null : parseSettlementAttempt(stored, lease.accountId, groupId);
      if (!current(owner) || view !== viewRequest) return;
      if (recovery) publish({ ...snapshot, settlement: { ...snapshot.settlement, ...recovery } });
      const context = await settlementContext(groupId, owner);
      const history = parseSettlementHistory(
        await request(`/api/groups/${groupId}/settlements`, owner),
        groupId,
      );
      if (!current(owner) || view !== viewRequest) return;
      publish({
        ...snapshot,
        settlement: {
          ...snapshot.settlement,
          ...context,
          history,
          status: recovery ? 'uncertain' : 'ready',
          message: recovery
            ? 'A payment record is unresolved. Check the history, then explicitly retry the same submission to confirm it.'
            : null,
        },
      });
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
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
          message:
            error instanceof RequestError
              ? error.message
              : 'Could not load payments. Reconnect and retry; retained submissions are unchanged.',
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
    publish({
      ...snapshot,
      settlement: {
        ...state,
        status: 'editing',
        draft: { ...state.draft, ...patch },
        acknowledged: false,
        message: null,
      },
    });
  };
  const reviewSettlement = async () => {
    const state = snapshot.settlement,
      lease = accountStorage();
    if (
      snapshot.screen !== 'settlement' ||
      !['editing', 'review'].includes(state.status) ||
      !state.draft ||
      !state.groupId ||
      state.attempt ||
      !lease
    )
      return;
    const owner = generation,
      view = viewRequest;
    publish({ ...snapshot, settlement: { ...state, status: 'loading', message: null } });
    try {
      settlementBody(state.draft);
      const context = await settlementContext(state.groupId, owner);
      assertSettlementMembers(
        new Set(context.group.members.map((m) => m.user.id)),
        state.draft.paidBy,
        state.draft.paidTo,
      );
      assertSettlementAuthorization(lease.accountId, state.draft.paidBy, state.draft.paidTo);
      assertGroupCurrency(context.group.defaultCurrency, state.draft.currency);
      if (!current(owner) || view !== viewRequest) return;
      const suggested = settlementSuggestion(context.balances, state.draft);
      publish({
        ...snapshot,
        settlement: {
          ...state,
          ...context,
          status: 'review',
          suggested,
          acknowledged: false,
          message:
            suggested !== state.suggested
              ? 'The suggested debt changed. Review the current suggestion and your actual payment.'
              : null,
        },
      });
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      publish({
        ...snapshot,
        settlement: {
          ...state,
          status:
            error instanceof RequestError && [403, 404].includes(error.status)
              ? 'blocked'
              : 'editing',
          message:
            error instanceof Error
              ? error.message
              : 'Could not review this payment. Reconnect and retry.',
        },
      });
    } finally {
      if (
        current(owner) &&
        view !== viewRequest &&
        snapshot.settlement.draft === state.draft &&
        snapshot.settlement.status === 'loading'
      )
        publish({
          ...snapshot,
          settlement: {
            ...snapshot.settlement,
            status: 'editing',
            acknowledged: false,
            message: 'Your payment details are kept. Review again before recording.',
          },
        });
    }
  };

  const acknowledgeSettlement = () => {
    if (
      snapshot.screen === 'settlement' &&
      snapshot.settlement.status === 'review' &&
      !snapshot.settlement.attempt
    )
      publish({ ...snapshot, settlement: { ...snapshot.settlement, acknowledged: true } });
  };
  const recordSettlement = async () => {
    const state = snapshot.settlement,
      lease = accountStorage(),
      storage = dependencies.settlementAttempts;
    if (
      snapshot.screen !== 'settlement' ||
      !['review', 'uncertain'].includes(state.status) ||
      !state.draft ||
      !state.groupId ||
      !lease ||
      !storage
    )
      return;
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
        if (suggested !== state.suggested) {
          publish({
            ...snapshot,
            settlement: {
              ...state,
              ...context,
              suggested,
              status: 'review',
              acknowledged: false,
              message:
                'The suggested debt changed. Review this amount before recording your actual payment.',
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
        await lease.write(() => storage.save(lease.accountId, groupId, value));
        attempt = pending;
      }
      if (!current(owner) || view !== viewRequest) return;
      publish({ ...snapshot, settlement: { ...snapshot.settlement, attempt } });
      const response = await request(`/api/groups/${groupId}/settlements`, owner, {
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
      if (!current(owner) || view !== viewRequest) return;
      const refreshing = openSettlements(groupId);
      const refreshView = viewRequest;
      await refreshing;
      if (
        current(owner) &&
        viewRequest === refreshView &&
        snapshot.screen === 'settlement' &&
        snapshot.settlement.groupId === groupId
      )
        publish({
          ...snapshot,
          settlement: {
            ...snapshot.settlement,
            message:
              snapshot.settlement.status === 'ready'
                ? 'Payment recorded. The refreshed balances show what remains; no money was transferred by SplitBook.'
                : `Payment recorded. ${snapshot.settlement.message ?? 'Could not refresh payments.'} Use Refresh payments to check the current result.`,
          },
        });
    } catch (error) {
      if (!current(owner) || error instanceof Superseded) return;
      const correctionCodes: Record<string, string> = {
        CURRENCY_MISMATCH:
          'The Group currency changed. Return to payments and review the available currency.',
        INVALID_MEMBERS:
          'The payer or recipient is no longer a Group member. Review the available payments.',
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
            ? 'This payment cannot be recorded with the current access or details. Any unresolved submission is retained; check the history and refresh access before continuing.'
            : attempt
              ? 'The payment may already be recorded. Retry this exact submission to confirm it; it cannot be edited.'
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
              ? 'Payment recorded. Refresh payments to see current balances.'
              : 'Your entries are retained. Review or explicitly retry after reconnecting.',
          },
        });
      if (current(owner) && completed) await refreshLedgerViews(groupId, owner, false);
    }
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

  const loadInviteLink = async (): Promise<string | null> => {
    if (
      snapshot.auth.status !== 'authenticated' ||
      snapshot.detail.status !== 'ready' ||
      !snapshot.detail.id ||
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
      const id = parseJoinedGroup(await request(`/api/join/${code}`, owner, { method: 'POST' }));
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

  const cancelInvitation = async () => {
    const view = ++viewRequest;
    const owner = generation;
    publish({
      ...snapshot,
      screen: 'groups',
      detail: { status: 'idle', id: null, data: null, message: null },
      financial: emptyFinancial(),
      invitation: { code: null, status: 'idle', preview: null, message: null },
    });
    try {
      await savePending(null);
      if (current(owner) && view === viewRequest) await refreshHome();
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
    publish({
      ...snapshot,
      creation: { ...snapshot.creation, draft: { ...snapshot.creation.draft, ...patch } },
    });
  };

  const createGroup = async () => {
    if (
      snapshot.auth.status !== 'authenticated' ||
      ['saving', 'uncertain'].includes(snapshot.creation.status)
    )
      return;
    const owner = generation;
    const view = viewRequest;
    const draft = snapshot.creation.draft;
    const bounded = getGroupTheme(draft.category).dates === 'bounded';
    if (
      bounded &&
      [draft.startDate, draft.endDate].some((value) => {
        if (!value) return false;
        const date = new Date(value);
        return (
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== value
        );
      })
    ) {
      publish({
        ...snapshot,
        creation: {
          ...snapshot.creation,
          status: 'error',
          message: 'Enter valid Trip dates as YYYY-MM-DD.',
        },
      });
      return;
    }
    const payload = createGroupSchema.safeParse({
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      alternateCurrencies: [],
      startDate: bounded && draft.startDate ? draft.startDate : null,
      endDate: bounded && draft.endDate ? draft.endDate : null,
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
    publish({ ...snapshot, creation: { ...snapshot.creation, status: 'saving', message: null } });
    try {
      const group = parseCreatedGroup(
        await request('/api/groups', owner, {
          method: 'POST',
          body: payload.data,
        }),
      );
      assertCurrent(owner);
      if (
        !group.members.some(
          (member) => member.user.id === snapshot.auth.user?.id && member.role === 'admin',
        )
      )
        throw new RequestError('The server returned invalid creator membership.');
      publish({
        ...snapshot,
        creation: cleanSnapshot(snapshot.auth).creation,
        groups: { status: 'ready', data: [group, ...snapshot.groups.data], message: null },
        ...(view === viewRequest
          ? ({
              screen: 'group',
              detail: { status: 'ready', id: group.id, data: group, message: null },
            } as const)
          : {}),
      });
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

  const discardCreation = () => {
    if (snapshot.creation.status === 'saving') return;
    publish({ ...snapshot, screen: 'groups', creation: cleanSnapshot(snapshot.auth).creation });
  };

  const back = () => {
    if (snapshot.screen === 'activity') {
      if (snapshot.activity.selected) return closeActivityDetail();
      if (snapshot.activity.groupId && snapshot.activity.status !== 'denied')
        return openGroup(snapshot.activity.groupId);
    }
    if (snapshot.screen === 'invite') {
      void cancelInvitation();
      return;
    }
    if (snapshot.creation.status === 'saving' || expenseNavigationBlocked()) return;
    viewRequest += 1;
    publish({
      ...snapshot,
      screen: 'groups',
      detail: { status: 'idle', id: null, data: null, message: null },
      financial: emptyFinancial(),
    });
    return refreshHome();
  };

  const refresh = async () => {
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
    if (snapshot.auth.status !== 'authenticated') return restore();
    if (snapshot.screen === 'activity') return refreshActivity();
    if (['create', 'invite', 'settings', 'expense', 'settlement'].includes(snapshot.screen)) {
      const owner = generation,
        view = viewRequest,
        screen = snapshot.screen;
      const groupId =
        screen === 'expense'
          ? snapshot.expense.groupId
          : screen === 'settlement'
            ? snapshot.settlement.groupId
            : null;
      try {
        try {
          await revalidateSession(owner);
        } catch (error) {
          if (!(error instanceof RequestError) || !error.networkFailure || !dependencies.readCache)
            throw error;
          offlineSession = true;
        }
        if (!current(owner) || view !== viewRequest) return;
        if (dependencies.readCache && groupId) {
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
        }
        publishReadFreshness();
        if (snapshot.screen === 'invite') await retryInvitation();
      } catch (error) {
        if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
        if (groupId && error instanceof RequestError && [403, 404].includes(error.status)) {
          dropDeniedGroup(groupId, error);
          if (screen === 'expense')
            publish({
              ...snapshot,
              expense: {
                ...snapshot.expense,
                status: 'blocked',
                context: null,
                message: error.message,
              },
            });
          else
            publish({
              ...snapshot,
              settlement: {
                ...snapshot.settlement,
                status: 'blocked',
                group: null,
                balances: [],
                history: [],
                message: error.message,
              },
            });
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
    if (snapshot.screen === 'group' && snapshot.detail.id) return openGroup(snapshot.detail.id);
    const owner = generation;
    await loadGroups(owner);
    if (current(owner)) await refreshHome();
  };

  const signOut = async () => {
    creationRecovery = null;
    const oldCookie = cookie;
    const owner = invalidate();
    publish(cleanSnapshot({ status: 'signed-out', user: null, message: null }));
    // Independent stores must both be purged. Wait for both attempts before
    // exposing recovery so a failed invitation clear cannot preserve a session.
    try {
      await clearAccount(owner, 'sign-out');
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
    if (!oldCookie || !current(owner)) return;
    try {
      await request('/api/auth/sign-out', owner, {
        method: 'POST',
        body: {},
        sessionCookie: oldCookie,
        logout: true,
      });
    } catch {
      if (current(owner)) {
        publish(
          cleanSnapshot({
            status: 'signed-out',
            user: null,
            message: 'Signed out on this device. The server could not confirm session revocation.',
          }),
        );
      }
    }
  };

  return {
    openActivity,
    selectActivity,
    closeActivityDetail,
    refreshActivity,
    loadMoreActivity,
    reviewExpenseDeletion,
    cancelExpenseDeletion,
    deleteExpense: () => saveExpenseEdit('delete'),
    reconcileExpense,
    reviewLatestExpense,
    acceptCurrentExpense,
    editExpense,
    discardExpenseDraft,
    saveExpense,
    openExpense,
    resumeExpenseDraft,
    updateExpenseDraft,
    restore,
    signIn,
    startCreate,
    openSettings,
    accountStorage,
    openSettlements,
    selectSettlement,
    updateSettlement,
    reviewSettlement,
    recordSettlement,
    acknowledgeSettlement,
    updateCreation,
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
