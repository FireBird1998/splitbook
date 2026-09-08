/**
 * Private-beta allowlist for Google sign-in. Edge-safe: no Node-only imports.
 *
 * Better Auth calls `validateAllowedUser` (wired as `user.validateUserInfo`)
 * just before it creates a user, links an account and, for OAuth, on every
 * sign-in of an existing user — so removing an address from
 * `AUTH_ALLOWED_EMAILS` locks that person out at their next Google sign-in,
 * exactly as the Auth.js `signIn` callback did. Demo personas never pass
 * through this gate: their plugin creates a session for an existing user
 * without provisioning.
 */

export interface AllowlistEnv {
  AUTH_ALLOWED_EMAILS?: string | undefined;
}

/** Error code Better Auth appends to the login page as `?error=<code>`. */
export const EMAIL_NOT_ALLOWED = 'email_not_allowed';

export interface AllowlistRejection {
  error: typeof EMAIL_NOT_ALLOWED;
  errorDescription: string;
}

export function normaliseEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const normalised = email.trim().toLowerCase();
  return normalised.length ? normalised : null;
}

/** Parse the comma-separated allowlist; trimmed, lower-cased, blanks dropped. */
export function parseAllowedEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((entry) => normaliseEmail(entry))
      .filter((entry): entry is string => entry !== null),
  );
}

/** Fail closed: an empty or missing allowlist admits nobody. */
export function isEmailAllowed(email: unknown, env: AllowlistEnv = process.env): boolean {
  const normalised = normaliseEmail(email);
  if (!normalised) return false;
  return parseAllowedEmails(env.AUTH_ALLOWED_EMAILS).has(normalised);
}

/**
 * Better Auth `user.validateUserInfo` gate. Returns nothing to admit the
 * identity and a rejection (surfaced as a 403 with this code, or as
 * `?error=email_not_allowed` on the login page after a browser flow) otherwise.
 */
export function validateAllowedUser(
  data: { user: { email?: string | null | undefined } },
  env: AllowlistEnv = process.env,
): AllowlistRejection | undefined {
  if (isEmailAllowed(data.user.email, env)) return undefined;
  return {
    error: EMAIL_NOT_ALLOWED,
    errorDescription: 'This Google account is not invited to the private beta.',
  };
}
