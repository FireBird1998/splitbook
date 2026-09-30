import type { FinancialReadStore, OfflineIdentityStore } from './offline-cache';
import type { ActivityState } from './activity';
import type { AccountGroupRecordStore } from './account-record-storage';
import type { SettlementState } from './settlement';
import type { ExpenseDraftStore, ExpenseEditor } from './expense-draft';
import type { GroupCategory } from '@splitbook/shared/types';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface MobileGroup {
  id: string;
  name: string;
  description: string;
  category: GroupCategory;
  defaultCurrency: string;
  members: Array<{
    user: SessionUser;
    role: 'admin' | 'member';
    joinedAt: Date;
  }>;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'denied';

export interface FinancialPerson {
  id: string | null;
  name: string;
  image: string | null;
}

export interface HomeCurrencyBalance {
  currency: string;
  youOwe: number;
  youAreOwed: number;
}

/**
 * `status` describes the latest request; `data` stays while the same authorized
 * view refreshes. `refreshedAt` is when that data was last read successfully.
 */
export interface ReadFreshness {
  refreshedAt: number | null;
  /** Retained after a ledger change, such as recurring materialization, and not yet re-read. */
  stale: boolean;
}

export interface HomeFinancialState extends ReadFreshness {
  status: LoadStatus;
  data: HomeCurrencyBalance[] | null;
  message: string | null;
}

export interface GroupCurrencyBalance {
  currency: string;
  balances: { user: FinancialPerson; balance: number }[];
  debts: { from: FinancialPerson; to: FinancialPerson; amount: number }[];
}

export interface MobileExpense {
  id: string;
  groupId: string;
  description: string;
  currency: string;
  amount: number;
  amountMinor: number;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
  category: string;
  tag: string;
  tagId: string | null;
  paidBy: { user: FinancialPerson; amount: number; amountMinor: number }[];
  splitBetween: { user: FinancialPerson; amount: number; amountMinor: number }[];
  splitMethod: 'equal' | 'unequal' | 'percentage' | 'shares' | 'exact';
}

export interface ExpenseWindowSummary {
  /** The Group's default currency applies to contribution figures only. */
  currency: string;
  count: number;
  totalsByCurrency: { currency: string; totalAmount: number }[];
  userOwes: number;
  userGetsBack: number;
  byMember: { user: FinancialPerson; paid: number; share: number; net: number }[];
}

export interface GroupFinancialState {
  groupId: string | null;
  /** Local calendar YYYY-MM, or null for all time. */
  month: string | null;
  expenses: {
    status: LoadStatus;
    data: MobileExpense[];
    summary: ExpenseWindowSummary | null;
    pagination: { page: number; limit: number; total: number; totalPages: number } | null;
    message: string | null;
    moreStatus: 'idle' | 'loading' | 'error';
    moreMessage: string | null;
    /** The Month these Expenses belong to; content is never shown or kept under another. */
    month: string | null;
    refreshedAt: number | null;
  };
  /** All-time; never filtered by `month`. */
  balances: ReadFreshness & {
    status: LoadStatus;
    data: GroupCurrencyBalance[] | null;
    message: string | null;
  };
}

export interface GroupDraft {
  name: string;
  description: string;
  category: GroupCategory;
  defaultCurrency: string;
  startDate: string;
  endDate: string;
}

export interface GroupCreation {
  draft: GroupDraft;
  status: 'editing' | 'saving' | 'error' | 'uncertain';
  message: string | null;
}

export interface InvitationPreview {
  id: string;
  name: string;
  category: GroupCategory;
  memberCount: number;
}

export interface PendingInvitationStore {
  load(): Promise<string | null>;
  save(code: string): Promise<void>;
  clear(): Promise<void>;
}

export interface MobileSnapshot {
  offline: { active: boolean; refreshedAt: number | null; message: string | null };
  /** A member-requested refresh is running; automatic refreshes never set this. */
  pull: boolean;
  auth: {
    status: 'restoring' | 'signed-out' | 'signing-in' | 'authenticated' | 'error';
    user: SessionUser | null;
    message: string | null;
  };
  screen:
    | 'groups'
    | 'group'
    | 'create'
    | 'invite'
    | 'settings'
    | 'expense'
    | 'settlement'
    | 'activity';
  expense: ExpenseEditor;
  settlement: SettlementState;
  activity: ActivityState;
  home: HomeFinancialState;
  financial: GroupFinancialState;
  creation: GroupCreation;
  share: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    url: string | null;
    message: string | null;
  };
  invitation: {
    code: string | null;
    status: 'idle' | 'loading' | 'ready' | 'joining' | 'error' | 'invalid' | 'denied';
    preview: InvitationPreview | null;
    message: string | null;
  };
  groups: { status: LoadStatus; data: MobileGroup[]; message: string | null };
  detail: {
    status: LoadStatus;
    id: string | null;
    /** Kept, with `refreshedAt`, while the same Group refreshes or after a failed refresh. */
    data: MobileGroup | null;
    message: string | null;
    refreshedAt: number | null;
  };
}

export interface MobileConfig {
  /** Backend origin, without /api. May use an emulator's address for a local server. */
  apiBaseUrl: string;
  /** The origin configured as trusted by the backend, which can differ on an emulator. */
  authOrigin: string;
  /** Exact web origin allowed to supply invitations for this build's environment. */
  inviteOrigin?: string;
  /** The caller must combine __DEV__ with an explicit development-persona setting. */
  developmentPersonaEnabled: boolean;
  /** Public server audience for native Google identity tokens. Staging requires HTTPS. */
  googleWebClientId?: string;
}

export interface CredentialStore {
  /** Store one signed session cookie, scoped to this backend. Never a raw session token. */
  load(): Promise<string | null>;
  save(cookie: string): Promise<void>;
  clear(): Promise<void>;
}

export interface AccountLocalStorage {
  owner: {
    load(): Promise<string | null>;
    save(accountId: string): Promise<void>;
    clear(): Promise<void>;
  };
  /** Backend-scoped tombstone: a restart must finish cleanup before restoring a session. */
  cleanupMarker: {
    load(): Promise<boolean>;
    mark(): Promise<void>;
    clear(): Promise<void>;
  };
  /** Register at startup. Each store clears all its account keys for this backend. */
  stores: readonly { clear(): Promise<void> }[];
}

/** Capture before asynchronous work. Retired sessions cannot write account data. */
export interface AccountStorageLease {
  accountId: string;
  write<T>(operation: () => Promise<T>): Promise<T>;
}

export interface CookieHeaders {
  get(name: string): string | null;
  getSetCookie?(): string[];
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: CookieHeaders;
  json(): Promise<unknown>;
}

export type MobileFetch = (url: string, init: RequestInit) => Promise<FetchResponse>;

export type GoogleIdentityResult =
  | { status: 'success'; idToken: string; nonce: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface MobileDependencies {
  /** Native identity acquisition only. The controller owns the app session. */
  googleSignIn?: () => Promise<GoogleIdentityResult>;
  readCache?: FinancialReadStore;
  offlineIdentity?: OfflineIdentityStore;
  fetch: MobileFetch;
  credentials: CredentialStore;
  pendingInvitation?: PendingInvitationStore;
  accountLocal?: AccountLocalStorage;
  now?: () => number;
  expenseDrafts?: ExpenseDraftStore;
  settlementAttempts?: AccountGroupRecordStore;
  newSubmissionKey?: () => string;
}
