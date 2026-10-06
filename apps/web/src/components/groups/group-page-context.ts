'use client';

import { createContext, useContext } from 'react';
import type { GroupRead } from '@splitbook/shared/group-read';

/** The Group's balances read, as the header and the Expenses tab use it. */
export interface GroupBalancesRead {
  data?: {
    balances?: Array<{ user: { _id: string }; balance: number }>;
    debts?: Array<{ from: { _id: string }; to: { _id: string }; amount: number }>;
  };
}

/**
 * What the Group page's layout hands its tabs (#305). A tab renders only while the Group can be
 * shown, so `group` is always the verified Group read.
 */
export interface GroupPageValue {
  groupId: string;
  userId: string;
  group: GroupRead;
  balancesData?: GroupBalancesRead;
  /** Opens the layout's Expense form for this Group. */
  openExpenseForm: () => void;
  /** Opens the layout's invite dialog. */
  openInvite: () => void;
}

export const GroupPageContext = createContext<GroupPageValue | null>(null);

export function useGroupPage(): GroupPageValue {
  const value = useContext(GroupPageContext);
  if (!value) throw new Error('A Group tab renders inside the Group page layout.');
  return value;
}
