/** The Activity page read contract (#210), returned in wire shape. */
import { z } from 'zod';
import {
  amount,
  changes,
  currencyCode,
  identity,
  pagination,
  person,
  timestamp,
} from './wire-fields';

const metadata = z.looseObject({
  userId: identity.optional(),
  method: z.string().optional(),
  expenseId: identity.optional(),
  settlementId: identity.optional(),
  description: z.string().optional(),
  amount: amount.optional(),
  currency: currencyCode.optional(),
  paidByName: z.string().optional(),
  paidToName: z.string().optional(),
  recurring: z.boolean().optional(),
  action: z.string().optional(),
  changes: changes.optional(),
});
const event = z.looseObject({
  _id: identity,
  group: identity,
  type: z.string().min(1),
  actor: person,
  createdAt: timestamp,
  metadata: metadata.nullish(),
});
const activityPage = z.looseObject({ activities: z.array(event), pagination });

export type ActivityPageRead = z.infer<typeof activityPage>;
export type ActivityEventRead = ActivityPageRead['activities'][number];

/** Keep malformed remote data out of both apps' views and out of error messages. */
export class ActivityPageReadError extends Error {
  constructor() {
    super('Unable to load Activity. Please retry.');
    this.name = 'ActivityPageReadError';
  }
}

const response = z.object({ status: z.literal(200), data: activityPage });

export function parseActivityPageResponse(value: unknown): ActivityPageRead {
  const result = response.safeParse(value);
  if (!result.success) throw new ActivityPageReadError();
  return result.data.data;
}
