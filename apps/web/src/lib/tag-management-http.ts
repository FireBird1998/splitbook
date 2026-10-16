import { NextResponse } from 'next/server';
import { tagCommandSchema } from '@splitbook/shared/tag-management';
import { z } from 'zod';
import { TagManagementError } from '@/lib/services/tag-management.service';
import { error, serverError } from '@/lib/utils/api-response';
export const tagGroupIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const tagRequestIdSchema = z.string().uuid();
export async function readTagCommand(req: Request) {
  const body: unknown = await req.json().catch(() => {
    throw new TagManagementError('INVALID_TAG_COMMAND', 400);
  });
  if (!body || typeof body !== 'object' || !('requestId' in body))
    throw new TagManagementError('TAG_PRECONDITION_REQUIRED', 428);
  if (
    'intent' in body &&
    body.intent &&
    typeof body.intent === 'object' &&
    'action' in body.intent &&
    body.intent.action !== 'create' &&
    !('expectedRevision' in body.intent)
  )
    throw new TagManagementError('TAG_PRECONDITION_REQUIRED', 428);
  const parsed = tagCommandSchema.safeParse(body);
  if (!parsed.success) throw new TagManagementError('INVALID_TAG_COMMAND', 400);
  return parsed.data;
}
export function tagError(err: unknown) {
  if (!(err instanceof TagManagementError)) return serverError(err);
  const messages: Record<string, string> = {
    TAG_PRECONDITION_REQUIRED: 'Reload Tag management before making this change.',
    INVALID_TAG_COMMAND: 'Check the Tag name and submitted action, then try again.',
    TAG_ADMIN_REQUIRED: 'Only Group admins can manage Tags.',
    TAG_TRANSACTIONS_REQUIRED: 'Tag changes are temporarily unavailable. Try again later.',
    TAG_CHANGED: 'This Tag changed. Review its current state before applying your change.',
    TAG_EXISTS: 'A Tag with this name already exists. Archived Tags can be restored.',
    LAST_ACTIVE_TAG: 'Create or restore another Tag before removing the last active Tag.',
    REQUEST_KEY_REUSED: 'This request was already used for another action.',
    TAG_IN_USE: 'This Tag is used by Expenses or recurring templates and cannot be deleted.',
    AMBIGUOUS_TAG: 'This Tag has ambiguous historical references and cannot be renamed.',
  };
  return NextResponse.json(
    {
      error: messages[err.code] ?? 'Tag action could not be completed.',
      status: err.status,
      code: err.code,
      ...(err.snapshot ? { snapshot: err.snapshot } : {}),
      ...(err.existingTagId ? { existingTagId: err.existingTagId } : {}),
    },
    { status: err.status },
  );
}
export function invalidTagId() {
  return error('Invalid Group, Tag or request identity.', 400, 'INVALID_TAG_COMMAND');
}

/** Older URLs keep their Group response, but cannot bypass command identity or reviewed state. */
export async function readLegacyTagCommand(
  req: Request,
  action: 'create' | 'update' | 'delete',
  tagId?: string,
) {
  const text = await req.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new TagManagementError('INVALID_TAG_COMMAND', 400);
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !('requestId' in body) ||
    (action !== 'create' && !('expectedRevision' in body))
  )
    throw new TagManagementError('TAG_PRECONDITION_REQUIRED', 428);
  const schema =
    action === 'create'
      ? z.object({ requestId: tagRequestIdSchema, name: z.string() }).strict()
      : action === 'delete'
        ? z.object({ requestId: tagRequestIdSchema, expectedRevision: z.number() }).strict()
        : z
            .object({
              requestId: tagRequestIdSchema,
              expectedRevision: z.number(),
              name: z.string().optional(),
              isArchived: z.boolean().optional(),
            })
            .strict()
            .refine((value) => (value.name !== undefined) !== (value.isArchived !== undefined));
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new TagManagementError('INVALID_TAG_COMMAND', 400);
  const data = parsed.data;
  const intent =
    action === 'create' && 'name' in data
      ? { action: 'create', name: data.name }
      : action === 'delete' && 'expectedRevision' in data
        ? { action: 'delete', tagId, expectedRevision: data.expectedRevision }
        : 'expectedRevision' in data && 'name' in data && data.name !== undefined
          ? { action: 'rename', tagId, expectedRevision: data.expectedRevision, name: data.name }
          : 'expectedRevision' in data && 'isArchived' in data
            ? {
                action: data.isArchived ? 'archive' : 'restore',
                tagId,
                expectedRevision: data.expectedRevision,
              }
            : null;
  const command = tagCommandSchema.safeParse({ requestId: data.requestId, intent });
  if (!command.success) throw new TagManagementError('INVALID_TAG_COMMAND', 400);
  return command.data;
}
