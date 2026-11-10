import { API_CACHE_CONTROL } from '@/lib/api-cache-control';
import { ZodError } from 'zod';
import { Refusal, type RefusalCode } from '@splitbook/shared/refusals';
import { isDatabaseUnreachable } from '@/lib/mongodb-client';
import { databaseUnavailable, serverError, validationError } from '@/lib/utils/api-response';

// The original census records these refusals as uncertainty in this family. Preserve that
// inconsistency until the owner decides #1086, while other typed refusals answer as themselves.
const hiddenDraftRefusals: ReadonlySet<RefusalCode> = new Set([
  'ACTIVITY_BACKLOG_FULL',
  'ALREADY_INVITED',
  'CURRENCY_LOCKED',
  'CURRENCY_MISMATCH',
  'FORBIDDEN_SETTLEMENT',
  'GROUP_DELETION_CONFIRMATION_REQUIRED',
  'GROUP_DELETION_UNAVAILABLE',
  'INVALID_ID',
  'INVALID_IDEMPOTENCY_KEY',
  'INVALID_JSON',
  'INVALID_MEMBERS',
  'INVALID_TAG',
  'INVALID_WINDOW',
  'INVITATION_EXPIRED',
  'INVITATION_NOT_PENDING',
  'LAST_ADMIN',
  'LEAVE_CONFLICT',
  'NOT_HOUSEHOLD',
  'NO_SETTLEMENT_DEBT',
  'RECURRING_EXPENSES_OFF',
  'REMOVAL_CONFLICT',
  'SAME_PARTY',
  'SELF_REMOVE',
  'SETTLEMENT_TRANSACTIONS_REQUIRED',
]);

export function draftError(cause: unknown, caller: 'draft' | 'draft-save' = 'draft') {
  if (cause instanceof ZodError) return validationError(cause);
  if (cause instanceof SyntaxError) return serverError(new Refusal('INVALID_JSON'));
  if (cause instanceof Refusal && !hiddenDraftRefusals.has(cause.code)) return serverError(cause);
  if (isDatabaseUnreachable(cause)) return databaseUnavailable(cause);
  // Other failures can contain submitted values. Keep uncertainty private and unlogged.
  return serverError(
    new Refusal('DRAFT_UNCONFIRMED', caller === 'draft-save' ? { variant: 'save' } : undefined),
  );
}

export function privateDraftResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', API_CACHE_CONTROL);
  return response;
}
