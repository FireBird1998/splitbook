/** Read an invitation code at the native application's incoming-link boundary. */
export function parseInvitationLink(value: string, origin: string): string | null {
  try {
    const expected = new URL(origin);
    if (
      !['http:', 'https:'].includes(expected.protocol) ||
      expected.username ||
      expected.password ||
      expected.search ||
      expected.hash ||
      expected.pathname !== '/'
    )
      return null;
    // Match the original string: URL parsing would erase dot segments and some
    // control characters before we could reject a noncanonical incoming link.
    const prefix = `${expected.origin}/join/`;
    if (!value.startsWith(prefix)) return null;
    const code = value.slice(prefix.length);
    return code.length === 8 && /^[a-f\d]{8}$/i.test(code) ? code.toLowerCase() : null;
  } catch {
    return null;
  }
}
