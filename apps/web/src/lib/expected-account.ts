/**
 * The account a web page was rendered for, sent with every `/api/` request
 * that page makes (see `src/lib/utils/api-fetch.ts`). When the browser's
 * session has since moved to another account (in another tab), the API
 * answers 419 `ACCOUNT_CHANGED` before it reads or writes anything, and the
 * page reloads for the account signed in now.
 *
 * Requests without the header (page loads, server components, the mobile
 * app) are unaffected. Safe for both server and browser code.
 */
export const EXPECTED_ACCOUNT_HEADER = 'X-Expected-Account';

/** No other route answers 419: 401 is signed out, 409 a revision or idempotency conflict. */
export const ACCOUNT_CHANGED_STATUS = 419;

export const ACCOUNT_CHANGED = 'ACCOUNT_CHANGED';
