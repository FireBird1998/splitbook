import { createCheckedMobileController } from './flow-monitor';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { MobileDependencies } from '../data/types';
import { savedQueriesIn } from './saved-queries';

type StoreOperation = 'load' | 'save' | 'remove' | 'clear' | 'list' | 'keys' | 'mark';

/** Faults stop at the native storage boundary, before its atomic read or write. */
function faultable<T extends object>(store: T) {
  const next = new Map<string, (() => Promise<void>)[]>();
  const enqueue = (operation: StoreOperation, action: () => Promise<void>) => {
    const queue = next.get(operation) ?? [];
    queue.push(action);
    next.set(operation, queue);
  };
  for (const [operation, value] of Object.entries(store)) {
    if (typeof value !== 'function') continue;
    const call = value as (...args: unknown[]) => unknown;
    Object.defineProperty(store, operation, {
      enumerable: true,
      configurable: true,
      value: async (...args: unknown[]) => {
        await next.get(operation)?.shift()?.();
        return call.apply(store, args);
      },
    });
  }
  return Object.assign(store, {
    failNext(operation: StoreOperation, error = new Error('Fictional device storage failure')) {
      enqueue(operation, () => Promise.reject(error));
    },
    stallNext(operation: StoreOperation, until: Promise<void>) {
      enqueue(operation, () => until);
    },
    holdNext(operation: StoreOperation) {
      let arrive!: () => void, release!: () => void;
      const arrived = new Promise<void>((done) => {
        arrive = done;
      });
      const released = new Promise<void>((done) => {
        release = done;
      });
      enqueue(operation, () => {
        arrive();
        return released;
      });
      return { arrived, release };
    },
  });
}

/** Native cells clone at the boundary, as the persisted adapters do. */
function cell<T>(initial: T) {
  let value = structuredClone(initial);
  return faultable({
    get value() {
      return structuredClone(value);
    },
    load: async () => structuredClone(value),
    save: async (next: T) => {
      value = structuredClone(next);
    },
    clear: async () => {
      value = structuredClone(initial);
    },
  });
}
function records() {
  const rows = new Map<string, unknown>();
  return faultable({ records: rows, ...savedQueriesIn(rows) });
}

/** A phone owns its stores; reopening replaces only the app, never the phone's contents. */
export function testPhone(
  server: Pick<MobileDependencies, 'fetch'>,
  options: {
    now?: number;
    newSubmissionKey?: () => string;
    parts?: Partial<Omit<MobileDependencies, 'fetch'>>;
    monitor?: boolean;
  } = {},
) {
  const stores = {
    credentials: cell<string | null>(null),
    owner: cell<string | null>(null),
    cleanupMarker: {
      ...cell(false),
      async mark() {
        await this.save(true);
      },
    },
    signOutRecord: {
      ...cell<{ invitationCleared: boolean } | null>(null),
      async mark(value: { invitationCleared: boolean }) {
        await this.save(value);
      },
    },
    financialCleanup: cell<unknown>(null),
    untrustedCopies: cell<unknown>(null),
    offlineIdentity: cell<unknown>(null),
    pendingInvitation: cell<string | null>(null),
    savedQueries: records(),
    expenseDrafts: records(),
    settlementAttempts: records(),
    draftRequests: records(),
    tagRequests: records(),
    groupCreations: (() => {
      const rows = new Map<string, unknown>();
      return faultable({
        records: rows,
        load: async (account: string) => structuredClone(rows.get(account) ?? null),
        save: async (account: string, value: unknown) => {
          rows.set(account, structuredClone(value));
        },
        remove: async (account: string) => {
          rows.delete(account);
        },
        clear: async () => {
          rows.clear();
        },
      });
    })(),
  };
  const clock = { now: options.now ?? Date.now() };
  let online = true,
    key = 0,
    active: MobileController | undefined;
  const listeners = new Set<(state: { isConnected: boolean }) => void>();
  const parts = {
    credentials: stores.credentials,
    savedQueries: stores.savedQueries,
    offlineIdentity: stores.offlineIdentity,
    pendingInvitation: stores.pendingInvitation,
    expenseDrafts: stores.expenseDrafts,
    settlementAttempts: stores.settlementAttempts,
    draftRequests: stores.draftRequests,
    tagRequests: stores.tagRequests,
    groupCreations: stores.groupCreations,
    netInfo: {
      addEventListener(listener: (state: { isConnected: boolean }) => void) {
        listeners.add(listener);
        listener({ isConnected: online });
        return () => {
          listeners.delete(listener);
        };
      },
    },
    now: () => clock.now,
    newSubmissionKey: options.newSubmissionKey ?? (() => `test-phone-key-${++key}`),
    ...options.parts,
  };
  const accountLocal: NonNullable<MobileDependencies['accountLocal']> = {
    owner: stores.owner,
    cleanupMarker: stores.cleanupMarker,
    signOutRecord: stores.signOutRecord,
    financialCleanup: stores.financialCleanup,
    untrustedCopies: stores.untrustedCopies,
    stores: [
      parts.savedQueries,
      parts.offlineIdentity,
      parts.expenseDrafts,
      parts.settlementAttempts,
      parts.draftRequests,
      parts.tagRequests,
      parts.groupCreations,
      stores.financialCleanup,
      stores.untrustedCopies,
    ],
  };
  return {
    stores,
    clock,
    connect(value: boolean) {
      online = value;
      listeners.forEach((listener) => listener({ isConnected: online }));
    },
    open() {
      active?.dispose();
      active = (options.monitor === false ? createMobileController : createCheckedMobileController)(
        {
          apiBaseUrl: 'http://localhost:4138',
          authOrigin: 'http://localhost:4138',
          developmentPersonaEnabled: true,
        },
        {
          ...parts,
          accountLocal: options.parts?.accountLocal ?? accountLocal,
          fetch: server.fetch,
        },
      );
      return active;
    },
    dispose() {
      active?.dispose();
      active = undefined;
    },
  };
}
