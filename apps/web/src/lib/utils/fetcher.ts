import { apiFetch, signInAgain } from '@/lib/utils/api-fetch';
import { noteAnswered } from '@/lib/utils/read-times';

export class HttpResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpResponseError';
  }
}

export async function fetcher(url: string) {
  // A 419 (the session moved to another account) never settles: the page reloads instead.
  const res = await apiFetch(url);
  const json = await res.json().catch(() => ({}));
  // The session is gone: resume at /login, then let the caller fail fast.
  if (res.status === 401) signInAgain();
  if (!res.ok) {
    const message = (json as { error?: unknown } | null)?.error;
    throw new HttpResponseError(
      (typeof message === 'string' && message) || res.statusText || 'Request failed',
      res.status,
    );
  }
  noteAnswered(url);
  return json;
}
