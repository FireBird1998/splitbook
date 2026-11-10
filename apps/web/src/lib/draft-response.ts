import { API_CACHE_CONTROL } from '@/lib/api-cache-control';
import { ZodError } from 'zod';
import { Refusal } from '@splitbook/shared/refusals';
import { isDatabaseUnreachable } from '@/lib/mongodb-client';
import { databaseUnavailable, serverError, validationError } from '@/lib/utils/api-response';

export function draftError(cause: unknown, caller: 'draft' | 'draft-save' = 'draft') {
  if (cause instanceof ZodError) return validationError(cause);
  if (cause instanceof SyntaxError) return serverError(new Refusal('INVALID_JSON'));
  if (cause instanceof Refusal) return serverError(cause);
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
