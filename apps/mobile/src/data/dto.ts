import { getCurrency } from '@splitbook/shared/currency';
import { z } from 'zod';
import type { MobileGroup, SessionUser } from './types';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const image = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null);
const personFields = { name: z.string().min(1), email: z.email(), image };
const user = z.object({ id: objectId, ...personFields });
const memberUser = z.object({ _id: objectId, ...personFields }).transform(({ _id, ...rest }) => ({
  id: _id,
  ...rest,
}));

const group = z
  .object({
    _id: objectId,
    name: z.string().min(1),
    description: z.string().optional().default(''),
    category: z.enum(['trip', 'home', 'couple', 'work', 'other']),
    defaultCurrency: z.string().refine((value) => getCurrency(value) !== undefined),
    members: z.array(
      z.object({
        user: memberUser,
        role: z.enum(['admin', 'member']),
        joinedAt: timestamp,
      }),
    ),
    startDate: timestamp.nullish().transform((value) => value ?? null),
    endDate: timestamp.nullish().transform((value) => value ?? null),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .transform(({ _id, ...rest }) => ({ id: _id, ...rest }));

const session = z
  .object({ user, session: z.object({ userId: objectId, expiresAt: timestamp }) })
  .refine((value) => value.session.userId === value.user.id);

export function parseSession(value: unknown): { user: SessionUser; expiresAt: Date } | null {
  if (value === null) return null;
  const result = session.parse(value);
  return { user: result.user, expiresAt: result.session.expiresAt };
}

export function parseSignIn(value: unknown): SessionUser {
  // The raw token is deliberately discarded; only the signed response cookie is usable.
  return z.object({ user }).parse(value).user;
}

export function parseGroups(value: unknown): MobileGroup[] {
  return z.object({ data: z.array(group), status: z.literal(200) }).parse(value).data;
}

export function parseGroup(value: unknown): MobileGroup {
  return z.object({ data: group, status: z.literal(200) }).parse(value).data;
}
