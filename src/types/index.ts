// ─── User ───────────────────────────────────────────────
export interface IUser {
  _id: string;
  name: string;
  email: string;
  image?: string;
  emailVerified?: Date | null;
  preferredCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Group ──────────────────────────────────────────────
export type GroupCategory = 'trip' | 'home' | 'couple' | 'work' | 'other';
export type MemberRole = 'admin' | 'member';

export interface IGroupMember {
  user: string | IUser;
  role: MemberRole;
  joinedAt: Date;
}

export interface IGroupTag {
  _id: string;
  name: string;
  isArchived: boolean;
  createdAt: Date;
}

export interface IGroup {
  _id: string;
  name: string;
  description?: string;
  image?: string;
  createdBy: string | IUser;
  members: IGroupMember[];
  tags: IGroupTag[];
  defaultCurrency: string;
  alternateCurrencies: string[];
  category: GroupCategory;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  isArchived: boolean;
  inviteCode?: string | null;
  inviteCodeExpiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Expense ────────────────────────────────────────────
export type SplitMethod = 'equal' | 'unequal' | 'percentage' | 'shares' | 'exact';

export interface IExpensePayer {
  user: string | IUser;
  amount: number;
}

export interface IExpenseSplit {
  user: string | IUser;
  amount: number;
  percentage?: number;
  shares?: number;
}

export interface IExpenseEditEntry {
  editedBy: string | IUser;
  editedAt: Date;
  changes: Record<string, { old: unknown; new: unknown }>;
}

export interface IExpense {
  _id: string;
  group: string | IGroup;
  description: string;
  amount: number;
  currency: string;
  category: string;
  date: Date;
  paidBy: IExpensePayer[];
  splitMethod: SplitMethod;
  splitBetween: IExpenseSplit[];
  tag: string;
  predefinedItem?: string | null;
  receiptUrl?: string | null;
  notes?: string;
  /** Set when the expense was materialized from a recurring template. */
  recurringExpense?: string | null;
  /** The template period (`YYYY-MM`) this expense was generated for. */
  period?: string | null;
  createdBy: string | IUser;
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedBy?: string | IUser | null;
  editHistory: IExpenseEditEntry[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Recurring Expense Templates ────────────────────────
export interface IRecurringExpense {
  _id: string;
  group: string | IGroup;
  description: string;
  amount: number;
  currency: string;
  category: string;
  tag: string;
  paidBy: IExpensePayer[];
  splitMethod: SplitMethod;
  splitBetween: IExpenseSplit[];
  /** 1–31; clamped to the last day of short months at generation time. */
  dayOfMonth: number;
  startsOn: Date | string;
  endsOn?: Date | string | null;
  isPaused: boolean;
  /** Last materialized period (`YYYY-MM`). */
  lastGeneratedFor?: string | null;
  createdBy: string | IUser;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Settlement ─────────────────────────────────────────
export interface ISettlement {
  _id: string;
  group: string | IGroup;
  paidBy: string | IUser;
  paidTo: string | IUser;
  amount: number;
  currency: string;
  note?: string;
  createdBy: string | IUser;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Activity ───────────────────────────────────────────
export type ActivityType =
  | 'expense_added'
  | 'expense_updated'
  | 'expense_deleted'
  | 'settlement_recorded'
  | 'member_joined'
  | 'member_left'
  | 'group_created'
  | 'group_updated';

export interface IActivity {
  _id: string;
  group: string | IGroup;
  type: ActivityType;
  actor: string | IUser;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ─── Invitation ─────────────────────────────────────────
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface IInvitation {
  _id: string;
  group: string | IGroup;
  invitedBy: string | IUser;
  invitedEmail: string;
  status: InvitationStatus;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─── API Types ──────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  status: number;
}

export interface PaginatedResponse<T> {
  data: {
    items: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

// ─── Filter Types ───────────────────────────────────────
export interface ExpenseFilters {
  quickFilter?: string;
  dateFrom?: string;
  dateTo?: string;
  category?: string;
  tag?: string;
  search?: string;
  paidByUser?: string;
  owedByUser?: string;
  sortBy?: 'date' | 'amount';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  /** Opt-in: include the per-member paid/share/net breakdown in the summary. */
  includeMemberBreakdown?: boolean;
}

// ─── Expense Summary Types ──────────────────────────────
export interface ExpenseMemberBreakdownRow {
  user: { _id: string; name: string; image?: string };
  /** Sum of this member's paidBy amounts in the window. */
  paid: number;
  /** Sum of this member's splitBetween amounts in the window. */
  share: number;
  /** share - paid. Positive = under-contributed this window. */
  net: number;
}

export interface ExpenseSummary {
  totalAmount: number;
  count: number;
  userOwes: number;
  userGetsBack: number;
  /** Present only when includeMemberBreakdown is requested. */
  byMember?: ExpenseMemberBreakdownRow[];
}

// ─── Balance Types ──────────────────────────────────────
export interface UserBalance {
  user: IUser;
  balance: number;
}

export interface Debt {
  from: IUser;
  to: IUser;
  amount: number;
}

export interface GroupBalanceResponse {
  balances: UserBalance[];
  debts: Debt[];
  currency: string;
  hasMixedCurrencies?: boolean;
}

export interface DashboardSettlement {
  counterpartyId: string;
  counterpartyName: string;
  amount: number;
}

/** One person the user owes, or is owed by, within a single group + currency. */
export interface DashboardCounterparty {
  counterpartyId: string;
  counterpartyName: string;
  /** Always positive — read the direction from `direction`. */
  amount: number;
  direction: 'owe' | 'owed';
}

export interface DashboardBalanceAmount {
  currency: string;
  balance: number;
  settlement?: DashboardSettlement;
  /** Every open position for the user, largest first. */
  counterparties: DashboardCounterparty[];
}

export interface DashboardGroupBalance {
  groupId: string;
  name: string;
  category: GroupCategory;
  updatedAt: string;
  hasMixedCurrencies: boolean;
  balances: DashboardBalanceAmount[];
}

/** Per-trip contribution to one person's line in a bucket breakdown. */
export interface CurrencyBreakdownGroup {
  groupId: string;
  groupName: string;
  amount: number;
}

/** One person aggregated across every trip sharing a currency. */
export interface CurrencyBreakdownEntry {
  counterpartyId: string;
  counterpartyName: string;
  amount: number;
  groups: CurrencyBreakdownGroup[];
}

export interface CurrencyBalanceBucket {
  currency: string;
  youOwe: number;
  youAreOwed: number;
  net: number;
  /** Who you owe, largest first — sums to `youOwe`. */
  oweBreakdown: CurrencyBreakdownEntry[];
  /** Who owes you, largest first — sums to `youAreOwed`. */
  owedBreakdown: CurrencyBreakdownEntry[];
}

export type DashboardNextAction =
  | {
      kind: 'create-group';
      title: string;
      description: string;
      href: '/groups/new';
    }
  | {
      kind: 'settle';
      title: string;
      description: string;
      href: string;
      groupId: string;
      counterpartyName: string;
      amount: number;
      currency: string;
    }
  | {
      kind: 'review-invitations';
      title: string;
      description: string;
      href: '#pending-actions';
    }
  | {
      kind: 'add-expense';
      title: string;
      description: string;
      href: string;
      groupId: string;
    };

export interface UserBalancesResponse {
  buckets: CurrencyBalanceBucket[];
  groups: DashboardGroupBalance[];
  hasMixedCurrencies: boolean;
}
