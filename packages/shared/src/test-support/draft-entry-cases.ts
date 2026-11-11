import type { ExpenseDraftValues } from '../validators/expense-draft';
import { alex, sam } from './expense-entry-cases';

/** Additional review inputs: unused facts and repeated identities survive the stored format. */
export const draftEntryCases: {
  id: string;
  values: ExpenseDraftValues;
  change: 'shares' | 'note';
}[] = [
  {
    id: 'other-split-parts',
    change: 'shares',
    values: {
      description: 'Lunch',
      amount: 100,
      currency: 'INR',
      splitMethod: 'shares',
      paidBy: [{ user: alex, amount: 100 }],
      splitBetween: [
        { user: alex, amount: 50, percentage: 50, shares: 1 },
        { user: sam, amount: 50, percentage: 50, shares: 1 },
      ],
    },
  },
  {
    id: 'repeated-payer',
    change: 'note',
    values: {
      description: 'Lunch',
      amount: 100,
      currency: 'INR',
      splitMethod: 'equal',
      paidBy: [
        { user: alex, amount: 40 },
        { user: alex, amount: 60 },
      ],
      splitBetween: [{ user: alex }, { user: sam }],
    },
  },
];
