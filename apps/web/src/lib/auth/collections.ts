/**
 * Names shared between the Mongoose models, Better Auth's MongoDB adapter and
 * the authentication data migration. Edge-safe: constants only.
 */

/** Application users; Better Auth's `user` model with plural collection names. */
export const USERS_COLLECTION = 'users';
/** Better Auth account rows (one per Google identity linked to a user). */
export const ACCOUNTS_COLLECTION = 'accounts';
/** Where the migration parks the Auth.js account rows until the cleanup ticket drops them. */
export const ACCOUNTS_AUTHJS_BACKUP_COLLECTION = 'accounts_authjs_backup';
/** Where `--revert` parks Better Auth account rows so the Auth.js rows can return. */
export const ACCOUNTS_BETTER_AUTH_BACKUP_COLLECTION = 'accounts_betterauth_backup';

/**
 * Unique index on `users.email`.
 *
 * Better Auth's MongoDB adapter creates field-level indexes under generated
 * names (`<collection>_<field>_uidx`) before it writes to a collection, and
 * MongoDB refuses a second index with the same keys under a different name
 * (`IndexOptionsConflict`). The Mongoose schema therefore declares the same
 * name, and the migration renames the legacy `email_1` index to it.
 */
export const USERS_EMAIL_INDEX = 'users_email_uidx';
/** The unique email index Mongoose created before the migration. */
export const LEGACY_USERS_EMAIL_INDEX = 'email_1';
