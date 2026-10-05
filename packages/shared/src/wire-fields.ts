/**
 * Field rules the response decoders share (#210). They check the wire shape and transform
 * nothing: times stay ISO strings, people stay as the server sent them, and every object
 * keeps the fields it doesn't declare.
 */
import { z } from 'zod';

export const identity = z.string().regex(/^[a-f\d]{24}$/i);
export const timestamp = z.iso.datetime({ offset: true });
/** Zod 4 numbers are finite: Infinity and NaN fail. */
export const amount = z.number();
/**
 * A historical read keeps a currency outside today's list, as the shared Group read does
 * for alternate currencies. A client that only reads today's list checks it itself.
 */
export const currencyCode = z.string();
export const splitMethod = z.enum(['equal', 'unequal', 'exact', 'percentage', 'shares']);

/** Any positive page size; a caller that asked for one size checks it. */
export const pagination = z.looseObject({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

/** Someone named in a read: populated, an id alone, or null for a former member. */
export const person = z.union([
  identity,
  z.looseObject({ _id: identity, name: z.string().optional() }),
  z.null(),
]);
/** A person in Balances and Expense pages, where a populated person's image is checked too. */
export const financialPerson = z.union([
  identity,
  z.looseObject({ _id: identity, name: z.string().optional(), image: z.string().nullish() }),
  z.null(),
]);

/** A recorded edit's fields, before and after. */
export const changes = z.record(
  z.string(),
  z.looseObject({ old: z.unknown().optional(), new: z.unknown().optional() }),
);

export type PersonRead = z.infer<typeof person>;
export type FinancialPersonRead = z.infer<typeof financialPerson>;
