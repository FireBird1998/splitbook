/**
 * What a member is told when Splitbook couldn't reach its database (#826, #858, #862): the
 * request tried once more and still failed. Every API answers 503 with this code and these
 * words, a web page shows them in place of the page, and each client says them as they are.
 * The owner chose the words on 2026-11-05.
 */
export const DATABASE_UNAVAILABLE = 'DATABASE_UNAVAILABLE';
export const DATABASE_UNAVAILABLE_MESSAGE = 'Couldn’t reach Splitbook. Try again.';
