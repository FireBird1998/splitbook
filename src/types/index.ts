import { Types } from "mongoose";

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
export type GroupCategory = "trip" | "home" | "couple" | "work" | "other";
export type MemberRole = "admin" | "member";

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
  isArchived: boolean;
  inviteCode?: string | null;
  inviteCodeExpiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Expense ────────────────────────────────────────────
export type SplitMethod = "equal" | "unequal" | "percentage" | "shares" | "exact";

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
  createdBy: string | IUser;
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedBy?: string | IUser | null;
  editHistory: IExpenseEditEntry[];
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
  | "expense_added"
  | "expense_updated"
  | "expense_deleted"
  | "settlement_recorded"
  | "member_joined"
  | "member_left"
  | "group_created"
  | "group_updated";

export interface IActivity {
  _id: string;
  group: string | IGroup;
  type: ActivityType;
  actor: string | IUser;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ─── Invitation ─────────────────────────────────────────
export type InvitationStatus = "pending" | "accepted" | "declined" | "expired";

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
  sortBy?: "date" | "amount";
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
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
}

