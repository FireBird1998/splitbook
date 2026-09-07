export async function fetcher(url: string) {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined') {
    // The session is gone (expired, or signed out in another tab). Resume at
    // /login the way a page navigation would, then let the caller fail fast.
    const callbackUrl = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  if (!res.ok) {
    throw new Error((json as { error?: string }).error || res.statusText || 'Request failed');
  }
  return json;
}
