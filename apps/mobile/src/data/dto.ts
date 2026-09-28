import {
  parseGroupListResponse,
  parseGroupResponse,
  parseCreatedGroupResponse,
  type GroupRead,
} from '@splitbook/shared/group-read';
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

export function toMobileGroup(value: GroupRead): MobileGroup {
  return {
    id: value._id,
    name: value.name,
    description: value.description,
    category: value.category,
    defaultCurrency: value.defaultCurrency,
    members: value.members.map(({ user, role, joinedAt }) => ({
      user: { id: user._id, name: user.name, email: user.email, image: user.image ?? null },
      role,
      joinedAt: new Date(joinedAt),
    })),
    startDate: value.startDate === null ? null : new Date(value.startDate),
    endDate: value.endDate === null ? null : new Date(value.endDate),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  };
}

export function parseGroups(value: unknown): MobileGroup[] {
  return parseGroupListResponse(value).map(toMobileGroup);
}

export function parseGroup(value: unknown): MobileGroup {
  return toMobileGroup(parseGroupResponse(value));
}

export function parseCreatedGroup(value: unknown): MobileGroup {
  return toMobileGroup(parseCreatedGroupResponse(value));
}

export function parseInvitationPreview(value: unknown) {
  const data = z
    .object({
      data: z.object({
        _id: objectId,
        name: z.string().min(1),
        category: z.enum(['trip', 'home', 'couple', 'work', 'other']),
        memberCount: z.number().int().nonnegative(),
      }),
      status: z.literal(200),
    })
    .parse(value).data;
  return { id: data._id, name: data.name, category: data.category, memberCount: data.memberCount };
}

export function parseJoinedGroup(value: unknown): string {
  return z
    .object({
      data: z.object({ groupId: objectId }),
      status: z.union([z.literal(200), z.literal(201)]),
    })
    .parse(value).data.groupId;
}

export function parseInviteLink(value: unknown) {
  return z
    .object({
      data: z.union([
        z.object({
          inviteCode: z.literal(null),
          inviteUrl: z.literal(null),
          expiresAt: z.literal(null),
        }),
        z.object({
          inviteCode: z.string().regex(/^[a-f\d]{8}$/),
          inviteUrl: z.url(),
          expiresAt: timestamp,
        }),
      ]),
      status: z.union([z.literal(200), z.literal(201)]),
    })
    .parse(value).data;
}
