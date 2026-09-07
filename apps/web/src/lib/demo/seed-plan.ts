/**
 * Pure demo seed plan helpers (no DB I/O) — unit-testable.
 */

import { DEMO_GROUP_ID, DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { DEFAULT_GROUP_TAGS } from '@splitbook/shared/default-tags';

export const DEMO_TRIP_NAME = 'Goa Friends Trip';
export const DEMO_CURRENCY = 'INR';
export const DEMO_TAGS = DEFAULT_GROUP_TAGS;

export interface SeedExpensePlan {
  key: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  tag: string;
  daysAgo: number;
  paidBy: Array<{ user: string; amount: number }>;
  splitMethod: 'equal' | 'unequal' | 'percentage' | 'shares' | 'exact';
  splitBetween: Array<{
    user: string;
    amount?: number;
    percentage?: number;
    shares?: number;
  }>;
  notes?: string;
}

export interface SeedSettlementPlan {
  key: string;
  paidBy: string;
  paidTo: string;
  amount: number;
  currency: string;
  note: string;
}

export interface DemoSeedPlan {
  groupId: string;
  groupName: string;
  currency: string;
  tags: readonly string[];
  memberIds: string[];
  adminId: string;
  expenses: SeedExpensePlan[];
  settlement: SeedSettlementPlan;
}

export function buildDemoSeedPlan(): DemoSeedPlan {
  const alex = DEMO_PERSONA_IDS.alex;
  const sam = DEMO_PERSONA_IDS.sam;
  const priya = DEMO_PERSONA_IDS.priya;

  return {
    groupId: DEMO_GROUP_ID,
    groupName: DEMO_TRIP_NAME,
    currency: DEMO_CURRENCY,
    tags: DEMO_TAGS,
    memberIds: [alex, sam, priya],
    adminId: alex,
    expenses: [
      {
        key: 'hotel',
        description: 'Beachside villa (3 nights)',
        amount: 18000,
        currency: DEMO_CURRENCY,
        category: 'accommodation',
        tag: 'Stay',
        daysAgo: 10,
        paidBy: [{ user: alex, amount: 18000 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }, { user: priya }],
        notes: 'Booked via Airbnb',
      },
      {
        key: 'flights',
        description: 'Airport taxi + tolls',
        amount: 2400,
        currency: DEMO_CURRENCY,
        category: 'transport',
        tag: 'Transport',
        daysAgo: 9,
        paidBy: [{ user: sam, amount: 2400 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }, { user: priya }],
      },
      {
        key: 'dinner',
        description: 'Seafood dinner at Anjuna',
        amount: 3600,
        currency: DEMO_CURRENCY,
        category: 'food',
        tag: 'Food',
        daysAgo: 8,
        paidBy: [{ user: priya, amount: 3600 }],
        splitMethod: 'percentage',
        splitBetween: [
          { user: alex, percentage: 40 },
          { user: sam, percentage: 30 },
          { user: priya, percentage: 30 },
        ],
      },
      {
        key: 'scooter',
        description: 'Scooter rental',
        amount: 1500,
        currency: DEMO_CURRENCY,
        category: 'transport',
        tag: 'Transport',
        daysAgo: 7,
        paidBy: [{ user: alex, amount: 1500 }],
        splitMethod: 'shares',
        splitBetween: [
          { user: alex, shares: 1 },
          { user: sam, shares: 1 },
          { user: priya, shares: 1 },
        ],
      },
      {
        key: 'watersports',
        description: 'Parasailing & jet ski',
        amount: 4500,
        currency: DEMO_CURRENCY,
        category: 'entertainment',
        tag: 'Activities',
        daysAgo: 6,
        paidBy: [{ user: sam, amount: 4500 }],
        splitMethod: 'unequal',
        splitBetween: [
          { user: alex, amount: 2000 },
          { user: sam, amount: 1500 },
          { user: priya, amount: 1000 },
        ],
      },
      {
        key: 'groceries',
        description: 'Groceries & snacks',
        amount: 2100,
        currency: DEMO_CURRENCY,
        category: 'food',
        tag: 'Food',
        daysAgo: 5,
        paidBy: [{ user: priya, amount: 2100 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alex }, { user: sam }, { user: priya }],
      },
      {
        key: 'misc',
        description: 'Trip SIM cards',
        amount: 900,
        currency: DEMO_CURRENCY,
        category: 'other',
        tag: 'General',
        daysAgo: 4,
        paidBy: [{ user: alex, amount: 900 }],
        splitMethod: 'exact',
        splitBetween: [
          { user: alex, amount: 300 },
          { user: sam, amount: 300 },
          { user: priya, amount: 300 },
        ],
      },
    ],
    settlement: {
      key: 'sam-to-alex',
      paidBy: sam,
      paidTo: alex,
      amount: 2500,
      currency: DEMO_CURRENCY,
      note: 'UPI — partial villa share',
    },
  };
}

export interface SeedIdempotencyState {
  groupExists: boolean;
  expenseCount: number;
  settlementCount: number;
}

/**
 * Decide whether trip expenses/settlements should be inserted.
 * Re-running seed must not duplicate financial rows when the trip already has data.
 */
export function shouldInsertTripTransactions(state: SeedIdempotencyState): boolean {
  if (!state.groupExists) return true;
  return state.expenseCount === 0 && state.settlementCount === 0;
}

export function daysAgoDate(daysAgo: number, now: Date = new Date()): Date {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(12, 0, 0, 0);
  return date;
}
