export async function fetcher(url: string) {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { error?: string }).error || res.statusText || 'Request failed');
  }
  return json;
}
