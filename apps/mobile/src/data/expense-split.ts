import { getCurrencyPrecision } from '@splitbook/shared/currency';
import {
  splitBreakdown,
  splitChoiceOf,
  type SplitBreakdown,
  type SplitChoice,
  type SplitEntryProblem,
  type SplitLeftover,
  type SplitProblem,
} from '@splitbook/shared/expense-split';
import { expenseMoney, type ExpenseDraft } from './expense-draft';
import { amountExample } from './field-feedback';

/**
 * The Split sheet's view of a draft (#123), in words. Pure: no React, storage or requests. The
 * shared split rules work out every share and problem from the shared exact-money rules; this
 * only gives them the draft and words what they report.
 */

/** "The leftover ₹0.01 goes to Sam Chen so the total is exact." */
export function roundingNote(
  leftover: SplitLeftover,
  name: (id: string) => string,
  money: (minor: number) => string,
) {
  const names = leftover.users.map(name);
  const people =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `The leftover ${money(leftover.amountMinor)} goes to ${people} so the total is exact.`;
}

/** The shared split status, with a problem in words. */
export type SplitStatus =
  | Exclude<SplitBreakdown['status'], { kind: 'problem' }>
  | { kind: 'problem'; message: string };

export interface SplitPreview {
  /** The Expense amount in minor units, or null while it isn't valid. */
  total: number | null;
  /** Each included person's resulting share in minor units, when it can be worked out. */
  shares: Partial<Record<string, number>>;
  /** Corrections for individual entries, by person. */
  errors: Partial<Record<string, string>>;
  status: SplitStatus;
}

/** Why one person's entry can't be used, beside it. Nothing is rounded or corrected for them. */
function entryError(choice: SplitChoice, problem: SplitEntryProblem, currency: string) {
  if (problem === 'not-whole') return 'Use a whole number of shares.';
  if (problem === 'negative')
    return choice === 'shares'
      ? 'Shares can’t be negative.'
      : choice === 'percentage'
        ? 'Percentages can’t be negative.'
        : 'Amounts can’t be negative.';
  if (problem === 'too-large')
    return choice === 'percentage'
      ? 'A percentage can be at most 100.'
      : 'That’s more than the Expense total.';
  if (choice === 'percentage')
    return problem === 'too-precise'
      ? 'Percentages can have at most 2 decimal places. Nothing is rounded for you.'
      : 'Use digits and one decimal point, such as 33.5.';
  const digits = getCurrencyPrecision(currency);
  if (problem === 'too-precise')
    return `${currency} amounts ${
      digits
        ? `can have at most ${digits} decimal ${digits === 1 ? 'place' : 'places'}`
        : 'can’t include decimal places'
    }. Nothing is rounded for you.`;
  return digits
    ? `Use digits and one decimal point, such as ${amountExample(currency)}.`
    : `Use digits only, such as ${amountExample(currency)}.`;
}

const problemMessages: Record<SplitProblem, string> = {
  'no-participants': 'Choose at least one person to share this Expense.',
  'marked-entry': 'Correct the entry marked above.',
  'marked-entries': 'Correct the entries marked above.',
  'no-shares': 'Give at least one person a share.',
  unexplained: 'Review how this Expense is split.',
};

/**
 * Each person's share, any entry that needs correcting, and whether the split adds up, from
 * the draft's whole allocation as it would be saved.
 */
export function previewSplit(draft: ExpenseDraft): SplitPreview {
  const { problems, status, ...breakdown } = splitBreakdown(draft, (multiPayer) =>
    expenseMoney({ ...draft, multiPayer }),
  );
  const choice = splitChoiceOf(draft.splitMethod);
  const errors: SplitPreview['errors'] = {};
  for (const [id, problem] of Object.entries(problems))
    if (problem) errors[id] = entryError(choice, problem, draft.currency);
  return {
    ...breakdown,
    errors,
    status:
      status.kind !== 'problem'
        ? status
        : {
            kind: 'problem',
            message: status.reason === 'refused' ? status.message : problemMessages[status.reason],
          },
  };
}
