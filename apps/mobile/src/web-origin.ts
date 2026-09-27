/** Parse a configured HTTP(S) origin without credentials, a path, or URL extras. */
export function parseWebOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
