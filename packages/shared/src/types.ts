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
  isDeleted?: boolean;
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
  amountMinor?: number;
}

export interface IExpenseSplit {
  user: string | IUser;
  amount: number;
  amountMinor?: number;
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
  amountMinor?: number;
  currency: string;
  moneyVersion?: number;
  revision?: number;
  category: string;
  date: Date;
  paidBy: IExpensePayer[];
  splitMethod: SplitMethod;
  splitBetween: IExpenseSplit[];
  tag: string;
  tagId?: string;
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
  amountMinor?: number;
  currency: string;
  moneyVersion?: number;
  revision?: number;
  category: string;
  tag: string;
  tagId?: string;
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
  amountMinor?: number;
  currency: string;
  moneyVersion?: number;
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
  tagId?: string;
  search?: string;
  paidByUser?: string;
  owedByUser?: string;
  sortBy?: 'date' | 'amount';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  /** Opt-in: include the per-member paid/share/net breakdown in the summary. */
  includeMemberBreakdown?: boolean;
  /** Only the Expenses this member paid part of or has a share of (#310). */
  involvesUser?: string;
  /**
   * The lowest and highest amount, inclusive, in the Group's currency's major units, as
   * decimal text ("500", "1249.50"), so the range is read exactly (#310).
   */
  amountMin?: string;
  amountMax?: string;
  /**
   * Opt-in: count the Expenses recurring Expenses added, as `summary.recurringCount`. The
   * server leaves it out while recurring Expenses are switched off (#289, #310).
   */
  includeRecurringCount?: boolean;
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
  amountMinor?: number;
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
  amountMinor?: number;
}

export interface DashboardBalanceAmount {
  currency: string;
  balance: number;
  settlement?: DashboardSettlement;
}

export interface DashboardGroupBalance {
  groupId: string;
  name: string;
  category: GroupCategory;
  updatedAt: string;
  hasMixedCurrencies: boolean;
  balances: DashboardBalanceAmount[];
}

export interface CurrencyBalanceBucket {
  currency: string;
  youOwe: number;
  youAreOwed: number;
  net: number;
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
      amountMinor?: number;
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

/** Whether the member makes a suggested payment or receives it. */
export type SuggestedPaymentDirection = 'pay' | 'receive';

/**
 * One payment Splitbook suggests in a Group, where the member pays or receives (#306): the same
 * payment the Group's Balances lists under "Who pays whom".
 */
export interface HomeSuggestedPayment {
  groupId: string;
  groupName: string;
  currency: string;
  direction: SuggestedPaymentDirection;
  /** The other person: the one the member pays, or the one who pays the member. */
  counterpartyId: string;
  counterpartyName: string;
  /** Exact, in the currency's minor units (paise, cents), and always above zero. */
  amountMinor: number;
}

export interface UserBalancesResponse {
  buckets: CurrencyBalanceBucket[];
  groups: DashboardGroupBalance[];
  hasMixedCurrencies: boolean;
  /** Every suggested payment involving the member, across their Groups, in Needs you's order. */
  suggestedPayments: HomeSuggestedPayment[];
}
