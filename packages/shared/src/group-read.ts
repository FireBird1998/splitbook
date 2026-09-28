/** The Group HTTP read contract. Persistence documents and write validation stay separate. */
import { z } from 'zod';
import { getCurrency } from './currency';

const identity = z.string().regex(/^[a-f\d]{24}$/i);
const timestamp = z.iso.datetime({ offset: true });
const name = z.string().refine((value) => value.trim().length > 0);
const image = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);
const person = z.looseObject({ _id: identity, name, email: z.email(), image });
const tag = z.looseObject({
  _id: identity,
  name,
  isArchived: z.boolean().optional().default(false),
  isDeleted: z.boolean().optional().default(false),
  createdAt: timestamp,
});

const group = z.looseObject({
  _id: identity,
  name,
  description: z.string().optional().default(''),
  image,
  createdBy: identity,
  members: z.array(
    z.looseObject({
      user: person,
      role: z.enum(['admin', 'member']),
      joinedAt: timestamp,
    }),
  ),
  tags: z.array(tag).optional().default([]),
  defaultCurrency: z.string().refine((value) => getCurrency(value) !== undefined),
  currencyLocked: z.boolean().optional().default(false),
  // Historical read values are not constrained by today's write currency list or limit.
  alternateCurrencies: z.array(z.string()).optional().default([]),
  category: z.enum(['trip', 'home', 'couple', 'work', 'other']).optional().default('other'),
  startDate: timestamp.nullish().transform((value) => value ?? null),
  endDate: timestamp.nullish().transform((value) => value ?? null),
  isArchived: z.boolean().optional().default(false),
  inviteCode: z.string().nullish(),
  inviteCodeExpiresAt: timestamp.nullish(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export type GroupRead = z.infer<typeof group>;
export type GroupReadMember = GroupRead['members'][number];
export type GroupReadTag = GroupRead['tags'][number];

/** Keep malformed remote data out of both presentation models and error messages. */
export class GroupReadError extends Error {
  constructor() {
    super('Unable to load Groups. Please retry.');
    this.name = 'GroupReadError';
  }
}

const listResponse = z.object({ status: z.literal(200), data: z.array(group) });
const detailResponse = z.object({ status: z.literal(200), data: group });
const createdResponse = z.object({ status: z.literal(201), data: group });

export function parseGroupListResponse(value: unknown): GroupRead[] {
  const result = listResponse.safeParse(value);
  if (!result.success) throw new GroupReadError();
  return result.data.data;
}

export function parseGroupResponse(value: unknown): GroupRead {
  const result = detailResponse.safeParse(value);
  if (!result.success) throw new GroupReadError();
  return result.data.data;
}

export function parseCreatedGroupResponse(value: unknown): GroupRead {
  const result = createdResponse.safeParse(value);
  if (!result.success) throw new GroupReadError();
  return result.data.data;
}
