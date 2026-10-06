/**
 * The demo Groups seeded beside the Goa trip (#302), as a pure plan (no DB I/O).
 *
 * They give the web portal realistic data: a Household with more than six months of
 * history and recurring Expenses, a six-day Trip with payments still to settle, and a Work
 * Group with a different member mix. Everything is fictional.
 *
 * Every date is a UTC calendar day (`YYYY-MM-DD`), the shape the web form sends, counted back
 * from the run date, so the same run date always gives the same plan and the last six months
 * always hold data. Monthly bills fall on days 2–28, never on the first or last day of a
 * month, so they stay in the same Month for a viewer in any time zone.
 *
 * Who owes whom is chosen so each persona's Home makes sense next to the Goa trip, without
 * changing any figure the existing demo journeys check:
 * - Alex owes in the Household and the Kerala trip, and is owed only in Goa (₹6,160).
 * - Sam owes in Goa and the Household, and is owed in the Kerala trip.
 * - Priya owes only in Goa (₹4,680), and is owed in the Household and the Kerala trip.
 * - The Studio Lunch Club is settled; Alex has invited Priya to it.
 */

import {
  DEMO_HOUSEHOLD_ID,
  DEMO_PERSONAS,
  DEMO_PERSONA_IDS,
  DEMO_WEEK_TRIP_ID,
  DEMO_WORK_GROUP_ID,
} from '@/lib/demo-personas';
import { defaultTagsForCategory } from '@splitbook/shared/default-tags';
import { getDuePeriods, toPeriod } from '@splitbook/shared/recurring-due-periods';

const alex = DEMO_PERSONA_IDS.alex;
const sam = DEMO_PERSONA_IDS.sam;
const priya = DEMO_PERSONA_IDS.priya;
const everyone = [alex, sam, priya];

export const DEMO_GROUPS_CURRENCY = 'INR';

export type DemoGroupKey = 'household' | 'weekTrip' | 'work';
export type DemoSplitMethod = 'equal' | 'unequal' | 'percentage' | 'shares' | 'exact';

export interface DemoSplitRow {
  user: string;
  amount?: number;
  percentage?: number;
  shares?: number;
}

/** What a member enters for an Expense: the body the web form would send. */
export interface DemoExpenseInput {
  description: string;
  amount: number;
  category: string;
  /** The name of one of the Group's default Tags. */
  tag: string;
  paidBy: Array<{ user: string; amount: number }>;
  splitMethod: DemoSplitMethod;
  splitBetween: DemoSplitRow[];
  notes?: string;
}

export interface DemoExpensePlan extends DemoExpenseInput {
  key: string;
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  recordedBy: string;
}

/** A later change to a seeded Expense, so its history shows. */
export interface DemoExpenseEditPlan {
  expenseKey: string;
  editedBy: string;
  change: Partial<Pick<DemoExpenseInput, 'description' | 'amount' | 'tag' | 'notes'>> &
    Partial<Pick<DemoExpenseInput, 'paidBy' | 'splitMethod' | 'splitBetween'>>;
}

export interface DemoExpenseDeletionPlan {
  expenseKey: string;
  deletedBy: string;
}

/**
 * A monthly recurring Expense. With recurring Expenses switched on it is created as a template,
 * which adds one Expense per due Month; switched off, the same Expenses are entered by hand.
 */
export interface DemoRecurringPlan extends DemoExpenseInput {
  key: string;
  dayOfMonth: number;
  /** UTC calendar day, `YYYY-MM-DD`. */
  startsOn: string;
  createdBy: string;
  /** The Months (`YYYY-MM`) due on the run date: one Expense each. */
  periods: string[];
}

export interface DemoSettlementPlan {
  key: string;
  paidBy: string;
  paidTo: string;
  amount: number;
  note: string;
}

export interface DemoInvitationPlan {
  email: string;
  invitedBy: string;
}

export interface DemoGroupPlan {
  key: DemoGroupKey;
  groupId: string;
  name: string;
  description: string;
  category: 'home' | 'trip' | 'work';
  currency: string;
  adminId: string;
  /** Admin first. */
  memberIds: string[];
  joinedAt: Date;
  /** Trip dates, UTC calendar days; null for open-ended Themes. */
  startDate: string | null;
  endDate: string | null;
  expenses: DemoExpensePlan[];
  edits: DemoExpenseEditPlan[];
  deletions: DemoExpenseDeletionPlan[];
  recurring: DemoRecurringPlan[];
  settlements: DemoSettlementPlan[];
  invitations: DemoInvitationPlan[];
}

const DAY_MS = 86_400_000;

function toCalendarDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The UTC calendar day `days` days before the run date's UTC day. */
export function calendarDaysAgo(days: number, now: Date): string {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return toCalendarDay(new Date(today - days * DAY_MS));
}

/** Day `day` (1–28, so every month has it) of the UTC month `monthsAgo` before the run date's. */
export function calendarDayInMonth(monthsAgo: number, day: number, now: Date): string {
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new Error(`Demo day of month must be 1–28, got ${day}`);
  }
  return toCalendarDay(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day)),
  );
}

/** Noon UTC, `days` days before the run date: a membership date that is a day in every zone. */
function noonDaysAgo(days: number, now: Date): Date {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  return new Date(date.getTime() - days * DAY_MS);
}

const equalSplit = (members: string[]): DemoSplitRow[] => members.map((user) => ({ user }));

function shared(
  key: string,
  date: string,
  description: string,
  amount: number,
  payer: string,
  category: string,
  tag: string,
  members: string[] = everyone,
): DemoExpensePlan {
  return {
    key,
    date,
    description,
    amount,
    category,
    tag,
    paidBy: [{ user: payer, amount }],
    splitMethod: 'equal',
    splitBetween: equalSplit(members),
    recordedBy: payer,
  };
}

// --- Banyan Court Flat 4B: the Household -------------------------------------------------

/** Months of monthly bills before the current one. With the recurring Months, seven in all. */
const HOUSEHOLD_MONTHS = 6;

const GROCERY_DESCRIPTIONS = [
  'Weekly groceries',
  'Vegetables and fruit',
  'Monthly staples — rice, dal, oil',
  'Milk, eggs and bread',
] as const;

/** One grocery run every nine days, from 200 days ago to 2 days ago. */
const GROCERY_DAYS_AGO = Array.from({ length: 23 }, (_, index) => 200 - index * 9);
const GROCERY_AMOUNTS = [
  2860, 1240, 3720, 980, 2415, 1365, 3105, 1150, 2790, 1680, 3480, 1025, 2655, 1430, 3890, 1210,
  2940, 1575, 3335, 1090, 2575, 1460, 1865,
];
const GROCERY_PAYERS = [priya, sam, alex];

/** Electricity, oldest Month first. The bill three Months ago was entered wrong, then edited. */
const ELECTRICITY = [2340, 2615, 3180, 3290, 4105, 3460];
const ELECTRICITY_CORRECTED = { monthsAgo: 3, amount: 3920 };

function householdPlan(now: Date): DemoGroupPlan {
  const expenses: DemoExpensePlan[] = [];

  for (let monthsAgo = HOUSEHOLD_MONTHS; monthsAgo >= 1; monthsAgo -= 1) {
    expenses.push(
      shared(
        `cook-${monthsAgo}`,
        calendarDayInMonth(monthsAgo, 5, now),
        'Cook’s monthly salary',
        7500,
        priya,
        'housing',
        'Household',
      ),
      shared(
        `electricity-${monthsAgo}`,
        calendarDayInMonth(monthsAgo, 11, now),
        'Electricity bill',
        ELECTRICITY[HOUSEHOLD_MONTHS - monthsAgo],
        alex,
        'housing',
        'Utilities',
      ),
    );
    if (monthsAgo % 2 === 0) {
      expenses.push(
        shared(
          `gas-${monthsAgo}`,
          calendarDayInMonth(monthsAgo, 17, now),
          'Cooking gas cylinder',
          1103,
          sam,
          'housing',
          'Utilities',
        ),
      );
    }
  }

  GROCERY_DAYS_AGO.forEach((daysAgo, index) => {
    expenses.push(
      shared(
        `groceries-${daysAgo}`,
        calendarDaysAgo(daysAgo, now),
        GROCERY_DESCRIPTIONS[index % GROCERY_DESCRIPTIONS.length],
        GROCERY_AMOUNTS[index],
        GROCERY_PAYERS[index % GROCERY_PAYERS.length],
        'food',
        'Groceries',
      ),
    );
  });

  expenses.push(
    shared(
      'pest-control',
      calendarDaysAgo(188, now),
      'Pest control visit',
      1800,
      alex,
      'housing',
      'Household',
    ),
    shared(
      'cleaning',
      calendarDaysAgo(150, now),
      'Cleaning supplies and dish soap',
      845,
      priya,
      'shopping',
      'Household',
    ),
    shared(
      'purifier',
      calendarDaysAgo(121, now),
      'Water purifier service',
      1499,
      sam,
      'other',
      'Utilities',
    ),
    shared(
      'plumber',
      calendarDaysAgo(96, now),
      'Plumber — kitchen sink',
      650,
      alex,
      'housing',
      'Household',
    ),
    {
      key: 'housewarming',
      date: calendarDaysAgo(64, now),
      description: 'House-warming party snacks',
      amount: 3240,
      category: 'food',
      tag: 'General',
      paidBy: [{ user: sam, amount: 3240 }],
      splitMethod: 'shares',
      splitBetween: [
        { user: alex, shares: 1 },
        { user: sam, shares: 2 },
        { user: priya, shares: 1 },
      ],
      notes: 'Sam brought two friends',
      recordedBy: sam,
    },
    shared(
      'pressure-cooker',
      calendarDaysAgo(40, now),
      'New pressure cooker',
      2199,
      priya,
      'shopping',
      'Household',
    ),
    {
      key: 'ac-service',
      date: calendarDaysAgo(23, now),
      description: 'AC servicing — two rooms',
      amount: 1800,
      category: 'housing',
      tag: 'Utilities',
      paidBy: [{ user: alex, amount: 1800 }],
      splitMethod: 'percentage',
      splitBetween: [
        { user: alex, percentage: 60 },
        { user: sam, percentage: 40 },
      ],
      notes: 'Priya’s room has no AC',
      recordedBy: alex,
    },
    {
      key: 'pharmacy',
      date: calendarDaysAgo(9, now),
      description: 'Pharmacy run',
      amount: 940,
      category: 'health',
      tag: 'General',
      paidBy: [{ user: sam, amount: 940 }],
      splitMethod: 'exact',
      splitBetween: [
        { user: alex, amount: 310 },
        { user: sam, amount: 420 },
        { user: priya, amount: 210 },
      ],
      recordedBy: sam,
    },
  );

  // Sam enters the latest grocery run a second time, then deletes the copy.
  const latestGroceries = expenses.find((expense) => expense.key === 'groceries-11')!;
  expenses.push({
    ...latestGroceries,
    key: 'groceries-11-duplicate',
    paidBy: latestGroceries.paidBy.map((payer) => ({ ...payer })),
    splitBetween: latestGroceries.splitBetween.map((row) => ({ ...row })),
    recordedBy: sam,
  });

  expenses.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));

  const startsOn = calendarDayInMonth(HOUSEHOLD_MONTHS, 1, now);
  const monthly = (key: string, input: DemoExpenseInput): DemoRecurringPlan => ({
    key,
    ...input,
    dayOfMonth: 2,
    startsOn,
    createdBy: priya,
    periods: getDuePeriods(
      { dayOfMonth: 2, startsOn, endsOn: null, isPaused: false, lastGeneratedFor: null },
      toPeriod(now),
    ),
  });

  return {
    key: 'household',
    groupId: DEMO_HOUSEHOLD_ID,
    name: 'Banyan Court Flat 4B',
    description: 'Demo household — three flatmates sharing rent, bills and groceries.',
    category: 'home',
    currency: DEMO_GROUPS_CURRENCY,
    adminId: priya,
    memberIds: [priya, alex, sam],
    joinedAt: noonDaysAgo(215, now),
    startDate: null,
    endDate: null,
    expenses,
    edits: [
      {
        expenseKey: `electricity-${ELECTRICITY_CORRECTED.monthsAgo}`,
        editedBy: alex,
        change: {
          amount: ELECTRICITY_CORRECTED.amount,
          paidBy: [{ user: alex, amount: ELECTRICITY_CORRECTED.amount }],
          splitMethod: 'equal',
          splitBetween: equalSplit(everyone),
        },
      },
      {
        expenseKey: 'groceries-29',
        editedBy: sam,
        change: {
          description: 'Weekly groceries and floor cleaner',
          notes: 'Added the floor cleaner from the same shop',
        },
      },
      {
        expenseKey: 'plumber',
        editedBy: priya,
        change: { tag: 'Utilities' },
      },
    ],
    deletions: [{ expenseKey: 'groceries-11-duplicate', deletedBy: sam }],
    recurring: [
      monthly('rent', {
        description: 'Flat rent',
        amount: 54000,
        category: 'housing',
        tag: 'Rent',
        // Each flatmate pays the landlord their own third.
        paidBy: [
          { user: priya, amount: 18000 },
          { user: alex, amount: 18000 },
          { user: sam, amount: 18000 },
        ],
        splitMethod: 'equal',
        splitBetween: equalSplit(everyone),
      }),
      monthly('broadband', {
        description: 'Broadband (300 Mbps)',
        amount: 1179,
        category: 'housing',
        tag: 'Internet',
        paidBy: [{ user: sam, amount: 1179 }],
        splitMethod: 'equal',
        splitBetween: equalSplit(everyone),
      }),
    ],
    settlements: [
      {
        key: 'alex-to-priya',
        paidBy: alex,
        paidTo: priya,
        amount: 3000,
        note: 'UPI — groceries',
      },
      {
        key: 'sam-to-priya',
        paidBy: sam,
        paidTo: priya,
        amount: 11000,
        note: 'UPI — cook’s salary, three months',
      },
    ],
    invitations: [],
  };
}

// --- Kochi to Alleppey: a six-day Trip through Kerala --------------------------------------

const TRIP_FIRST_DAY_AGO = 52;
const TRIP_LAST_DAY_AGO = 47;

function weekTripPlan(now: Date): DemoGroupPlan {
  const day = (tripDay: number) => calendarDaysAgo(TRIP_FIRST_DAY_AGO - (tripDay - 1), now);
  return {
    key: 'weekTrip',
    groupId: DEMO_WEEK_TRIP_ID,
    // The trip strip reads its route from the name: KOC ✈ ALL.
    name: 'Kochi to Alleppey',
    description: 'Demo trip — a six-day week in Kerala, from Kochi to the Alleppey backwaters.',
    category: 'trip',
    currency: DEMO_GROUPS_CURRENCY,
    adminId: sam,
    memberIds: [sam, alex, priya],
    joinedAt: noonDaysAgo(70, now),
    startDate: calendarDaysAgo(TRIP_FIRST_DAY_AGO, now),
    endDate: calendarDaysAgo(TRIP_LAST_DAY_AGO, now),
    expenses: [
      shared(
        'train',
        day(1),
        'Train to Kochi (3 × AC 2-tier)',
        5640,
        sam,
        'transport',
        'Transport',
      ),
      shared('jetty-lunch', day(1), 'Lunch at the ferry jetty', 1080, priya, 'food', 'Food'),
      shared(
        'homestay',
        day(2),
        'Fort Kochi homestay (2 nights)',
        9600,
        priya,
        'accommodation',
        'Stay',
      ),
      shared(
        'kathakali',
        day(2),
        'Kathakali show tickets',
        1800,
        alex,
        'entertainment',
        'Activities',
      ),
      shared('taxi', day(3), 'Taxi to Munnar', 4200, priya, 'transport', 'Transport'),
      {
        key: 'spice-market',
        date: day(3),
        description: 'Spice market gifts',
        amount: 2250,
        category: 'shopping',
        tag: 'General',
        paidBy: [{ user: priya, amount: 2250 }],
        splitMethod: 'exact',
        splitBetween: [
          { user: alex, amount: 900 },
          { user: sam, amount: 600 },
          { user: priya, amount: 750 },
        ],
        recordedBy: priya,
      },
      shared('tea-estate', day(4), 'Tea estate tour', 1350, sam, 'entertainment', 'Activities'),
      shared('cottage', day(4), 'Munnar cottage (1 night)', 5400, priya, 'accommodation', 'Stay'),
      {
        key: 'sadya',
        date: day(4),
        description: 'Dinner — Kerala sadya',
        amount: 1470,
        category: 'food',
        tag: 'Food',
        paidBy: [{ user: alex, amount: 1470 }],
        splitMethod: 'percentage',
        splitBetween: [
          { user: alex, percentage: 30 },
          { user: sam, percentage: 40 },
          { user: priya, percentage: 30 },
        ],
        recordedBy: alex,
      },
      shared(
        'houseboat',
        day(5),
        'Alleppey houseboat (overnight, all meals)',
        16500,
        sam,
        'accommodation',
        'Stay',
      ),
      shared(
        'canoe',
        day(5),
        'Canoe ride through the canals',
        900,
        alex,
        'entertainment',
        'Activities',
      ),
    ],
    edits: [],
    deletions: [],
    recurring: [],
    settlements: [
      {
        key: 'alex-to-sam',
        paidBy: alex,
        paidTo: sam,
        amount: 4000,
        note: 'Part of the houseboat share',
      },
    ],
    invitations: [],
  };
}

// --- Studio Lunch Club: a settled Work Group ---------------------------------------------

function workPlan(now: Date): DemoGroupPlan {
  const pair = [alex, sam];
  const priyaPersona = DEMO_PERSONAS.find((persona) => persona.id === priya)!;
  return {
    key: 'work',
    groupId: DEMO_WORK_GROUP_ID,
    name: 'Studio Lunch Club',
    description: 'Demo work group — team lunches and supplies at the design studio.',
    category: 'work',
    currency: DEMO_GROUPS_CURRENCY,
    adminId: alex,
    memberIds: pair,
    joinedAt: noonDaysAgo(75, now),
    startDate: null,
    endDate: null,
    expenses: [
      shared(
        'thali',
        calendarDaysAgo(58, now),
        'Team lunch — thali place',
        1640,
        alex,
        'food',
        'Meals',
        pair,
      ),
      shared(
        'pitch-coffee',
        calendarDaysAgo(44, now),
        'Coffee and pastries for the client pitch',
        1250,
        sam,
        'food',
        'Client',
        pair,
      ),
      shared(
        'printer-paper',
        calendarDaysAgo(31, now),
        'Printer paper and markers',
        780,
        alex,
        'shopping',
        'Supplies',
        pair,
      ),
      shared(
        'biryani',
        calendarDaysAgo(17, now),
        'Friday lunch — biryani',
        1920,
        sam,
        'food',
        'Meals',
        pair,
      ),
      shared('coffee-run', calendarDaysAgo(9, now), 'Coffee run', 460, alex, 'food', 'Meals', pair),
    ],
    edits: [],
    deletions: [],
    recurring: [],
    settlements: [
      {
        key: 'alex-to-sam',
        paidBy: alex,
        paidTo: sam,
        amount: 145,
        note: 'UPI — lunch club, all square',
      },
    ],
    invitations: [{ email: priyaPersona.email, invitedBy: alex }],
  };
}

/**
 * The demo Groups beside the Goa trip, in the order the seed writes them. The same run date
 * always gives the same plan.
 */
export function buildDemoGroupsPlan(now: Date = new Date()): DemoGroupPlan[] {
  return [workPlan(now), weekTripPlan(now), householdPlan(now)];
}

/**
 * The Group's default Tags with fixed ids, so every run gives the same Tag ids, and links
 * that name a Tag keep working after a reset. `b…` ids never meet the `a…` persona and
 * Group ids.
 */
export function demoGroupTags(
  plan: Pick<DemoGroupPlan, 'groupId' | 'category'>,
): Array<{ id: string; name: string }> {
  return defaultTagsForCategory(plan.category).map((name, index) => {
    if (index > 15) throw new Error(`Demo Group ${plan.groupId} has too many default Tags`);
    return { id: `b${plan.groupId.slice(-3).padStart(22, '0')}${index.toString(16)}`, name };
  });
}

/** Whether a demo Group's ledger should be written: only while it has none. */
export function shouldInsertDemoLedger(state: {
  expenseCount: number;
  settlementCount: number;
  recurringCount: number;
}): boolean {
  return state.expenseCount === 0 && state.settlementCount === 0 && state.recurringCount === 0;
}
