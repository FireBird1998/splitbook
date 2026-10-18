import { ZodError } from 'zod';
import { DRAFT_GROUP_LIMIT_MESSAGE } from '@splitbook/shared/validators/expense-draft';
import { error, serverError, validationError } from '@/lib/utils/api-response';

export function draftError(cause: unknown) {
  if (cause instanceof ZodError) return validationError(cause);
  if (cause instanceof SyntaxError) return error('Invalid JSON body', 400, 'INVALID_JSON');
  if (cause instanceof Error) {
    if (cause.message === 'DRAFTS_DISABLED')
      return error('Drafts are not enabled', 404, cause.message);
    if (cause.message === 'REQUEST_TOO_LARGE')
      return error('Request too large', 413, cause.message);
    if (cause.message === 'DRAFT_GROUP_LIMIT')
      return error(DRAFT_GROUP_LIMIT_MESSAGE, 409, cause.message);
    if (cause.message === 'DRAFT_NOT_FOUND') return error('Draft not found', 404, cause.message);
    if (cause.message === 'DRAFT_TRANSACTIONS_REQUIRED')
      return error('Draft changes are temporarily unavailable.', 503, cause.message);
  }
  if (
    cause instanceof Error &&
    [
      'FORBIDDEN',
      'GROUP_ARCHIVED',
      'IDEMPOTENCY_CONFLICT',
      'STALE_REVISION',
      'REVISION_REQUIRED',
      'ACCOUNT_CHANGED',
    ].includes(cause.message)
  )
    return serverError(cause);
  // Database errors may embed submitted values. Never log them at this private boundary.
  return error(
    'Draft request not confirmed. Reload before retrying; reuse the original creation request.',
    503,
    'DRAFT_UNCONFIRMED',
  );
}

export function privateDraftResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
