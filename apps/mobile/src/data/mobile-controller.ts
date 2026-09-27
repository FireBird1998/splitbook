import { readSessionCookie, validSessionCookie } from './cookies';
import { createGroupSchema } from '@splitbook/shared/validators/group';
import { getGroupTheme } from '@splitbook/shared/group-themes';
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

function monthDate(month: string): Date {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid Month.');
  const [year, number] = month.split('-').map(Number);
  return new Date(year, number - 1, 1);
}

export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonthKey(month: string, offset: number): string {
  const date = monthDate(month);
  date.setMonth(date.getMonth() + offset);
  return currentMonthKey(date);
}

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
  ) {
    super(message);
  }
}

function cleanSnapshot(auth: MobileSnapshot['auth']): MobileSnapshot {
  return {
    auth,
    screen: 'groups',
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
      method?: 'GET' | 'POST';
      body?: unknown;
      sessionCookie?: string | null;
      logout?: boolean;
    } = {},
  ): Promise<unknown> => {
    assertCurrent(owner);
    const abort = new AbortController();
    requests.add(abort);
    const timeout = setTimeout(() => abort.abort(), 20_000);
    try {
      const outgoingCookie = options.sessionCookie === undefined ? cookie : options.sessionCookie;
      const response = await dependencies.fetch(`${apiBase}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Origin: authOrigin,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(outgoingCookie ? { Cookie: outgoingCookie } : {}),
        },
        credentials: 'omit',
        redirect: 'error',
        signal: abort.signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      assertCurrent(owner);
      // Logout responses must never reinstall a cookie, even a surprising one.
      if (!options.logout) await adoptCookie(response, owner);
      assertCurrent(owner);
      if (response.status === 401 && !options.logout) {
        await failSession(owner, expiredMessage);
        throw new Superseded();
      }
      if (!response.ok) {
        const message =
          response.status === 403
            ? 'You no longer have access to this group.'
            : response.status === 404
              ? 'This group is no longer available.'
              : response.status === 429
                ? 'Too many attempts. Wait a moment and try again.'
                : 'The server could not complete this request. Please try again.';
        throw new RequestError(message, response.status);
      }
      const body = await response.json();
      assertCurrent(owner);
      return body;
    } catch (error) {
      if (!current(owner)) throw new Superseded();
      if (error instanceof RequestError || error instanceof Superseded) throw error;
      throw new RequestError('Could not reach SplitBook. Check your connection and try again.');
    } finally {
      clearTimeout(timeout);
      requests.delete(abort);
    }
  };

  const loadGroups = async (owner: number) => {
    assertCurrent(owner);
    const view = ++viewRequest;
    publish({
      ...snapshot,
      screen: 'groups',
      groups: { status: 'loading', data: [], message: null },
      detail: { status: 'idle', id: null, data: null, message: null },
    });
    try {
      const groups = parseGroups(await request('/api/groups', owner));
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
      publish({ ...snapshot, groups: { status: 'ready', data: groups, message: null } });
    } catch (error) {
      if (!current(owner) || view !== viewRequest || error instanceof Superseded) return;
      publish({
        ...snapshot,
        groups: {
          status: error instanceof RequestError && error.status === 403 ? 'denied' : 'error',
          data: [],
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
      const data = parseHomeBalances(await request('/api/user/balances', owner));
      if (!current(owner) || read !== homeRequest) return;
      publish({ ...snapshot, home: { status: 'ready', data, message: null } });
    } catch (error) {
      if (!current(owner) || read !== homeRequest || error instanceof Superseded) return;
      publish({
        ...snapshot,
        home: {
          status: error instanceof RequestError && error.status === 403 ? 'denied' : 'error',
          data: null,
          message: 'Could not load your balances. Please try again.',
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
    const view = ++viewRequest;
    publish({
      ...snapshot,
      screen: 'group',
      share: { status: 'idle', url: null, message: null },
      detail: { status: 'loading', id, data: null, message: null },
      financial: { ...emptyFinancial(), groupId: id },
    });
    try {
      if (!objectId.safeParse(id).success)
        throw new RequestError('This group is no longer available.', 404);
      const group = parseGroup(await request(`/api/groups/${id}`, owner));
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
          data: null,
          message:
            error instanceof RequestError
              ? error.message
              : 'The server returned invalid group data. Please try again.',
        },
      });
    }
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
      const data = parseGroupBalances(await request(`/api/groups/${group.id}/balances`, owner));
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
            message: 'Could not load running balances. Please try again.',
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
        const start = monthDate(month);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        params.set('dateFrom', start.toISOString());
        params.set('dateTo', new Date(end.getTime() - 1).toISOString());
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
    if (month !== null) monthDate(month);
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

  const refreshExpenses = async () => {
    const group = snapshot.detail.data;
    if (snapshot.auth.status !== 'authenticated' || snapshot.screen !== 'group' || !group) return;
    const owner = generation;
    const view = viewRequest;
    const read = ++financialRequest;
    beginExpenseRead();
    publish({
      ...snapshot,
      financial: {
        ...snapshot.financial,
        expenses: { ...emptyFinancial().expenses, status: 'loading' },
      },
    });
    try {
      const page = parseExpensePage(
        await request(expensePath(group.id, group.category, snapshot.financial.month, 1), owner),
        group.id,
        group.defaultCurrency,
      );
      if (!current(owner) || view !== viewRequest || read !== financialRequest) return;
      if (page.pagination.page !== 1) throw new Error('Unexpected expense page.');
      publish({
        ...snapshot,
        financial: {
          ...snapshot.financial,
          expenses: {
            status: 'ready',
            data: page.expenses,
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
          expenses: {
            ...emptyFinancial().expenses,
            status: 'error',
            message: 'Could not load expenses. Please try again.',
          },
        },
      });
    }
  };

  const loadMoreExpenses = async () => {
    const group = snapshot.detail.data;
    const expenses = snapshot.financial.expenses;
    const pagination = expenses.pagination;
    if (
      snapshot.auth.status !== 'authenticated' ||
      snapshot.screen !== 'group' ||
      !group ||
      expenses.status !== 'ready' ||
      expenses.moreStatus === 'loading' ||
      !pagination ||
      pagination.page >= pagination.totalPages
    )
      return;
    const owner = generation;
    const view = viewRequest;
    const read = ++financialRequest;
    beginExpenseRead();
    const nextPage = pagination.page + 1;
    publish({
      ...snapshot,
      financial: {
        ...snapshot.financial,
        expenses: { ...expenses, moreStatus: 'loading', moreMessage: null },
      },
    });
    try {
      const page = parseExpensePage(
        await request(
          expensePath(group.id, group.category, snapshot.financial.month, nextPage),
          owner,
        ),
        group.id,
        group.defaultCurrency,
      );
      if (!current(owner) || view !== viewRequest || read !== financialRequest) return;
      if (page.pagination.page !== nextPage) throw new Error('Unexpected expense page.');
      const seen = new Set(expenses.data.map((expense) => expense.id));
      publish({
        ...snapshot,
        financial: {
          ...snapshot.financial,
          expenses: {
            status: 'ready',
            data: [...expenses.data, ...page.expenses.filter((expense) => !seen.has(expense.id))],
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
          expenses: {
            ...snapshot.financial.expenses,
            moreStatus: 'error',
            moreMessage: 'Could not load more expenses. Please try again.',
          },
        },
      });
    }
  };

  const startCreate = () => {
    if (snapshot.auth.status !== 'authenticated') return;
    viewRequest += 1;
    publish({ ...snapshot, screen: 'create' });
  };

  const openSettings = () => {
    if (snapshot.auth.status !== 'authenticated') return;
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
      invitation: { code: null, status: 'idle', preview: null, message: null },
    });
    try {
      await savePending(null);
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
    if (snapshot.screen === 'invite') {
      void cancelInvitation();
      return;
    }
    if (snapshot.creation.status === 'saving') return;
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
    if (snapshot.creation.status === 'saving' || snapshot.invitation.status === 'joining') return;
    if (snapshot.screen === 'invite' && snapshot.auth.status !== 'authenticated')
      return retryInvitation();
    if (snapshot.auth.status !== 'authenticated') return restore();
    if (['create', 'invite', 'settings'].includes(snapshot.screen)) {
      const owner = generation;
      try {
        const session = parseSession(await request('/api/auth/get-session', owner));
        assertCurrent(owner);
        if (
          !session ||
          session.expiresAt.getTime() <= now() ||
          session.user.id !== snapshot.auth.user?.id
        ) {
          await failSession(owner, expiredMessage);
          return;
        }
        if (snapshot.screen === 'invite') await retryInvitation();
      } catch (error) {
        if (!current(owner) || error instanceof Superseded) return;
        if (snapshot.screen === 'create')
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
    restore,
    signIn,
    startCreate,
    openSettings,
    accountStorage,
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
