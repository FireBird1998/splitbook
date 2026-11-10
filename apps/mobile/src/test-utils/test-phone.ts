import { onTestFinished } from 'vitest';
import { createCheckedMobileController } from './flow-monitor';
import { createMobileController, type MobileController } from '../data/mobile-controller';
import type { AccountLocalStorage, MobileConfig, MobileDependencies } from '../data/types';
import { savedQueriesIn } from './saved-queries';
import type { SavedQueryRecords } from '../data/saved-copy-budget';

type StoreOperation = 'load' | 'save' | 'remove' | 'clear' | 'list' | 'keys' | 'retainGroups';

type PurgeStore =
  | 'savedQueries'
  | 'offlineIdentity'
  | 'expenseDrafts'
  | 'settlementAttempts'
  | 'draftRequests'
  | 'tagRequests'
  | 'groupCreations'
  | 'financialCleanup'
  | 'untrustedCopies';
type PhoneParts = Omit<Partial<Omit<MobileDependencies, 'fetch'>>, 'accountLocal'> & {
  accountLocal?: Partial<AccountLocalStorage>;
};

/** Faults stop at the native storage boundary, before its atomic read or write. */
function faultable<T extends object>(store: T) {
  const next = new Map<string, { path?: string; action: () => Promise<void> }[]>();
  const persistent = new Set<{
    operation: StoreOperation;
    path?: string;
    when: () => boolean;
    action: () => Promise<void> | null;
  }>();
  const persist = (
    operation: StoreOperation,
    action: () => Promise<void> | null,
    when: () => boolean,
    path?: string,
  ) => {
    const rule = { operation, action, when, path };
    persistent.add(rule);
    return () => {
      persistent.delete(rule);
    };
  };
  const enqueue = (operation: StoreOperation, action: () => Promise<void>, path?: string) => {
    const queue = next.get(operation) ?? [];
    queue.push({ path, action });
    next.set(operation, queue);
  };
  for (const [operation, value] of Object.entries(store)) {
    if (typeof value !== 'function') continue;
    const call = value as (...args: unknown[]) => unknown;
    Object.defineProperty(store, operation, {
      enumerable: true,
      configurable: true,
      value: (...args: unknown[]) => {
        const rules = [...persistent].filter(
          (rule) =>
            rule.operation === operation && (rule.path === undefined || rule.path === args[1]),
        );
        const invoke = (index: number): unknown => {
          if (index < rules.length) {
            const rule = rules[index];
            if (!rule.when()) return invoke(index + 1);
            const waiting = rule.action();
            return waiting ? waiting.then(() => invoke(index + 1)) : invoke(index + 1);
          }
          const queue = next.get(operation);
          const slot =
            queue?.findIndex((step) => step.path === undefined || step.path === args[1]) ?? -1;
          if (slot >= 0)
            return queue!
              .splice(slot, 1)[0]
              .action()
              .then(() => call.apply(store, args));
          // Fast native reads must keep their turn: saved previews race immediate network answers.
          return call.apply(store, args);
        };
        return invoke(0);
      },
    });
  }
  const controls = (path?: string) => ({
    failNext(operation: StoreOperation, error = new Error('Fictional device storage failure')) {
      enqueue(operation, () => Promise.reject(error), path);
    },
    failPersistently(
      operation: StoreOperation,
      error = new Error('Fictional device storage failure'),
      when = () => true,
    ) {
      return persist(operation, () => Promise.reject(error), when, path);
    },
    delayPersistently(operation: StoreOperation, milliseconds: () => number) {
      return persist(
        operation,
        () => new Promise<void>((resolve) => setTimeout(resolve, milliseconds())),
        () => milliseconds() > 0,
        path,
      );
    },
    stallPersistently(operation: StoreOperation, waiting: () => Promise<void> | null) {
      return persist(operation, waiting, () => true, path);
    },
    stallNext(operation: StoreOperation, until: Promise<void>) {
      enqueue(operation, () => until, path);
    },
    holdNext(operation: StoreOperation) {
      let arrive!: () => void, release!: () => void;
      const arrived = new Promise<void>((done) => {
        arrive = done;
      });
      const released = new Promise<void>((done) => {
        release = done;
      });
      enqueue(
        operation,
        () => {
          arrive();
          return released;
        },
        path,
      );
      return { arrived, release };
    },
  });
  return Object.assign(store, controls(), { at: (path: string) => controls(path) });
}

/** Native cells clone at the boundary, as the persisted adapters do. */
function cell<T>(initial: T) {
  let value = structuredClone(initial);
  return faultable({
    get value() {
      return structuredClone(value);
    },
    set value(next: T) {
      value = structuredClone(next);
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
function records(savedQueries = false, separator = '') {
  const rows = new Map<string, unknown>();
  const adapter = savedQueriesIn(rows, {}, separator);
  const retainGroups: NonNullable<SavedQueryRecords['retainGroups']> = async () => {};
  // Saved-query helpers intentionally find API paths only. Native Draft/payment stores also
  // list plain Group ids, which is how Home discovers recovery copies after a restart.
  return faultable({
    records: rows,
    ...adapter,
    ...(savedQueries ? { retainGroups } : {}),
    list: async (account: string) =>
      savedQueries
        ? adapter.list!(account)
        : [...rows]
            .filter(([key]) => key.startsWith(account + separator))
            .map(([key, value]) => ({
              groupId: key.slice(account.length + separator.length),
              value: structuredClone(value),
            })),
    keys: async (account: string) =>
      savedQueries
        ? adapter.keys!(account)
        : [...rows.keys()]
            .filter((key) => key.startsWith(account + separator))
            .map((key) => key.slice(account.length + separator.length)),
  });
}

/** A phone owns its stores; reopening replaces only the app, never the phone's contents. */
export function testPhone<Queries extends SavedQueryRecords | undefined = undefined>(
  server: Pick<MobileDependencies, 'fetch'> & { online: boolean },
  options: {
    now?: number;
    origin?: string;
    config?: Partial<MobileConfig>;
    recordSeparator?: string;
    settlementSeparator?: string;
    newSubmissionKey?: () => string;
    parts?: Omit<PhoneParts, 'savedQueries'> & { savedQueries?: Queries };
    purge?: readonly PurgeStore[];
    monitor?: boolean;
  } = {},
) {
  type QueryStorage = Queries extends SavedQueryRecords ? Queries : ReturnType<typeof records>;
  // A supplied adapter stays native (including SQLite); only the default adapter has memory rows.
  const queries = (
    options.parts?.savedQueries ? faultable(options.parts.savedQueries) : records(true)
  ) as ReturnType<typeof faultable<QueryStorage>>;
  const stores = {
    credentials: cell<string | null>(null),
    owner: cell<string | null>(null),
    cleanupMarker: (() => {
      const marker = cell(false);
      return Object.assign(marker, { mark: () => marker.save(true) });
    })(),
    signOutRecord: (() => {
      const record = cell<{ invitationCleared: boolean } | null>(null);
      return Object.assign(record, {
        mark: (value: { invitationCleared: boolean }) => record.save(value),
      });
    })(),
    financialCleanup: cell<unknown>(null),
    untrustedCopies: cell<unknown>(null),
    offlineIdentity: cell<unknown>(null),
    pendingInvitation: cell<string | null>(null),
    savedQueries: queries,
    expenseDrafts: records(false, options.recordSeparator),
    settlementAttempts: records(false, options.settlementSeparator),
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
  // A suite that never set `now` ran on the platform clock, and vitest's fake timers; one that set
  // it moves this clock, and TanStack Query's with it (`./query-clock.ts`).
  const injected = options.now !== undefined;
  let moment = options.now ?? 0;
  const clock = {
    get now() {
      return injected ? moment : Date.now();
    },
    set now(next: number) {
      if (!injected) throw new Error('Give the phone a `now` to move its clock.');
      moment = next;
    },
  };
  let key = 0,
    active: MobileController | undefined;
  type Connection = { isConnected: boolean; isInternetReachable?: boolean | null };
  let connection: Connection | undefined;
  const listeners = new Set<(state: Connection) => void>();
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
      addEventListener(listener: (state: Connection) => void) {
        listeners.add(listener);
        listener(connection ?? { isConnected: server.online });
        return () => {
          listeners.delete(listener);
        };
      },
    },
    ...(injected ? { now: () => clock.now } : {}),
    newSubmissionKey: options.newSubmissionKey ?? (() => `test-phone-key-${++key}`),
    ...options.parts,
    ...(options.parts?.savedQueries ? { savedQueries: stores.savedQueries } : {}),
  };
  const accountParts = options.parts?.accountLocal;
  const accountLocal: AccountLocalStorage = {
    signOutRecord: stores.signOutRecord,
    financialCleanup: stores.financialCleanup,
    untrustedCopies: stores.untrustedCopies,
    ...accountParts,
    owner: accountParts?.owner ?? stores.owner,
    cleanupMarker: accountParts?.cleanupMarker ?? stores.cleanupMarker,
    stores: [],
  };
  const available = {
    savedQueries: parts.savedQueries,
    offlineIdentity: parts.offlineIdentity,
    expenseDrafts: parts.expenseDrafts,
    settlementAttempts: parts.settlementAttempts,
    draftRequests: parts.draftRequests,
    tagRequests: parts.tagRequests,
    groupCreations: parts.groupCreations,
    financialCleanup: accountLocal.financialCleanup,
    untrustedCopies: accountLocal.untrustedCopies,
  };
  // A fixture may deliberately omit a part, or keep a different native purge registry. Preserve
  // both conditions; tests must not silently gain cleanup of a store their original phone kept.
  accountLocal.stores =
    accountParts?.stores ??
    (options.purge ?? (Object.keys(available) as PurgeStore[]))
      .map((key) => available[key])
      .filter((store) => store !== undefined);
  const omitAccount =
    options.parts && 'accountLocal' in options.parts && accountParts === undefined;
  const phone = {
    stores,
    clock,
    connect(value: boolean, isInternetReachable?: boolean | null) {
      connection = {
        isConnected: value,
        ...(isInternetReachable === undefined ? {} : { isInternetReachable }),
      };
      server.online = value && isInternetReachable !== false;
      listeners.forEach((listener) => listener(connection!));
    },
    open() {
      active?.dispose();
      active = (options.monitor === false ? createMobileController : createCheckedMobileController)(
        {
          apiBaseUrl: options.origin ?? 'http://localhost:4138',
          authOrigin: options.origin ?? 'http://localhost:4138',
          developmentPersonaEnabled: true,
          ...options.config,
        },
        {
          ...parts,
          accountLocal: omitAccount ? undefined : accountLocal,
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
  onTestFinished(phone.dispose);
  return phone;
}

/** Wait on the app's public snapshot, as the member waits for a read to finish. */
export function until(
  controller: MobileController,
  ready: (snapshot: ReturnType<MobileController['getSnapshot']>) => boolean,
) {
  return new Promise<void>((resolve) => {
    if (ready(controller.getSnapshot())) return resolve();
    const stop = controller.subscribe(() => {
      if (!ready(controller.getSnapshot())) return;
      stop();
      resolve();
    });
  });
}
