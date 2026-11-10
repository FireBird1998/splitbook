import { API_CACHE_CONTROL } from '@/lib/api-cache-control';
import { serverError } from '@/lib/utils/api-response';

export function draftError(cause: unknown, caller: 'draft' | 'draft-save' = 'draft') {
  return serverError(cause, caller);
}

export function privateDraftResponse<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', API_CACHE_CONTROL);
  return response;
}
