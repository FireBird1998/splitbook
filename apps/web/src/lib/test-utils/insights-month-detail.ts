/**
 * The Month in detail (#315) for a fictional Household's September 2026, as the Group insights
 * read sends it after #314's fields: By Tag against March to August, who paid against their
 * share, and three recurring templates. It fits a read whose September Spent is ₹18,420.00 with
 * three Expenses added by recurring Expenses, compared with March to August.
 */

import type {
  GroupInsightsByTagRead,
  GroupInsightsRecurringRead,
  GroupInsightsWhoPaidRead,
} from '@splitbook/shared/group-insights-read';

export const DETAIL_IDS = {
  alex: 'a00000000000000000000001',
  sam: 'a00000000000000000000002',
  priya: 'a00000000000000000000003',
  household: 'd00000000000000000000011',
  utilities: 'd00000000000000000000012',
  groceries: 'd00000000000000000000013',
  cook: 'e00000000000000000000001',
  wifi: 'e00000000000000000000002',
  purifier: 'e00000000000000000000003',
} as const;

const ids = DETAIL_IDS;

export const SEPTEMBER_DETAIL: {
  byTag: GroupInsightsByTagRead;
  whoPaid: GroupInsightsWhoPaidRead;
  recurring: GroupInsightsRecurringRead;
} = {
  byTag: {
    earlierMonths: ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
    tags: [
      {
        tagId: ids.household,
        name: 'Household',
        spentMinor: 589000,
        expenseCount: 5,
        averageMinor: 541000,
        differenceMinor: 48000,
        direction: 'up',
        changePercent: 8.9,
      },
      {
        tagId: ids.utilities,
        name: 'Utilities',
        spentMinor: 496200,
        expenseCount: 3,
        averageMinor: 454000,
        differenceMinor: 42200,
        direction: 'up',
        changePercent: 9.3,
      },
      {
        tagId: ids.groceries,
        name: 'Groceries',
        spentMinor: 398800,
        expenseCount: 4,
        averageMinor: 421500,
        differenceMinor: -22700,
        direction: 'down',
        changePercent: -5.4,
      },
      {
        tagId: null,
        name: null,
        spentMinor: 358000,
        expenseCount: 2,
        averageMinor: 0,
        differenceMinor: 358000,
        direction: 'up',
        changePercent: null,
      },
    ],
  },
  whoPaid: {
    members: [
      {
        id: ids.priya,
        name: 'Priya Shah',
        isMember: true,
        paidMinor: 667700,
        shareMinor: 614000,
        netMinor: 53700,
      },
      {
        id: ids.sam,
        name: 'Sam Chen',
        isMember: true,
        paidMinor: 653300,
        shareMinor: 614000,
        netMinor: 39300,
      },
      {
        id: ids.alex,
        name: 'Alex Rivera',
        isMember: true,
        paidMinor: 521000,
        shareMinor: 614000,
        netMinor: -93000,
      },
    ],
  },
  recurring: {
    addedInMonth: { count: 3, spentMinor: 484900 },
    templates: [
      {
        id: ids.cook,
        description: 'Cook',
        amountMinor: 300000,
        dayOfMonth: 5,
        paused: false,
        nextDate: '2026-10-05',
        addedOn: '2026-09-05',
        paidBy: [{ id: ids.priya, name: 'Priya Shah' }],
      },
      {
        id: ids.purifier,
        description: 'Water purifier service',
        amountMinor: 85000,
        dayOfMonth: 21,
        paused: false,
        nextDate: '2026-10-21',
        addedOn: '2026-09-21',
        paidBy: [{ id: ids.sam, name: 'Sam Chen' }],
      },
      {
        id: ids.wifi,
        description: 'Wi-Fi',
        amountMinor: 99900,
        dayOfMonth: 28,
        paused: false,
        nextDate: '2026-10-28',
        addedOn: '2026-09-28',
        paidBy: [{ id: ids.alex, name: 'Alex Rivera' }],
      },
    ],
  },
};
