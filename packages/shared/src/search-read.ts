/**
 * The search read's contract (#321): what `GET /api/search?q=…` answers, in wire shape. Results
 * come in three sections, each capped (see `SEARCH_LIMITS`), with whether more matched. People
 * carry a name and never an email address.
 */
import { z } from 'zod';
import { currencyCode, identity, timestamp } from './wire-fields';

const groupResult = z.looseObject({
  id: identity,
  name: z.string(),
  /** The Theme's stored category; an unknown one reads as General. */
  category: z.string(),
  memberCount: z.number().int().nonnegative(),
});

const personResult = z.looseObject({
  id: identity,
  name: z.string(),
  /** The first Group the member shares with them, in the order of the member's Group list. */
  groupId: identity,
  groupName: z.string(),
  /** How many of the member's Groups they are in. */
  groupCount: z.number().int().positive(),
});

const expenseResult = z.looseObject({
  id: identity,
  groupId: identity,
  groupName: z.string(),
  description: z.string(),
  /** Exact minor units, or null when the stored amount can't be read exactly. */
  amountMinor: z.number().int().nonnegative().nullable(),
  currency: currencyCode,
  date: timestamp,
});

const searchRead = z.looseObject({
  /** The query as searched, normalized; empty when nothing was searched. */
  query: z.string(),
  groups: z.array(groupResult),
  people: z.array(personResult),
  expenses: z.array(expenseResult),
  /** Whether each section had more matches than it returned. */
  more: z.looseObject({ groups: z.boolean(), people: z.boolean(), expenses: z.boolean() }),
});

export type SearchRead = z.infer<typeof searchRead>;
export type SearchGroupResult = z.infer<typeof groupResult>;
export type SearchPersonResult = z.infer<typeof personResult>;
export type SearchExpenseResult = z.infer<typeof expenseResult>;

/** Keep malformed remote data out of the views and out of error messages. */
export class SearchReadError extends Error {
  constructor() {
    super('Search could not be loaded. Please retry.');
    this.name = 'SearchReadError';
  }
}

const response = z.object({ status: z.literal(200), data: searchRead });

export function parseSearchResponse(value: unknown): SearchRead {
  const result = response.safeParse(value);
  if (!result.success) throw new SearchReadError();
  return result.data.data;
}
