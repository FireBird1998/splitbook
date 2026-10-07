import { apiFetch } from '@/lib/utils/api-fetch';
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
  if (res.status === 401 && typeof window !== 'undefined') {
    // The session is gone (expired, or signed out in another tab). Resume at
    // /login the way a page navigation would, then let the caller fail fast.
    const callbackUrl = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
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
