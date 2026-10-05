import type { FinancialReadStore, OfflineIdentityStore } from './offline-cache';
import type { ActivityState } from './activity';
import type { AccountGroupRecordStore } from './account-record-storage';
import type { PendingPayment, SettlementState } from './settlement';
import type { ExpenseDraftStore, ExpenseEditor } from './expense-draft';
import type { GroupValidation } from './group-draft';
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

/** The member's balance in one of a Group's currencies: negative owes, positive is owed. */
export interface HomeGroupBalance {
  currency: string;
  balance: number;
}

export interface HomeFinancialState extends ReadFreshness {
  status: LoadStatus;
  data: HomeCurrencyBalance[] | null;
  /**
   * From the same response, by Group id: the currencies the member isn't settled in. An empty
   * list is settled up; a Group without an entry is unknown.
   */
  byGroup: Record<string, HomeGroupBalance[]>;
  message: string | null;
}

/** An Expense draft kept on this device, as Home lists it to resume. */
export interface ExpenseDraftSummary {
  groupId: string;
  /** From the saved Groups list. */
  groupName: string;
  /** The saved Expense the draft edits; null for a new Expense. */
  expenseId: string | null;
  description: string;
  /** As typed, so it may not be a valid amount yet. */
  amount: string;
  currency: string;
  /** A save or change was sent without a confirmed result, so it may already be recorded. */
  unconfirmed: boolean;
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

/** The three Group-scoped places the bottom navigation switches between. */
export type GroupDestination = 'expenses' | 'balances' | 'activity';

/**
 * Where a full-screen Expense task returns: captured when it opens from that Group's view.
 * `null` is direct entry, which returns to the Group at its default Month.
 */
export interface GroupReturnContext {
  groupId: string;
  /** The Month shown at entry; null for All time or a Group without a Month lens. */
  month: string | null;
  /** The Group view's vertical scroll offset at entry. */
  scrollY: number;
  /** Expense pages loaded at entry, read again on return so that position still exists. */
  pages: number;
  /** The bottom-navigation destination at entry; Back and close return to it. */
  destination: GroupDestination;
  /** Activity pages loaded at entry from Activity, read again on return. */
  activityPages: number;
}

/** Confirms a ledger change on the Group view it returned to. */
export interface GroupSnackbar {
  groupId: string;
  message: string;
  /** The saved Expense's Month when it differs from the Month shown; offered, never switched to. */
  viewMonth: string | null;
  /** The saved Expense, highlighted on Expenses while this shows. */
  expenseId?: string;
}

/**
 * This Group's Expense draft kept on the device (one per Group, ADR 0004), read so Expenses
 * can offer it without opening it.
 */
export interface KeptDraft {
  groupId: string;
  /** Null when the stored record can't be read; opening it explains why. */
  draft: {
    description: string;
    /** The entered amount when it is a valid one. */
    amount: number | null;
    currency: string;
    /** Changes to a saved Expense rather than a new one. */
    edit: boolean;
  } | null;
  /** A save or change that may already be recorded: finished from here, never discarded. */
  unconfirmed: boolean;
}

/**
 * Leave Group's confirm sheet over Members and Group details. Leaving needs a connection, a
 * settled-up member, and nothing on this device for that Group that may already be recorded.
 */
export interface LeaveGroupState {
  groupId: string | null;
  /**
   * 'checking' reads what this device keeps for the Group; 'blocked' is a save or payment that
   * may already be recorded, so nothing is sent; 'refused' is the server's answer (`code`);
   * 'error' is any other failure, after which Leave Group can be tried again.
   */
  status: 'closed' | 'checking' | 'confirm' | 'leaving' | 'blocked' | 'refused' | 'error';
  /** Why the server refused: OPEN_BALANCE, LAST_ADMIN or LEAVE_CONFLICT. */
  code: string | null;
  message: string | null;
  /** This Group's Expense draft is kept on this device; leaving discards it. */
  draft: boolean;
  /** The Group destination that shows what blocks leaving, such as Balances for an open balance. */
  check: GroupDestination | null;
}

/** Confirms something that ended on Home, such as leaving a Group. Leaving Home ends it. */
export interface HomeSnackbar {
  message: string;
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
  validation: GroupValidation;
  /**
   * The immutable identity of the last submission, stored on this device before it is sent.
   * Sending the same details again reuses it, also after a restart.
   */
  attempt: { key: string; body: string } | null;
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
  /**
   * The view (`shownView`) a running pull-to-refresh started on. Only that view shows the pull
   * indicator; foreground refreshes and retries never set this.
   */
  pull: string | null;
  /** Likewise for an automatic (foreground) refresh, which its view never announces. */
  automatic: string | null;
  /**
   * `restoring` with a user is the cold-start check: the saved Home of the account that last
   * signed in on this device is shown, and nothing is sent until the session is confirmed.
   *
   * `sign-out-unconfirmed`: this device is signed out, but the server hasn't confirmed revoking
   * the session. Nothing of the account shows; Try again re-sends the revoke (`restore`), and
   * Continue (`continueSignedOut`) sends nothing more.
   */
  auth: {
    status:
      | 'restoring'
      | 'signed-out'
      | 'signing-in'
      | 'authenticated'
      | 'error'
      | 'sign-out-unconfirmed';
    user: SessionUser | null;
    message: string | null;
  };
  /** 'members' is the Group's Members and Group details page; Back returns to the Group. */
  screen:
    | 'groups'
    | 'group'
    | 'create'
    | 'invite'
    | 'settings'
    | 'expense'
    | 'settlement'
    | 'members';
  /**
   * The Group destination shown while `screen` is 'group'. Back from an Expense task returns
   * to the destination it opened from; a confirmed change returns to Expenses.
   */
  destination: GroupDestination;
  expense: ExpenseEditor;
  /**
   * Asks the Group view to scroll back to where the member was after a full-screen task
   * returns to it. `request` changes once per return.
   */
  restoreScroll: { groupId: string; y: number; request: number } | null;
  snackbar: GroupSnackbar | null;
  homeSnackbar: HomeSnackbar | null;
  /** Leave Group, a sheet over Members and Group details. */
  leave: LeaveGroupState;
  settlement: SettlementState;
  /** The current Group's unconfirmed payment, kept for an explicit retry from Balances. */
  pendingPayment: PendingPayment | null;
  /** The current Group's kept Expense draft, offered from Expenses. */
  keptDraft: KeptDraft | null;
  activity: ActivityState;
  home: HomeFinancialState;
  /** This account's Expense drafts in listed Groups, unconfirmed saves first, then by Group. */
  drafts: ExpenseDraftSummary[];
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
  groups: {
    status: LoadStatus;
    data: MobileGroup[];
    message: string | null;
    /** A list has been read for this account, from the server or this device; it may be empty. */
    loaded: boolean;
  };
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
  /**
   * Backend-scoped tombstone: a restart must finish cleanup before restoring a session. While it
   * is set, the saved session cookie is only ever sent to revoke it, and stays until the server
   * confirms that.
   */
  cleanupMarker: {
    load(): Promise<boolean>;
    mark(): Promise<void>;
    clear(): Promise<void>;
  };
  /**
   * The same tombstone for a sign-out, kept outside SecureStore (the account-record database), so
   * a restart still finishes the sign-out when SecureStore failed to write the marker or to clear
   * the cookie. Never one of `stores`: the purge must not remove it. `invitationCleared`: that
   * sign-out has already cleared the saved invitation, so a retry keeps one opened since.
   */
  signOutRecord?: {
    load(): Promise<{ invitationCleared: boolean } | null>;
    mark(record: { invitationCleared: boolean }): Promise<void>;
    clear(): Promise<void>;
  };
  /** Register at startup. Each store clears all its account keys for this backend. */
  stores: readonly { clear(): Promise<void> }[];
}

/**
 * A Group submission whose reply may never have arrived, one per account: its key, body and
 * draft, stored before it is sent and kept until it is confirmed or discarded.
 */
export interface GroupCreationStore {
  load(accountId: string): Promise<unknown | null>;
  save(accountId: string, value: unknown): Promise<void>;
  remove(accountId: string): Promise<void>;
  clear(): Promise<void>;
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
  /**
   * How long a verified read is shown again without another request when navigating
   * or returning to the foreground. Defaults to `DISPLAY_FRESHNESS_MS`. Pull-to-refresh,
   * Retry and confirmed changes always read again; it never extends session or access.
   */
  displayFreshnessMs?: number;
  expenseDrafts?: ExpenseDraftStore;
  settlementAttempts?: AccountGroupRecordStore;
  /** Register it in `accountLocal.stores` too, so sign-out and account change remove it. */
  groupCreations?: GroupCreationStore;
  newSubmissionKey?: () => string;
}
